import type { CrmAdapter, CrmContact, CrmProvider } from "../types";

interface ResponseMapping {
  email: string;
  name?: string;
  company?: string;
  title?: string;
  phone?: string;
  dealStage?: string;
  dealValue?: string;
  tags?: string;
  crmRecordId?: string;
  crmRecordUrl?: string;
}

interface CustomApiConfig {
  baseUrl: string;
  emailQueryParam: string;
  headers: Record<string, string>;
  responseMapping: ResponseMapping;
}

/**
 * Resolve a dot-notation path in a nested object.
 * e.g. "data.contact.name" on { data: { contact: { name: "Alice" } } }
 * Returns undefined if any segment is missing.
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function resolveStr(obj: unknown, path: string | undefined): string | null {
  if (!path) return null;
  const val = resolvePath(obj, path);
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  return null;
}

function resolveNum(obj: unknown, path: string | undefined): number | null {
  if (!path) return null;
  const val = resolvePath(obj, path);
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

function resolveTags(obj: unknown, path: string | undefined): string[] {
  if (!path) return [];
  const val = resolvePath(obj, path);
  if (Array.isArray(val)) return (val as unknown[]).map((t) => String(t));
  if (typeof val === "string" && val.trim()) {
    return val
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

export class CustomApiAdapter implements CrmAdapter {
  readonly provider: CrmProvider = "custom_api";
  private cfg: CustomApiConfig;

  constructor(
    readonly connectionId: string,
    config: Record<string, unknown>,
  ) {
    this.cfg = config as unknown as CustomApiConfig;
  }

  private async fetch(email: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl}?${this.cfg.emailQueryParam}=${encodeURIComponent(email)}`;

    const response = await fetch(url, {
      headers: this.cfg.headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Custom API error ${response.status}: ${body}`);
    }

    return response.json();
  }

  private mapResponse(data: unknown, email: string): CrmContact | null {
    const m = this.cfg.responseMapping;
    const resolvedEmail = resolveStr(data, m.email) ?? email;

    if (!resolvedEmail) return null;

    return {
      email: resolvedEmail,
      displayName: resolveStr(data, m.name) ?? resolvedEmail,
      company: resolveStr(data, m.company),
      title: resolveStr(data, m.title),
      phone: resolveStr(data, m.phone),
      dealStage: resolveStr(data, m.dealStage),
      dealValue: resolveNum(data, m.dealValue),
      tags: resolveTags(data, m.tags),
      crmRecordId: resolveStr(data, m.crmRecordId),
      crmRecordUrl: resolveStr(data, m.crmRecordUrl),
      rawData: data as Record<string, unknown>,
    };
  }

  async fetchContactByEmail(email: string): Promise<CrmContact | null> {
    const data = await this.fetch(email);
    return this.mapResponse(data, email);
  }

  /**
   * Custom API adapters are single-contact lookup only.
   * Full contact enumeration is not supported without a known list endpoint.
   */
  async fetchAllContacts(): Promise<CrmContact[]> {
    return [];
  }

  async testConnection(): Promise<boolean> {
    try {
      // Use a benign test value — just verify the endpoint is reachable
      const url = `${this.cfg.baseUrl}?${this.cfg.emailQueryParam}=${encodeURIComponent("test@example.com")}`;
      const response = await fetch(url, {
        headers: this.cfg.headers,
      });
      // Accept any response that isn't a network failure (4xx/5xx still means the server is up)
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
