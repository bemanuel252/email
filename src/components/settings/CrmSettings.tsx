import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Plus,
  Trash2,
  Pencil,
  ChevronRight,
  X,
  Building2,
  Database,
  Table,
  FileText,
  Globe,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import {
  getCrmConnections,
  createCrmConnection,
  updateCrmConnection,
  deleteCrmConnection,
} from "@/services/db/crmConnections";
import type { DbCrmConnection } from "@/services/db/crmConnections";
import { syncConnection } from "@/services/crm/crmManager";
import { getSetting, setSetting, getSecureSetting, setSecureSetting } from "@/services/db/settings";
import { getDb } from "@/services/db/connection";

// ─── Types ────────────────────────────────────────────────────────────────────

type CrmProvider = "hubspot" | "notion" | "airtable" | "csv" | "custom";

interface HubSpotConfig {
  accessToken: string;
}

interface NotionConfig {
  integrationToken: string;
  databaseId: string;
  emailProperty: string;
  nameProperty: string;
  companyProperty: string;
  titleProperty: string;
  dealStageProperty: string;
}

interface AirtableConfig {
  personalAccessToken: string;
  baseId: string;
  tableIdOrName: string;
  emailField: string;
  nameField: string;
  companyField: string;
  titleField: string;
  dealStageField: string;
}

interface CsvConfig {
  filePath: string;
  emailColumn: string;
  nameColumn: string;
  companyColumn: string;
  titleColumn: string;
  phoneColumn: string;
  tagsColumns: string[];
  dealStageColumn: string;
  dealValueColumn: string;
}

interface CustomApiConfig {
  baseUrl: string;
  emailParam: string;
  apiKey: string;
  emailPath: string;
  namePath: string;
  companyPath: string;
  titlePath: string;
  dealStagePath: string;
  headers: { key: string; value: string }[];
}

type ProviderConfig = HubSpotConfig | NotionConfig | AirtableConfig | CsvConfig | CustomApiConfig;

