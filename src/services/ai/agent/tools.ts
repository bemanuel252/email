// ---------------------------------------------------------------------------
// Agent tool definitions
// ---------------------------------------------------------------------------

export type AgentTool =
  | { name: "search_emails"; params: { query: string; limit?: number } }
  | { name: "get_thread"; params: { thread_id: string } }
  | { name: "archive_threads"; params: { thread_ids: string[] } }
  | { name: "label_threads"; params: { thread_ids: string[]; label_id: string } }
  | { name: "mark_read"; params: { thread_ids: string[]; read: boolean } }
  | { name: "trash_threads"; params: { thread_ids: string[] } }
  | { name: "summarize_thread"; params: { thread_id: string } }
  | { name: "draft_reply"; params: { thread_id: string; instructions: string } }
  | { name: "get_contact_crm"; params: { email: string } }
  | { name: "list_labels"; params: Record<string, never> };

export type AgentToolName = AgentTool["name"];

// ---------------------------------------------------------------------------
// Confirmation policy
// ---------------------------------------------------------------------------

/** Tools that ALWAYS require explicit user confirmation regardless of count. */
export const ALWAYS_CONFIRM: Set<AgentToolName> = new Set(["trash_threads"]);

/**
 * For bulk-capable tools (archive_threads, label_threads, mark_read),
 * trigger a confirmation dialog when the operation affects more than this
 * many threads.
 */
export const BULK_CONFIRM_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Runtime result types
// ---------------------------------------------------------------------------

/** Result returned after executing a single tool call. */
export interface ToolResult {
  toolName: AgentToolName;
  success: boolean;
  /** Human-readable summary fed back to the LLM as the tool result. */
  output: string;
  /** Thread IDs affected by the operation (used for citation in the UI). */
  threadIds?: string[];
}

/**
 * Emitted by the agent loop when a destructive or bulk operation needs
 * explicit user approval before proceeding.  The loop suspends and waits
 * for the host UI to resolve this request.
 */
export interface ConfirmationRequest {
  /** Unique ID so the UI can correlate approval/rejection back to the loop. */
  id: string;
  /** Short human-readable description of the action, e.g. "Archive 14 threads". */
  action: string;
  /** Full list of thread IDs that will be operated on. */
  threadIds: string[];
  /** Representative preview items shown in the confirmation dialog. */
  previewItems: Array<{ subject: string; from: string; date: number }>;
  /** True for trash — the UI should show a stronger warning. */
  isIrreversible: boolean;
}

/**
 * Callback signature for the confirmation gate.  The executor suspends a
 * destructive / bulk operation and calls this with a ConfirmationRequest;
 * the host UI must resolve it with true (approved) or false (rejected).
 */
export type ConfirmCallback = (req: ConfirmationRequest) => Promise<boolean>;

/** Returned by the agent after a complete user-message → final-answer cycle. */
export interface AgentTurnResult {
  /** The agent's final answer text displayed to the user. */
  answer: string;
  /** Ordered list of tool names called during this turn (for telemetry/UI). */
  toolsUsed: AgentToolName[];
  /** Thread IDs cited or touched during this turn (for sidebar highlights). */
  threadRefs: string[];
}

// ---------------------------------------------------------------------------
// System prompt tool schema
// ---------------------------------------------------------------------------

/**
 * Tool schema injected into the agent system prompt.
 * Describes every available tool, its parameters, and output contract,
 * and defines the strict XML block output format the parser expects.
 */
export const TOOL_SCHEMA_PROMPT = `
You have access to the following tools. To use a tool, output a <tool_call> block. To give a final answer, output an <answer> block.

TOOL SCHEMAS:

search_emails: Search the inbox using natural language or keywords.
  params: { query: string (keywords/filters), limit?: number (default 10, max 30) }
  returns: List of matching thread summaries with IDs

get_thread: Get full details of a specific email thread including all messages.
  params: { thread_id: string }
  returns: Thread subject, participants, all message bodies

archive_threads: Move threads out of inbox (reversible).
  params: { thread_ids: string[] }
  IMPORTANT: Requires user confirmation for more than 3 threads.

label_threads: Apply a label to threads.
  params: { thread_ids: string[], label_id: string }
  IMPORTANT: Use list_labels first to get valid label IDs.

mark_read: Mark threads as read or unread.
  params: { thread_ids: string[], read: boolean }

trash_threads: Move threads to trash. ALWAYS requires user confirmation.
  params: { thread_ids: string[] }

summarize_thread: Get an AI summary of a thread.
  params: { thread_id: string }
  returns: 2-3 sentence summary

draft_reply: Generate a draft reply and open the composer.
  params: { thread_id: string, instructions: string (what the reply should say) }

get_contact_crm: Look up CRM information for an email address.
  params: { email: string }
  returns: Contact name, company, title, deal stage, or "not found"

list_labels: Get all available labels/folders for the current account.
  params: {}
  returns: List of label IDs and names

OUTPUT FORMAT:
- To call a tool: <tool_call>{"name": "tool_name", "params": {...}}</tool_call>
- To give your final answer: <answer>Your response here</answer>
- NEVER output anything outside these two block types
- NEVER call more than one tool per response
- After a tool result, decide: call another tool OR give final answer
`.trim();
