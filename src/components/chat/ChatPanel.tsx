import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  PenSquare,
  Bot,
  Send,
  AlertCircle,
  History,
  PanelLeft,
  PanelRight,
  Maximize2,
  Minimize2,
  Cpu,
  ChevronDown,
} from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { ChatMessageItem } from "./ChatMessage";
import { SessionHistory } from "./SessionHistory";
import {
  getConfiguredProviders,
  getActiveProviderName,
  type ConfiguredProvider,
} from "@/services/ai/providerManager";
import type { AiProvider } from "@/services/ai/types";

export function ChatPanel() {
  const {
    isOpen,
    messages,
    isLoading,
    loadingStatus,
    error,
    sessions,
    sessionId,
    closeChat,
    sendMessage,
    startNewSession,
    switchSession,
    deleteSession,
    resolveConfirmation,
    loadSessions,
    clearError,
    panelPosition,
    isFloating,
    selectedProvider,
    selectedModel,
    togglePanelPosition,
    setFloating,
    setProviderOverride,
  } = useChatStore();

  const activeAccountId = useAccountStore((s) => s.activeAccountId);

  const [inputValue, setInputValue] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [providers, setProviders] = useState<ConfiguredProvider[]>([]);
  const [defaultProviderName, setDefaultProviderName] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize the textarea as the user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputValue]);

  // Load sessions when the panel opens or account changes
  useEffect(() => {
    if ((isOpen || isFloating) && activeAccountId) {
      loadSessions(activeAccountId);
    }
  }, [isOpen, isFloating, activeAccountId, loadSessions]);

  // Load configured providers on mount
  useEffect(() => {
    Promise.all([
      getConfiguredProviders(),
      getActiveProviderName(),
    ]).then(([prov, defName]) => {
      setProviders(prov);
      setDefaultProviderName(defName);
    }).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage(text);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleNewSession = useCallback(async () => {
    if (!activeAccountId) return;
    setShowHistory(false);
    await startNewSession(activeAccountId);
  }, [activeAccountId, startNewSession]);

  const handleSelectSession = useCallback(
    async (sid: string) => {
      setShowHistory(false);
      await switchSession(sid);
    },
    [switchSession],
  );

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      await deleteSession(sid);
    },
    [deleteSession],
  );

  // When floating, always render regardless of isOpen.
  // When not floating, hide if isOpen is false.
  if (!isFloating && !isOpen) return null;

  const hasPendingConfirmation = messages.some((m) => m.role === "confirmation");
  const canSend =
    inputValue.trim().length > 0 && !isLoading && !hasPendingConfirmation;

  // Floating mode positional classes
  const floatingPositionClass =
    panelPosition === "left" ? "top-16 left-4" : "top-16 right-4";

  const outerClass = isFloating
    ? `fixed ${floatingPositionClass} z-50 flex flex-col w-96 h-[calc(100vh-5rem)] shadow-2xl rounded-xl overflow-hidden border border-border-primary`
    : `flex flex-col h-full w-80 ${panelPosition === "left" ? "border-r" : "border-l"} border-border-primary bg-bg-primary shrink-0`;

  const modelLabel = (() => {
    if (selectedProvider && selectedModel) {
      const prov = providers.find((p) => p.provider === selectedProvider);
      const model = prov?.models.find((m) => m.id === selectedModel);
      return `${prov?.providerLabel ?? selectedProvider} · ${model?.label ?? selectedModel}`;
    }
    const defProv = providers.find((p) => p.provider === defaultProviderName);
    if (defProv) {
      const model = defProv.models.find((m) => m.id === defProv.activeModel);
      return `${defProv.providerLabel} · ${model?.label ?? defProv.activeModel}`;
    }
    return "Default";
  })();

  return (
    <div className={`${outerClass} bg-bg-primary relative`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-2.5 border-b border-border-primary bg-bg-secondary shrink-0 ${isFloating ? "cursor-move" : ""}`}
      >
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-primary">
            AI Assistant
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Panel position toggle */}
          <button
            onClick={togglePanelPosition}
            title={panelPosition === "left" ? "Move to right" : "Move to left"}
            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors rounded"
          >
            {panelPosition === "left" ? (
              <PanelRight size={14} />
            ) : (
              <PanelLeft size={14} />
            )}
          </button>
          {/* Float / minimize */}
          <button
            onClick={() => setFloating(!isFloating)}
            title={isFloating ? "Dock panel" : "Pop out"}
            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors rounded"
          >
            {isFloating ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {/* Toggle history */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            title="Conversation history"
            className={`p-1.5 transition-colors rounded ${
              showHistory
                ? "text-accent bg-accent/10"
                : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
            }`}
          >
            <History size={14} />
          </button>
          {/* New chat */}
          <button
            onClick={handleNewSession}
            title="New conversation"
            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors rounded"
          >
            <PenSquare size={14} />
          </button>
          {/* Close */}
          <button
            onClick={closeChat}
            title="Close"
            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Session history — collapsible, shown above messages */}
      {showHistory && (
        <div className="shrink-0">
          <SessionHistory
            sessions={sessions}
            currentSessionId={sessionId}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            onNewSession={handleNewSession}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center gap-3">
            <Bot size={28} className="text-text-tertiary/50" />
            <p className="text-xs text-text-tertiary leading-relaxed">
              Ask me anything about your inbox — find emails, summarize threads,
              archive, label, and more.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            onConfirm={
              message.role === "confirmation"
                ? (approved) => resolveConfirmation(approved)
                : undefined
            }
          />
        ))}

        {/* Loading indicator — shown when agent is running but no progress message yet */}
        {isLoading &&
          !loadingStatus &&
          messages.every((m) => m.role !== "tool_progress") && (
            <div className="flex items-center gap-2 px-3 py-2 text-text-tertiary">
              <div className="flex gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 mx-3 mb-2 flex items-start gap-2 px-3 py-2 rounded-md bg-danger/10 border border-danger/25">
          <AlertCircle size={13} className="text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-danger leading-snug">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="shrink-0 text-danger/60 hover:text-danger transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-border-primary bg-bg-secondary px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasPendingConfirmation
                ? "Waiting for confirmation..."
                : "Ask your inbox..."
            }
            disabled={hasPendingConfirmation}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: "1.5rem", maxHeight: "7.5rem" }}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            title="Send (Enter)"
            className="shrink-0 p-1.5 text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={15} />
          </button>
        </div>
        <p className="text-[0.625rem] text-text-tertiary mt-1">
          Enter to send · Shift+Enter for newline
        </p>
      </div>

      {/* Model / provider selector footer */}
      <div className="shrink-0 border-t border-border-primary/50 px-3 py-1.5 flex items-center justify-between">
        <button
          onClick={() => setShowModelPicker((v) => !v)}
          className="flex items-center gap-1 text-[0.625rem] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <Cpu size={9} />
          <span>{modelLabel}</span>
          <ChevronDown size={9} className={`transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
        </button>
        {selectedProvider && (
          <button
            onClick={() => setProviderOverride(null, null)}
            className="text-[0.625rem] text-text-tertiary hover:text-danger transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Model picker — rendered as a fixed overlay above the panel footer */}
      {showModelPicker && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-[198]"
            onClick={() => setShowModelPicker(false)}
          />
          <div className="fixed bottom-10 z-[199] w-64 bg-bg-primary border border-border-primary rounded-lg shadow-xl overflow-hidden"
            style={panelPosition === "right" ? { right: "0.75rem" } : { left: "0.75rem" }}
          >
            {providers.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-tertiary">No providers configured</div>
            )}
            {providers.map((p, pi) => (
              <div key={p.provider}>
                {pi > 0 && <div className="border-t border-border-primary/40" />}
                {/* Provider group header */}
                <div className="px-3 pt-2 pb-1 text-[0.625rem] font-semibold text-text-tertiary uppercase tracking-wider">
                  {p.providerLabel}
                </div>
                {/* Models for this provider */}
                {p.models.map((m) => {
                  const isActive = selectedProvider === p.provider && selectedModel === m.id;
                  const isGlobalDefault = !selectedProvider && p.activeModel === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setProviderOverride(p.provider as AiProvider, m.id);
                        setShowModelPicker(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                        isActive
                          ? "bg-accent/10 text-accent font-medium"
                          : "hover:bg-bg-hover text-text-primary"
                      }`}
                    >
                      <span>{m.label}</span>
                      <span className="text-[0.6rem] shrink-0 ml-2">
                        {isActive && <span className="text-accent">✓</span>}
                        {!isActive && isGlobalDefault && <span className="text-text-tertiary">default</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {/* Global default option */}
            <div className="border-t border-border-primary/40">
              <button
                onClick={() => { setProviderOverride(null, null); setShowModelPicker(false); }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                  !selectedProvider ? "text-accent font-medium bg-accent/5" : "text-text-tertiary hover:bg-bg-hover"
                }`}
              >
                <span>Use global default</span>
                {!selectedProvider && <span className="text-accent">✓</span>}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
