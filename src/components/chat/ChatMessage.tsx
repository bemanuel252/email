import { Loader2, Mail } from "lucide-react";
import { ConfirmActionCard } from "./ConfirmActionCard";
import type { ChatMessage } from "@/stores/chatStore";

interface Props {
  message: ChatMessage;
  onConfirm?: (approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// Thread chip — pill button, no raw ID shown
// ---------------------------------------------------------------------------

function ThreadChip({ threadId }: { threadId: string }) {
  return (
    <button
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("velo-select-thread", { detail: { threadId } }),
        )
      }
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full text-xs bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20 transition-colors font-medium"
    >
      <Mail size={10} className="shrink-0" />
      <span>Open thread</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline content parser
// Handles: [thread:ID], **bold**, *italic*, `code`
// Thread refs take priority — they are detected first. Bold/italic are then
// parsed recursively so that **[thread:ID] description** renders the chip
// inside the bold segment rather than raw text.
// ---------------------------------------------------------------------------

type Segment =
  | { kind: "text"; value: string }
  | { kind: "thread"; id: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "code"; value: string };

function parseInlineContent(content: string): Segment[] {
  // Thread refs come FIRST in the alternation so they are greedily matched
  // before bold markers when both could apply (e.g. **[thread:ID]**).
  const pattern =
    /(\[thread:([^\]]+)\])|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      // [thread:ID]
      segments.push({ kind: "thread", id: match[2] ?? "" });
    } else if (match[3]) {
      // **bold** — store the inner text for recursive rendering
      segments.push({ kind: "bold", value: match[4] ?? "" });
    } else if (match[5]) {
      // *italic*
      segments.push({ kind: "italic", value: match[6] ?? "" });
    } else if (match[7]) {
      // `code`
      segments.push({ kind: "code", value: match[8] ?? "" });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

function renderSegments(segments: Segment[]): React.ReactNode[] {
  return segments.map((seg, i) => {
    switch (seg.kind) {
      case "thread":
        return <ThreadChip key={i} threadId={seg.id} />;

      case "bold": {
        // Recursively parse the bold content — handles **[thread:ID] description**
        const innerSegs = parseInlineContent(seg.value);
        return (
          <strong key={i} className="font-semibold text-text-primary">
            {renderSegments(innerSegs)}
          </strong>
        );
      }

      case "italic": {
        const innerSegs = parseInlineContent(seg.value);
        return (
          <em key={i} className="italic">
            {renderSegments(innerSegs)}
          </em>
        );
      }

      case "code":
        return (
          <code
            key={i}
            className="px-1 py-0.5 rounded text-[0.75em] bg-bg-hover font-mono text-text-primary"
          >
            {seg.value}
          </code>
        );

      case "text":
        return <span key={i}>{seg.value}</span>;
    }
  });
}

// ---------------------------------------------------------------------------
// List-line detection helpers
// ---------------------------------------------------------------------------

type LineKind = "bullet" | "ordered" | "plain";

function detectLineKind(line: string): LineKind {
  if (/^[-*]\s/.test(line)) return "bullet";
  if (/^\d+\.\s/.test(line)) return "ordered";
  return "plain";
}

function stripListMarker(line: string, kind: LineKind): string {
  if (kind === "bullet") return line.replace(/^[-*]\s+/, "");
  if (kind === "ordered") return line.replace(/^\d+\.\s+/, "");
  return line;
}

// ---------------------------------------------------------------------------
// AssistantContent — renders paragraphs with list grouping
// ---------------------------------------------------------------------------

function AssistantContent({ content }: { content: string }) {
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="space-y-2 text-sm text-text-primary leading-relaxed">
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");

        // Check if this paragraph is entirely list items of one type
        const kinds = lines.map(detectLineKind);
        const firstListKind = kinds.find((k) => k !== "plain");
        const isHomogeneousList =
          firstListKind !== undefined && kinds.every((k) => k === firstListKind || k === "plain");

        if (isHomogeneousList && firstListKind === "bullet") {
          return (
            <ul key={pi} className="space-y-0.5 pl-0">
              {lines.map((line, li) => {
                const kind = detectLineKind(line);
                const text = kind === "plain" ? line : stripListMarker(line, kind);
                return (
                  <li key={li} className="flex items-start gap-1.5">
                    <span className="mt-[0.35em] w-1 h-1 rounded-full bg-text-tertiary shrink-0" />
                    <span>{renderSegments(parseInlineContent(text))}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        if (isHomogeneousList && firstListKind === "ordered") {
          return (
            <ol key={pi} className="space-y-0.5 pl-0">
              {lines.map((line, li) => {
                const kind = detectLineKind(line);
                const text = kind === "plain" ? line : stripListMarker(line, kind);
                // Extract original number if present, otherwise use li+1
                const numMatch = line.match(/^(\d+)\./);
                const num = numMatch ? numMatch[1] : String(li + 1);
                return (
                  <li key={li} className="flex items-start gap-1.5">
                    <span className="mt-[0.05em] text-[0.75em] text-text-tertiary font-medium tabular-nums shrink-0 min-w-[1.25em]">
                      {num}.
                    </span>
                    <span>{renderSegments(parseInlineContent(text))}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Mixed or plain paragraph — render line by line with <br> between
        return (
          <p key={pi}>
            {lines.map((line, li) => {
              const kind = detectLineKind(line);
              const text = kind !== "plain" ? stripListMarker(line, kind) : line;

              // Inline bullet for mixed paragraphs that have stray list lines
              if (kind === "bullet") {
                return (
                  <span key={li} className="flex items-start gap-1.5">
                    {li > 0 && <br />}
                    <span className="mt-[0.35em] w-1 h-1 rounded-full bg-text-tertiary shrink-0" />
                    <span>{renderSegments(parseInlineContent(text))}</span>
                  </span>
                );
              }

              return (
                <span key={li}>
                  {li > 0 && <br />}
                  {renderSegments(parseInlineContent(line))}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool name → human-readable label
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  search_emails: "Searched inbox",
  get_thread: "Read thread",
  archive_threads: "Archived",
  label_threads: "Labeled",
  mark_read: "Marked read",
  trash_threads: "Trashed",
  summarize_thread: "Summarized",
  draft_reply: "Drafted reply",
  get_contact_crm: "Looked up contact",
  list_labels: "Listed labels",
};

// ---------------------------------------------------------------------------
// ChatMessageItem
// ---------------------------------------------------------------------------

export function ChatMessageItem({ message, onConfirm }: Props) {
  // Confirmation card — delegated to ConfirmActionCard
  if (message.role === "confirmation" && message.confirmationRequest) {
    return (
      <div className="px-3 py-2">
        <ConfirmActionCard
          request={message.confirmationRequest}
          onApprove={() => onConfirm?.(true)}
          onCancel={() => onConfirm?.(false)}
        />
      </div>
    );
  }

  // Tool progress — spinner + status text
  if (message.role === "tool_progress") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-text-tertiary">
        <Loader2 size={13} className="animate-spin shrink-0" />
        <span className="text-xs italic">{message.content}</span>
      </div>
    );
  }

  // User message — right-aligned bubble
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3 py-1">
        <div className="max-w-[80%] px-3 py-2 rounded-xl rounded-br-sm bg-accent text-white text-sm leading-relaxed break-words">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message — left-aligned prose with tool badges at very bottom
  return (
    <div className="px-3 py-1">
      <div className="max-w-[92%]">
        <AssistantContent content={message.content} />

        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {message.toolsUsed.map((tool, i) => (
              <span
                key={`${tool}-${i}`}
                className="inline-flex items-center px-1 py-px rounded text-[0.6rem] bg-bg-hover text-text-tertiary/70"
              >
                {TOOL_LABELS[tool] ?? tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
