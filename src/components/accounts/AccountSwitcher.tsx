import { useState, useRef, useCallback } from "react";
import { useAccountStore, type Account } from "@/stores/accountStore";
import { Plus, Layers, UserPlus, Calendar, Check } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";

interface AccountSwitcherProps {
  collapsed: boolean;
  onAddAccount: () => void;
}

const MAX_INLINE = 4; // max account pills shown inline before overflow

/** Single account pill button */
function AccountPill({
  account,
  isActive,
  onClick,
}: {
  account: Account;
  isActive: boolean;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const initial = (account.displayName?.[0] ?? account.email[0] ?? "?").toUpperCase();
  const showImg = account.avatarUrl && !imgError;
  const label = account.displayName || account.email.split("@")[0];

  return (
    <button
      onClick={onClick}
      title={`${label} — ${account.email}`}
      className={`relative w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-[0.7rem] font-semibold shrink-0 transition-all duration-150 ${
        isActive
          ? "ring-2 ring-accent ring-offset-1 ring-offset-sidebar"
          : "opacity-60 hover:opacity-100"
      }`}
      style={{ background: isActive ? undefined : undefined }}
    >
      {showImg ? (
        <img
          src={account.avatarUrl!}
          alt={account.email}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center ${isActive ? "bg-accent text-white" : "bg-accent/25 text-accent"}`}>
          {initial}
        </div>
      )}
      {account.provider === "caldav" && (
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-sidebar rounded-full flex items-center justify-center">
          <Calendar size={7} className="text-text-tertiary" />
        </div>
      )}
    </button>
  );
}

export function AccountSwitcher({ collapsed, onAddAccount }: AccountSwitcherProps) {
  const { accounts, activeAccountId, setActiveAccount, setAllAccounts } = useAccountStore();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(overflowRef, () => setOverflowOpen(false));

  const isAllAccounts = activeAccountId === null && accounts.length > 1;
  const visibleAccounts = accounts.slice(0, MAX_INLINE);
  const overflowAccounts = accounts.slice(MAX_INLINE);
  const hasOverflow = overflowAccounts.length > 0;

  const handleSwitch = useCallback(
    (id: string) => {
      setActiveAccount(id);
      setOverflowOpen(false);
    },
    [setActiveAccount],
  );

  const handleAllAccounts = useCallback(() => {
    setAllAccounts();
    setOverflowOpen(false);
  }, [setAllAccounts]);

  // No accounts — prompt to add
  if (accounts.length === 0) {
    return (
      <div className="px-2 py-1.5">
        <button
          onClick={onAddAccount}
          className={`flex items-center w-full rounded-lg p-2 text-sm text-sidebar-text/70 hover:bg-sidebar-hover hover:text-sidebar-text transition-colors ${
            collapsed ? "justify-center" : "gap-3"
          }`}
        >
          <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            <UserPlus size={14} className="text-accent" />
          </div>
          {!collapsed && <span className="font-medium text-sm">Add Account</span>}
        </button>
      </div>
    );
  }

  // Collapsed sidebar — just show active account avatar
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-2 py-2">
        {isAllAccounts ? (
          <button
            onClick={() => accounts[0] && handleSwitch(accounts[0].id)}
            title="All accounts"
            className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center"
          >
            <Layers size={13} className="text-accent" />
          </button>
        ) : (
          accounts.slice(0, 1).map((a) => (
            <AccountPill
              key={a.id}
              account={a}
              isActive={a.id === activeAccountId}
              onClick={() => handleSwitch(a.id)}
            />
          ))
        )}
      </div>
    );
  }

  // Expanded sidebar — pill row
  return (
    <div className="relative px-3 py-2" ref={overflowRef}>
      <div className="flex items-center gap-1.5">

        {/* All Accounts pill — only when multiple accounts */}
        {accounts.length > 1 && (
          <button
            onClick={handleAllAccounts}
            title="All accounts — combined inbox"
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-150 ${
              isAllAccounts
                ? "bg-accent text-white ring-2 ring-accent ring-offset-1 ring-offset-sidebar"
                : "bg-accent/15 text-accent opacity-60 hover:opacity-100"
            }`}
          >
            <Layers size={13} />
          </button>
        )}

        {/* Account pills */}
        {visibleAccounts.map((account) => (
          <AccountPill
            key={account.id}
            account={account}
            isActive={account.id === activeAccountId}
            onClick={() => handleSwitch(account.id)}
          />
        ))}

        {/* Overflow button */}
        {hasOverflow && (
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            className={`w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center text-[0.65rem] font-semibold text-text-secondary hover:bg-bg-hover transition-colors shrink-0 ${
              overflowOpen ? "bg-bg-hover" : ""
            }`}
            title={`${overflowAccounts.length} more accounts`}
          >
            +{overflowAccounts.length}
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Add account */}
        <button
          onClick={onAddAccount}
          title="Add account"
          className="w-7 h-7 rounded-full bg-bg-tertiary/60 flex items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors shrink-0"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Overflow dropdown */}
      {overflowOpen && hasOverflow && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-bg-primary border border-border-primary rounded-xl shadow-lg overflow-hidden py-1">
          {overflowAccounts.map((account) => {
            const isActive = account.id === activeAccountId;
            return (
              <button
                key={account.id}
                onClick={() => handleSwitch(account.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
                  isActive ? "bg-accent/8 text-accent" : "text-text-primary hover:bg-bg-hover"
                }`}
              >
                <AccountPillSmall account={account} isActive={isActive} />
                <div className="flex-1 min-w-0">
                  <div className="text-[0.8125rem] font-medium truncate leading-tight">
                    {account.displayName || account.email.split("@")[0]}
                  </div>
                  <div className="text-xs text-text-tertiary truncate leading-tight">
                    {account.email}
                  </div>
                </div>
                {isActive && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccountPillSmall({ account, isActive }: { account: Account; isActive: boolean }) {
  const [imgError, setImgError] = useState(false);
  const initial = (account.displayName?.[0] ?? account.email[0] ?? "?").toUpperCase();
  const showImg = account.avatarUrl && !imgError;

  return (
    <div
      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[0.65rem] font-semibold overflow-hidden ${
        isActive ? "bg-accent text-white" : "bg-accent/15 text-accent"
      }`}
    >
      {showImg ? (
        <img
          src={account.avatarUrl!}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : initial}
    </div>
  );
}
