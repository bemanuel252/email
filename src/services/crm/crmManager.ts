import {
  getEnabledCrmConnections,
  upsertCrmContact,
  upsertCrmContacts,
  getCrmContactByEmail,
  clearCrmContactsForConnection,
  updateConnectionSyncStatus,
} from "@/services/db/crmConnections";
import { createCrmAdapter } from "./crmAdapterFactory";
import type { CrmContact, CrmLookupResult, CrmProvider } from "./types";
import type { DbCrmContact, DbCrmConnection } from "@/services/db/crmConnections";

/** Maximum age of a cached contact before triggering a live refresh (24 hours). */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

function isCacheStale(contact: DbCrmContact): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds - contact.last_synced_at > CACHE_TTL_SECONDS;
}

function crmContactToUpsert(
  contact: CrmContact,
  connectionId: string,
): Parameters<typeof upsertCrmContact>[0] {
  return {
    connectionId,
    email: contact.email,
    displayName: contact.displayName,
    company: contact.company,
    title: contact.title,
    phone: contact.phone,
    dealStage: contact.dealStage,
    dealValue: contact.dealValue,
    tagsJson: JSON.stringify(contact.tags),
    rawJson: JSON.stringify(contact.rawData),
    crmRecordId: contact.crmRecordId,
    crmRecordUrl: contact.crmRecordUrl,
  };
}

