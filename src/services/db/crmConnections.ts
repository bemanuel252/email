import { getDb } from "./connection";

export interface DbCrmConnection {
  id: string;
  provider: string;
  display_name: string;
  config_json: string;
  is_enabled: number;
  last_sync_at: number | null;
  sync_status: "idle" | "syncing" | "error" | "success";
  created_at: number;
}

export interface DbCrmContact {
  id: string;
  connection_id: string;
  email: string;
  display_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  deal_stage: string | null;
  deal_value: number | null;
  tags_json: string;
  raw_json: string;
  crm_record_id: string | null;
  crm_record_url: string | null;
  last_synced_at: number;
}

export interface NewCrmConnection {
  provider: string;
  displayName: string;
  configJson?: string;
}

export interface UpsertCrmContact {
  connectionId: string;
  email: string;
  displayName?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  dealStage?: string | null;
  dealValue?: number | null;
  tagsJson?: string;
  rawJson?: string;
  crmRecordId?: string | null;
  crmRecordUrl?: string | null;
}

export async function createCrmConnection(
  conn: NewCrmConnection,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO crm_connections (id, provider, display_name, config_json)
     VALUES ($1, $2, $3, $4)`,
    [id, conn.provider, conn.displayName, conn.configJson ?? "{}"],
  );
  return id;
}

export async function getCrmConnections(): Promise<DbCrmConnection[]> {
  const db = await getDb();
  return db.select<DbCrmConnection[]>(
    `SELECT * FROM crm_connections ORDER BY created_at ASC`,
  );
}

export async function getEnabledCrmConnections(): Promise<DbCrmConnection[]> {
  const db = await getDb();
  return db.select<DbCrmConnection[]>(
    `SELECT * FROM crm_connections WHERE is_enabled = 1 ORDER BY created_at ASC`,
  );
}

export async function updateCrmConnection(
  id: string,
  updates: Partial<
    Pick<
      DbCrmConnection,
      "display_name" | "config_json" | "is_enabled" | "sync_status" | "last_sync_at"
    >
  >,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.display_name !== undefined) {
    fields.push(`display_name = $${idx++}`);
    params.push(updates.display_name);
  }
  if (updates.config_json !== undefined) {
    fields.push(`config_json = $${idx++}`);
    params.push(updates.config_json);
  }
  if (updates.is_enabled !== undefined) {
    fields.push(`is_enabled = $${idx++}`);
    params.push(updates.is_enabled);
  }
  if (updates.sync_status !== undefined) {
    fields.push(`sync_status = $${idx++}`);
    params.push(updates.sync_status);
  }
  if (updates.last_sync_at !== undefined) {
    fields.push(`last_sync_at = $${idx++}`);
    params.push(updates.last_sync_at);
  }

  if (fields.length === 0) return;

  params.push(id);
  await db.execute(
    `UPDATE crm_connections SET ${fields.join(", ")} WHERE id = $${idx}`,
    params,
  );
}

export async function deleteCrmConnection(id: string): Promise<void> {
  const db = await getDb();
  // crm_contacts cascade-deletes via FK
  await db.execute(`DELETE FROM crm_connections WHERE id = $1`, [id]);
}

export async function upsertCrmContact(
  contact: UpsertCrmContact,
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO crm_contacts
       (id, connection_id, email, display_name, company, title, phone,
        deal_stage, deal_value, tags_json, raw_json, crm_record_id, crm_record_url,
        last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, unixepoch())
     ON CONFLICT(connection_id, email) DO UPDATE SET
       display_name    = $4,
       company         = $5,
       title           = $6,
       phone           = $7,
       deal_stage      = $8,
       deal_value      = $9,
       tags_json       = $10,
       raw_json        = $11,
       crm_record_id   = $12,
       crm_record_url  = $13,
       last_synced_at  = unixepoch()`,
    [
      id,
      contact.connectionId,
      contact.email,
      contact.displayName ?? null,
      contact.company ?? null,
      contact.title ?? null,
      contact.phone ?? null,
      contact.dealStage ?? null,
      contact.dealValue ?? null,
      contact.tagsJson ?? "[]",
      contact.rawJson ?? "{}",
      contact.crmRecordId ?? null,
      contact.crmRecordUrl ?? null,
    ],
  );
}

export async function upsertCrmContacts(
  contacts: UpsertCrmContact[],
): Promise<void> {
  // Run sequentially to avoid SQLite write-lock contention; batch is typically
  // called once per sync cycle, so sequential inserts are acceptable.
  for (const contact of contacts) {
    await upsertCrmContact(contact);
  }
}

export async function getCrmContactByEmail(
  email: string,
): Promise<DbCrmContact[]> {
  const db = await getDb();
  return db.select<DbCrmContact[]>(
    `SELECT * FROM crm_contacts WHERE email = $1`,
    [email],
  );
}

export async function getCrmContactsForConnection(
  connectionId: string,
): Promise<DbCrmContact[]> {
  const db = await getDb();
  return db.select<DbCrmContact[]>(
    `SELECT * FROM crm_contacts WHERE connection_id = $1 ORDER BY display_name ASC`,
    [connectionId],
  );
}

export async function clearCrmContactsForConnection(
  connectionId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM crm_contacts WHERE connection_id = $1`,
    [connectionId],
  );
}

export async function updateConnectionSyncStatus(
  id: string,
  status: "idle" | "syncing" | "error" | "success",
  lastSyncAt?: number,
): Promise<void> {
  const db = await getDb();
  if (lastSyncAt !== undefined) {
    await db.execute(
      `UPDATE crm_connections SET sync_status = $1, last_sync_at = $2 WHERE id = $3`,
      [status, lastSyncAt, id],
    );
  } else {
    await db.execute(
      `UPDATE crm_connections SET sync_status = $1 WHERE id = $2`,
      [status, id],
    );
  }
}
