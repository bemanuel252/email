import type { CrmAdapter } from "./types";
import type { DbCrmConnection } from "@/services/db/crmConnections";
import { HubspotAdapter } from "./adapters/hubspotAdapter";
import { NotionAdapter } from "./adapters/notionAdapter";
import { AirtableAdapter } from "./adapters/airtableAdapter";
import { CsvAdapter } from "./adapters/csvAdapter";
import { CustomApiAdapter } from "./adapters/customApiAdapter";

export function createCrmAdapter(connection: DbCrmConnection): CrmAdapter {
  const config = JSON.parse(connection.config_json) as Record<string, unknown>;
  switch (connection.provider) {
    case "hubspot":
      return new HubspotAdapter(connection.id, config);
    case "notion":
      return new NotionAdapter(connection.id, config);
    case "airtable":
      return new AirtableAdapter(connection.id, config);
    case "csv":
      return new CsvAdapter(connection.id, config);
    case "custom_api":
      return new CustomApiAdapter(connection.id, config);
    default:
      throw new Error(`Unknown CRM provider: ${connection.provider}`);
  }
}