interface EditState {
  connectionId: string;
  displayName: string;
  provider: CrmProvider;
  config: ProviderConfig;
  apiKey: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getContactCountForConnection(connectionId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM crm_contacts WHERE connection_id = $1`,
    [connectionId],
  );
  return rows[0]?.count ?? 0;
}

function formatLastSync(lastSyncAt: number | null): string {
  if (!lastSyncAt) return "Never synced";
  const diffSeconds = Math.floor(Date.now() / 1000) - lastSyncAt;
  if (diffSeconds < 60) return "Just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function defaultConfigForProvider(provider: CrmProvider): ProviderConfig {
  switch (provider) {
    case "hubspot":
      return { accessToken: "" } satisfies HubSpotConfig;
    case "notion":
      return {
        integrationToken: "",
        databaseId: "",
        emailProperty: "Email",
        nameProperty: "Name",
        companyProperty: "",
        titleProperty: "",
        dealStageProperty: "",
      } satisfies NotionConfig;
    case "airtable":
      return {
        personalAccessToken: "",
        baseId: "",
        tableIdOrName: "",
        emailField: "Email",
        nameField: "Name",
        companyField: "",
        titleField: "",
        dealStageField: "",
      } satisfies AirtableConfig;
    case "csv":
      return {
        filePath: "",
        emailColumn: "",
        nameColumn: "",
        companyColumn: "",
        titleColumn: "",
        phoneColumn: "",
        tagsColumns: [],
        dealStageColumn: "",
        dealValueColumn: "",
      } satisfies CsvConfig;
    case "custom":
      return {
        baseUrl: "",
        emailParam: "email",
        apiKey: "",
        emailPath: "",
        namePath: "",
        companyPath: "",
        titlePath: "",
        dealStagePath: "",
        headers: [],
      } satisfies CustomApiConfig;
  }
}

function providerLabel(provider: CrmProvider): string {
  switch (provider) {
    case "hubspot": return "HubSpot";
    case "notion": return "Notion";
    case "airtable": return "Airtable";
    case "csv": return "CSV File";
    case "custom": return "Custom API";
  }
}

function ProviderIcon({ provider, size = 16 }: { provider: CrmProvider; size?: number }) {
  switch (provider) {
    case "hubspot":
      return <Building2 size={size} className="text-orange-500" />;
    case "notion":
      return <Database size={size} className="text-text-primary" />;
    case "airtable":
      return <Table size={size} className="text-yellow-500" />;
    case "csv":
      return <FileText size={size} className="text-green-500" />;
    case "custom":
      return <Globe size={size} className="text-blue-500" />;
  }
}

function SyncStatusBadge({ status }: { status: DbCrmConnection["sync_status"] }) {
  const map = {
    idle: { label: "Idle", className: "bg-bg-tertiary text-text-tertiary" },
    syncing: { label: "Syncing…", className: "bg-accent/15 text-accent" },
    error: { label: "Error", className: "bg-danger/15 text-danger" },
    success: { label: "Synced", className: "bg-success/15 text-success" },
  } as const;
  const entry = map[status];
  return (
    <span className={`text-[0.6rem] font-medium px-1.5 py-0.5 rounded-full ${entry.className}`}>
      {entry.label}
    </span>
  );
}

// ─── Sub-forms ────────────────────────────────────────────────────────────────

function HubSpotForm({
  config,
  onChange,
}: {
  config: HubSpotConfig;
  onChange: (c: HubSpotConfig) => void;
}) {
  return (
    <TextField
      label="Access Token"
      size="md"
      type="password"
      value={config.accessToken}
      onChange={(e) => onChange({ ...config, accessToken: e.target.value })}
      placeholder="pat-na1-..."
    />
  );
}

function NotionForm({
  config,
  onChange,
}: {
  config: NotionConfig;
  onChange: (c: NotionConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="Integration Token"
        size="md"
        type="password"
        value={config.integrationToken}
        onChange={(e) => onChange({ ...config, integrationToken: e.target.value })}
        placeholder="secret_..."
      />
      <TextField
        label="Database ID"
        size="md"
        value={config.databaseId}
        onChange={(e) => onChange({ ...config, databaseId: e.target.value })}
        placeholder="32-character Notion database ID"
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Email Property"
          size="md"
          value={config.emailProperty}
          onChange={(e) => onChange({ ...config, emailProperty: e.target.value })}
          placeholder="Email"
        />
        <TextField
          label="Name Property"
          size="md"
          value={config.nameProperty}
          onChange={(e) => onChange({ ...config, nameProperty: e.target.value })}
          placeholder="Name"
        />
        <TextField
          label="Company Property (optional)"
          size="md"
          value={config.companyProperty}
          onChange={(e) => onChange({ ...config, companyProperty: e.target.value })}
          placeholder="Company"
        />
        <TextField
          label="Title Property (optional)"
          size="md"
          value={config.titleProperty}
          onChange={(e) => onChange({ ...config, titleProperty: e.target.value })}
          placeholder="Title"
        />
        <TextField
          label="Deal Stage Property (optional)"
          size="md"
          value={config.dealStageProperty}
          onChange={(e) => onChange({ ...config, dealStageProperty: e.target.value })}
          placeholder="Deal Stage"
        />
      </div>
    </div>
  );
}

function AirtableForm({
  config,
  onChange,
}: {
  config: AirtableConfig;
  onChange: (c: AirtableConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <TextField
        label="Personal Access Token"
        size="md"
        type="password"
        value={config.personalAccessToken}
        onChange={(e) => onChange({ ...config, personalAccessToken: e.target.value })}
        placeholder="pat..."
      />
      <TextField
        label="Base ID"
        size="md"
        value={config.baseId}
        onChange={(e) => onChange({ ...config, baseId: e.target.value })}
        placeholder="appXXXXXXXXXXXXXX — found in your Airtable URL"
      />
      <TextField
        label="Table ID or Name"
        size="md"
        value={config.tableIdOrName}
        onChange={(e) => onChange({ ...config, tableIdOrName: e.target.value })}
        placeholder="Contacts"
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Email Field"
          size="md"
          value={config.emailField}
          onChange={(e) => onChange({ ...config, emailField: e.target.value })}
          placeholder="Email"
        />
        <TextField
          label="Name Field"
          size="md"
          value={config.nameField}
          onChange={(e) => onChange({ ...config, nameField: e.target.value })}
          placeholder="Name"
        />
        <TextField
          label="Company Field (optional)"
          size="md"
          value={config.companyField}
          onChange={(e) => onChange({ ...config, companyField: e.target.value })}
          placeholder="Company"
        />
        <TextField
          label="Title Field (optional)"
          size="md"
          value={config.titleField}
          onChange={(e) => onChange({ ...config, titleField: e.target.value })}
          placeholder="Title"
        />
        <TextField
          label="Deal Stage Field (optional)"
          size="md"
          value={config.dealStageField}
          onChange={(e) => onChange({ ...config, dealStageField: e.target.value })}
          placeholder="Deal Stage"
        />
      </div>
    </div>
  );
}

// ─── CSV header detection helpers ────────────────────────────────────────────

function parseFirstCsvLine(line: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let field = "";
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { fields.push(field.trim()); field = ""; }
    else { field += ch; }
  }
  fields.push(field.trim());
  return fields.filter(Boolean);
}

async function readCsvMeta(filePath: string): Promise<{ headers: string[]; rowCount: number }> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const text = await readTextFile(filePath);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rowCount: 0 };
  return { headers: parseFirstCsvLine(lines[0]!), rowCount: lines.length - 1 };
}

const CSV_FIELD_HINTS: Record<keyof Omit<CsvConfig, "filePath" | "tagsColumns">, string[]> = {
  emailColumn:     ["email", "e-mail", "mail", "email_address", "emailaddress"],
  nameColumn:      ["name", "full_name", "fullname", "full name", "contact_name", "display_name"],
  companyColumn:   ["company", "organization", "org", "account", "business", "employer"],
  titleColumn:     ["title", "job_title", "jobtitle", "job title", "position", "role"],
  phoneColumn:     ["phone", "mobile", "cell", "telephone", "tel", "phone_number"],
  dealStageColumn: ["deal_stage", "dealstage", "stage", "pipeline", "opportunity"],
  dealValueColumn: ["deal_value", "dealvalue", "value", "amount", "revenue", "arr", "mrr"],
};

const CSV_TAG_HINTS = ["tags", "tag", "labels", "label", "category", "categories", "segment", "group", "type", "status"];

function autoMatchCsvColumns(headers: string[], current: CsvConfig): CsvConfig {
  const lower = headers.map((h) => h.toLowerCase());

  function best(hints: string[], cur: string): string {
    if (cur) return cur;
    for (const hint of hints) {
      const i = lower.indexOf(hint);
      if (i !== -1) return headers[i]!;
    }
    for (const hint of hints) {
      const i = lower.findIndex((h) => h.includes(hint));
      if (i !== -1) return headers[i]!;
    }
    return "";
  }

  // Auto-detect tag columns: find first match if none already set
  const tagsColumns = current.tagsColumns.length > 0
    ? current.tagsColumns
    : (() => {
        const match = best(CSV_TAG_HINTS, "");
        return match ? [match] : [];
      })();

  return {
    ...current,
    emailColumn:     best(CSV_FIELD_HINTS.emailColumn,     current.emailColumn),
    nameColumn:      best(CSV_FIELD_HINTS.nameColumn,      current.nameColumn),
    companyColumn:   best(CSV_FIELD_HINTS.companyColumn,   current.companyColumn),
    titleColumn:     best(CSV_FIELD_HINTS.titleColumn,     current.titleColumn),
    phoneColumn:     best(CSV_FIELD_HINTS.phoneColumn,     current.phoneColumn),
    tagsColumns,
    dealStageColumn: best(CSV_FIELD_HINTS.dealStageColumn, current.dealStageColumn),
    dealValueColumn: best(CSV_FIELD_HINTS.dealValueColumn, current.dealValueColumn),
  };
}

// ─── CSV Form ─────────────────────────────────────────────────────────────────

function CsvForm({
  config,
  onChange,
}: {
  config: CsvConfig;
  onChange: (c: CsvConfig) => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // Load headers for an existing config on mount (display-only, no auto-match)
  useEffect(() => {
    if (!config.filePath) return;
    setLoading(true);
    readCsvMeta(config.filePath)
      .then(({ headers: hdrs, rowCount: rc }) => {
        setHeaders(hdrs);
        setRowCount(rc);
      })
      .catch(() => setReadError("Could not read file — check the path is accessible."))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });
      if (typeof selected !== "string") return;
      setLoading(true);
      setReadError(null);
      try {
        const { headers: hdrs, rowCount: rc } = await readCsvMeta(selected);
        setHeaders(hdrs);
        setRowCount(rc);
        // Blank out column mappings so auto-match fills them fresh
        const blank: CsvConfig = {
          filePath: selected,
          emailColumn: "", nameColumn: "", companyColumn: "",
          titleColumn: "", phoneColumn: "", tagsColumns: [],
          dealStageColumn: "", dealValueColumn: "",
        };
        onChange(autoMatchCsvColumns(hdrs, blank));
      } catch {
        setReadError("Could not read file — check the path is accessible.");
        onChange({ ...config, filePath: selected });
      } finally {
        setLoading(false);
      }
    } catch (err) {
      console.error("File picker failed:", err);
    }
  }, [config, onChange]);

  // ColSelect: dropdown when headers are known, text input as fallback
  function ColSelect({
    label,
    value,
    onChangeVal,
    required = false,
  }: {
    label: string;
    value: string;
    onChangeVal: (v: string) => void;
    required?: boolean;
  }) {
    const hasError = required && !value && headers.length > 0;
    return (
      <div>
        <label className="text-xs text-text-tertiary block mb-1">
          {label}
          {required ? <span className="text-danger ml-0.5">*</span> : <span className="text-text-quaternary ml-1">(optional)</span>}
        </label>
        {headers.length > 0 ? (
          <select
            value={value}
            onChange={(e) => onChangeVal(e.target.value)}
            className={`w-full px-3 py-2 text-sm bg-bg-tertiary border rounded text-text-primary outline-none focus:border-accent ${
              hasError ? "border-danger/50" : "border-border-primary"
            }`}
          >
            <option value="">— not mapped —</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChangeVal(e.target.value)}
            placeholder={required ? "Column name" : "Column name"}
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent placeholder:text-text-tertiary"
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* File picker */}
      <div>
        <label className="text-sm text-text-secondary block mb-1.5">CSV File</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={config.filePath}
            onChange={(e) => onChange({ ...config, filePath: e.target.value })}
            placeholder="/path/to/contacts.csv"
            className="flex-1 px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={handleBrowse}
            className="bg-bg-tertiary border border-border-primary text-text-primary shrink-0"
          >
            Browse
          </Button>
        </div>
      </div>

      {/* Status indicators */}
      {loading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border border-border-secondary rounded-lg text-xs text-text-tertiary">
          <Loader2 size={12} className="animate-spin shrink-0" />
          Reading columns…
        </div>
      )}
      {!loading && rowCount !== null && headers.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-600">
          <CheckCircle2 size={12} className="shrink-0" />
          <span className="font-medium">{rowCount.toLocaleString()} contacts</span>
          <span className="text-green-600/50">·</span>
          <span>{headers.length} columns found</span>
        </div>
      )}
      {!loading && readError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger">
          <AlertCircle size={12} className="shrink-0" />
          {readError}
        </div>
      )}

      {/* Column mapping — shown once a file is set */}
      {config.filePath && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Column Mapping</span>
            {headers.length > 0 && (
              <span className="text-xs text-text-quaternary">Columns auto-detected from your file</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColSelect
              label="Email"
              value={config.emailColumn}
              onChangeVal={(v) => onChange({ ...config, emailColumn: v })}
              required
            />
            <ColSelect
              label="Name"
              value={config.nameColumn}
              onChangeVal={(v) => onChange({ ...config, nameColumn: v })}
              required
            />
            <ColSelect
              label="Company"
              value={config.companyColumn}
              onChangeVal={(v) => onChange({ ...config, companyColumn: v })}
            />
            <ColSelect
              label="Title / Role"
              value={config.titleColumn}
              onChangeVal={(v) => onChange({ ...config, titleColumn: v })}
            />
            <ColSelect
              label="Phone"
              value={config.phoneColumn}
              onChangeVal={(v) => onChange({ ...config, phoneColumn: v })}
            />
            <ColSelect
              label="Deal Stage"
              value={config.dealStageColumn}
              onChangeVal={(v) => onChange({ ...config, dealStageColumn: v })}
            />
            <ColSelect
              label="Deal Value"
              value={config.dealValueColumn}
              onChangeVal={(v) => onChange({ ...config, dealValueColumn: v })}
            />
          </div>

          {/* Tag Sources — full width, supports multiple columns */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-tertiary">
                Tag Sources <span className="text-text-quaternary">(optional)</span>
              </label>
              <span className="text-xs text-text-quaternary">Each column adds its value as a contact tag</span>
            </div>
            <div className="space-y-2">
              {config.tagsColumns.map((col, i) => (
                <div key={i} className="flex items-center gap-2">
                  {headers.length > 0 ? (
                    <select
                      value={col}
                      onChange={(e) => {
                        const updated = [...config.tagsColumns];
                        updated[i] = e.target.value;
                        onChange({ ...config, tagsColumns: updated });
                      }}
                      className="flex-1 px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent"
                    >
                      <option value="">— not mapped —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={col}
                      onChange={(e) => {
                        const updated = [...config.tagsColumns];
                        updated[i] = e.target.value;
                        onChange({ ...config, tagsColumns: updated });
                      }}
                      placeholder="Column name"
                      className="flex-1 px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent"
                    />
                  )}
                  <button
                    onClick={() => onChange({ ...config, tagsColumns: config.tagsColumns.filter((_, j) => j !== i) })}
                    className="p-1.5 text-text-tertiary hover:text-danger transition-colors shrink-0 rounded"
                    title="Remove tag source"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => onChange({ ...config, tagsColumns: [...config.tagsColumns, ""] })}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                <Plus size={12} />
                Add tag source
              </button>
            </div>
            {config.tagsColumns.length > 0 && (
              <p className="text-xs text-text-quaternary mt-1.5">
                Values can be pipe-separated within a column — e.g. <span className="font-mono bg-bg-tertiary px-1 rounded">active client|vip</span>.
                Use the <span className="font-medium text-text-tertiary">Contact tag</span> filter in Inbox Splits to route emails by tag.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomApiForm({
  config,
  onChange,
}: {
  config: CustomApiConfig;
  onChange: (c: CustomApiConfig) => void;
}) {
  const addHeader = () => {
    onChange({ ...config, headers: [...config.headers, { key: "", value: "" }] });
  };

  const updateHeader = (index: number, field: "key" | "value", val: string) => {
    const updated = config.headers.map((h, i) =>
      i === index ? { ...h, [field]: val } : h,
    );
    onChange({ ...config, headers: updated });
  };

  const removeHeader = (index: number) => {
    onChange({ ...config, headers: config.headers.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <TextField
        label="Base URL"
        size="md"
        value={config.baseUrl}
        onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
        placeholder="https://api.example.com/contacts"
      />
      <TextField
        label="Email Query Parameter"
        size="md"
        value={config.emailParam}
        onChange={(e) => onChange({ ...config, emailParam: e.target.value })}
        placeholder="email"
      />
      <TextField
        label="API Key"
        size="md"
        type="password"
        value={config.apiKey}
        onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
        placeholder="Bearer token or API key"
      />
      <div>
        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Response Mapping (dot-notation)</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Email Path"
            size="md"
            value={config.emailPath}
            onChange={(e) => onChange({ ...config, emailPath: e.target.value })}
            placeholder="data.email"
          />
          <TextField
            label="Name Path"
            size="md"
            value={config.namePath}
            onChange={(e) => onChange({ ...config, namePath: e.target.value })}
            placeholder="data.name"
          />
          <TextField
            label="Company Path (optional)"
            size="md"
            value={config.companyPath}
            onChange={(e) => onChange({ ...config, companyPath: e.target.value })}
            placeholder="data.company"
          />
          <TextField
            label="Title Path (optional)"
            size="md"
            value={config.titlePath}
            onChange={(e) => onChange({ ...config, titlePath: e.target.value })}
            placeholder="data.title"
          />
          <TextField
            label="Deal Stage Path (optional)"
            size="md"
            value={config.dealStagePath}
            onChange={(e) => onChange({ ...config, dealStagePath: e.target.value })}
            placeholder="data.deal_stage"
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Custom Headers</p>
          <button
            onClick={addHeader}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            + Add header
          </button>
        </div>
        {config.headers.length === 0 ? (
          <p className="text-xs text-text-tertiary">No custom headers configured.</p>
        ) : (
          <div className="space-y-2">
            {config.headers.map((header, index) => (
              <div key={index} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={header.key}
                  onChange={(e) => updateHeader(index, "key", e.target.value)}
                  placeholder="Header-Name"
                  className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={header.value}
                  onChange={(e) => updateHeader(index, "value", e.target.value)}
                  placeholder="value"
                  className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border-primary rounded text-text-primary outline-none focus:border-accent"
                />
                <button
                  onClick={() => removeHeader(index)}
                  className="p-1 text-text-tertiary hover:text-danger transition-colors shrink-0"
                  title="Remove header"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Provider selection cards ──────────────────────────────────────────────────

const PROVIDERS: { id: CrmProvider; label: string; description: string }[] = [
  {
    id: "hubspot",
    label: "HubSpot",
    description: "Connect via HubSpot private app access token",
  },
  {
    id: "notion",
    label: "Notion",
    description: "Sync contacts from a Notion database",
  },
  {
    id: "airtable",
    label: "Airtable",
    description: "Sync contacts from an Airtable base",
  },
  {
    id: "csv",
    label: "CSV File",
    description: "Import contacts from a local CSV file",
  },
  {
    id: "custom",
    label: "Custom API",
    description: "Connect to any REST API with custom field mapping",
  },
];

// ─── Add-connection inline panel ──────────────────────────────────────────────

interface AddConnectionPanelProps {
  onSaved: () => void;
  onCancel: () => void;
}

function AddConnectionPanel({ onSaved, onCancel }: AddConnectionPanelProps) {
  const [step, setStep] = useState<"pick-provider" | "configure">("pick-provider");
  const [selectedProvider, setSelectedProvider] = useState<CrmProvider | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [config, setConfig] = useState<ProviderConfig>(defaultConfigForProvider("hubspot"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectProvider = (provider: CrmProvider) => {
    setSelectedProvider(provider);
    setDisplayName(providerLabel(provider));
    setConfig(defaultConfigForProvider(provider));
    setError(null);
    setStep("configure");
  };

  const extractApiKey = (provider: CrmProvider, cfg: ProviderConfig): string => {
    switch (provider) {
      case "hubspot": return (cfg as HubSpotConfig).accessToken;
      case "notion": return (cfg as NotionConfig).integrationToken;
      case "airtable": return (cfg as AirtableConfig).personalAccessToken;
      case "csv": return "";
      case "custom": return (cfg as CustomApiConfig).apiKey;
    }
  };

  const buildConfigJson = (provider: CrmProvider, cfg: ProviderConfig): string => {
    switch (provider) {
      case "hubspot": {
        const c = cfg as HubSpotConfig;
        return JSON.stringify({ ...c, accessToken: undefined });
      }
      case "notion": {
        const c = cfg as NotionConfig;
        return JSON.stringify({ ...c, integrationToken: undefined });
      }
      case "airtable": {
        const c = cfg as AirtableConfig;
        return JSON.stringify({ ...c, personalAccessToken: undefined });
      }
      case "csv":
        return JSON.stringify(cfg);
      case "custom": {
        const c = cfg as CustomApiConfig;
        return JSON.stringify({ ...c, apiKey: undefined });
      }
    }
  };

  const handleSave = async () => {
    if (!selectedProvider) return;
    setError(null);
    setSaving(true);
    try {
      const apiKey = extractApiKey(selectedProvider, config);
      const configJson = buildConfigJson(selectedProvider, config);

      const newId = await createCrmConnection({
        provider: selectedProvider,
        displayName: displayName.trim() || providerLabel(selectedProvider),
        configJson,
      });

      if (apiKey) {
        await setSecureSetting(`crm_key_${newId}`, apiKey);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSaving(false);
    }
  };

  if (step === "pick-provider") {
    return (
      <div className="mt-4 border border-border-primary rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary bg-bg-secondary">
          <span className="text-sm font-medium text-text-primary">Select Provider</span>
          <button
            onClick={onCancel}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors rounded"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-3 grid grid-cols-1 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProvider(p.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-primary hover:bg-bg-hover transition-colors text-left border border-border-primary"
            >
              <ProviderIcon provider={p.id} size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-primary">{p.label}</div>
                <div className="text-xs text-text-tertiary mt-0.5">{p.description}</div>
              </div>
              <ChevronRight size={14} className="text-text-tertiary shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Configure step
  return (
    <div className="mt-4 border border-border-primary rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-primary bg-bg-secondary">
        <button
          onClick={() => setStep("pick-provider")}
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-text-primary flex items-center gap-2">
          <ProviderIcon provider={selectedProvider!} size={16} />
          Configure {providerLabel(selectedProvider!)}
        </span>
        <button
          onClick={onCancel}
          className="ml-auto p-1 text-text-tertiary hover:text-text-primary transition-colors rounded"
        >
          <X size={15} />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <TextField
          label="Display Name"
          size="md"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={providerLabel(selectedProvider!)}
        />

        {selectedProvider === "hubspot" && (
          <HubSpotForm
            config={config as HubSpotConfig}
            onChange={(c) => setConfig(c)}
          />
        )}
        {selectedProvider === "notion" && (
          <NotionForm
            config={config as NotionConfig}
            onChange={(c) => setConfig(c)}
          />
        )}
        {selectedProvider === "airtable" && (
          <AirtableForm
            config={config as AirtableConfig}
            onChange={(c) => setConfig(c)}
          />
        )}
        {selectedProvider === "csv" && (
          <CsvForm
            config={config as CsvConfig}
            onChange={(c) => setConfig(c)}
          />
        )}
        {selectedProvider === "custom" && (
          <CustomApiForm
            config={config as CustomApiConfig}
            onChange={(c) => setConfig(c)}
          />
        )}

        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Add Connection"}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            className="bg-bg-tertiary text-text-primary border border-border-primary"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-connection inline panel ─────────────────────────────────────────────

interface EditConnectionPanelProps {
  editState: EditState;
  onSaved: () => void;
  onCancel: () => void;
}

function EditConnectionPanel({ editState, onSaved, onCancel }: EditConnectionPanelProps) {
  const [displayName, setDisplayName] = useState(editState.displayName);
  const [config, setConfig] = useState<ProviderConfig>(editState.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = editState.provider;

  const extractApiKey = (cfg: ProviderConfig): string => {
    switch (provider) {
      case "hubspot": return (cfg as HubSpotConfig).accessToken;
      case "notion": return (cfg as NotionConfig).integrationToken;
      case "airtable": return (cfg as AirtableConfig).personalAccessToken;
      case "csv": return "";
      case "custom": return (cfg as CustomApiConfig).apiKey;
    }
  };

  const buildConfigJson = (cfg: ProviderConfig): string => {
    switch (provider) {
      case "hubspot": {
        const c = cfg as HubSpotConfig;
        return JSON.stringify({ ...c, accessToken: undefined });
      }
      case "notion": {
        const c = cfg as NotionConfig;
        return JSON.stringify({ ...c, integrationToken: undefined });
      }
      case "airtable": {
        const c = cfg as AirtableConfig;
        return JSON.stringify({ ...c, personalAccessToken: undefined });
      }
      case "csv":
        return JSON.stringify(cfg);
      case "custom": {
        const c = cfg as CustomApiConfig;
        return JSON.stringify({ ...c, apiKey: undefined });
      }
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const apiKey = extractApiKey(config);
      const configJson = buildConfigJson(config);

      await updateCrmConnection(editState.connectionId, {
        display_name: displayName.trim() || providerLabel(provider),
        config_json: configJson,
      });

      if (apiKey) {
        await setSecureSetting(`crm_key_${editState.connectionId}`, apiKey);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 border border-border-primary rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-primary bg-bg-secondary">
        <span className="text-sm font-medium text-text-primary flex items-center gap-2">
          <ProviderIcon provider={provider} size={16} />
          Edit {providerLabel(provider)}
        </span>
        <button
          onClick={onCancel}
          className="ml-auto p-1 text-text-tertiary hover:text-text-primary transition-colors rounded"
        >
          <X size={15} />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <TextField
          label="Display Name"
          size="md"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={providerLabel(provider)}
        />

        {provider === "hubspot" && (
          <HubSpotForm config={config as HubSpotConfig} onChange={(c) => setConfig(c)} />
        )}
        {provider === "notion" && (
          <NotionForm config={config as NotionConfig} onChange={(c) => setConfig(c)} />
        )}
        {provider === "airtable" && (
          <AirtableForm config={config as AirtableConfig} onChange={(c) => setConfig(c)} />
        )}
        {provider === "csv" && (
          <CsvForm config={config as CsvConfig} onChange={(c) => setConfig(c)} />
        )}
        {provider === "custom" && (
          <CustomApiForm config={config as CustomApiConfig} onChange={(c) => setConfig(c)} />
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            className="bg-bg-tertiary text-text-primary border border-border-primary"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Connection row ────────────────────────────────────────────────────────────

interface ConnectionRowProps {
  connection: DbCrmConnection;
  contactCount: number;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onSyncNow: (id: string) => void;
  syncing: boolean;
  onEdit: (connection: DbCrmConnection) => void;
  onDelete: (id: string) => void;
  isEditing: boolean;
}

function ConnectionRow({
  connection,
  contactCount,
  onToggleEnabled,
  onSyncNow,
  syncing,
  onEdit,
  onDelete,
  isEditing,
}: ConnectionRowProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const provider = connection.provider as CrmProvider;
  const isEnabled = connection.is_enabled === 1;

  return (
    <div className={`rounded-lg border transition-colors ${isEditing ? "border-accent/50 bg-bg-secondary" : "border-border-primary bg-bg-secondary"}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Provider icon */}
        <div className="shrink-0">
          <ProviderIcon provider={provider} size={18} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate">
              {connection.display_name}
            </span>
            <span className="text-[0.6rem] font-medium px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-tertiary shrink-0">
              {providerLabel(provider)}
            </span>
            <SyncStatusBadge status={syncing ? "syncing" : connection.sync_status} />
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-text-tertiary">
              {formatLastSync(connection.last_sync_at)}
            </span>
            <span className="text-xs text-text-tertiary">
              {contactCount.toLocaleString()} {contactCount === 1 ? "contact" : "contacts"}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Sync now */}
          <button
            onClick={() => onSyncNow(connection.id)}
            disabled={syncing || !isEnabled}
            title="Sync now"
            className="p-1.5 rounded text-text-tertiary hover:text-text-primary disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          </button>

          {/* Edit */}
          <button
            onClick={() => onEdit(connection)}
            title="Edit connection"
            className={`p-1.5 rounded transition-colors ${isEditing ? "text-accent" : "text-text-tertiary hover:text-text-primary"}`}
          >
            <Pencil size={14} />
          </button>

          {/* Delete */}
          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(connection.id)}
                className="text-xs text-danger hover:opacity-80 transition-colors font-medium"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              title="Delete connection"
              className="p-1.5 rounded text-text-tertiary hover:text-danger transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Enable toggle */}
          <button
            onClick={() => onToggleEnabled(connection.id, !isEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-1 ${isEnabled ? "bg-accent" : "bg-bg-tertiary"}`}
            title={isEnabled ? "Disable" : "Enable"}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isEnabled ? "translate-x-5" : ""}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main CrmSettings component ───────────────────────────────────────────────

export function CrmSettings() {
  const [crmEnabled, setCrmEnabled] = useState(true);
  const [connections, setConnections] = useState<DbCrmConnection[]>([]);
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({});
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingConnection, setEditingConnection] = useState<EditState | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConnections = useCallback(async () => {
    const conns = await getCrmConnections();
    setConnections(conns);

    // Load contact counts in parallel
    const counts = await Promise.all(
      conns.map(async (c) => ({
        id: c.id,
        count: await getContactCountForConnection(c.id),
      })),
    );
    const countsMap: Record<string, number> = {};
    for (const { id, count } of counts) {
      countsMap[id] = count;
    }
    setContactCounts(countsMap);
  }, []);

  useEffect(() => {
    async function load() {
      const enabled = await getSetting("crm_enabled");
      setCrmEnabled(enabled !== "false");
      await loadConnections();
      setLoading(false);
    }
    load();
  }, [loadConnections]);

  const handleToggleCrmEnabled = async () => {
    const newVal = !crmEnabled;
    setCrmEnabled(newVal);
    await setSetting("crm_enabled", newVal ? "true" : "false");
  };

  const handleToggleConnectionEnabled = async (id: string, enabled: boolean) => {
    setConnections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_enabled: enabled ? 1 : 0 } : c)),
    );
    await updateCrmConnection(id, { is_enabled: enabled ? 1 : 0 });
  };

  const handleSyncNow = async (id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await syncConnection(id);
      // Refresh connection status and contact count after sync
      const conns = await getCrmConnections();
      setConnections(conns);
      const count = await getContactCountForConnection(id);
      setContactCounts((prev) => ({ ...prev, [id]: count }));
    } catch (err) {
      console.error("CRM sync failed:", err);
      // Refresh to show error status
      const conns = await getCrmConnections();
      setConnections(conns);
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    await deleteCrmConnection(id);
    if (editingConnection?.connectionId === id) {
      setEditingConnection(null);
    }
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setContactCounts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleEdit = async (connection: DbCrmConnection) => {
    if (editingConnection?.connectionId === connection.id) {
      setEditingConnection(null);
      return;
    }

    // Parse stored config and load API key from keychain
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(connection.config_json) as Record<string, unknown>;
    } catch {
      /* use empty */
    }

    const provider = connection.provider as CrmProvider;
    const storedApiKey = await getSecureSetting(`crm_key_${connection.id}`);
    const apiKey = storedApiKey ?? "";

    // Merge API key back into the config for the form
    let formConfig: ProviderConfig;
    switch (provider) {
      case "hubspot":
        formConfig = { ...defaultConfigForProvider("hubspot"), ...parsedConfig, accessToken: apiKey } as HubSpotConfig;
        break;
      case "notion":
        formConfig = { ...defaultConfigForProvider("notion"), ...parsedConfig, integrationToken: apiKey } as NotionConfig;
        break;
      case "airtable":
        formConfig = { ...defaultConfigForProvider("airtable"), ...parsedConfig, personalAccessToken: apiKey } as AirtableConfig;
        break;
      case "csv":
        formConfig = { ...defaultConfigForProvider("csv"), ...parsedConfig } as CsvConfig;
        break;
      case "custom":
        formConfig = { ...defaultConfigForProvider("custom"), ...parsedConfig, apiKey } as CustomApiConfig;
        break;
      default:
        formConfig = defaultConfigForProvider("custom");
    }

    setEditingConnection({
      connectionId: connection.id,
      displayName: connection.display_name,
      provider,
      config: formConfig,
      apiKey,
    });
    setShowAddPanel(false);
  };

  const handleEditSaved = async () => {
    setEditingConnection(null);
    await loadConnections();
  };

  const handleAddSaved = async () => {
    setShowAddPanel(false);
    await loadConnections();
  };

  return (
    <div className="space-y-8">
      {/* Master toggle */}
      <Section title="CRM Integration">
        <p className="text-xs text-text-tertiary mb-3">
          Connect your CRM to surface contact information alongside email threads. Contact data is stored locally and never leaves your machine.
        </p>
        <ToggleRow
          label="Enable CRM features"
          description="Look up contacts from connected CRM providers when reading email"
          checked={crmEnabled}
          onToggle={handleToggleCrmEnabled}
        />
      </Section>

      {/* Connections list */}
      <Section title="Connections">
        {loading ? (
          <p className="text-sm text-text-tertiary">Loading connections…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No CRM connections configured. Add one below to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <div key={conn.id}>
                <ConnectionRow
                  connection={conn}
                  contactCount={contactCounts[conn.id] ?? 0}
                  onToggleEnabled={handleToggleConnectionEnabled}
                  onSyncNow={handleSyncNow}
                  syncing={syncingIds.has(conn.id)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  isEditing={editingConnection?.connectionId === conn.id}
                />
                {editingConnection?.connectionId === conn.id && (
                  <EditConnectionPanel
                    editState={editingConnection}
                    onSaved={handleEditSaved}
                    onCancel={() => setEditingConnection(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add connection */}
        {!showAddPanel && !editingConnection && (
          <button
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-2 mt-3 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            <Plus size={15} />
            Add Connection
          </button>
        )}
        {showAddPanel && (
          <AddConnectionPanel
            onSaved={handleAddSaved}
            onCancel={() => setShowAddPanel(false)}
          />
        )}
      </Section>
    </div>
  );
}

// ─── Local Section / ToggleRow (matches SettingsPage.tsx pattern) ─────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm text-text-secondary">{label}</span>
        {description && (
          <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={onToggle}
        className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ml-4 ${checked ? "bg-accent" : "bg-bg-tertiary"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${checked ? "translate-x-5" : ""}`}
        />
      </button>
    </div>
  );
}
