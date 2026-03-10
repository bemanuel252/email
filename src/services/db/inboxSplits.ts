import { getDb } from "./connection";
import type { DbThread } from "./threads";
import { buildSplitWhereClause, type RuleType } from "../splits/splitRuleEngine";

export interface InboxSplitRule {
  id: string;
  splitId: string;
  accountId: string;
  ruleType: RuleType;
  ruleValue: string | null;
  position: number;
}

export interface InboxSplit {
  id: string;
  accountId: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  isEnabled: boolean;
  ruleOperator: "AND" | "OR";
  isCatchAll: boolean;
  aiDescription: string | null;
  aiClassificationEnabled: boolean;
  rules: InboxSplitRule[];
  createdAt: number;
  updatedAt: number;
}

interface DbInboxSplit {
  id: string;
  account_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: number;
  is_enabled: number;
  rule_operator: string;
  is_catch_all: number;
  ai_description: string | null;
  ai_classification_enabled: number;
  created_at: number;
  updated_at: number;
}

interface DbInboxSplitRule {
  id: string;
  split_id: string;
  account_id: string;
  rule_type: string;
  rule_value: string | null;
  position: number;
}

function mapDbSplit(row: DbInboxSplit, rules: InboxSplitRule[]): InboxSplit {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    position: row.position,
    isEnabled: row.is_enabled === 1,
    ruleOperator: row.rule_operator === "AND" ? "AND" : "OR",
    isCatchAll: row.is_catch_all === 1,
    aiDescription: row.ai_description ?? null,
    aiClassificationEnabled: row.ai_classification_enabled === 1,
    rules,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDbRule(row: DbInboxSplitRule): InboxSplitRule {
  return {
    id: row.id,
    splitId: row.split_id,
    accountId: row.account_id,
    ruleType: row.rule_type as RuleType,
    ruleValue: row.rule_value,
    position: row.position,
  };
}

export async function getSplitsForAccount(accountId: string): Promise<InboxSplit[]> {
  const db = await getDb();
  const splitRows = await db.select<DbInboxSplit[]>(
    `SELECT * FROM inbox_splits WHERE account_id = $1 ORDER BY position ASC`,
    [accountId],
  );
  if (splitRows.length === 0) return [];

  const ruleRows = await db.select<DbInboxSplitRule[]>(
    `SELECT * FROM inbox_split_rules WHERE account_id = $1 ORDER BY split_id, position ASC`,
    [accountId],
  );

  const rulesBySplitId = new Map<string, InboxSplitRule[]>();
  for (const row of ruleRows) {
    const mapped = mapDbRule(row);
    const list = rulesBySplitId.get(row.split_id) ?? [];
    list.push(mapped);
    rulesBySplitId.set(row.split_id, list);
  }

  return splitRows.map((row) => mapDbSplit(row, rulesBySplitId.get(row.id) ?? []));
}

export async function upsertSplit(split: Omit<InboxSplit, "rules" | "createdAt" | "updatedAt">): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO inbox_splits (id, account_id, name, icon, color, position, is_enabled, rule_operator, is_catch_all, ai_description, ai_classification_enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, unixepoch())
     ON CONFLICT(id, account_id) DO UPDATE SET
       name = $3, icon = $4, color = $5, position = $6,
       is_enabled = $7, rule_operator = $8, is_catch_all = $9,
       ai_description = $10, ai_classification_enabled = $11,
       updated_at = unixepoch()`,
    [
      split.id,
      split.accountId,
      split.name,
      split.icon,
      split.color,
      split.position,
      split.isEnabled ? 1 : 0,
      split.ruleOperator,
      split.isCatchAll ? 1 : 0,
      split.aiDescription ?? null,
      split.aiClassificationEnabled ? 1 : 0,
    ],
  );
}

export async function deleteSplit(splitId: string, accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM inbox_splits WHERE id = $1 AND account_id = $2`,
    [splitId, accountId],
  );
}

