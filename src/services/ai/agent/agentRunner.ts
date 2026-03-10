import { getActiveProvider, getNamedProvider } from "../providerManager";
import { AiError } from "../errors";
import { AGENT_SYSTEM_PROMPT } from "../prompts";
import { TOOL_SCHEMA_PROMPT } from "./tools";
import { executeAgentTool } from "./toolExecutor";
import { getWritingContext } from "../writingContext";
import type { AgentTool, AgentTurnResult, ConfirmCallback } from "./tools";

const MAX_TOOL_HOPS = 5;
// Cap history at 10 exchanges (user + assistant pairs) to manage context window
const MAX_HISTORY_EXCHANGES = 10;

export type ProgressCallback = (msg: string) => void;

export interface AgentInput {
  userMessage: string;
  accountId: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  onProgress?: ProgressCallback;
  onConfirm: ConfirmCallback;
  // Optional: use a specific provider+model instead of the global active provider
  providerOverride?: { provider: import("../types").AiProvider; model: string };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type AgentResponse =
  | { type: "tool_call"; tool: AgentTool }
  | { type: "answer"; content: string }
  | { type: "parse_error"; raw: string };

/**
 * Parse the LLM's raw text output into either a structured tool call or a
 * final answer.  The model is instructed to emit exactly one of:
 *
 *   <tool_call>{"name":"search_emails","params":{"query":"..."}}</tool_call>
 *   <answer>...</answer>
 */
function parseAgentResponse(text: string): AgentResponse {
  const trimmed = text.trim();

  // --- tool_call branch ---
  const toolMatch = trimmed.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (toolMatch) {
    const raw = (toolMatch[1] ?? "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { type: "parse_error", raw: trimmed };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["name"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["params"] !== "object"
    ) {
      return { type: "parse_error", raw: trimmed };
    }

    const candidate = parsed as { name: string; params: Record<string, unknown> };

    // Validate against known tool names via the discriminated union's "name" field
    const validNames = new Set<string>([
      "search_emails",
      "get_thread",
      "archive_threads",
      "label_threads",
      "mark_read",
      "trash_threads",
      "summarize_thread",
      "draft_reply",
      "get_contact_crm",
      "list_labels",
    ]);

    if (!validNames.has(candidate.name)) {
      return { type: "parse_error", raw: trimmed };
    }

    return {
      type: "tool_call",
      tool: { name: candidate.name, params: candidate.params } as AgentTool,
    };
  }

  // --- answer branch ---
  const answerMatch = trimmed.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answerMatch) {
    return { type: "answer", content: (answerMatch[1] ?? "").trim() };
  }

  // If the model emitted neither tag but the content looks like plain prose,
  // treat it as an answer rather than failing hard.
  if (trimmed.length > 0) {
    return { type: "answer", content: trimmed };
  }

  return { type: "parse_error", raw: trimmed };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Serialize the capped conversation history into a flat string block that
 * gets appended to the user content.  Format:
 *
 *   [User]: ...
 *   [Assistant]: ...
 *   [Tool Result (tool_name)]: ...
 */
function serializeHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  // Each exchange is user + assistant, so cap at 2 * MAX_HISTORY_EXCHANGES entries
  const capped = history.slice(-(MAX_HISTORY_EXCHANGES * 2));
  return capped
    .map((msg) => {
      const label = msg.role === "user" ? "[User]" : "[Assistant]";
      return `${label}: ${msg.content}`;
    })
    .join("\n");
}

/**
 * The system prompt is fixed: AGENT_SYSTEM_PROMPT (which includes inlined tool
 * schemas) plus the TOOL_SCHEMA_PROMPT constant for any toolExecutor references.
 * History is folded into userContent instead to keep systemPrompt stable.
 */
function buildSystemPrompt(writingContext?: string): string {
  // AGENT_SYSTEM_PROMPT already contains the inlined tool schema documentation.
  // We append TOOL_SCHEMA_PROMPT here so the runner has a single source of
  // structured tool spec without duplicating it.
  return `${AGENT_SYSTEM_PROMPT}${writingContext ?? ""}\n\n${TOOL_SCHEMA_PROMPT}`;
}

/**
 * Build the user content block for a given turn, incorporating prior
 * conversation history and any tool results accumulated so far.
 */