function dbContactToCrmLookupResult(
  cached: DbCrmContact,
  connection: DbCrmConnection,
): CrmLookupResult {
  return {
    connectionId: connection.id,
    provider: connection.provider as CrmProvider,
    displayName: connection.display_name,
    contact: {
      email: cached.email,
      displayName: cached.display_name,
      company: cached.company,
      title: cached.title,
      phone: cached.phone,
      dealStage: cached.deal_stage,
      dealValue: cached.deal_value,
      tags: (() => {
        try {
          return JSON.parse(cached.tags_json) as string[];
        } catch {
          return [];
        }
      })(),
      crmRecordId: cached.crm_record_id,
      crmRecordUrl: cached.crm_record_url,
      rawData: (() => {
        try {
          return JSON.parse(cached.raw_json) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    },
    error: null,
  };
}

/**
 * Look up a contact by email across all enabled connections.
 *
 * Strategy:
 * 1. Load all enabled connections.
 * 2. For each connection, check the local cache.
 *    - If cached and fresh (< 24 h), return from cache.
 *    - If not cached or stale, do a live API lookup, upsert the result, and return it.
 * 3. Return one CrmLookupResult per enabled connection.
 *
 * Connections are queried in parallel; individual failures are captured
 * as error results rather than rejecting the whole call.
 */
export async function lookupContactByEmail(
  email: string,
): Promise<CrmLookupResult[]> {
  const connections = await getEnabledCrmConnections();
  if (connections.length === 0) return [];

  // Pre-fetch cached rows once for this email
  const cachedRows = await getCrmContactByEmail(email);
  const cacheByConnection = new Map<string, DbCrmContact>();
  for (const row of cachedRows) {
    cacheByConnection.set(row.connection_id, row);
  }

  const results = await Promise.all(
    connections.map(async (connection): Promise<CrmLookupResult> => {
      const cached = cacheByConnection.get(connection.id);

      // Cache hit and fresh — return immediately
      if (cached && !isCacheStale(cached)) {
        return dbContactToCrmLookupResult(cached, connection);
      }

      // Live lookup
      try {
        const adapter = createCrmAdapter(connection);
        const contact = await adapter.fetchContactByEmail(email);

        if (contact) {
          await upsertCrmContact(crmContactToUpsert(contact, connection.id));
        } else if (cached) {
          // Contact no longer exists in CRM — update the timestamp so it won't
          // be refetched immediately, but keep the cached data visible.
          await upsertCrmContact(crmContactToUpsert(
            {
              email: cached.email,
              displayName: cached.display_name,
              company: cached.company,
              title: cached.title,
              phone: cached.phone,
              dealStage: cached.deal_stage,
              dealValue: cached.deal_value,
              tags: (() => { try { return JSON.parse(cached.tags_json) as string[]; } catch { return []; } })(),
              crmRecordId: cached.crm_record_id,
              crmRecordUrl: cached.crm_record_url,
              rawData: (() => { try { return JSON.parse(cached.raw_json) as Record<string, unknown>; } catch { return {}; } })(),
            },
            connection.id,
          ));
        }

        return {
          connectionId: connection.id,
          provider: connection.provider as CrmProvider,
          displayName: connection.display_name,
          contact,
          error: null,
        };
      } catch (err) {
        // If live lookup fails, fall back to stale cache if available
        if (cached) {
          const result = dbContactToCrmLookupResult(cached, connection);
          result.error = err instanceof Error ? err.message : String(err);
          return result;
        }

        return {
          connectionId: connection.id,
          provider: connection.provider as CrmProvider,
          displayName: connection.display_name,
          contact: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return results;
}

/**
 * Return cached CRM contacts for an email without hitting any API.
 * Used by the UI sidebar for instant display.
 */
export async function getCachedCrmContacts(email: string): Promise<DbCrmContact[]> {
  return getCrmContactByEmail(email);
}

/**
 * Full sync for a single connection: fetch all contacts from the provider,
 * clear the old local cache for this connection, and upsert the fresh data.
 */
export async function syncConnection(connectionId: string): Promise<void> {
  await updateConnectionSyncStatus(connectionId, "syncing");

  try {
    const connections = await getEnabledCrmConnections();
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection) {
      throw new Error(`CRM connection not found or not enabled: ${connectionId}`);
    }

    const adapter = createCrmAdapter(connection);
    const contacts = await adapter.fetchAllContacts();

    await clearCrmContactsForConnection(connectionId);

    if (contacts.length > 0) {
      await upsertCrmContacts(
        contacts.map((c) => crmContactToUpsert(c, connectionId)),
      );
    }

    await updateConnectionSyncStatus(
      connectionId,
      "success",
      Math.floor(Date.now() / 1000),
    );
  } catch (err) {
    await updateConnectionSyncStatus(connectionId, "error").catch(() => {
      // Status update failure is non-fatal — swallow so the original error propagates
    });
    throw err;
  }
}

/**
 * Full sync of all enabled connections. Runs connections in parallel.
 * Individual failures are logged but do not abort the other connections.
 */
export async function syncAllConnections(): Promise<void> {
  const connections = await getEnabledCrmConnections();
  if (connections.length === 0) return;

  await Promise.all(
    connections.map((connection) =>
      syncConnection(connection.id).catch((err) => {
        console.error(
          `CRM sync failed for connection ${connection.id} (${connection.display_name}):`,
          err,
        );
      }),
    ),
  );
}

/**
 * Format a single cached CRM contact as plain text for use in an AI context window.
 */
export function formatCrmContactForAgent(contact: DbCrmContact): string {
  const lines: string[] = [];

  if (contact.display_name) lines.push(`Name: ${contact.display_name}`);
  lines.push(`Email: ${contact.email}`);
  if (contact.company) lines.push(`Company: ${contact.company}`);
  if (contact.title) lines.push(`Title: ${contact.title}`);
  if (contact.phone) lines.push(`Phone: ${contact.phone}`);
  if (contact.deal_stage) lines.push(`Deal Stage: ${contact.deal_stage}`);
  if (contact.deal_value !== null && contact.deal_value !== undefined) {
    lines.push(`Deal Value: $${contact.deal_value.toLocaleString()}`);
  }

  const tags: string[] = (() => {
    try {
      return JSON.parse(contact.tags_json) as string[];
    } catch {
      return [];
    }
  })();
  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);

  if (contact.crm_record_url) lines.push(`CRM URL: ${contact.crm_record_url}`);

  return lines.join("\n");
}

/**
 * Format multiple CRM contacts (from different connections) as a single
 * plain-text block suitable for an AI context window.
 */
export function formatCrmResultsForAgent(contacts: DbCrmContact[]): string {
  if (contacts.length === 0) return "No CRM records found.";

  return contacts
    .map((contact, index) => {
      const header =
        contacts.length > 1 ? `--- CRM Record ${index + 1} ---\n` : "";
      return header + formatCrmContactForAgent(contact);
    })
    .join("\n\n");
}
