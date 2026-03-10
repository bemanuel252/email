import { useState } from "react";
import { ChevronDown, ChevronUp, X, PenSquare } from "lucide-react";
import type { DbChatSession } from "@/services/db/chatSessions";

interface Props {
  sessions: DbChatSession[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
}

function relativeTime(unixMs: number): string {
  // updated_at is stored as unix seconds in the DB schema
  const diff = Date.now() / 1000 - unixMs;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixMs * 1000).toLocaleDateString();
}

export function SessionHistory({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
  onNewSession,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (sessions.length === 0) return null;

  return (
    <div className="border-b border-border-primary">
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
      >
        <span className="font-medium uppercase tracking-wider">
          Previous conversations
        </span>
        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {isExpanded && (
        <div className="max-h-48 overflow-y-auto">
          {/* New conversation entry */}
          <button
            onClick={onNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-bg-hover transition-colors"
          >
            <PenSquare size={12} />
            <span>New conversation</span>
          </button>

          {/* Session list */}
          {sessions.map((session) => {
            const isActive = session.id === currentSessionId;
            return (
              <div
                key={session.id}
                className={`group relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  isActive
                    ? "bg-accent/10 text-text-primary"
                    : "hover:bg-bg-hover text-text-secondary"
                }`}
                onClick={() => onSelect(session.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">
                    {session.title ?? "New conversation"}
                  </div>
                  <div className="text-[0.625rem] text-text-tertiary mt-0.5">
                    {relativeTime(session.updated_at)}
                  </div>
                </div>

                {/* Delete button — shown on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  className="shrink-0 p-0.5 text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete conversation"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
