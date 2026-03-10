import { memo, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Thread } from "@/stores/threadStore";
import { useThreadStore } from "@/stores/threadStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel } from "@/hooks/useRouteNavigation";
import { formatRelativeDate } from "@/utils/date";
import { Paperclip, Star, Check, Pin, BellRing, VolumeX } from "lucide-react";
import type { DragData } from "@/components/dnd/DndProvider";

const CATEGORY_COLORS: Record<string, string> = {
  Updates: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  Promotions: "bg-green-500/15 text-green-600 dark:text-green-400",
  Social: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  Newsletters: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

interface ThreadCardProps {
  thread: Thread;
  isSelected: boolean;
  onClick: (thread: Thread) => void;
  onContextMenu?: (e: React.MouseEvent, threadId: string) => void;
  category?: string;
  showCategoryBadge?: boolean;
  hasFollowUp?: boolean;
}

export const ThreadCard = memo(function ThreadCard({ thread, isSelected, onClick, onContextMenu, category, showCategoryBadge, hasFollowUp }: ThreadCardProps) {
  const isMultiSelected = useThreadStore((s) => s.selectedThreadIds.has(thread.id));
  const hasMultiSelect = useThreadStore((s) => s.selectedThreadIds.size > 0);
  const toggleThreadSelection = useThreadStore((s) => s.toggleThreadSelection);
  const selectThreadRange = useThreadStore((s) => s.selectThreadRange);
  const activeLabel = useActiveLabel();
  const emailDensity = useUIStore((s) => s.emailDensity);
  const isSpam = thread.labelIds.includes("SPAM");
  const isUnread = !thread.isRead;

  const dragData: DragData = useMemo(() => ({
    threadIds: hasMultiSelect && isMultiSelected
      ? [...useThreadStore.getState().selectedThreadIds]
      : [thread.id],
    sourceLabel: activeLabel,
  }), [hasMultiSelect, isMultiSelected, thread.id, activeLabel]);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `thread-${thread.id}`,
    data: dragData,
  });

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectThreadRange(thread.id);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleThreadSelection(thread.id);
    } else if (hasMultiSelect) {
      toggleThreadSelection(thread.id);
    } else {
      onClick(thread);
    }
  };

  const handleContextMenu = onContextMenu
    ? (e: React.MouseEvent) => onContextMenu(e, thread.id)
    : undefined;

  const initial = (
    thread.fromName?.[0] ??
    thread.fromAddress?.[0] ??
    "?"
  ).toUpperCase();

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      aria-label={`${isUnread ? "Unread " : ""}email from ${thread.fromName ?? thread.fromAddress ?? "Unknown"}: ${thread.subject ?? "(No subject)"}`}
      aria-selected={isSelected}
      className={`w-full text-left relative border-b border-border-secondary/40 group transition-colors duration-[50ms] ${
        emailDensity === "compact" ? "px-3 py-3 pl-4" : emailDensity === "spacious" ? "px-4 py-4 pl-5" : "px-4 py-3.5 pl-5"
      } ${
        isDragging
          ? "opacity-40"
          : isMultiSelected
            ? "bg-accent/8"
            : isSelected
              ? "bg-bg-selected border-l-2 border-l-accent"
              : "hover:bg-bg-hover"
      } ${isSpam ? "bg-red-500/8 dark:bg-red-500/10" : ""}`}
    >
      {/* Unread accent strip */}
      {isUnread && !isSelected && !isMultiSelected && (
        <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-accent rounded-r-full" />
      )}

      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={`rounded-full flex items-center justify-center shrink-0 font-semibold transition-colors ${
            emailDensity === "compact" ? "w-7 h-7 text-xs" : emailDensity === "spacious" ? "w-10 h-10 text-sm" : "w-8 h-8 text-[0.8125rem]"
          } ${
            isMultiSelected
              ? "bg-accent text-white"
              : isUnread
                ? "bg-accent text-white"
                : "bg-text-tertiary/30 text-text-tertiary"
          }`}
        >
          {isMultiSelected ? <Check size={emailDensity === "compact" ? 14 : 15} /> : initial}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: sender + date */}
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-[0.8125rem] truncate leading-snug ${
                isUnread
                  ? "font-semibold text-text-primary"
                  : "font-normal text-text-secondary"
              }`}
            >
              {thread.fromName ?? thread.fromAddress ?? "Unknown"}
            </span>
            <span className="text-xs whitespace-nowrap shrink-0 text-text-tertiary">
              {formatRelativeDate(thread.lastMessageAt)}
            </span>
          </div>

          {/* Row 2: subject */}
          <div
            className={`text-[0.8125rem] truncate leading-snug ${
              isUnread ? "text-text-primary font-medium" : "text-text-secondary"
            }`}
          >
            {thread.subject ?? "(No subject)"}
          </div>

          {/* Row 3: snippet + badges (hidden in compact) */}
          <div className={`flex items-center gap-1.5 mt-0.5 ${emailDensity === "compact" ? "hidden" : ""}`}>
            <span className={`text-[0.75rem] truncate flex-1 leading-snug ${isUnread ? "text-text-tertiary opacity-100" : "text-text-tertiary opacity-60"}`}>
              {thread.snippet}
            </span>
            {showCategoryBadge && category && category !== "Primary" && CATEGORY_COLORS[category] && (
              <span className={`shrink-0 text-[0.6rem] px-1.5 py-px rounded-full font-medium leading-none ${CATEGORY_COLORS[category]}`}>
                {category}
              </span>
            )}
            {hasFollowUp && (
              <span className="shrink-0 text-accent" title="Follow-up reminder set">
                <BellRing size={11} />
              </span>
            )}
            {thread.isMuted && (
              <span className="shrink-0 text-text-tertiary" title="Muted">
                <VolumeX size={11} />
              </span>
            )}
            {thread.isPinned && (
              <span className="shrink-0 text-accent" title="Pinned">
                <Pin size={11} className="fill-current" />
              </span>
            )}
            {thread.hasAttachments && (
              <span className="shrink-0 text-text-tertiary" title="Has attachments">
                <Paperclip size={11} />
              </span>
            )}
            {thread.isStarred && (
              <span className="shrink-0 text-warning star-animate" title="Starred">
                <Star size={11} className="fill-current" />
              </span>
            )}
            {thread.messageCount > 1 && (
              <span className="text-[0.7rem] text-text-tertiary shrink-0 bg-bg-tertiary/80 rounded-full px-1.5 py-px">
                {thread.messageCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
});
