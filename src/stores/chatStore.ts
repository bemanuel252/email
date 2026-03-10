import { create } from "zustand";
import { runAgentTurn } from "@/services/ai/agent/agentRunner";
import { useThreadStore } from "@/stores/threadStore";
import { setSetting } from "@/services/db/settings";
import {
  createChatSession,
  getRecentSessions,
  getSessionMessages,
  saveChatMessage,
  updateSessionTitle,
  deleteSession as dbDeleteSession,
} from "@/services/db/chatSessions";
import type { DbChatSession, DbChatMessage } from "@/services/db/chatSessions";
import type {
  ConfirmationRequest,
  AgentTurnResult,
  AgentToolName,
} from "@/services/ai/agent/tools";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The UI representation of a chat message — richer than the DB type. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_progress" | "confirmation";
  content: string;
  toolsUsed?: AgentToolName[];
  threadRefs?: string[];
  confirmationRequest?: ConfirmationRequest;
  /** Reserved for future streaming support. */
  isStreaming?: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// State + action interface
// ---------------------------------------------------------------------------

interface ChatState {
  // Panel visibility — chatStore owns this, not uiStore
  isOpen: boolean;

  // Session state
  sessionId: string | null;
  accountId: string | null;
  messages: ChatMessage[];
  sessions: DbChatSession[];

  // Loading state
  isLoading: boolean;
  /** Human-readable status shown while the agent loop is running. */
  loadingStatus: string;

  // Confirmation protocol
  pendingConfirmation: ConfirmationRequest | null;
  /** Internal: resolve function for the in-flight confirmation Promise. Not for UI use. */
  _confirmResolve: ((approved: boolean) => void) | null;

  // Error state
  error: string | null;

  // Panel layout
  panelPosition: "left" | "right"; // which side of the reading pane
  isFloating: boolean; // detached floating overlay

  // Per-session provider selection (null = use global active provider)
  selectedProvider: import("@/services/ai/types").AiProvider | null;
  selectedModel: string | null;

  // Panel actions
  openChat: (accountId: string) => Promise<void>;
  closeChat: () => void;
  toggleChat: (accountId: string) => Promise<void>;

