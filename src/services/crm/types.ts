export type CrmProvider = "hubspot" | "notion" | "airtable" | "csv" | "custom_api";

export interface CrmContact {
  email: string;
  displayName: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  dealStage: string | null;
  dealValue: number | null;
  tags: string[];
  crmRecordId: string | null;
  crmRecordUrl: string | null;
  rawData: Record<string, unknown>;
}

export interface CrmConnectionConfig {
  // HubSpot: { accessToken: string (stored in keychain, this is just a marker) }
  // Notion: { databaseId: string, emailProperty: string, nameProperty: string, companyProperty: string, titleProperty?: string, dealStageProperty?: string }
  // Airtable: { baseId: string, tableId: string, emailField: string, nameField: string, companyField?: string, titleField?: string, dealStageField?: string }
  // CSV: { filePath: string, emailColumn: string, nameColumn: string, companyColumn?: string, titleColumn?: string, phoneColumn?: string }
  // custom_api: { baseUrl: string, emailQueryParam: string, headers: Record<string,string>, responseMapping: { email: string, name: string, company?: string, title?: string, dealStage?: string } }
  [key: string]: unknown;
}

export interface CrmAdapter {
  readonly provider: CrmProvider;
  readonly connectionId: string;
  fetchContactByEmail(email: string): Promise<CrmContact | null>;
  fetchAllContacts(): Promise<CrmContact[]>;
  testConnection(): Promise<boolean>;
}

export interface CrmLookupResult {
  connectionId: string;
  provider: CrmProvider;
  displayName: string;
  contact: CrmContact | null;
  error: string | null;
}
