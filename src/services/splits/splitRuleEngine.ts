/**
 * Builds parameterized SQL WHERE clauses from inbox split rules.
 * All clauses assume the query has:
 *   - `t` aliased to `threads`
 *   - `m` aliased to `messages` (latest message per thread, LEFT JOIN)
 */

export type RuleType =
  | "from_domain"
  | "from_address"
  | "from_name_contains"
  | "subject_contains"
  | "has_label"
  | "to_address"
  | "is_unread"
  | "is_starred"
  | "has_attachment"
  | "list_unsubscribe";

export interface SplitRule {
  ruleType: RuleType;
  ruleValue: string | null;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Convert a glob pattern (* → %) for use in LIKE, escaping other metacharacters. */
function globToLike(pattern: string): string {
  return pattern.split("*").map(escapeLike).join("%");
}

interface RuleClause {
  sql: string;
  params: unknown[];
}

/** Build a single SQL clause for one rule, starting params at `paramOffset`. */
export function buildRuleClause(rule: SplitRule, paramOffset: number): RuleClause {
  const params: unknown[] = [];
  let idx = paramOffset;
  let sql: string;

  switch (rule.ruleType) {
    case "from_domain": {
      const val = escapeLike(rule.ruleValue ?? "");
      params.push(`%@${val}`);
      sql = `LOWER(m.from_address) LIKE LOWER($${idx++}) ESCAPE '\\'`;
      break;
    }
    case "from_address": {
      const likeVal = rule.ruleValue?.includes("*")
        ? globToLike(rule.ruleValue)
        : `%${escapeLike(rule.ruleValue ?? "")}%`;
      params.push(likeVal);
      sql = `LOWER(m.from_address) LIKE LOWER($${idx++}) ESCAPE '\\'`;
      break;
    }
    case "from_name_contains": {
      params.push(`%${escapeLike(rule.ruleValue ?? "")}%`);
      sql = `LOWER(m.from_name) LIKE LOWER($${idx++}) ESCAPE '\\'`;
      break;
    }
    case "subject_contains": {
      params.push(`%${escapeLike(rule.ruleValue ?? "")}%`);
      sql = `LOWER(t.subject) LIKE LOWER($${idx++}) ESCAPE '\\'`;
      break;
    }
    case "has_label": {
      params.push(rule.ruleValue ?? "");
      sql = `EXISTS (SELECT 1 FROM thread_labels tl2 WHERE tl2.account_id = t.account_id AND tl2.thread_id = t.id AND tl2.label_id = $${idx++})`;
      break;
    }
    case "to_address": {
      params.push(`%${escapeLike(rule.ruleValue ?? "")}%`);
      sql = `LOWER(m.to_addresses) LIKE LOWER($${idx++}) ESCAPE '\\'`;
      break;
    }
    case "is_unread":
      sql = `t.is_read = 0`;
      break;
    case "is_starred":
      sql = `t.is_starred = 1`;
      break;
    case "has_attachment":
      sql = `t.has_attachments = 1`;
      break;
    case "list_unsubscribe":
      // Proxy: threads Gmail categorized as Promotions or Newsletters
      sql = `EXISTS (SELECT 1 FROM thread_labels tl2 WHERE tl2.account_id = t.account_id AND tl2.thread_id = t.id AND tl2.label_id IN ('CATEGORY_PROMOTIONS', 'CATEGORY_NEWSLETTERS'))`;
      break;
    default:
      sql = `1=0`; // Unknown rule — never matches
  }

  return { sql, params };
}

/** Build the combined WHERE clause for a set of rules with AND/OR operator. */
export function buildSplitWhereClause(
  rules: SplitRule[],
  ruleOperator: "AND" | "OR",
  startParamIdx: number,
): { clause: string; params: unknown[] } {
  if (rules.length === 0) return { clause: "1=0", params: [] };

  const allParams: unknown[] = [];
  let currentIdx = startParamIdx;

  const clauses = rules.map((rule) => {
    const { sql, params } = buildRuleClause(rule, currentIdx);
    currentIdx += params.length;
    allParams.push(...params);
    return sql;
  });

  const connector = ruleOperator === "AND" ? " AND " : " OR ";
  return {
    clause: `(${clauses.join(connector)})`,
    params: allParams,
  };
}

/** Human-readable label for each rule type. */
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  from_domain: "From domain",
  from_address: "From address",
  from_name_contains: "Sender name contains",
  subject_contains: "Subject contains",
  has_label: "Has label",
  to_address: "To address",
  is_unread: "Is unread",
  is_starred: "Is starred",
  has_attachment: "Has attachment",
  list_unsubscribe: "Is newsletter / promotional",
};

/** Whether a rule type requires a value input. */
export const RULE_TYPE_HAS_VALUE: Record<RuleType, boolean> = {
  from_domain: true,
  from_address: true,
  from_name_contains: true,
  subject_contains: true,
  has_label: true,
  to_address: true,
  is_unread: false,
  is_starred: false,
  has_attachment: false,
  list_unsubscribe: false,
};

export const RULE_TYPE_PLACEHOLDER: Record<RuleType, string> = {
  from_domain: "e.g. github.com",
  from_address: "e.g. *@github.com",
  from_name_contains: "e.g. GitHub",
  subject_contains: "e.g. Invoice",
  has_label: "e.g. INBOX, STARRED",
  to_address: "e.g. me@example.com",
  is_unread: "",
  is_starred: "",
  has_attachment: "",
  list_unsubscribe: "",
};
