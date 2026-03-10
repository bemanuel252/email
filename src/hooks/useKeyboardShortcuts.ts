import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useThreadStore } from "@/stores/threadStore";
import { useComposerStore } from "@/stores/composerStore";
import { useAccountStore } from "@/stores/accountStore";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useInboxSplitsStore } from "@/stores/inboxSplitsStore";
import { navigateToLabel, navigateToThread, navigateBack, getActiveLabel, getSelectedThreadId } from "@/router/navigate";
import { router } from "@/router/index";
import { archiveThread, trashThread, permanentDeleteThread, starThread, spamThread, addThreadLabel } from "@/services/emailActions";
import { deleteThread as deleteThreadFromDb, pinThread as pinThreadDb, unpinThread as unpinThreadDb, muteThread as muteThreadDb, unmuteThread as unmuteThreadDb } from "@/services/db/threads";
import { deleteDraftsForThread } from "@/services/gmail/draftDeletion";
import { getGmailClient } from "@/services/gmail/tokenManager";
import { getMessagesForThread } from "@/services/db/messages";
import { parseUnsubscribeUrl } from "@/components/email/MessageItem";
import { openUrl } from "@tauri-apps/plugin-opener";
import { triggerSync } from "@/services/gmail/syncManager";

/**
 * Parse a key binding string and check if it matches a keyboard event.
 * Supports formats like: "j", "#", "Ctrl+K", "Ctrl+Shift+E", "Cmd+Enter"
 */
function matchesKey(binding: string, e: KeyboardEvent): boolean {
  const parts = binding.split("+");
  const key = parts[parts.length - 1]!;
  const needsCtrl = parts.some((p) => p === "Ctrl" || p === "Cmd");
  const needsShift = parts.some((p) => p === "Shift");
  const needsAlt = parts.some((p) => p === "Alt");

  const ctrlMatch = needsCtrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
  const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey;
  const altMatch = needsAlt ? e.altKey : !e.altKey;

  // For single character keys, compare case-insensitively
  const keyMatch = key.length === 1
    ? e.key === key || e.key === key.toLowerCase() || e.key === key.toUpperCase()
    : e.key === key;

  return ctrlMatch && shiftMatch && altMatch && keyMatch;
}

/**
 * Build a reverse map: key binding -> action ID.
 * Normalizes Shift+X single-char bindings to "Shift+x" for consistent lookup.
 */
function buildReverseMap(keyMap: Record<string, string>): {
  singleKey: Map<string, string>;
  twoKeySequences: Map<string, string>; // second key -> action ID (first key is always "g")
  ctrlCombos: Map<string, string>;
} {
  const singleKey = new Map<string, string>();
  const twoKeySequences = new Map<string, string>();
  const ctrlCombos = new Map<string, string>();

  for (const [id, keys] of Object.entries(keyMap)) {
    if (keys.includes(" then ")) {
      // Two-key sequence like "g then i"
      const secondKey = keys.split(" then ")[1]!.trim();
      twoKeySequences.set(secondKey, id);
    } else if (keys.includes("+") && (keys.includes("Ctrl") || keys.includes("Cmd"))) {
      ctrlCombos.set(id, keys);
    } else if (keys.startsWith("Shift+") && !keys.includes("Tab") && !keys.includes("Space")) {
      // Normalize "Shift+X" -> "Shift+x" for lookup: when Shift is held,
      // e.key returns uppercase letter, we want to look up "Shift+lowercase"
      const afterShift = keys.slice(6);
      singleKey.set("Shift+" + afterShift.toLowerCase(), id);
    } else {
      singleKey.set(keys, id);
    }
  }

  return { singleKey, twoKeySequences, ctrlCombos };
}

// Cached reverse map to avoid rebuilding on every keypress
let cachedKeyMap: Record<string, string> | null = null;
let cachedReverseMap: ReturnType<typeof buildReverseMap> | null = null;

function getCachedReverseMap(keyMap: Record<string, string>): ReturnType<typeof buildReverseMap> {
  if (cachedKeyMap === keyMap && cachedReverseMap) return cachedReverseMap;
  cachedKeyMap = keyMap;
  cachedReverseMap = buildReverseMap(keyMap);
  return cachedReverseMap;
}

/**
 * Global keyboard shortcuts handler (Superhuman-aligned).
 * Uses customizable key bindings from the shortcut store.
 */
