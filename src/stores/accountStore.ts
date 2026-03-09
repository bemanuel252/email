import { create } from "zustand";
import { setSetting } from "../services/db/settings";

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  provider?: string;
}

interface AccountState {
  accounts: Account[];
  activeAccountId: string | null;
  setAccounts: (accounts: Account[], restoredId?: string | null) => void;
  setActiveAccount: (id: string | null) => void;
  setAllAccounts: () => void;
  addAccount: (account: Account) => void;
  removeAccount: (id: string) => void;
}

export const useAccountStore = create<AccountState>((set) => ({
  accounts: [],
  activeAccountId: null,

  setAccounts: (accounts, restoredId) => {
    const activeId = (restoredId && accounts.some((a) => a.id === restoredId))
      ? restoredId
      : accounts[0]?.id ?? null;
    set({ accounts, activeAccountId: activeId });
  },

  setActiveAccount: (id) => {
    if (id !== null) {
      setSetting("active_account_id", id).catch(() => {});
    }
    set({ activeAccountId: id });
  },

  setAllAccounts: () => set({ activeAccountId: null }),

  addAccount: (account) =>
    set((state) => ({
      accounts: [...state.accounts, account],
      activeAccountId: state.activeAccountId ?? account.id,
    })),

  removeAccount: (id) =>
    set((state) => {
      const accounts = state.accounts.filter((a) => a.id !== id);
      return {
        accounts,
        activeAccountId:
          state.activeAccountId === id
            ? (accounts[0]?.id ?? null)
            : state.activeAccountId,
      };
    }),
}));

/**
 * Returns account IDs to use for thread queries.
 * null activeAccountId = combined inbox = all active accounts.
 * string activeAccountId = single account.
 */
export const useActiveAccountIds = (): string[] =>
  useAccountStore((s) =>
    s.activeAccountId
      ? [s.activeAccountId]
      : s.accounts.filter((a) => a.isActive).map((a) => a.id),
  );

/**
 * Returns true if we're in combined inbox mode (showing all accounts).
 */
export const useIsCombinedInbox = (): boolean =>
  useAccountStore((s) => s.activeAccountId === null && s.accounts.length > 1);

/**
 * Type guard: ensure we never accidentally query without account context.
 * Use this at query callsites: if (!accountIds.length) return [];
 */
export function assertAccountIds(ids: string[], context: string): void {
  if (ids.length === 0) {
    console.warn(`[${context}] No account IDs available — query skipped`);
  }
}
