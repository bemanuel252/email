/**
 * AI-powered inbox split analyzer.
 *
 * Three capabilities:
 * 1. suggestSplitsForInbox  — analyzes inbox patterns, returns split suggestions
 * 2. naturalLanguageToRules — converts a plain-English description to filter rules
 * 3. classifyThreadsForSplits — background AI classification for unmatched threads
 */

import { getDb } from "../db/connection";
import { getActiveProvider } from "../ai/providerManager";
import type { RuleType } from "./splitRuleEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiSuggestedRule {
  ruleType: RuleType;
  ruleValue: string | null;
}

export interface AiSuggestedSplit {
  name: string;
  icon: string;
  description: string;
  ruleOperator: "AND" | "OR";
  isCatchAll: boolean;
  rules: AiSuggestedRule[];
  /** Domains/senders that will match — shown in preview */
  exampleMatches: string[];
}

export interface InboxSenderPattern {
  domain: string;
  displayName: string;
  count: number;
  exampleSubjects: string[];
}

// ─── Inbox Pattern Analysis ────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "aol.com", "msn.com", "live.com", "protonmail.com",
]);

export async function getInboxSenderPatterns(accountId: string): Promise<InboxSenderPattern[]> {
  const db = await getDb();
  const rows = await db.select<{
    subject: string | null;
    from_address: string | null;
    from_name: string | null;
  }[]>(
    `SELECT t.subject, m.from_address, m.from_name
     FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX'
     ORDER BY t.last_message_at DESC
     LIMIT 400`,
    [accountId],
  );

  const domainMap = new Map<string, InboxSenderPattern>();

  for (const row of rows) {
    const match = row.from_address?.match(/@([\w.-]+)$/);
    if (!match) continue;
    const domain = match[1]!.toLowerCase();
    if (PERSONAL_DOMAINS.has(domain)) continue;

    const existing = domainMap.get(domain) ?? {
      domain,
      displayName: row.from_name ?? domain,
      count: 0,
      exampleSubjects: [],
    };
    existing.count++;
    if (existing.exampleSubjects.length < 3 && row.subject != null) {
      existing.exampleSubjects.push(row.subject);
    }
    domainMap.set(domain, existing);
  }

  return [...domainMap.values()]
    .filter((p) => p.count >= 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

// ─── 1. Suggest Splits ────────────────────────────────────────────────────────

export async function suggestSplitsForInbox(
  accountId: string,
  onProgress?: (msg: string) => void,
): Promise<AiSuggestedSplit[]> {
  onProgress?.("Scanning your inbox...");
  const patterns = await getInboxSenderPatterns(accountId);

  if (patterns.length === 0) {
    throw new Error("Not enough inbox data to analyze. Try syncing more emails first.");
  }

  onProgress?.("Identifying patterns...");
  const provider = await getActiveProvider();
  if (!provider) throw new Error("No AI provider configured. Set one up in Settings → AI.");

  const domainsText = patterns
    .slice(0, 40)
    .map((p) => `  - ${p.domain} (${p.count} emails) — e.g. "${p.exampleSubjects[0] ?? ""}"`)
    .join("\n");

  onProgress?.("Generating suggestions...");

  const raw = await provider.complete({
    systemPrompt: `You are an expert email organizer. Analyze inbox sender patterns and suggest smart inbox split tab configurations.

Return ONLY a valid JSON array — no markdown fences, no explanation, no text outside the JSON.

Each split object must have:
{
  "name": "short tab name (1-3 words)",
  "icon": "single emoji",
  "description": "one sentence: what emails go here",
  "ruleOperator": "OR",
  "isCatchAll": false,
  "rules": [{"ruleType": "from_domain", "ruleValue": "domain.com"}, ...],
  "exampleMatches": ["domain1.com", "sender name", ...]
}

For a catch-all tab: isCatchAll: true, rules: [], exampleMatches: []

Available ruleTypes:
- "from_domain": matches @domain.com — use this most often
- "from_address": specific email, supports * wildcard
- "from_name_contains": sender display name contains text
- "subject_contains": subject line contains text
- "has_label": Gmail label (STARRED, IMPORTANT, CATEGORY_PROMOTIONS, CATEGORY_NEWSLETTERS, CATEGORY_UPDATES, CATEGORY_SOCIAL)
- "list_unsubscribe": catches newsletters/marketing automatically (ruleValue: null)
- "is_starred": ruleValue: null
- "has_attachment": ruleValue: null

Guidelines:
- Suggest 4–7 splits total, always ending with a catch-all
- Group related services (GitHub + Linear + Jira = "Dev Tools")
- For newsletters/marketing, prefer "list_unsubscribe" rule
- For starred/important: use "is_starred" or has_label: "IMPORTANT"
- Be specific — use real domains from the data
- Make names human-friendly: "Work", "Finance", "Shopping", "GitHub", "Updates"`,
    userContent: `Here are the most common sender domains in this inbox:\n${domainsText}\n\nSuggest the best 4-7 inbox split tabs for this inbox. Make them practical and specific to the actual senders shown.`,
    maxTokens: 2500,
  });

  // Extract JSON array even if wrapped in markdown or has leading text
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("AI returned an unexpected response. Please try again.");

  const parsed = JSON.parse(jsonMatch[0]) as AiSuggestedSplit[];

  // Validate and sanitize
  return parsed.filter((s) => s.name && (s.isCatchAll || s.rules?.length > 0));
}

// ─── 2. Natural Language → Rules ──────────────────────────────────────────────

export async function naturalLanguageToRules(
  description: string,
  context?: { topDomains: string[] },
): Promise<AiSuggestedRule[]> {
  const provider = await getActiveProvider();
  if (!provider) throw new Error("No AI provider configured.");

  const contextNote = context?.topDomains.length
    ? `\n\nTop sender domains in this inbox: ${context.topDomains.slice(0, 25).join(", ")}`
    : "";

  const raw = await provider.complete({
    systemPrompt: `You are an email filter rule builder. Convert plain-English descriptions into precise filter rules.

Return ONLY a valid JSON array of rule objects. No markdown, no explanation.

Format: [{"ruleType": "...", "ruleValue": "...or null"}]

Available ruleTypes:
- "from_domain": @domain.com (e.g. "github.com", "stripe.com")
- "from_address": specific address, supports * wildcard (e.g. "noreply@github.com", "*@stripe.com")
- "from_name_contains": sender display name contains text
- "subject_contains": subject line contains text
- "has_label": Gmail label ID — STARRED, IMPORTANT, CATEGORY_PROMOTIONS, CATEGORY_NEWSLETTERS, CATEGORY_UPDATES
- "to_address": recipient address contains text
- "is_starred": ruleValue must be null
- "is_unread": ruleValue must be null
- "has_attachment": ruleValue must be null
- "list_unsubscribe": catches all newsletters/marketing, ruleValue must be null${contextNote}

Use OR logic between rules (they're combined with OR in the tab).
Be specific and practical. For vague descriptions, generate multiple complementary rules.`,
    userContent: `Create email filter rules for this tab description: "${description}"`,
    maxTokens: 600,
  });

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("AI returned an unexpected response.");

  const rules = JSON.parse(jsonMatch[0]) as AiSuggestedRule[];
  return rules.filter((r) => r.ruleType);
}

// ─── 3. Background AI Classification ─────────────────────────────────────────

interface ThreadToClassify {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  snippet: string | null;
}

interface SplitForClassification {
  id: string;
  name: string;
  aiDescription: string | null;
}

/** Classify threads into splits using AI. Returns threadId → splitId map. */
export async function classifyThreadsForSplits(
  threads: ThreadToClassify[],
  splits: SplitForClassification[],
): Promise<Map<string, string>> {
  if (threads.length === 0 || splits.length === 0) return new Map();

  const provider = await getActiveProvider();
  if (!provider) return new Map();

  // Batch in groups of 30 to stay within token limits
  const BATCH_SIZE = 30;
  const result = new Map<string, string>();

  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    const batch = threads.slice(i, i + BATCH_SIZE);
    const batchMap = await classifyBatch(batch, splits, provider);
    for (const [k, v] of batchMap) result.set(k, v);
  }

  return result;
}

async function classifyBatch(
  threads: ThreadToClassify[],
  splits: SplitForClassification[],
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
): Promise<Map<string, string>> {
  if (!provider) return new Map();

  const tabsList = splits
    .map((s, i) => `${i}: ${s.name}${s.aiDescription ? ` — ${s.aiDescription}` : ""}`)
    .join("\n");

  const emailsList = threads
    .map(
      (t, i) =>
        `${i}: From: ${t.fromName ?? t.fromAddress ?? "?"} | Subject: ${t.subject ?? "(no subject)"}`,
    )
    .join("\n");

  const raw = await provider.complete({
    systemPrompt: `You are an email classifier. Assign each email to the best matching inbox tab.
Return ONLY a valid JSON object mapping email index (string) to tab index (number).
Example: {"0": 2, "1": 0, "2": 3}
Use the catch-all tab if nothing else fits well.`,
    userContent: `Inbox tabs:\n${tabsList}\n\nEmails to classify:\n${emailsList}`,
    maxTokens: 400,
  });

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return new Map();

  const assignments = JSON.parse(jsonMatch[0]) as Record<string, number>;
  const result = new Map<string, string>();

  for (const [idxStr, splitIdx] of Object.entries(assignments)) {
    const thread = threads[parseInt(idxStr)];
    const split = splits[splitIdx];
    if (thread && split) result.set(thread.id, split.id);
  }

  return result;
}

// ─── AI Classification DB Helpers ─────────────────────────────────────────────

export async function saveAiClassifications(
  accountId: string,
  assignments: Map<string, string>,
): Promise<void> {
  if (assignments.size === 0) return;
  const db = await getDb();
  for (const [threadId, splitId] of assignments) {
    await db.execute(
      `INSERT INTO thread_split_assignments (thread_id, account_id, split_id, assigned_at)
       VALUES ($1, $2, $3, unixepoch())
       ON CONFLICT(thread_id, account_id) DO UPDATE SET split_id = $3, assigned_at = unixepoch()`,
      [threadId, accountId, splitId],
    );
  }
}

export async function clearAiClassificationsForSplit(
  accountId: string,
  splitId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM thread_split_assignments WHERE account_id = $1 AND split_id = $2`,
    [accountId, splitId],
  );
}

export async function clearAllAiClassifications(accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM thread_split_assignments WHERE account_id = $1`,
    [accountId],
  );
}

/** Fetch inbox threads not yet matched by any split's rules (for AI classification). */
export async function getUnassignedInboxThreads(
  accountId: string,
  limit = 100,
): Promise<ThreadToClassify[]> {
  const db = await getDb();
  return db.select<ThreadToClassify[]>(
    `SELECT DISTINCT t.id, t.subject, m.from_address as fromAddress, m.from_name as fromName, t.snippet
     FROM threads t
     INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     LEFT JOIN thread_split_assignments tsa ON tsa.account_id = t.account_id AND tsa.thread_id = t.id
     WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND tsa.thread_id IS NULL
     ORDER BY t.last_message_at DESC
     LIMIT $2`,
    [accountId, limit],
  );
}