export function useKeyboardShortcuts() {
  const pendingKeyRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Close context menu on Escape before any other handling
      if (e.key === "Escape" && useContextMenuStore.getState().menuType) {
        e.preventDefault();
        useContextMenuStore.getState().closeMenu();
        return;
      }

      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const keyMap = useShortcutStore.getState().keyMap;
      const { singleKey, twoKeySequences, ctrlCombos } = getCachedReverseMap(keyMap);

      // Ctrl/Cmd shortcuts work everywhere
      if (e.ctrlKey || e.metaKey) {
        for (const [actionId, binding] of ctrlCombos) {
          if (matchesKey(binding, e)) {
            e.preventDefault();
            executeAction(actionId);
            return;
          }
        }
        // Cmd+K for command palette
        if ((e.key === "k" || e.key === "K") && !e.shiftKey) {
          e.preventDefault();
          window.dispatchEvent(new Event("velo-toggle-command-palette"));
          return;
        }
        // Cmd+Enter is handled by composer directly, let it pass
        return;
      }

      // F5 sync works even when input is focused
      if (e.key === "F5") {
        e.preventDefault();
        const syncActionId = singleKey.get("F5");
        if (syncActionId) await executeAction(syncActionId);
        return;
      }

      // Tab / Shift+Tab — cycle splits (capture phase, intercepts browser focus cycling)
      if (e.key === "Tab" && !isInputFocused) {
        e.preventDefault();
        await executeAction(e.shiftKey ? "nav.splitPrev" : "nav.splitNext");
        return;
      }

      // Space / Shift+Space — scroll (before input guard so we can prevent default)
      if (e.key === " " && !isInputFocused) {
        e.preventDefault();
        await executeAction(e.shiftKey ? "nav.scrollUp" : "nav.scrollDown");
        return;
      }

      // Enter — context-sensitive: open thread (list) OR reply-all (reading pane)
      if (e.key === "Enter" && !isInputFocused && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const selectedId = getSelectedThreadId();
        if (selectedId) {
          await executeAction("action.replyAll");
        } else {
          await executeAction("nav.open");
        }
        return;
      }

      // Don't process single-key shortcuts when typing in inputs
      if (isInputFocused) return;

      const key = e.key;

      // Handle two-key sequences (pending "g" key)
      if (pendingKeyRef.current === "g") {
        pendingKeyRef.current = null;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        const actionId = twoKeySequences.get(key);
        if (actionId) {
          e.preventDefault();
          executeAction(actionId);
          return;
        }
      }

      // Check if "g" starts a two-key sequence
      if (key === "g" && twoKeySequences.size > 0) {
        pendingKeyRef.current = "g";
        pendingTimerRef.current = setTimeout(() => {
          pendingKeyRef.current = null;
        }, 1000);
        return;
      }

      // Arrow keys — conversation navigation (redundant with J/K but useful in list-only view)
      if (key === "ArrowDown" || key === "ArrowUp") {
        const selectedId = getSelectedThreadId();
        const paneOff = useUIStore.getState().readingPanePosition === "hidden";
        if (!(paneOff && selectedId)) {
          e.preventDefault();
          await executeAction(key === "ArrowDown" ? "nav.next" : "nav.prev");
          return;
        }
      }

      // Single key shortcuts — with Shift+X normalization
      const lookupKey = (e.shiftKey && key.length === 1)
        ? "Shift+" + key.toLowerCase()
        : key;

      let actionId = singleKey.get(lookupKey) ?? singleKey.get(key) ?? singleKey.get(key.toLowerCase());

      // Delete and Backspace always trigger delete action
      if (!actionId && (key === "Delete" || key === "Backspace")) {
        actionId = "action.delete";
      }

      if (actionId) {
        e.preventDefault();
        await executeAction(actionId);
      }
    };

    // Use capture phase so Tab is intercepted before browser focus-cycling consumes it
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);
}

