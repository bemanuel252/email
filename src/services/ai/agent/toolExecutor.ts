import type {
  AgentTool,
  ToolResult,
  ConfirmationRequest,
  ConfirmCallback,
} from "./tools";
import { ALWAYS_CONFIRM, BULK_CONFIRM_THRESHOLD } from "./tools";
import { searchMessages } from "@/services/db/search";
import { getLabelsForAccount } from "@/services/db/labels";
import { getThreadById } from "@/services/db/threads";
import { getMessagesForThread } from "@/services/db/messages";
import { getCrmContactByEmail } from "@/services/db/crmConnections";
import { summarizeThread, generateReply } from "../aiService";
import {
  archiveThread,
  trashThread,
  addThreadLabel,
  markThreadRead,
} from "@/services/emailActions";
import { getDb } from "@/services/db/connection";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ThreadPreviewRow {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  last_message_at: number | null;
}

/**
 * Validate that every threadId in the list belongs to accountId.
 * Returns the set of valid IDs and the set of invalid IDs.
 */
async function validateThreadIds(
  accountId: string,
  threadIds: string[],
): Promise<{ valid: string[]; invalid: string[] }> {
  if (threadIds.length === 0) return { valid: [], invalid: [] };

  const db = await getDb();
  // Build a parameterized IN clause
  const placeholders = threadIds.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM threads WHERE account_id = $1 AND id IN (${placeholders})`,
    [accountId, ...threadIds],
  );
  const foundIds = new Set(rows.map((r) => r.id));
  const valid = threadIds.filter((id) => foundIds.has(id));
  const invalid = threadIds.filter((id) => !foundIds.has(id));
  return { valid, invalid };
}

/**
 * Fetch preview rows for up to 5 threads for the ConfirmationRequest card.
 */
async function fetchPreviewItems(
  accountId: string,
  threadIds: string[],
): Promise<Array<{ subject: string; from: string; date: number }>> {
  if (threadIds.length === 0) return [];

  const db = await getDb();
  const sample = threadIds.slice(0, 5);
  const placeholders = sample.map((_, i) => `$${i + 2}`).join(", ");

  const rows = await db.select<ThreadPreviewRow[]>(
    `SELECT t.id, t.subject, t.last_message_at, m.from_name, m.from_address
     FROM threads t
     LEFT JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
       AND m.date = (SELECT MAX(m2.date) FROM messages m2
                    WHERE m2.account_id = t.account_id AND m2.thread_id = t.id)
     WHERE t.account_id = $1 AND t.id IN (${placeholders})
     LIMIT 5`,
    [accountId, ...sample],
  );

  return rows.map((r) => ({
    subject: r.subject ?? "(no subject)",
    from:
      r.from_name
        ? `${r.from_name} <${r.from_address ?? ""}>`
        : (r.from_address ?? "Unknown"),
    date: r.last_message_at ?? 0,
  }));
}

/**
 * Build a ConfirmationRequest and call the confirmation callback.
 * Returns true if the user approved, false if rejected/cancelled.
 */
async function requestConfirmation(
  accountId: string,
  threadIds: string[],
  actionDescription: string,
  isIrreversible: boolean,
  onConfirm: ConfirmCallback,
): Promise<boolean> {
  const previewItems = await fetchPreviewItems(accountId, threadIds);
  const req: ConfirmationRequest = {
    id: crypto.randomUUID(),
    action: actionDescription,
    threadIds,
    previewItems,
    isIrreversible,
  };
  return onConfirm(req);
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleSearchEmails(
  params: Extract<AgentTool, { name: "search_emails" }>["params"],
  accountId: string,
): Promise<ToolResult> {
  const limit = params.limit ?? 10;
  const results = await searchMessages(params.query, accountId, limit);

  if (results.length === 0) {
    return {
      toolName: "search_emails",
      success: true,
      output: `No emails found matching "${params.query}".`,
      threadIds: [],
    };
  }

  const lines = results.map((r, i) => {
    const from = r.from_name
      ? `${r.from_name} <${r.from_address ?? ""}>`
      : (r.from_address ?? "Unknown");
    const date = new Date(r.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const subject = r.subject ?? "(no subject)";
    return `${i + 1}. [thread_id: ${r.thread_id}] From: ${from} | Subject: ${subject} | Date: ${date}`;
  });

  const threadIds = [...new Set(results.map((r) => r.thread_id))];

  return {
    toolName: "search_emails",
    success: true,
    output: lines.join("\n"),
    threadIds,
  };
}

async function handleGetThread(
  params: Extract<AgentTool, { name: "get_thread" }>["params"],
  accountId: string,
): Promise<ToolResult> {
  const thread = await getThreadById(accountId, params.thread_id);
  if (!thread) {
    return {
      toolName: "get_thread",
      success: false,
      output: `Thread "${params.thread_id}" not found.`,
    };
  }

  const messages = await getMessagesForThread(accountId, params.thread_id);
  if (messages.length === 0) {
    return {
      toolName: "get_thread",
      success: true,
      output: `Thread [thread_id: ${params.thread_id}] "${thread.subject ?? "(no subject)"}" has no messages.`,
      threadIds: [params.thread_id],
    };
  }

  const header = `Thread [thread_id: ${params.thread_id}]
Subject: ${thread.subject ?? "(no subject)"}
Messages: ${messages.length}`;

  const msgLines = messages.map((msg, i) => {
    const from = msg.from_name
      ? `${msg.from_name} <${msg.from_address ?? ""}>`
      : (msg.from_address ?? "Unknown");
    const date = new Date(msg.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const body = (msg.body_text ?? msg.snippet ?? "").trim().slice(0, 1000);
    const truncated = (msg.body_text ?? msg.snippet ?? "").trim().length > 1000 ? "..." : "";
    return `--- Message ${i + 1} ---\nFrom: ${from}\nDate: ${date}\n\n${body}${truncated}`;
  });

  return {
    toolName: "get_thread",
    success: true,
    output: `${header}\n\n${msgLines.join("\n\n")}`,
    threadIds: [params.thread_id],
  };
}

async function handleArchiveThreads(
  params: Extract<AgentTool, { name: "archive_threads" }>["params"],
  accountId: string,
  onConfirm: ConfirmCallback,
): Promise<ToolResult> {
  const { valid, invalid } = await validateThreadIds(accountId, params.thread_ids);

  if (valid.length === 0) {
    return {
      toolName: "archive_threads",
      success: false,
      output: `None of the specified thread IDs were found for this account.`,
    };
  }

  const needsConfirm =
    ALWAYS_CONFIRM.has("archive_threads") || valid.length > BULK_CONFIRM_THRESHOLD;

  if (needsConfirm) {
    const approved = await requestConfirmation(
      accountId,
      valid,
      `Archive ${valid.length} thread${valid.length === 1 ? "" : "s"}`,
      false,
      onConfirm,
    );
    if (!approved) {
      return {
        toolName: "archive_threads",
        success: false,
        output: "Action cancelled by user.",
        threadIds: valid,
      };
    }
  }

  const results = await Promise.allSettled(
    valid.map((threadId) => archiveThread(accountId, threadId, [])),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = valid.length - succeeded;

  const parts: string[] = [`Archived ${succeeded} thread${succeeded === 1 ? "" : "s"}.`];
  if (invalid.length > 0) {
    parts.push(`${invalid.length} thread ID(s) not found and skipped.`);
  }
  if (failed > 0) {
    parts.push(`${failed} thread(s) failed to archive.`);
  }

  return {
    toolName: "archive_threads",
    success: succeeded > 0,
    output: parts.join(" "),
    threadIds: valid,
  };
}

async function handleLabelThreads(
  params: Extract<AgentTool, { name: "label_threads" }>["params"],
  accountId: string,
  onConfirm: ConfirmCallback,
): Promise<ToolResult> {
  // Validate label belongs to account
  const db = await getDb();
  const labelRows = await db.select<{ id: string; name: string }[]>(
    "SELECT id, name FROM labels WHERE account_id = $1 AND id = $2",
    [accountId, params.label_id],
  );
  if (labelRows.length === 0 || !labelRows[0]) {
    return {
      toolName: "label_threads",
      success: false,
      output: `Label "${params.label_id}" not found for this account.`,
    };
  }
  const labelName = labelRows[0].name;

  const { valid, invalid } = await validateThreadIds(accountId, params.thread_ids);
  if (valid.length === 0) {
    return {
      toolName: "label_threads",
      success: false,
      output: `None of the specified thread IDs were found for this account.`,
    };
  }

  const needsConfirm = valid.length > BULK_CONFIRM_THRESHOLD;
  if (needsConfirm) {
    const approved = await requestConfirmation(
      accountId,
      valid,
      `Label ${valid.length} thread${valid.length === 1 ? "" : "s"} as "${labelName}"`,
      false,
      onConfirm,
    );
    if (!approved) {
      return {
        toolName: "label_threads",
        success: false,
        output: "Action cancelled by user.",
        threadIds: valid,
      };
    }
  }

  const results = await Promise.allSettled(
    valid.map((threadId) => addThreadLabel(accountId, threadId, params.label_id)),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = valid.length - succeeded;

  const parts: string[] = [
    `Applied label "${labelName}" to ${succeeded} thread${succeeded === 1 ? "" : "s"}.`,
  ];
  if (invalid.length > 0) parts.push(`${invalid.length} thread ID(s) not found and skipped.`);
  if (failed > 0) parts.push(`${failed} thread(s) failed.`);

  return {
    toolName: "label_threads",
    success: succeeded > 0,
    output: parts.join(" "),
    threadIds: valid,
  };
}

async function handleMarkRead(
  params: Extract<AgentTool, { name: "mark_read" }>["params"],
  accountId: string,
): Promise<ToolResult> {
  const { valid, invalid } = await validateThreadIds(accountId, params.thread_ids);
  if (valid.length === 0) {
    return {
      toolName: "mark_read",
      success: false,
      output: `None of the specified thread IDs were found for this account.`,
    };
  }

  const results = await Promise.allSettled(
    valid.map((threadId) => markThreadRead(accountId, threadId, [], params.read)),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = valid.length - succeeded;
  const action = params.read ? "read" : "unread";

  const parts: string[] = [
    `Marked ${succeeded} thread${succeeded === 1 ? "" : "s"} as ${action}.`,
  ];
  if (invalid.length > 0) parts.push(`${invalid.length} thread ID(s) not found and skipped.`);
  if (failed > 0) parts.push(`${failed} thread(s) failed.`);

  return {
    toolName: "mark_read",
    success: succeeded > 0,
    output: parts.join(" "),
    threadIds: valid,
  };
}

async function handleTrashThreads(
  params: Extract<AgentTool, { name: "trash_threads" }>["params"],
  accountId: string,
  onConfirm: ConfirmCallback,
): Promise<ToolResult> {
  const { valid, invalid } = await validateThreadIds(accountId, params.thread_ids);
  if (valid.length === 0) {
    return {
      toolName: "trash_threads",
      success: false,
      output: `None of the specified thread IDs were found for this account.`,
    };
  }

  // trash_threads is ALWAYS in ALWAYS_CONFIRM — always requires approval, always irreversible
  const approved = await requestConfirmation(
    accountId,
    valid,
    `Move ${valid.length} thread${valid.length === 1 ? "" : "s"} to Trash`,
    true,
    onConfirm,
  );
  if (!approved) {
    return {
      toolName: "trash_threads",
      success: false,
      output: "Action cancelled by user.",
      threadIds: valid,
    };
  }

  const results = await Promise.allSettled(
    valid.map((threadId) => trashThread(accountId, threadId, [])),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success,
  ).length;
  const failed = valid.length - succeeded;

  const parts: string[] = [`Moved ${succeeded} thread${succeeded === 1 ? "" : "s"} to Trash.`];
  if (invalid.length > 0) parts.push(`${invalid.length} thread ID(s) not found and skipped.`);
  if (failed > 0) parts.push(`${failed} thread(s) failed.`);

  return {
    toolName: "trash_threads",
    success: succeeded > 0,
    output: parts.join(" "),
    threadIds: valid,
  };
}

async function handleSummarizeThread(
  params: Extract<AgentTool, { name: "summarize_thread" }>["params"],
  accountId: string,
): Promise<ToolResult> {
  const thread = await getThreadById(accountId, params.thread_id);
  if (!thread) {
    return {
      toolName: "summarize_thread",
      success: false,
      output: `Thread "${params.thread_id}" not found.`,
    };
  }

  const messages = await getMessagesForThread(accountId, params.thread_id);
  if (messages.length === 0) {
    return {
      toolName: "summarize_thread",
      success: false,
      output: `Thread "${params.thread_id}" has no messages to summarize.`,
    };
  }

  const summary = await summarizeThread(params.thread_id, accountId, messages);
  return {
    toolName: "summarize_thread",
    success: true,
    output: `Summary of [thread_id: ${params.thread_id}] "${thread.subject ?? "(no subject)"}"\n\n${summary}`,
    threadIds: [params.thread_id],
  };
}

async function handleDraftReply(
  params: Extract<AgentTool, { name: "draft_reply" }>["params"],
  accountId: string,
): Promise<ToolResult> {
  const thread = await getThreadById(accountId, params.thread_id);
  if (!thread) {
    return {
      toolName: "draft_reply",
      success: false,
      output: `Thread "${params.thread_id}" not found.`,
    };
  }

  const messages = await getMessagesForThread(accountId, params.thread_id);

  // Build plain-text representations for generateReply
  const messagesText = messages.map((msg) => {
    const from = msg.from_name
      ? `${msg.from_name} <${msg.from_address ?? ""}>`
      : (msg.from_address ?? "Unknown");
    const date = new Date(msg.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const body = (msg.body_text ?? msg.snippet ?? "").trim();
    return `From: ${from}\nDate: ${date}\n\n${body}`;
  });

  const draftContent = await generateReply(messagesText, params.instructions);

  // Open the composer via a custom DOM event so the UI layer can respond
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("velo-open-composer", {
        detail: { threadId: params.thread_id, draftContent },
      }),
    );
  }

  return {
    toolName: "draft_reply",
    success: true,
    output: "Draft created and opened in composer.",
    threadIds: [params.thread_id],
  };
}

async function handleGetContactCrm(
  params: Extract<AgentTool, { name: "get_contact_crm" }>["params"],
): Promise<ToolResult> {
  const contacts = await getCrmContactByEmail(params.email);

  if (contacts.length === 0) {
    return {
      toolName: "get_contact_crm",
      success: true,
      output: `No CRM record found for ${params.email}.`,
    };
  }

  const lines = contacts.map((c) => {
    const parts: string[] = [`<crm_context>`];
    parts.push(`Name: ${c.display_name ?? "Unknown"}`);
    parts.push(`Email: ${c.email}`);
    if (c.company) parts.push(`Company: ${c.company}`);
    if (c.title) parts.push(`Title: ${c.title}`);
    if (c.phone) parts.push(`Phone: ${c.phone}`);
    if (c.deal_stage) parts.push(`Deal Stage: ${c.deal_stage}`);
    if (c.deal_value !== null) parts.push(`Deal Value: $${c.deal_value.toLocaleString()}`);
    if (c.crm_record_url) parts.push(`CRM URL: ${c.crm_record_url}`);
    try {
      const tags: unknown = JSON.parse(c.tags_json);
      if (Array.isArray(tags) && tags.length > 0) {
        parts.push(`Tags: ${(tags as string[]).join(", ")}`);
      }
    } catch {
      // Malformed tags_json — skip silently
    }
    parts.push(`</crm_context>`);
    return parts.join("\n");
  });

  return {
    toolName: "get_contact_crm",
    success: true,
    output: lines.join("\n\n"),
  };
}

async function handleListLabels(
  accountId: string,
): Promise<ToolResult> {
  const labels = await getLabelsForAccount(accountId);

  if (labels.length === 0) {
    return {
      toolName: "list_labels",
      success: true,
      output: "No labels found for this account.",
    };
  }

  const lines = labels.map((l) => `${l.id}: ${l.name}`);
  return {
    toolName: "list_labels",
    success: true,
    output: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function executeAgentTool(
  tool: AgentTool,
  accountId: string,
  onConfirm: ConfirmCallback,
): Promise<ToolResult> {
  switch (tool.name) {
    case "search_emails":
      return handleSearchEmails(tool.params, accountId);

    case "get_thread":
      return handleGetThread(tool.params, accountId);

    case "archive_threads":
      return handleArchiveThreads(tool.params, accountId, onConfirm);

    case "label_threads":
      return handleLabelThreads(tool.params, accountId, onConfirm);

    case "mark_read":
      return handleMarkRead(tool.params, accountId);

    case "trash_threads":
      return handleTrashThreads(tool.params, accountId, onConfirm);

    case "summarize_thread":
      return handleSummarizeThread(tool.params, accountId);

    case "draft_reply":
      return handleDraftReply(tool.params, accountId);

    case "get_contact_crm":
      return handleGetContactCrm(tool.params);

    case "list_labels":
      return handleListLabels(accountId);
  }
}
