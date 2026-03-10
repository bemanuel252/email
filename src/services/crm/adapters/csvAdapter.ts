import type { CrmAdapter, CrmContact, CrmProvider } from "../types";
import { readTextFile } from "@tauri-apps/plugin-fs";

interface CsvConfig {
  filePath: string;
  emailColumn: string;
  nameColumn: string;
  companyColumn?: string;
  titleColumn?: string;
  phoneColumn?: string;
  tagsColumns?: string[];   // Multiple tag source columns (new)
  tagsColumn?: string;      // Legacy single tag column (kept for backward compat)
  dealStageColumn?: string;
  dealValueColumn?: string;
}

/**
 * Parse a single CSV line into fields. Handles:
 * - Quoted fields that may contain commas
 * - Escaped double-quotes ("") inside quoted fields
 * - Unquoted fields
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;

  while (i <= len) {
    // End of string — push empty field if line ended with comma
    if (i === len) {
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = "";
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            // Escaped double-quote
            field += '"';
            i += 2;
          } else {
            // End of quoted field
            i++;
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      // Skip comma after closing quote
      if (i < len && line[i] === ",") i++;
    } else {
      // Unquoted field
      const commaIndex = line.indexOf(",", i);
      if (commaIndex === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, commaIndex));
        i = commaIndex + 1;
      }
    }
  }

  return fields;
}

/**
 * Parse CSV text into an array of row objects keyed by header name.
 * Ignores empty lines and handles \r\n and \n line endings.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return [];

  const headers = parseCsvLine(nonEmpty[0]!).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = parseCsvLine(nonEmpty[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = (fields[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

function rowToContact(
  row: Record<string, string>,
  cfg: CsvConfig,
): CrmContact | null {
  const email = row[cfg.emailColumn]?.trim();
  if (!email) return null;

  const name = row[cfg.nameColumn]?.trim() ?? null;
  const company = cfg.companyColumn ? row[cfg.companyColumn]?.trim() || null : null;
  const title = cfg.titleColumn ? row[cfg.titleColumn]?.trim() || null : null;
  const phone = cfg.phoneColumn ? row[cfg.phoneColumn]?.trim() || null : null;
  const dealStage = cfg.dealStageColumn ? row[cfg.dealStageColumn]?.trim() || null : null;
  const dealValueRaw = cfg.dealValueColumn ? row[cfg.dealValueColumn]?.trim() : null;
  const dealValue = dealValueRaw ? parseFloat(dealValueRaw) || null : null;

  // Collect tags from all mapped tag columns (new) or legacy single column
  const tagCols: string[] = cfg.tagsColumns?.length
    ? cfg.tagsColumns
    : cfg.tagsColumn
      ? [cfg.tagsColumn]
      : [];
  const tags: string[] = [];
  for (const col of tagCols) {
    const raw = row[col]?.trim();
    if (raw) {
      raw.split("|").map((t) => t.trim()).filter(Boolean).forEach((t) => tags.push(t));
    }
  }
  // Deduplicate
  const uniqueTags = [...new Set(tags)];

  return {
    email,
    displayName: name || email,
    company,
    title,
    phone,
    dealStage,
    dealValue,
    tags: uniqueTags,
    crmRecordId: null,
    crmRecordUrl: null,
    rawData: row as Record<string, unknown>,
  };
}

export class CsvAdapter implements CrmAdapter {
  readonly provider: CrmProvider = "csv";
  private cfg: CsvConfig;

  constructor(
    readonly connectionId: string,
    config: Record<string, unknown>,
  ) {
    this.cfg = config as unknown as CsvConfig;
  }

  private async readRows(): Promise<Record<string, string>[]> {
    const text = await readTextFile(this.cfg.filePath);
    return parseCsv(text);
  }

  async fetchContactByEmail(email: string): Promise<CrmContact | null> {
    const rows = await this.readRows();
    const lower = email.toLowerCase();

    for (const row of rows) {
      const rowEmail = row[this.cfg.emailColumn]?.trim().toLowerCase();
      if (rowEmail === lower) {
        return rowToContact(row, this.cfg);
      }
    }

    return null;
  }

  async fetchAllContacts(): Promise<CrmContact[]> {
    const rows = await this.readRows();
    const contacts: CrmContact[] = [];

    for (const row of rows) {
      const contact = rowToContact(row, this.cfg);
      if (contact) contacts.push(contact);
    }

    return contacts;
  }

  async testConnection(): Promise<boolean> {
    try {
      await readTextFile(this.cfg.filePath);
      return true;
    } catch {
      return false;
    }
  }
}