async function executeAction(actionId: string): Promise<void> {
  const threads = useThreadStore.getState().threads;
  const selectedId = getSelectedThreadId();
  const currentIdx = threads.findIndex((t) => t.id === selectedId);
  const activeAccountId = useAccountStore.getState().activeAccountId;

  switch (actionId) {
    // ── Navigation ────────────────────────────────────────────────────────────
    case "nav.next": {
      const nextIdx = Math.min(currentIdx + 1, threads.length - 1);
      if (threads[nextIdx]) navigateToThread(threads[nextIdx].id);
      break;
    }
    case "nav.prev": {
      const prevIdx = Math.max(currentIdx - 1, 0);
      if (threads[prevIdx]) navigateToThread(threads[prevIdx].id);
      break;
    }
    case "nav.open": {
      if (!selectedId && threads[0]) navigateToThread(threads[0].id);
      break;
    }
    case "nav.msgNext":
      window.dispatchEvent(new CustomEvent("velo-message-nav", { detail: { direction: "next" } }));
      break;
    case "nav.msgPrev":
      window.dispatchEvent(new CustomEvent("velo-message-nav", { detail: { direction: "prev" } }));
      break;
    case "nav.scrollDown":
      window.dispatchEvent(new CustomEvent("velo-scroll", { detail: { direction: "down" } }));
      break;
    case "nav.scrollUp":
      window.dispatchEvent(new CustomEvent("velo-scroll", { detail: { direction: "up" } }));
      break;

    // ── Folder navigation (g then X) ─────────────────────────────────────────
    case "nav.goInbox":
      navigateToLabel("inbox");
      break;
    case "nav.goStarred":
      navigateToLabel("starred");
      break;
    case "nav.goSent":
      navigateToLabel("sent");
      break;
    case "nav.goDrafts":
      navigateToLabel("drafts");
      break;
    case "nav.goAllMail":
      navigateToLabel("all");
      break;
    case "nav.goDone":
      // "Done" = archived mail — navigate to All Mail filtered to archived
      navigateToLabel("all");
      break;
    case "nav.goSnoozed":
      navigateToLabel("snoozed");
      break;
    case "nav.goMuted":
      // Muted threads are typically in All Mail — navigate there
      navigateToLabel("all");
      break;
    case "nav.goSpam":
      navigateToLabel("spam");
      break;
    case "nav.goTrash":
      navigateToLabel("trash");
      break;

    // ── Escape / Back ─────────────────────────────────────────────────────────
    case "nav.escape": {
      if (useComposerStore.getState().isOpen) {
        useComposerStore.getState().closeComposer();
      } else if (useThreadStore.getState().selectedThreadIds.size > 0) {
        useThreadStore.getState().clearMultiSelect();
      } else if (selectedId) {
        navigateBack();
      }
      break;
    }

    // ── Split navigation ──────────────────────────────────────────────────────
    case "nav.splitNext":
    case "nav.splitPrev": {
      const { inboxViewMode } = useUIStore.getState();
      const activeLabel = getActiveLabel();
      if (activeLabel !== "inbox") break;

      let currentCategoryId = "";
      for (const match of router.state.matches) {
        const search = (match as { search?: Record<string, unknown> }).search;
        if (search && typeof search["category"] === "string") {
          currentCategoryId = search["category"];
          break;
        }
      }

      let tabIds: string[] = [];
      if (inboxViewMode === "custom-split") {
        const { splits } = useInboxSplitsStore.getState();
        tabIds = splits.filter((s) => s.isEnabled).map((s) => s.id);
      } else if (inboxViewMode === "split") {
        tabIds = ["Primary", "Updates", "Promotions", "Social", "Newsletters"];
      } else {
        break;
      }

      if (tabIds.length === 0) break;
      const idx = tabIds.indexOf(currentCategoryId);
      const len = tabIds.length;
      const nextIdx =
        actionId === "nav.splitNext"
          ? idx === -1 ? 0 : (idx + 1) % len
          : idx === -1 ? len - 1 : (idx - 1 + len) % len;
      navigateToLabel("inbox", { category: tabIds[nextIdx] });
      break;
    }

    // ── Compose / Reply ───────────────────────────────────────────────────────
    case "action.compose":
      useComposerStore.getState().openComposer();
      break;
    case "action.reply": {
      if (selectedId) {
        const replyMode = useUIStore.getState().defaultReplyMode;
        window.dispatchEvent(new CustomEvent("velo-inline-reply", { detail: { mode: replyMode } }));
      }
      break;
    }
    case "action.replyAll":
      if (selectedId) {
        window.dispatchEvent(new CustomEvent("velo-inline-reply", { detail: { mode: "replyAll" } }));
      }
      break;
    case "action.forward":
      if (selectedId) {
        window.dispatchEvent(new CustomEvent("velo-inline-reply", { detail: { mode: "forward" } }));
      }
      break;
    case "action.expandMessage":
      window.dispatchEvent(new CustomEvent("velo-expand-message"));
      break;
    case "action.expandAllMessages":
      window.dispatchEvent(new CustomEvent("velo-expand-all-messages"));
      break;

    // ── Conversation actions ───────────────────────────────────────────────────
    case "action.archive": {
      const multiIds = useThreadStore.getState().selectedThreadIds;
      if (multiIds.size > 0 && activeAccountId) {
        for (const id of [...multiIds]) await archiveThread(activeAccountId, id, []);
      } else if (selectedId && activeAccountId) {
        await archiveThread(activeAccountId, selectedId, []);
        autoAdvance(selectedId);
      }
      break;
    }
    case "action.markNotDone": {
      // Move back to inbox (un-archive): add INBOX label
      if (selectedId && activeAccountId) {
        await addThreadLabel(activeAccountId, selectedId, "INBOX");
        useThreadStore.getState().removeThread(selectedId);
        autoAdvance(selectedId);
      }
      break;
    }
    case "action.delete": {
      const deleteLabelCtx = getActiveLabel();
      const isTrashView = deleteLabelCtx === "trash";
      const isDraftsView = deleteLabelCtx === "drafts";
      const multiDeleteIds = useThreadStore.getState().selectedThreadIds;
      if (multiDeleteIds.size > 0 && activeAccountId) {
        for (const id of [...multiDeleteIds]) {
          if (isTrashView) {
            await permanentDeleteThread(activeAccountId, id, []);
            await deleteThreadFromDb(activeAccountId, id);
          } else if (isDraftsView) {
            try {
              const client = await getGmailClient(activeAccountId);
              await deleteDraftsForThread(client, activeAccountId, id);
              useThreadStore.getState().removeThread(id);
            } catch (err) { console.error("Draft delete failed:", err); }
          } else {
            await trashThread(activeAccountId, id, []);
          }
        }
      } else if (selectedId && activeAccountId) {
        if (isTrashView) {
          await permanentDeleteThread(activeAccountId, selectedId, []);
          await deleteThreadFromDb(activeAccountId, selectedId);
        } else if (isDraftsView) {
          try {
            const client = await getGmailClient(activeAccountId);
            await deleteDraftsForThread(client, activeAccountId, selectedId);
            useThreadStore.getState().removeThread(selectedId);
          } catch (err) { console.error("Draft delete failed:", err); }
        } else {
          await trashThread(activeAccountId, selectedId, []);
        }
        autoAdvance(selectedId);
      }
      break;
    }
    case "action.star": {
      if (selectedId && activeAccountId) {
        const thread = threads.find((t) => t.id === selectedId);
        if (thread) await starThread(activeAccountId, selectedId, [], !thread.isStarred);
      }
      break;
    }
    case "action.markRead": {
      const threadIdForMark = getSelectedThreadId();
      if (threadIdForMark && activeAccountId) {
        const { threads: ts, updateThread } = useThreadStore.getState();
        const thread = ts.find((t) => t.id === threadIdForMark);
        if (thread) {
          const { markThreadRead } = await import("@/services/emailActions");
          await markThreadRead(activeAccountId, threadIdForMark, [], !thread.isRead);
          updateThread(threadIdForMark, { isRead: !thread.isRead });
        }
      }
      break;
    }
    case "action.spam": {
      const isSpamView = getActiveLabel() === "spam";
      const multiSpamIds = useThreadStore.getState().selectedThreadIds;
      if (multiSpamIds.size > 0 && activeAccountId) {
        for (const id of [...multiSpamIds]) await spamThread(activeAccountId, id, [], !isSpamView);
      } else if (selectedId && activeAccountId) {
        await spamThread(activeAccountId, selectedId, [], !isSpamView);
        autoAdvance(selectedId);
      }
      break;
    }
    case "action.mute": {
      const multiMuteIds = useThreadStore.getState().selectedThreadIds;
      if (multiMuteIds.size > 0 && activeAccountId) {
        for (const id of [...multiMuteIds]) {
          const t = threads.find((thread) => thread.id === id);
          if (t?.isMuted) {
            await unmuteThreadDb(activeAccountId, id);
            useThreadStore.getState().updateThread(id, { isMuted: false });
          } else {
            await muteThreadDb(activeAccountId, id);
            await archiveThread(activeAccountId, id, []);
          }
        }
      } else if (selectedId && activeAccountId) {
        const thread = threads.find((t) => t.id === selectedId);
        if (thread) {
          if (thread.isMuted) {
            await unmuteThreadDb(activeAccountId, selectedId);
            useThreadStore.getState().updateThread(selectedId, { isMuted: false });
          } else {
            await muteThreadDb(activeAccountId, selectedId);
            await archiveThread(activeAccountId, selectedId, []);
          }
        }
      }
      break;
    }
    case "action.snooze":
      if (selectedId) {
        window.dispatchEvent(new CustomEvent("velo-open-snooze", { detail: { threadId: selectedId } }));
      }
      break;
    case "action.unsubscribe": {
      if (selectedId && activeAccountId) {
        try {
          const msgs = await getMessagesForThread(activeAccountId, selectedId);
          const unsubMsg = msgs.find((m) => m.list_unsubscribe);
          if (unsubMsg) {
            const url = parseUnsubscribeUrl(unsubMsg.list_unsubscribe!);
            if (url) {
              await openUrl(url);
              await archiveThread(activeAccountId, selectedId, []);
            }
          }
        } catch (err) { console.error("Unsubscribe failed:", err); }
      }
      break;
    }

    // ── Labels ────────────────────────────────────────────────────────────────
    case "action.addLabel":
      if (selectedId) {
        window.dispatchEvent(new CustomEvent("velo-add-label", { detail: { threadId: selectedId } }));
      }
      break;
    case "action.moveToFolder": {
      const multiMoveIds = useThreadStore.getState().selectedThreadIds;
      const moveThreadIds = multiMoveIds.size > 0 ? [...multiMoveIds] : selectedId ? [selectedId] : [];
      if (moveThreadIds.length > 0) {
        window.dispatchEvent(new CustomEvent("velo-move-to-folder", { detail: { threadIds: moveThreadIds } }));
      }
      break;
    }

    // ── Selection ─────────────────────────────────────────────────────────────
    case "action.selectConversation":
      if (selectedId) useThreadStore.getState().toggleThreadSelection(selectedId);
      break;
    case "action.addToSelection": {
      // Add next thread to multi-select and advance cursor
      if (selectedId) {
        useThreadStore.getState().toggleThreadSelection(selectedId);
        const nextIdx2 = Math.min(currentIdx + 1, threads.length - 1);
        if (threads[nextIdx2] && threads[nextIdx2].id !== selectedId) {
          navigateToThread(threads[nextIdx2].id);
        }
      }
      break;
    }
    case "action.selectAll":
      useThreadStore.getState().selectAll();
      break;
    case "action.selectFromHere":
      useThreadStore.getState().selectAllFromHere();
      break;

    // ── Pinning (no default key, still actionable via command palette) ─────────
    case "action.pin": {
      if (selectedId && activeAccountId) {
        const thread = threads.find((t) => t.id === selectedId);
        if (thread) {
          const newPinned = !thread.isPinned;
          useThreadStore.getState().updateThread(selectedId, { isPinned: newPinned });
          try {
            if (newPinned) await pinThreadDb(activeAccountId, selectedId);
            else await unpinThreadDb(activeAccountId, selectedId);
          } catch (err) {
            console.error("Pin failed:", err);
            useThreadStore.getState().updateThread(selectedId, { isPinned: !newPinned });
          }
        }
      }
      break;
    }

    // ── App ───────────────────────────────────────────────────────────────────
    case "app.commandPalette":
    case "app.commandPaletteAlt":
      window.dispatchEvent(new Event("velo-toggle-command-palette"));
      break;
    case "app.toggleSidebar":
      useUIStore.getState().toggleSidebar();
      break;
    case "app.askInbox":
      window.dispatchEvent(new Event("velo-toggle-ask-inbox"));
      break;
    case "app.toggleChat":
      window.dispatchEvent(new CustomEvent("velo-toggle-chat"));
      break;
    case "app.help":
      window.dispatchEvent(new Event("velo-toggle-shortcuts-help"));
      break;
    case "app.syncFolder": {
      if (activeAccountId) {
        const currentLabel = getActiveLabel();
        useUIStore.getState().setSyncingFolder(currentLabel);
        triggerSync([activeAccountId]);
      }
      break;
    }
    case "action.createTaskFromEmail":
      if (selectedId) {
        window.dispatchEvent(new CustomEvent("velo-extract-task", { detail: { threadId: selectedId } }));
      }
      break;
  }
}

/**
 * Auto-advance to next/prev thread after an action removes the current one.
 */
function autoAdvance(removedThreadId: string): void {
  const { threads } = useThreadStore.getState();
  const idx = threads.findIndex((t) => t.id === removedThreadId);
  const next = threads[idx + 1] ?? threads[idx - 1] ?? null;
  if (next) navigateToThread(next.id);
  else navigateBack();
}
