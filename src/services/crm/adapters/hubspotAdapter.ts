import type { CrmAdapter, CrmContact, CrmProvider } from "../types";
import { getSecureSetting } from "@/services/db/settings";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

interface HubSpotContactProperties {
  firstname?: string;
  lastname?: string;
  email?: string;
  company?: string;
  jobtitle?: string;
  phone?: string;
  dealstage?: string;
  hs_lead_status?: string;
  [key: string]: string | undefined;
}

interface HubSpotContact {
  id: string;
  properties: HubSpotContactProperties;
}

interface HubSpotSearchResponse {
  results: HubSpotContact[];
  paging?: {
    next?: {
      after: string;
    };
  };
  total: number;
}

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "company",
  "jobtitle",
  "phone",
  "dealstage",
  "hs_lead_status",
];

function mapHubSpotContact(contact: HubSpotContact): CrmContact {
  const p = contact.properties;
  const firstName = p.firstname ?? "";
  const lastName = p.lastname ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    email: p.email ?? "",
    displayName: fullName || p.email || null,
    company: p.company ?? null,
    title: p.jobtitle ?? null,
    phone: p.phone ?? null,
    dealStage: p.hs_lead_status ?? p.dealstage ?? null,
    dealValue: null,
    tags: [],
    crmRecordId: contact.id,
    crmRecordUrl: `https://app.hubspot.com/contacts/contact/${contact.id}`,
    rawData: contact.properties as Record<string, unknown>,
  };
}

export class HubspotAdapter implements CrmAdapter {
  readonly provider: CrmProvider = "hubspot";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(
    readonly connectionId: string,
    _config: Record<string, unknown>,
  ) {}

  private async getAccessToken(): Promise<string> {
    const token = await getSecureSetting(`crm_key_${this.connectionId}`);
    if (!token) throw new Error("HubSpot access token not configured");
    return token;
  }

  private async request<T>(
    path: string,
    options: RequestInit,
    accessToken: string,
  ): Promise<T> {
    const url = `${HUBSPOT_API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HubSpot API error ${response.status}: ${body}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async fetchContactByEmail(email: string): Promise<CrmContact | null> {
    const accessToken = await this.getAccessToken();

    const body = {
      filterGroups: [
        {
          filters: [
            {
              value: email,
              propertyName: "email",
              operator: "EQ",
            },
          ],
        },
      ],
      properties: CONTACT_PROPERTIES,
      limit: 1,
    };

    const data = await this.request<HubSpotSearchResponse>(
      "/crm/v3/objects/contacts/search",
      { method: "POST", body: JSON.stringify(body) },
      accessToken,
    );

    const contact = data.results[0];
    if (!contact) return null;

    return mapHubSpotContact(contact);
  }

  async fetchAllContacts(): Promise<CrmContact[]> {
    const accessToken = await this.getAccessToken();
    const contacts: CrmContact[] = [];
    let after: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filterGroups: [],
        properties: CONTACT_PROPERTIES,
        limit: 100,
      };
      if (after) {
        body.after = after;
      }

      const data = await this.request<HubSpotSearchResponse>(
        "/crm/v3/objects/contacts/search",
        { method: "POST", body: JSON.stringify(body) },
        accessToken,
      );

      for (const contact of data.results) {
        contacts.push(mapHubSpotContact(contact));
      }

      after = data.paging?.next?.after;

      // HubSpot's search endpoint caps at 10,000 results total; stop at 500 per spec
      if (contacts.length >= 500) break;
    } while (after);

    return contacts;
  }

  async testConnection(): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      const response = await fetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts?limit=1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
