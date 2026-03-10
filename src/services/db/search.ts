import { getDb } from "./connection";
import { parseSearchQuery, hasSearchOperators } from "../search/searchParser";
import { buildSearchQuery } from "../search/searchQueryBuilder";
import { buildFts5Query } from "../search/fts5Utils";

export interface SearchResult {
  message_id: string;
  account_id: string;
  thread_id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  snippet: string | null;
  date: number;
  rank: number;
}

/** Whether the query looks like a domain or email address (contains a dot). */
function looksLikeDomainOrEmail(q: string): boolean {
  return /\S+\.\S+/.test(q);
}

/**
 * Escape LIKE metacharacters so user input is treated as literal text.
 * SQLite LIKE treats '_' (any single char) and '%' (any sequence) as wildcards.
 * Pair this with `ESCAPE '\'` in the SQL clause.
 */
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * LIKE-based fallback search for domain/email-style queries or when FTS5
 * returns no results. Searches subject, from_address, from_name, to_addresses,
 * and snippet directly — safe for dots and special characters.
 *
 * Uses $N positional params (required by the Tauri SQLite plugin).
 */
async function likeSearch(
  db: Awaited<ReturnType<typeof getDb>>,
  query: string,
  accountId: string | undefined,
  limit: number,
  excludeIds?: Set<string>,
): Promise<SearchResult[]> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const params: unknown[] = [];
  let idx = 1;

  // Each term must appear in at least one relevant field (including CRM contact data).
  // Escape LIKE metacharacters (_ and %) so user input is literal; use ESCAPE '\'.
  const termClauses = terms.map((t) => {
    const likeVal = `%${escapeLike(t)}%`;
    const a = idx++; params.push(likeVal);
    const b = idx++; params.push(likeVal);
    const c = idx++; params.push(likeVal);
    const d = idx++; params.push(likeVal);
    const e = idx++; params.push(likeVal);
    const f = idx++; params.push(likeVal);
    const g = idx++; params.push(likeVal);
    return `(LOWER(m.from_address) LIKE LOWER($${a}) ESCAPE '\\'
        OR LOWER(m.from_name) LIKE LOWER($${b}) ESCAPE '\\'
        OR LOWER(m.to_addresses) LIKE LOWER($${c}) ESCAPE '\\'
        OR LOWER(m.subject) LIKE LOWER($${d}) ESCAPE '\\'
        OR LOWER(m.snippet) LIKE LOWER($${e}) ESCAPE '\\'
        OR LOWER(cc.company) LIKE LOWER($${f}) ESCAPE '\\'
        OR LOWER(cc.display_name) LIKE LOWER($${g}) ESCAPE '\\')`;
  });

  const whereParts = [...termClauses];

  if (accountId) {
    whereParts.push(`m.account_id = $${idx}`);
    params.push(accountId);
    idx++;
  }

  if (excludeIds && excludeIds.size > 0) {
    const placeholders = [...excludeIds].map(() => `$${idx++}`).join(",");
    whereParts.push(`m.id NOT IN (${placeholders})`);
    params.push(...excludeIds);
  }

  params.push(limit);
  const limitIdx = idx;

  const sql = `SELECT DISTINCT
    m.id as message_id,
    m.account_id,
    m.thread_id,
    m.subject,
    m.from_name,
    m.from_address,
    m.snippet,
    m.date,
    0 as rank
  FROM messages m
  LEFT JOIN crm_contacts cc ON LOWER(cc.email) = LOWER(m.from_address)
  WHERE ${whereParts.join(" AND ")}
  ORDER BY m.date DESC
  LIMIT $${limitIdx}`;

  try {
    return await db.select<SearchResult[]>(sql, params);
  } catch {
    return [];
  }
}

/**
 * Full-text search across messages.
 *
 * Strategy:
 *  1. Operator-based search (from:, subject:, is:unread, etc.)
 *  2. FTS5 trigram search with proper query escaping (handles dots, special chars)
 *  3. LIKE fallback — always runs for domain/email queries, and augments when
 *     FTS5 returns fewer results than the limit
 *
 * Supports search operators: from:, to:, subject:, has:attachment, is:unread, etc.
 */
export async function searchMessages(
  query: string,
  accountId?: string,
  limit = 50,
): Promise<SearchResult[]> {
  const db = await getDb();

  const rawQuery = query.trim();
  if (!rawQuery) return [];

  // ── 1. Operator-based search ──────────────────────────────────────────────
  if (hasSearchOperators(rawQuery)) {
    const parsed = parseSearchQuery(rawQuery);
    if (
      parsed.freeText ||
      parsed.from ||
      parsed.to ||
      parsed.subject ||
      parsed.hasAttachment ||
      parsed.isUnread ||
      parsed.isRead ||
      parsed.isStarred ||
      parsed.before !== undefined ||
      parsed.after !== undefined ||
      parsed.label ||
      parsed.tag ||
      parsed.company
    ) {
      try {
        const { sql, params } = buildSearchQuery(parsed, accountId, limit);
        return db.select<SearchResult[]>(sql, params);
      } catch {
        // Fall through to FTS5 on operator search error
      }
    }
  }

  // ── 2. FTS5 full-text search ──────────────────────────────────────────────
  const fts5Query = buildFts5Query(rawQuery);
  let ftsResults: SearchResult[] = [];

  if (fts5Query) {
    try {
      if (accountId) {
        ftsResults = await db.select<SearchResult[]>(
          `SELECT
            m.id as message_id,
            m.account_id,
            m.thread_id,
            m.subject,
            m.from_name,
            m.from_address,
            m.snippet,
            m.date,
            rank
          FROM messages_fts
          JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH $1 AND m.account_id = $2
          ORDER BY rank
          LIMIT $3`,
          [fts5Query, accountId, limit],
        );
      } else {
        ftsResults = await db.select<SearchResult[]>(
          `SELECT
            m.id as message_id,
            m.account_id,
            m.thread_id,
            m.subject,
            m.from_name,
            m.from_address,
            m.snippet,
            m.date,
            rank
          FROM messages_fts
          JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH $1
          ORDER BY rank
          LIMIT $2`,
          [fts5Query, limit],
        );
      }
    } catch {
      // FTS5 failed — continue to LIKE fallback
    }
  }

  // ── 3. LIKE fallback / augment ────────────────────────────────────────────
  // Always run LIKE for domain/email-style queries (dots). Also augments FTS5
  // when it returned fewer results than the limit.
  const seenIds = new Set(ftsResults.map((r) => r.message_id));
  const remaining = limit - ftsResults.length;

  if (remaining > 0 && (looksLikeDomainOrEmail(rawQuery) || ftsResults.length === 0)) {
    const likeResults = await likeSearch(db, rawQuery, accountId, remaining, seenIds);
    return [...ftsResults, ...likeResults];
  }

  return ftsResults;
}
