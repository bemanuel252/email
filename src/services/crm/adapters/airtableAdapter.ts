import type { CrmAdapter, CrmContact, CrmProvider } from "../types";
import { getSecureSetting } from "@/services/db/settings";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

interface AirtableConfig {
  baseId: string;
  tableId: string;
  emailField: string;
  nameField: string;
  companyField?: string;
  titleField?: string;
  phoneField?: string;
  dealStageField?: string;
  dealValueField?: string;
  tagsField?: string;
}

function fieldStr(
  fields: Record<string, unknown>,
  key: string | undefined,
): string | null {
  if (!key) return null;
  const val = fields[key];
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) return (val as string[]).join(", ") || null;
  return String(val);
}

function fieldNum(
  fields: Record<string, unknown>,
  key: string | undefined,
): number | null {
  if (!key) return null;
  const val = fields[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

function fieldTags(
  fields: Record<string, unknown>,
  key: string | undefined,
): string[] {
  if (!key) return [];
  const val = fields[key];
  if (Array.isArray(val)) return (val as string[]).map((t) => String(t));
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

export class AirtableAdapter implements CrmAdapter {
  readonly provider: CrmProvider = "airtable";
  private cfg: AirtableConfig;

  constructor(
    readonly connectionId: string,
    config: Record<string, unknown>,
  ) {
    this.cfg = config as unknown as AirtableConfig;
  }

  private async getToken(): Promise<string> {
    const token = await getSecureSetting(`crm_key_${this.connectionId}`);
    if (!token) throw new Error("Airtable personal access token not configured");
    return token;
  }

  private async request<T>(url: string, token: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Airtable API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private mapRecord(record: AirtableRecord): CrmContact {
    const f = record.fields;
    const email = fieldStr(f, this.cfg.emailField);
    const name = fieldStr(f, this.cfg.nameField);

    return {
      email: email ?? "",
      displayName: name ?? email ?? null,
      company: fieldStr(f, this.cfg.companyField),
      title: fieldStr(f, this.cfg.titleField),
      phone: fieldStr(f, this.cfg.phoneField),
      dealStage: fieldStr(f, this.cfg.dealStageField),
      dealValue: fieldNum(f, this.cfg.dealValueField),
      tags: fieldTags(f, this.cfg.tagsField),
      crmRecordId: record.id,
      crmRecordUrl: `https://airtable.com/${this.cfg.baseId}/${this.cfg.tableId}/${record.id}`,
      rawData: f,
    };
  }

  async fetchContactByEmail(email: string): Promise<CrmContact | null> {
    const token = await this.getToken();
    // Airtable filterByFormula — escape double-quotes in the email
    const safeEmail = email.replace(/"/g, '\\"');
    const formula = encodeURIComponent(
      `({${this.cfg.emailField}}="${safeEmail}")`,
    );
    const url = `${AIRTABLE_API_BASE}/${this.cfg.baseId}/${encodeURIComponent(this.cfg.tableId)}?filterByFormula=${formula}&maxRecords=1`;

    const data = await this.request<AirtableListResponse>(url, token);
    const record = data.records[0];
    if (!record) return null;

    return this.mapRecord(record);
  }

  async fetchAllContacts(): Promise<CrmContact[]> {
    const token = await this.getToken();
    const contacts: CrmContact[] = [];
    let offset: string | undefined;

    do {
      let url = `${AIRTABLE_API_BASE}/${this.cfg.baseId}/${encodeURIComponent(this.cfg.tableId)}?pageSize=100`;
      if (offset) {
        url += `&offset=${encodeURIComponent(offset)}`;
      }

      const data = await this.request<AirtableListResponse>(url, token);

      for (const record of data.records) {
        const contact = this.mapRecord(record);
        if (contact.email) {
          contacts.push(contact);
        }
      }

      offset = data.offset;
    } while (offset);

    return contacts;
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.getToken();
      const url = `${AIRTABLE_API_BASE}/${this.cfg.baseId}/${encodeURIComponent(this.cfg.tableId)}?maxRecords=1`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