function buildUserContent(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  toolResults: string[],
): string {
  const parts: string[] = [];

  const historyStr = serializeHistory(history);
  if (historyStr) {
    parts.push(`Prior conversation:\n${historyStr}`);
  }

  if (toolResults.length > 0) {
    parts.push(`Tool results from this turn:\n${toolResults.join("\n\n")}`);
  }

  parts.push(`Current user message: ${userMessage}`);

  return parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Progress message helpers
// ---------------------------------------------------------------------------

function progressMessageForTool(toolName: string): string {
  switch (toolName) {
    case "search_emails":
      return "Searching your inbox...";
    case "get_thread":
      return "Getting thread details...";
    case "archive_threads":
      return "Archiving threads...";
    case "label_threads":
      return "Labeling threads...";
    case "mark_read":
      return "Marking threads as read/unread...";
    case "trash_threads":
      return "Moving threads to trash...";
    case "summarize_thread":
      return "Summarizing thread...";
    case "draft_reply":
      return "Drafting reply...";
    case "get_contact_crm":
      return "Looking up contact in CRM...";
    case "list_labels":
      return "Fetching labels...";
    default:
      return "Working...";
  }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

export async function runAgentTurn(input: AgentInput): Promise<AgentTurnResult> {
  const { userMessage, accountId, conversationHistory, onProgress, onConfirm, providerOverride } =
    input;

  const toolsUsed: AgentTurnResult["toolsUsed"] = [];
  const threadRefs: string[] = [];
  const toolResults: string[] = [];

  const writingContext = await getWritingContext(accountId);
  const systemPrompt = buildSystemPrompt(writingContext);

  let hops = 0;

  while (hops <= MAX_TOOL_HOPS) {
    const userContent = buildUserContent(userMessage, conversationHistory, toolResults);

    let rawResponse: string;
    try {
      const provider = providerOverride
        ? await getNamedProvider(providerOverride.provider, providerOverride.model)
        : await getActiveProvider();
      rawResponse = await provider.complete({ systemPrompt, userContent });
    } catch (err) {
      if (err instanceof AiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError("NETWORK_ERROR", message);
    }

    const parsed = parseAgentResponse(rawResponse);

    if (parsed.type === "answer") {
      // Extract any [thread:id] references from the answer
      const refMatches = parsed.content.matchAll(/\[thread:([^\]]+)\]/g);
      for (const m of refMatches) {
        const ref = m[1];
        if (ref && !threadRefs.includes(ref)) threadRefs.push(ref);
      }
      return {
        answer: parsed.content,
        toolsUsed,
        threadRefs,
      };
    }

    if (parsed.type === "parse_error") {
      // Model emitted something unparseable — return it as a plain answer
      // rather than crashing, so the user sees something useful.
      return {
        answer: parsed.raw || "I encountered an unexpected response format. Please try again.",
        toolsUsed,
        threadRefs,
      };
    }

    // --- tool_call ---
    const { tool } = parsed;

    if (hops === MAX_TOOL_HOPS) {
      // Hit the hop limit — synthesize a final answer from what we have
      return {
        answer:
          "I've done several steps to answer your request. Based on what I found:\n\n" +
          (toolResults.length > 0
            ? toolResults.join("\n\n")
            : "I wasn't able to gather enough information. Please try a more specific request."),
        toolsUsed,
        threadRefs,
      };
    }

    // Emit progress before execution
    onProgress?.(progressMessageForTool(tool.name));

    // Execute tool
    const result = await executeAgentTool(tool, accountId, onConfirm);

    // Track usage
    if (!toolsUsed.includes(tool.name)) toolsUsed.push(tool.name);

    // Collect any thread IDs the tool surfaces
    if (result.threadIds) {
      for (const id of result.threadIds) {
        if (!threadRefs.includes(id)) threadRefs.push(id);
      }
    }

    // Append result to running context
    const resultBlock = `[Tool Result (${tool.name})]: ${result.success ? result.output : `Error — ${result.output}`}`;
    toolResults.push(resultBlock);

    hops++;
  }

  // Should be unreachable, but TypeScript requires a return
  return {
    answer: "I was unable to complete the request within the allowed number of steps.",
    toolsUsed,
    threadRefs,
  };
}
