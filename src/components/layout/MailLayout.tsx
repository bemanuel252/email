import { useCallback, useRef } from "react";
import { EmailList } from "./EmailList";
import { ReadingPane } from "./ReadingPane";
import { useUIStore } from "@/stores/uiStore";
import { useChatStore } from "@/stores/chatStore";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useSelectedThreadId } from "@/hooks/useRouteNavigation";

function ResizableEmailLayout() {
  const emailListWidth = useUIStore((s) => s.emailListWidth);
  const setEmailListWidth = useUIStore((s) => s.setEmailListWidth);
  const isChatOpen = useChatStore((s) => s.isOpen);
  const chatPosition = useChatStore((s) => s.panelPosition);
  const isChatFloating = useChatStore((s) => s.isFloating);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedThreadId = useSelectedThreadId();

  // Reading pane is visible only when a thread is selected
  const showReading = selectedThreadId !== null;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = listRef.current?.offsetWidth ?? emailListWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.min(800, Math.max(280, startWidth + delta));
        if (listRef.current) listRef.current.style.width = `${newWidth}px`;
      };

      const handleMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const delta = ev.clientX - startX;
        const finalWidth = Math.min(800, Math.max(280, startWidth + delta));
        setEmailListWidth(finalWidth);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [emailListWidth, setEmailListWidth],
  );

  const inlineChatPanel =
    isChatOpen && !isChatFloating && chatPosition !== "left" ? (
      <ErrorBoundary name="ChatPanel">
        <ChatPanel />
      </ErrorBoundary>
    ) : null;

  const floatingChatPanel = isChatFloating ? (
    <ErrorBoundary name="ChatPanel">
      <ChatPanel />
    </ErrorBoundary>
  ) : null;

  return (
    <>
      <div ref={containerRef} className="flex flex-1 min-w-0 flex-row overflow-hidden">
        {/* Email list — full width when no thread, fixed width when reading */}
        <EmailList
          width={showReading ? emailListWidth : undefined}
          listRef={listRef}
          fullScreen={!showReading}
        />

        {/* Reading pane — only rendered when a thread is open */}
        {showReading && (
          <>
            <div
              onMouseDown={handleMouseDown}
              className="w-px cursor-col-resize bg-border-primary hover:bg-accent/50 active:bg-accent transition-colors shrink-0"
            />
            <div className="flex flex-1 min-w-0 animate-in fade-in slide-in-from-right-4 duration-200 bg-bg-primary">
              <ReadingPane />
              {inlineChatPanel}
            </div>
          </>
        )}

        {/* Chat panel when no reading pane showing */}
        {!showReading && !isChatFloating && isChatOpen && chatPosition !== "left" && inlineChatPanel}
      </div>
      {floatingChatPanel}
    </>
  );
}

export function MailLayout() {
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const selectedThreadId = useSelectedThreadId();
  const isChatOpen = useChatStore((s) => s.isOpen);
  const chatPosition = useChatStore((s) => s.panelPosition);
  const isChatFloating = useChatStore((s) => s.isFloating);

  if (readingPanePosition === "right") {
    return (
      <ErrorBoundary name="EmailLayout">
        <ResizableEmailLayout />
      </ErrorBoundary>
    );
  }

  const showReading = readingPanePosition !== "hidden" && selectedThreadId !== null;

  const inlineChatPanel =
    isChatOpen && !isChatFloating && chatPosition !== "left" ? (
      <ErrorBoundary name="ChatPanel">
        <ChatPanel />
      </ErrorBoundary>
    ) : null;

  const floatingChatPanel = isChatFloating ? (
    <ErrorBoundary name="ChatPanel">
      <ChatPanel />
    </ErrorBoundary>
  ) : null;

  return (
    <>
      <div
        className={`flex flex-1 min-w-0 ${readingPanePosition === "bottom" ? "flex-col" : "flex-row"}`}
      >
        <ErrorBoundary name="EmailList">
          <EmailList fullScreen={!showReading} />
        </ErrorBoundary>
        {showReading ? (
          <div className="flex flex-1 min-w-0 bg-bg-primary">
            <ErrorBoundary name="ReadingPane">
              <ReadingPane />
            </ErrorBoundary>
            {inlineChatPanel}
          </div>
        ) : (
          isChatOpen && !isChatFloating && chatPosition !== "left" && inlineChatPanel
        )}
      </div>
      {floatingChatPanel}
    </>
  );
}
