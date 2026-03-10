import type { CrmAdapter, CrmContact, CrmProvider } from "../types";
import { getSecureSetting } from "@/services/db/settings";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface NotionRichTextItem {
  plain_text: string;
}

interface NotionTitleProperty {
  type: "title";
  title: NotionRichTextItem[];
}

interface NotionRichTextProperty {
  type: "rich_text";
  rich_text: NotionRichTextItem[];
}

interface NotionEmailProperty {
  type: "email";
  email: string | null;
}

interface NotionNumberProperty {
  type: "number";
  number: number | null;
}

interface NotionSelectProperty {
  type: "select";
  select: { name: string } | null;
}

interface NotionMultiSelectProperty {
  type: "multi_select";
  multi_select: { name: string }[];
}

interface NotionPhoneProperty {
  type: "phone_number";
  phone_number: string | null;
}

type NotionProperty =
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionEmailProperty
  | NotionNumberProperty
  | NotionSelectProperty
  | NotionMultiSelectProperty
  | NotionPhoneProperty
  | { type: string; [key: string]: unknown };

interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

function extractNotionPropertyText(prop: NotionProperty | undefined): string | null {
  if (!prop) return null;

  switch (prop.type) {
    case "title": {
      const p = prop as NotionTitleProperty;
      return p.title.map((t) => t.plain_text).join("").trim() || null;
    }
    case "rich_text": {
      const p = prop as NotionRichTextProperty;
      return p.rich_text.map((t) => t.plain_text).join("").trim() || null;
    }
    case "email": {
      const p = prop as NotionEmailProperty;
      return p.email ?? null;
    }
    case "number": {
      const p = prop as NotionNumberProperty;
      return p.number !== null ? String(p.number) : null;
    }
    case "select": {
      const p = prop as NotionSelectProperty;
      return p.select?.name ?? null;
    }
    case "multi_select": {
      const p = prop as NotionMultiSelectProperty;
      return p.multi_select.map((s) => s.name).join(", ") || null;
    }
    case "phone_number": {
      const p = prop as NotionPhoneProperty;
      return p.phone_number ?? null;
    }
    default:
      return null;
  }
}

interface NotionConfig {
  databaseId: string;
  emailProperty: string;
  nameProperty: string;
  companyProperty?: string;
  titleProperty?: string;
  phoneProperty?: string;
  dealStageProperty?: string;
}

export class NotionAdapter implements CrmAdapter {
  readonly provider: CrmProvider = "notion";
  private cfg: NotionConfig;

  constructor(
    readonly connectionId: string,
    config: Record<string, unknown>,
  ) {
    this.cfg = config as unknown as NotionConfig;
  }

  private async getToken(): Promise<string> {
    const token = await getSecureSetting(`crm_key_${this.connectionId}`);
    if (!token) throw new Error("Notion integration token not configured");
    return token;
  }

  private async request<T>(
    path: string,
    options: RequestInit,
    token: string,
  ): Promise<T> {
    const url = `${NOTION_API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Notion API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private mapPage(page: NotionPage): CrmContact {
    const props = page.properties;
    const email = extractNotionPropertyText(props[this.cfg.emailProperty]);
    const name = extractNotionPropertyText(props[this.cfg.nameProperty]);
    const company = this.cfg.companyProperty
      ? extractNotionPropertyText(props[this.cfg.companyProperty])
      : null;
    const title = this.cfg.titleProperty
      ? extractNotionPropertyText(props[this.cfg.titleProperty])
      : null;
    const phone = this.cfg.phoneProperty
      ? extractNotionPropertyText(props[this.cfg.phoneProperty])
      : null;
    const dealStage = this.cfg.dealStageProperty
      ? extractNotionPropertyText(props[this.cfg.dealStageProperty])
      : null;

    const pageId = page.id.replace(/-/g, "");

    return {
      email: email ?? "",
      displayName: name ?? email ?? null,
      company,
      title,
      phone,
      dealStage,
      dealValue: null,
      tags: [],
      crmRecordId: page.id,
      crmRecordUrl: `https://notion.so/${pageId}`,
      rawData: props as unknown as Record<string, unknown>,
    };
  }

  async fetchContactByEmail(email: string): Promise<CrmContact | null> {
    const token = await this.getToken();

    const body = {
      filter: {
        property: this.cfg.emailProperty,
        email: { equals: email },
      },
      page_size: 1,
    };

    const data = await this.request<NotionQueryResponse>(
      `/databases/${this.cfg.databaseId}/query`,
      { method: "POST", body: JSON.stringify(body) },
      token,
    );

    const page = data.results[0];
    if (!page) return null;

    return this.mapPage(page);
  }

  async fetchAllContacts(): Promise<CrmContact[]> {
    const token = await this.getToken();
    const contacts: CrmContact[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) {
        body.start_cursor = cursor;
      }

      const data = await this.request<NotionQueryResponse>(
        `/databases/${this.cfg.databaseId}/query`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      );

      for (const page of data.results) {
        const contact = this.mapPage(page);
        // Only include pages that have a valid email in the email property
        if (contact.email) {
          contacts.push(contact);
        }
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return contacts;
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.getToken();
      const response = await fetch(
        `${NOTION_API_BASE}/databases/${this.cfg.databaseId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_VERSION,
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