export async function clearAllSplitsForAccount(accountId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM inbox_splits WHERE account_id = $1`, [accountId]);
}

export async function upsertSplitRule(rule: InboxSplitRule): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO inbox_split_rules (id, split_id, account_id, rule_type, rule_value, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(id) DO UPDATE SET
       rule_type = $4, rule_value = $5, position = $6`,
    [rule.id, rule.splitId, rule.accountId, rule.ruleType, rule.ruleValue, rule.position],
  );
}

export async function deleteSplitRule(ruleId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM inbox_split_rules WHERE id = $1`, [ruleId]);
}

/** Replace all rules for a split atomically. */
export async function replaceSplitRules(splitId: string, accountId: string, rules: InboxSplitRule[]): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM inbox_split_rules WHERE split_id = $1 AND account_id = $2`,
    [splitId, accountId],
  );
  for (const rule of rules) {
    await db.execute(
      `INSERT INTO inbox_split_rules (id, split_id, account_id, rule_type, rule_value, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rule.id, rule.splitId, rule.accountId, rule.ruleType, rule.ruleValue, rule.position],
    );
  }
}

/** Reorder splits by updating their position values. */
export async function reorderSplits(accountId: string, splitIds: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < splitIds.length; i++) {
    await db.execute(
      `UPDATE inbox_splits SET position = $1 WHERE id = $2 AND account_id = $3`,
      [i, splitIds[i], accountId],
    );
  }
}

const INBOX_THREADS_SELECT = `
  SELECT DISTINCT
    t.id, t.account_id, t.subject, t.snippet, t.last_message_at, t.message_count,
    t.is_read, t.is_starred, t.is_important, t.has_attachments, t.is_snoozed,
    t.snooze_until, t.is_pinned, t.is_muted,
    m.from_name, m.from_address
  FROM threads t
  INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
  LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
    AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
  WHERE t.account_id = $1 AND tl.label_id = 'INBOX'
`;

export async function getThreadsForSplit(
  accountId: string,
  split: InboxSplit,
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  const params: unknown[] = [accountId];
  let paramIdx = 2;

  const ruleClauses: string[] = [];

  // Rule-based matching
  if (split.rules.length > 0) {
    const { clause, params: ruleParams } = buildSplitWhereClause(split.rules, split.ruleOperator, paramIdx);
    params.push(...ruleParams);
    paramIdx += ruleParams.length;
    ruleClauses.push(clause);
  }

  // AI classification matching
  params.push(split.id);
  ruleClauses.push(
    `EXISTS (SELECT 1 FROM thread_split_assignments tsa WHERE tsa.account_id = t.account_id AND tsa.thread_id = t.id AND tsa.split_id = $${paramIdx++})`,
  );

  if (ruleClauses.length === 0) return [];

  params.push(limit);
  params.push(offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const sql = `${INBOX_THREADS_SELECT}
    AND (${ruleClauses.join(" OR ")})
    GROUP BY t.account_id, t.id
    ORDER BY t.last_message_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  return db.select<DbThread[]>(sql, params);
}

export async function getThreadsForCatchAllSplit(
  accountId: string,
  otherSplits: InboxSplit[],
  limit = 50,
  offset = 0,
): Promise<DbThread[]> {
  const db = await getDb();
  const params: unknown[] = [accountId];
  let paramIdx = 2;

  const notClauses: string[] = [];
  for (const split of otherSplits.filter((s) => !s.isCatchAll && s.isEnabled)) {
    const splitClauses: string[] = [];
    if (split.rules.length > 0) {
      const { clause, params: ruleParams } = buildSplitWhereClause(split.rules, split.ruleOperator, paramIdx);
      params.push(...ruleParams);
      paramIdx += ruleParams.length;
      splitClauses.push(clause);
    }
    // Also exclude AI-assigned threads
    params.push(split.id);
    splitClauses.push(
      `EXISTS (SELECT 1 FROM thread_split_assignments tsa WHERE tsa.account_id = t.account_id AND tsa.thread_id = t.id AND tsa.split_id = $${paramIdx++})`,
    );
    if (splitClauses.length > 0) {
      notClauses.push(`NOT (${splitClauses.join(" OR ")})`);
    }
  }

  const notMatchedClause = notClauses.length > 0 ? `AND (${notClauses.join(" AND ")})` : "";

  params.push(limit);
  params.push(offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const sql = `${INBOX_THREADS_SELECT}
    ${notMatchedClause}
    GROUP BY t.account_id, t.id
    ORDER BY t.last_message_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  return db.select<DbThread[]>(sql, params);
}

/** Count unread threads for a split (for badge display). */
export async function getSplitUnreadCount(
  accountId: string,
  split: InboxSplit,
  otherSplits?: InboxSplit[],
): Promise<number> {
  const db = await getDb();
  const params: unknown[] = [accountId];
  let paramIdx = 2;

  let ruleClause: string;

  if (split.isCatchAll) {
    const notClauses: string[] = [];
    for (const s of (otherSplits ?? []).filter((s) => !s.isCatchAll && s.isEnabled && s.rules.length > 0)) {
      const { clause, params: rp } = buildSplitWhereClause(s.rules, s.ruleOperator, paramIdx);
      params.push(...rp);
      paramIdx += rp.length;
      notClauses.push(`NOT ${clause}`);
    }
    ruleClause = notClauses.length > 0 ? `AND (${notClauses.join(" AND ")})` : "";
  } else {
    if (split.rules.length === 0) return 0;
    const { clause, params: rp } = buildSplitWhereClause(split.rules, split.ruleOperator, paramIdx);
    params.push(...rp);
    ruleClause = `AND ${clause}`;
  }

  const sql = `
    SELECT COUNT(DISTINCT t.id) as count
    FROM threads t
    INNER JOIN thread_labels tl ON tl.account_id = t.account_id AND tl.thread_id = t.id
    LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
      AND m.date = (SELECT MAX(m2.date) FROM messages m2 WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
    WHERE t.account_id = $1 AND tl.label_id = 'INBOX' AND t.is_read = 0
    ${ruleClause}
  `;

  const rows = await db.select<{ count: number }[]>(sql, params);
  return rows[0]?.count ?? 0;
}

/** Seed default splits for a new account. Call when user first enables custom splits. */
export async function seedDefaultSplits(accountId: string): Promise<void> {
  const existing = await getSplitsForAccount(accountId);
  if (existing.length > 0) return;

  const now = () => Math.floor(Date.now() / 1000);

  const flaggedId = crypto.randomUUID();
  const newslettersId = crypto.randomUUID();
  const catchAllId = crypto.randomUUID();

  const db = await getDb();

  // 1. Flagged (starred)
  await db.execute(
    `INSERT INTO inbox_splits (id, account_id, name, icon, color, position, is_enabled, rule_operator, is_catch_all, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [flaggedId, accountId, "Flagged", "⭐", null, 0, 1, "OR", 0, now()],
  );
  await db.execute(
    `INSERT INTO inbox_split_rules (id, split_id, account_id, rule_type, rule_value, position)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), flaggedId, accountId, "is_starred", null, 0],
  );

  // 2. Newsletters
  await db.execute(
    `INSERT INTO inbox_splits (id, account_id, name, icon, color, position, is_enabled, rule_operator, is_catch_all, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [newslettersId, accountId, "Newsletters", "📰", null, 1, 1, "OR", 0, now()],
  );
  await db.execute(
    `INSERT INTO inbox_split_rules (id, split_id, account_id, rule_type, rule_value, position)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), newslettersId, accountId, "list_unsubscribe", null, 0],
  );

  // 3. Everything Else (catch-all)
  await db.execute(
    `INSERT INTO inbox_splits (id, account_id, name, icon, color, position, is_enabled, rule_operator, is_catch_all, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [catchAllId, accountId, "Everything Else", "📥", null, 2, 1, "OR", 1, now()],
  );
}
