import { create } from "zustand";
import {
  getSplitsForAccount,
  upsertSplit,
  deleteSplit,
  clearAllSplitsForAccount,
  replaceSplitRules,
  reorderSplits,
  seedDefaultSplits,
  getSplitUnreadCount,
  type InboxSplit,
  type InboxSplitRule,
} from "@/services/db/inboxSplits";

interface InboxSplitsState {
  splits: InboxSplit[];
  unreadCounts: Record<string, number>;
  isLoaded: boolean;

  /** Load splits for an account. Seeds defaults if none exist. */
  loadSplits: (accountId: string, seedIfEmpty?: boolean) => Promise<void>;

  /** Persist a split (create or update). Re-fetches splits after. */
  saveSplit: (split: Omit<InboxSplit, "rules" | "createdAt" | "updatedAt">, rules: InboxSplitRule[], accountId: string) => Promise<void>;

  /** Delete a split. */
  removeSplit: (splitId: string, accountId: string) => Promise<void>;

  /** Reorder splits by providing the new ordered list of IDs. */
  moveSplit: (accountId: string, splitIds: string[]) => Promise<void>;

  /** Refresh unread counts for all splits. */
  refreshUnreadCounts: (accountId: string) => Promise<void>;

  /** Delete all splits for an account (used by AI wizard to replace). */
  clearAllSplits: (accountId: string) => Promise<void>;
}

export const useInboxSplitsStore = create<InboxSplitsState>((set, get) => ({
  splits: [],
  unreadCounts: {},
  isLoaded: false,

  loadSplits: async (accountId, seedIfEmpty = false) => {
    if (seedIfEmpty) {
      await seedDefaultSplits(accountId);
    }
    const splits = await getSplitsForAccount(accountId);
    set({ splits, isLoaded: true });
  },

  saveSplit: async (split, rules, accountId) => {
    await upsertSplit(split);
    await replaceSplitRules(split.id, accountId, rules);
    const splits = await getSplitsForAccount(accountId);
    set({ splits });
  },

  removeSplit: async (splitId, accountId) => {
    await deleteSplit(splitId, accountId);
    set((s) => ({ splits: s.splits.filter((sp) => sp.id !== splitId) }));
  },

  moveSplit: async (accountId, splitIds) => {
    await reorderSplits(accountId, splitIds);
    // Reorder in local state immediately for responsiveness
    set((s) => {
      const byId = new Map(s.splits.map((sp) => [sp.id, sp]));
      const reordered = splitIds
        .map((id, i) => {
          const sp = byId.get(id);
          return sp ? { ...sp, position: i } : null;
        })
        .filter((sp): sp is InboxSplit => sp !== null);
      return { splits: reordered };
    });
  },

  clearAllSplits: async (accountId) => {
    await clearAllSplitsForAccount(accountId);
    set({ splits: [] });
  },

  refreshUnreadCounts: async (accountId) => {
    const { splits } = get();
    const otherSplits = splits.filter((s) => s.isEnabled);
    const entries = await Promise.all(
      splits
        .filter((s) => s.isEnabled)
        .map(async (split) => {
          const count = await getSplitUnreadCount(accountId, split, otherSplits).catch(() => 0);
          return [split.id, count] as const;
        }),
    );
    set({ unreadCounts: Object.fromEntries(entries) });
  },
}));
