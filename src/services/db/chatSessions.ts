import { getDb } from "./connection";

export interface DbChatSession {
  id: string;
  account_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbChatMessage {
  id: string;
  session_id: string;
  account_id: string;
  role: "user" | "assistant" | "tool_result";
  content: string;
  tool_calls_json: string | null;
  tool_results_json: string | null;
  metadata_json: string | null;
  created_at: number;
}

export interface NewChatMessage {
  sessionId: string;
  accountId: string;
  role: "user" | "assistant" | "tool_result";
  content: string;
  toolCallsJson?: string | null;
  toolResultsJson?: string | null;
  metadataJson?: string | null;
}

export async function createChatSession(
  accountId: string,
  title?: string,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO chat_sessions (id, account_id, title) VALUES ($1, $2, $3)`,
    [id, accountId, title ?? null],
  );
  return id;
}

export async function getRecentSessions(
  accountId: string,
  limit = 50,
): Promise<DbChatSession[]> {
  const db = await getDb();
  return db.select<DbChatSession[]>(
    `SELECT * FROM chat_sessions
     WHERE account_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [accountId, limit],
  );
}

export async function getSessionById(
  sessionId: string,
): Promise<DbChatSession | null> {
  const db = await getDb();
  const rows = await db.select<DbChatSession[]>(
    `SELECT * FROM chat_sessions WHERE id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function getSessionMessages(
  sessionId: string,
): Promise<DbChatMessage[]> {
  const db = await getDb();
  return db.select<DbChatMessage[]>(
    `SELECT * FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  );
}

export async function saveChatMessage(msg: NewChatMessage): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO chat_messages
       (id, session_id, account_id, role, content, tool_calls_json, tool_results_json, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      msg.sessionId,
      msg.accountId,
      msg.role,
      msg.content,
      msg.toolCallsJson ?? null,
      msg.toolResultsJson ?? null,
      msg.metadataJson ?? null,
    ],
  );
  // Keep the session's updated_at current so ordering in getRecentSessions stays correct
  await db.execute(
    `UPDATE chat_sessions SET updated_at = unixepoch() WHERE id = $1`,
    [msg.sessionId],
  );
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chat_sessions SET title = $1, updated_at = unixepoch() WHERE id = $2`,
    [title, sessionId],
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();
  // chat_messages cascade-deletes via FK
  await db.execute(`DELETE FROM chat_sessions WHERE id = $1`, [sessionId]);
}