  // Session management
  startNewSession: (accountId: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  loadSessions: (accountId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

  // Messaging
  sendMessage: (text: string) => Promise<void>;
  openWithMessage: (text: string, accountId: string) => Promise<void>;

  // Confirmation protocol
  resolveConfirmation: (approved: boolean) => void;

  // Misc
  clearError: () => void;

  // Panel layout actions
  setPanelPosition: (pos: "left" | "right") => void;
  togglePanelPosition: () => void;
  setFloating: (floating: boolean) => void;

  // Provider override
  setProviderOverride: (
    provider: import("@/services/ai/types").AiProvider | null,
    model: string | null,
  ) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROGRESS_ID_PREFIX = "progress-";
const CONFIRM_ID_PREFIX = "confirm-";

function isProgressMessage(msg: ChatMessage): boolean {
  return msg.id.startsWith(PROGRESS_ID_PREFIX);
}

function isConfirmationMessage(msg: ChatMessage): boolean {
  return msg.role === "confirmation";
}

function mapDbMessageToUi(m: DbChatMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    createdAt: m.created_at,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  sessionId: null,
  accountId: null,
  messages: [],
  sessions: [],
  isLoading: false,
  loadingStatus: "",
  pendingConfirmation: null,
  _confirmResolve: null,
  error: null,
  panelPosition: "right",
  isFloating: false,
  selectedProvider: null,
  selectedModel: null,

  // -------------------------------------------------------------------------
  // Panel actions
  // -------------------------------------------------------------------------

  openChat: async (accountId: string) => {
    set({ isOpen: true, accountId });
    await get().loadSessions(accountId);
    if (!get().sessionId) {
      await get().startNewSession(accountId);
    }
  },

  closeChat: () => set({ isOpen: false }),

  toggleChat: async (accountId: string) => {
    if (get().isOpen) {
      get().closeChat();
    } else {
      await get().openChat(accountId);
    }
  },

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  startNewSession: async (accountId: string) => {
    const sessionId = await createChatSession(accountId);
    set({ sessionId, messages: [], accountId });
  },

  switchSession: async (sessionId: string) => {
    const dbMessages = await getSessionMessages(sessionId);
    const messages: ChatMessage[] = dbMessages.map(mapDbMessageToUi);
    set({ sessionId, messages });
  },

  loadSessions: async (accountId: string) => {
    const sessions = await getRecentSessions(accountId, 20);
    set({ sessions });
  },

  deleteSession: async (sessionId: string) => {
    await dbDeleteSession(sessionId);
    const { sessionId: currentSessionId, accountId } = get();
    if (currentSessionId === sessionId && accountId) {
      await get().startNewSession(accountId);
    }
    if (accountId) {
      await get().loadSessions(accountId);
    }
  },

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  sendMessage: async (text: string) => {
    const { sessionId, accountId, messages, isLoading } = get();

    // Guard: ignore calls while already processing
    if (isLoading) return;
    if (!sessionId || !accountId || !text.trim()) return;

    const trimmedText = text.trim();

    // Optimistically add the user message to the UI
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
      createdAt: Date.now(),
    };

    set({ messages: [...messages, userMsg], isLoading: true, error: null, loadingStatus: "" });

    // Persist user message (DB assigns its own UUID via saveChatMessage)
    await saveChatMessage({
      sessionId,
      accountId,
      role: "user",
      content: trimmedText,
    });

    // Build conversation history for the agent — last 10 user/assistant exchanges
    const history = get()
      .messages.filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-20) // up to 10 pairs = 20 messages
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      const result: AgentTurnResult = await runAgentTurn({
        userMessage: trimmedText,
        accountId,
        conversationHistory: history,
        providerOverride:
          get().selectedProvider && get().selectedModel
            ? { provider: get().selectedProvider!, model: get().selectedModel! }
            : undefined,

        onProgress: (status: string) => {
          const progressMsg: ChatMessage = {
            id: PROGRESS_ID_PREFIX + Date.now(),
            role: "tool_progress",
            content: status,
            createdAt: Date.now(),
          };
          set((state) => ({
            loadingStatus: status,
            // Replace any existing progress bubble — there should only ever be one
            messages: [
              ...state.messages.filter((m) => !isProgressMessage(m)),
              progressMsg,
            ],
          }));
        },

        onConfirm: (req: ConfirmationRequest): Promise<boolean> => {
          return new Promise<boolean>((resolve) => {
            const confirmMsg: ChatMessage = {
              id: CONFIRM_ID_PREFIX + req.id,
              role: "confirmation",
              content: req.action,
              confirmationRequest: req,
              createdAt: Date.now(),
            };
            set((state) => ({
              messages: [...state.messages, confirmMsg],
              pendingConfirmation: req,
              _confirmResolve: resolve,
            }));
          });
        },
      });

      // Surface found threads in the email list
      if (result.threadRefs.length > 0) {
        useThreadStore.getState().setSearch(
          `AI: ${trimmedText.slice(0, 40)}`,
          new Set(result.threadRefs),
        );
      }

      // Strip transient UI-only messages (progress bubbles); keep confirmation
      // cards in place until resolveConfirmation is called — by this point the
      // agent loop has already resumed, so they will have been resolved.
      const cleanMessages = get().messages.filter(
        (m) => !isProgressMessage(m) && !isConfirmationMessage(m),
      );

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.answer,
        toolsUsed: result.toolsUsed,
        threadRefs: result.threadRefs,
        createdAt: Date.now(),
      };

      set({
        messages: [...cleanMessages, assistantMsg],
        isLoading: false,
        loadingStatus: "",
        pendingConfirmation: null,
        _confirmResolve: null,
      });

      // Persist assistant message
      await saveChatMessage({
        sessionId,
        accountId,
        role: "assistant",
        content: result.answer,
        toolCallsJson:
          result.toolsUsed.length > 0 ? JSON.stringify(result.toolsUsed) : null,
        metadataJson:
          result.threadRefs.length > 0
            ? JSON.stringify({ threadRefs: result.threadRefs })
            : null,
      });

      // Auto-title the session from the first user message if it has no title yet
      const { sessions } = get();
      const session = sessions.find((s) => s.id === sessionId);
      if (!session?.title && trimmedText.length > 5) {
        const shortTitle =
          trimmedText.length > 50
            ? trimmedText.slice(0, 50) + "…"
            : trimmedText;
        // Fire-and-forget — failure is non-critical
        updateSessionTitle(sessionId, shortTitle)
          .then(() => get().loadSessions(accountId))
          .catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set((state) => ({
        isLoading: false,
        loadingStatus: "",
        error: errorMsg,
        pendingConfirmation: null,
        _confirmResolve: null,
        messages: state.messages.filter((m) => !isProgressMessage(m) && !isConfirmationMessage(m)),
      }));
    }
  },

  openWithMessage: async (text: string, accountId: string) => {
    if (!get().isOpen) {
      await get().openChat(accountId);
    }
    await get().sendMessage(text);
  },

  // -------------------------------------------------------------------------
  // Confirmation protocol
  // -------------------------------------------------------------------------

  resolveConfirmation: (approved: boolean) => {
    const { _confirmResolve } = get();
    if (!_confirmResolve) return;

    // Resume the agent loop before mutating state, so the Promise resolves
    // synchronously before the next set() call.
    _confirmResolve(approved);

    set((state) => ({
      pendingConfirmation: null,
      _confirmResolve: null,
      // Remove the confirmation card — the agent loop has already resumed
      messages: state.messages.filter((m) => !isConfirmationMessage(m)),
    }));
  },

  // -------------------------------------------------------------------------
  // Panel layout
  // -------------------------------------------------------------------------

  setPanelPosition: (panelPosition) => {
    setSetting("chat_panel_position", panelPosition).catch(() => {});
    set({ panelPosition });
  },

  togglePanelPosition: () => {
    const next = get().panelPosition === "right" ? "left" : "right";
    get().setPanelPosition(next);
  },

  setFloating: (isFloating) => set({ isFloating }),

  // -------------------------------------------------------------------------
  // Provider override
  // -------------------------------------------------------------------------

  setProviderOverride: (selectedProvider, selectedModel) => set({ selectedProvider, selectedModel }),

  // -------------------------------------------------------------------------
  // Misc
  // -------------------------------------------------------------------------

  clearError: () => set({ error: null }),
}));
