import { useState, useRef, useCallback } from "react";
import { searchMessages } from "@/services/db/search";
import { useAccountStore } from "@/stores/accountStore";
import { useThreadStore } from "@/stores/threadStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useChatStore } from "@/stores/chatStore";
import { InputDialog } from "@/components/ui/InputDialog";
import { Search, Sparkles, X, FolderPlus, Users, Send } from "lucide-react";

const HISTORY_KEY = "ai_prompt_history";
const MAX_HISTORY = 20;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveToHistory(text: string): void {
  const history = loadHistory().filter((h) => h !== text);
  history.unshift(text);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

const OPERATOR_SUGGESTIONS = [
  { label: "from:", description: "Filter by sender" },
  { label: "to:", description: "Filter by recipient" },
  { label: "has:attachment", description: "Has attachment" },
  { label: "is:unread", description: "Unread emails" },
  { label: "is:starred", description: "Starred" },
  { label: "is:read", description: "Read emails" },
  { label: "subject:", description: "Search subject" },
  { label: "before:", description: "Before date" },
  { label: "after:", description: "After date" },
];

export function UnifiedInboxBar() {
  const searchQuery = useThreadStore((s) => s.searchQuery);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [searchAllAccounts, setSearchAllAccounts] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Derived: are we in AI mode?
  const isAiMode = searchQuery.startsWith("?");
  const aiQuery = searchQuery.slice(1).trim(); // the actual query text when in AI mode

  // Operator suggestions — only in search mode
  const visibleSuggestions =
    !isAiMode && isFocused && searchQuery.length > 0
      ? OPERATOR_SUGGESTIONS.filter(
          (s) =>
            s.label.startsWith(searchQuery.toLowerCase()) ||
            s.label.includes(searchQuery.toLowerCase()) ||
            searchQuery.split(" ").some((word) => s.label.includes(word.toLowerCase())),
        ).slice(0, 5)
      : [];

  const runSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value.trim().length < 2) {
        useThreadStore.getState().setSearch(value, null);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        try {
          const accountIdForSearch = searchAllAccounts ? undefined : (activeAccountId ?? undefined);
          const hits = await searchMessages(value, accountIdForSearch, 100);
          const threadIds = new Set(hits.map((h) => h.thread_id));
          useThreadStore.getState().setSearch(value, threadIds);
        } catch {
          // On error show empty results (not null, which would show ALL emails)
          useThreadStore.getState().setSearch(value, new Set());
        }
      }, 200);
    },
    [activeAccountId, searchAllAccounts],
  );

  const handleChange = useCallback(
    (value: string) => {
      setHistoryIndex(-1);
      const { setSearch } = useThreadStore.getState();

      if (value.startsWith("?")) {
        // AI mode — suppress email filtering, just store the value
        setSearch(value, null);
        return;
      }

      // Search mode — normal debounced filtering
      setSearch(value, useThreadStore.getState().searchThreadIds);
      runSearch(value);
    },
    [runSearch],
  );

  const handleClear = useCallback(() => {
    useThreadStore.getState().clearSearch();
    setHistoryIndex(-1);
    inputRef.current?.focus();
  }, []);

  const enterAiMode = useCallback(() => {
    const current = searchQuery.startsWith("?") ? searchQuery : `?${searchQuery}`;
    useThreadStore.getState().setSearch(current, null);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    inputRef.current?.focus();
  }, [searchQuery]);

  const handleAiSend = useCallback(async () => {
    const text = aiQuery;
    if (!text || !activeAccountId || isSending) return;
    setIsSending(true);
    saveToHistory(text);
    setHistoryIndex(-1);
    try {
      const store = useChatStore.getState();
      if (!store.isOpen) {
        await store.openChat(activeAccountId);
      }
      await store.sendMessage(text);
      useThreadStore.getState().clearSearch();
    } finally {
      setIsSending(false);
    }
  }, [aiQuery, activeAccountId, isSending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        useThreadStore.getState().clearSearch();
        setHistoryIndex(-1);
        inputRef.current?.blur();
        return;
      }

      if (isAiMode) {
        if (e.key === "Enter" && aiQuery) {
          e.preventDefault();
          void handleAiSend();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const history = loadHistory();
          if (history.length === 0) return;
          const nextIndex = Math.min(historyIndex + 1, history.length - 1);
          setHistoryIndex(nextIndex);
          const recalled = history[nextIndex];
          if (recalled) {
            const newVal = `?${recalled}`;
            useThreadStore.getState().setSearch(newVal, null);
          }
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (historyIndex <= 0) {
            setHistoryIndex(-1);
            useThreadStore.getState().setSearch("?", null);
          } else {
            const history = loadHistory();
            const nextIndex = historyIndex - 1;
            setHistoryIndex(nextIndex);
            const recalled = history[nextIndex];
            if (recalled) {
              useThreadStore.getState().setSearch(`?${recalled}`, null);
            }
          }
        }
      }
    },
    [isAiMode, aiQuery, historyIndex, handleAiSend],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      const lastSpaceIdx = searchQuery.lastIndexOf(" ");
      const newValue =
        lastSpaceIdx >= 0 ? searchQuery.slice(0, lastSpaceIdx + 1) + suggestion : suggestion;
      useThreadStore.getState().setSearch(newValue, null);
      runSearch(newValue);
      inputRef.current?.focus();
    },
    [searchQuery, runSearch],
  );

  const hasText = searchQuery.length > 0;

  return (
    <div className="relative">
      {/* Left icon — Search or Sparkles depending on mode */}
      <button
        onClick={isAiMode ? undefined : enterAiMode}
        title={isAiMode ? "AI mode active (type ? to switch)" : "Click or type ? to ask AI"}
        className={`absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors ${
          isAiMode
            ? "text-accent pointer-events-none"
            : "text-text-tertiary hover:text-accent cursor-pointer"
        }`}
      >
        {isAiMode ? <Sparkles size={14} /> : <Search size={14} />}
      </button>

      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        placeholder={
          isAiMode
            ? "Ask your inbox anything... (Enter to send)"
            : "Search emails... (? to ask AI)"
        }
        className={`w-full text-text-primary text-sm pl-8 pr-20 py-1.5 rounded-md border focus:outline-none placeholder:text-text-tertiary transition-colors ${
          isAiMode
            ? "bg-accent/5 border-accent focus:border-accent"
            : "bg-bg-tertiary border-border-primary focus:border-accent"
        }`}
      />

      {/* Right-side actions */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {/* Multi-account toggle */}
        <button
          onClick={() => {
            setSearchAllAccounts((v) => !v);
            if (!isAiMode && searchQuery.trim().length >= 2) runSearch(searchQuery);
          }}
          title={searchAllAccounts ? "All accounts" : "Current account only"}
          className={`transition-colors ${
            searchAllAccounts ? "text-accent" : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <Users size={13} />
        </button>

        {hasText && (
          <>
            {!isAiMode && searchQuery.trim().length >= 2 && (
              <button
                onClick={() => setShowSaveModal(true)}
                className="text-text-tertiary hover:text-accent transition-colors"
                title="Save as Smart Folder"
              >
                <FolderPlus size={14} />
              </button>
            )}

            {isAiMode ? (
              <button
                onClick={() => void handleAiSend()}
                disabled={isSending || !aiQuery}
                title="Send to AI (Enter)"
                className="text-accent hover:text-accent-hover disabled:opacity-40 transition-colors"
              >
                <Send size={13} />
              </button>
            ) : (
              <button
                onClick={enterAiMode}
                title="Ask AI (type ? or click)"
                className="text-text-tertiary hover:text-accent transition-colors"
              >
                <Sparkles size={14} />
              </button>
            )}

            <button
              onClick={handleClear}
              className="text-text-tertiary hover:text-text-primary transition-colors"
              title="Clear (Esc)"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      {/* Operator autocomplete — search mode only */}
      {!isAiMode && isFocused && visibleSuggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-border-primary rounded-md shadow-lg z-50 overflow-hidden">
          {visibleSuggestions.map((s) => (
            <button
              key={s.label}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSuggestionClick(s.label);
              }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-bg-hover transition-colors"
            >
              <span className="text-xs font-mono text-accent">{s.label}</span>
              <span className="text-xs text-text-tertiary">{s.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* AI mode hint — shown when in AI mode and query is empty */}
      {isAiMode && !aiQuery && isFocused && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-accent/20 rounded-md shadow-lg z-50 p-3">
          <p className="text-xs text-text-tertiary leading-relaxed">
            <span className="text-accent font-medium">AI mode</span> — ask anything about your
            inbox. Press{" "}
            <kbd className="px-1 py-0.5 bg-bg-tertiary border border-border-primary rounded text-[0.6rem]">
              Esc
            </kbd>{" "}
            to return to search.
          </p>
          <div className="mt-2 space-y-1">
            {[
              "Find emails from last week about invoices",
              "Summarize my unread newsletters",
              "Who emailed me most this month?",
            ].map((hint) => (
              <button
                key={hint}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const newVal = `?${hint}`;
                  useThreadStore.getState().setSearch(newVal, null);
                  inputRef.current?.focus();
                }}
                className="block text-left text-xs text-text-secondary hover:text-accent transition-colors"
              >
                &ldquo;{hint}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}

      <InputDialog
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSubmit={(values) => {
          useSmartFolderStore.getState().createFolder(
            values.name!.trim(),
            useThreadStore.getState().searchQuery.trim(),
            activeAccountId ?? undefined,
          );
        }}
        title="Save as Smart Folder"
        fields={[{ key: "name", label: "Name", defaultValue: searchQuery.trim() }]}
        submitLabel="Save"
      />
    </div>
  );
}
