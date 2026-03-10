import { useState, useCallback } from "react";
import { Sparkles, X, Check, ChevronDown, ChevronRight, AlertCircle, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { useInboxSplitsStore } from "@/stores/inboxSplitsStore";
import { useAccountStore } from "@/stores/accountStore";
import {
  suggestSplitsForInbox,
  type AiSuggestedSplit,
  type AiSuggestedRule,
} from "@/services/splits/aiSplitAnalyzer";
import type { InboxSplitRule } from "@/services/db/inboxSplits";
import { RULE_TYPE_LABELS } from "@/services/splits/splitRuleEngine";

type WizardState = "idle" | "analyzing" | "results" | "saving" | "done" | "error";

interface WizardProps {
  onClose: () => void;
}

function RulePill({ rule }: { rule: AiSuggestedRule }) {
  const label = RULE_TYPE_LABELS[rule.ruleType] ?? rule.ruleType;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-tertiary border border-border-secondary rounded-full text-[0.65rem] text-text-secondary">
      <span className="text-text-tertiary">{label}:</span>
      <span className="font-medium text-text-primary truncate max-w-[120px]">
        {rule.ruleValue ?? "✓"}
      </span>
    </span>
  );
}

function SuggestionCard({
  split,
  isSelected,
  onToggle,
}: {
  split: AiSuggestedSplit;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`relative rounded-xl border-2 transition-all duration-200 cursor-pointer select-none ${
        isSelected
          ? "border-accent bg-accent/5 shadow-sm"
          : "border-border-primary bg-bg-primary hover:border-border-hover"
      }`}
      onClick={onToggle}
    >
      <div
        className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          isSelected ? "bg-accent border-accent" : "border-border-primary bg-bg-secondary"
        }`}
      >
        {isSelected && <Check size={11} strokeWidth={3} className="text-white" />}
      </div>

      <div className="p-4 pr-10">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="text-2xl leading-none">{split.icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{split.name}</h3>
            {split.isCatchAll && (
              <span className="text-[0.65rem] text-text-tertiary">Catch-all tab</span>
            )}
          </div>
        </div>

        <p className="text-xs text-text-secondary mb-2.5 leading-relaxed">{split.description}</p>

        {!split.isCatchAll && split.rules.length > 0 && (
          <div>
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="flex items-center gap-1 text-[0.65rem] text-text-tertiary hover:text-text-secondary transition-colors mb-1.5"
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {split.rules.length} rule{split.rules.length !== 1 ? "s" : ""}
            </button>
            {expanded && (
              <div className="flex flex-wrap gap-1">
                {split.rules.map((r, i) => (
                  <RulePill key={i} rule={r} />
                ))}
              </div>
            )}
            {!expanded && split.exampleMatches?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {split.exampleMatches.slice(0, 4).map((ex, i) => (
                  <span key={i} className="text-[0.65rem] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">
                    {ex}
                  </span>
                ))}
                {split.exampleMatches.length > 4 && (
                  <span className="text-[0.65rem] text-text-tertiary">+{split.exampleMatches.length - 4} more</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const PROGRESS_MESSAGES = [
  "Reading your inbox...",
  "Identifying sender patterns...",
  "Grouping related senders...",
  "Generating tab suggestions...",
  "Polishing recommendations...",
];

export function AiSplitSetupWizard({ onClose }: WizardProps) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const splitsStore = useInboxSplitsStore();

  const existingSplitCount = splitsStore.splits.length;
  const hasExistingSplits = existingSplitCount > 0;

  const [state, setState] = useState<WizardState>("idle");
  const [suggestions, setSuggestions] = useState<AiSuggestedSplit[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progressMsg, setProgressMsg] = useState(PROGRESS_MESSAGES[0]);
  const [errorMsg, setErrorMsg] = useState("");

  const runAnalysis = useCallback(async () => {
    if (!activeAccountId) return;
    setState("analyzing");
    setErrorMsg("");

    let msgIdx = 0;
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % PROGRESS_MESSAGES.length;
      setProgressMsg(PROGRESS_MESSAGES[msgIdx]);
    }, 1800);

    try {
      const results = await suggestSplitsForInbox(activeAccountId, (msg) => setProgressMsg(msg));
      clearInterval(interval);
      setSuggestions(results);
      setSelected(new Set(results.map((_, i) => i)));
      setState("results");
    } catch (err) {
      clearInterval(interval);
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("error");
    }
  }, [activeAccountId]);

  const handleApply = useCallback(async () => {
    if (!activeAccountId || selected.size === 0) return;
    setState("saving");

    try {
      // Always replace existing splits for this account — no duplicates
      await splitsStore.clearAllSplits(activeAccountId);

      const toCreate = suggestions.filter((_, i) => selected.has(i));

      for (let i = 0; i < toCreate.length; i++) {
        const s = toCreate[i]!;
        const splitId = crypto.randomUUID();

        const rules: InboxSplitRule[] = (s.rules ?? []).map((r, ri): InboxSplitRule => ({
          id: crypto.randomUUID(),
          splitId,
          accountId: activeAccountId,
          ruleType: r.ruleType,
          ruleValue: r.ruleValue,
          position: ri,
        }));

        await splitsStore.saveSplit(
          {
            id: splitId,
            accountId: activeAccountId,
            name: s.name,
            icon: s.icon ?? null,
            color: null,
            position: i,
            isEnabled: true,
            ruleOperator: s.ruleOperator ?? "OR",
            isCatchAll: s.isCatchAll ?? false,
            aiDescription: s.description ?? null,
            aiClassificationEnabled: false,
          },
          rules,
          activeAccountId,
        );
      }

      await splitsStore.refreshUnreadCounts(activeAccountId);
      setState("done");
    } catch {
      setState("error");
      setErrorMsg("Failed to save splits. Please try again.");
    }
  }, [activeAccountId, selected, suggestions, splitsStore]);

  const toggleAll = () => {
    if (selected.size === suggestions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(suggestions.map((_, i) => i)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative bg-bg-primary border border-border-primary rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border-secondary shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <Sparkles size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">AI Inbox Setup</h2>
              <p className="text-xs text-text-tertiary">Analyzes your inbox and builds smart tabs automatically</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Idle ── */}
          {state === "idle" && (
            <div className="flex flex-col items-center justify-center py-12 px-8 text-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-accent/10 flex items-center justify-center">
                <Sparkles size={36} className="text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">Set up your inbox with AI</h3>
                <p className="text-sm text-text-secondary leading-relaxed max-w-md">
                  AI will scan your recent emails, identify patterns across senders and topics,
                  and create personalized inbox tabs — ready to use in seconds.
                </p>
              </div>

              {/* Warning if splits already exist */}
              {hasExistingSplits && (
                <div className="flex items-start gap-3 w-full max-w-md bg-warning/8 border border-warning/20 rounded-xl px-4 py-3 text-left">
                  <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary leading-relaxed">
                    You already have <strong className="text-text-primary">{existingSplitCount} split{existingSplitCount !== 1 ? "s" : ""}</strong> set up.
                    Running AI analysis will <strong className="text-text-primary">replace</strong> them with new suggestions.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 w-full max-w-sm text-left">
                {[
                  { icon: "🔍", label: "Analyzes your senders" },
                  { icon: "🧠", label: "Groups related emails" },
                  { icon: "✨", label: "Builds smart tabs" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-1.5 p-3 bg-bg-secondary rounded-xl">
                    <span className="text-xl">{item.icon}</span>
                    <span className="text-[0.7rem] text-text-secondary text-center font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Analyzing ── */}
          {state === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-full border-4 border-accent/20 border-t-accent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles size={22} className="text-accent" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary mb-1 transition-all">{progressMsg}</p>
                <p className="text-xs text-text-tertiary">This takes about 10–20 seconds</p>
              </div>
              <div className="flex gap-1">
                {PROGRESS_MESSAGES.map((_, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      progressMsg === PROGRESS_MESSAGES[i] ? "bg-accent" : "bg-border-primary"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {state === "results" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {suggestions.length} tabs suggested for your inbox
                  </h3>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {hasExistingSplits
                      ? `Select tabs to create — your ${existingSplitCount} existing splits will be replaced.`
                      : "Select the ones you want to add. You can edit them any time."}
                  </p>
                </div>
                <button
                  onClick={toggleAll}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {selected.size === suggestions.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {suggestions.map((split, i) => (
                  <SuggestionCard
                    key={i}
                    split={split}
                    isSelected={selected.has(i)}
                    onToggle={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Saving ── */}
          {state === "saving" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 size={32} className="text-accent animate-spin" />
              <p className="text-sm text-text-secondary">Setting up your inbox splits...</p>
            </div>
          )}

          {/* ── Done ── */}
          {state === "done" && (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-5">
              <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                <Check size={28} className="text-green-500" strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary mb-1">
                  {selected.size} tab{selected.size !== 1 ? "s" : ""} created
                </h3>
                <p className="text-sm text-text-secondary">
                  Your inbox is now organized. Head to the inbox to see your new tabs.
                </p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {state === "error" && (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-5">
              <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center">
                <AlertCircle size={26} className="text-error" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">Analysis failed</h3>
                <p className="text-xs text-text-secondary max-w-sm">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-secondary flex items-center justify-between shrink-0">
          {state === "results" && (
            <p className="text-xs text-text-tertiary">
              {selected.size} of {suggestions.length} selected
            </p>
          )}
          {(state === "idle" || state === "error" || state === "analyzing" || state === "saving" || state === "done") && <div />}

          <div className="flex items-center gap-2 ml-auto">
            {state === "done" && (
              <button
                onClick={onClose}
                className="px-5 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
              >
                Done
              </button>
            )}
            {state === "idle" && (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors rounded-lg">
                  Cancel
                </button>
                <button
                  onClick={runAnalysis}
                  className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
                >
                  <Sparkles size={15} />
                  {hasExistingSplits ? "Re-analyze inbox" : "Analyze my inbox"}
                </button>
              </>
            )}
            {state === "error" && (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors rounded-lg">
                  Cancel
                </button>
                <button
                  onClick={runAnalysis}
                  className="flex items-center gap-2 px-5 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors"
                >
                  <RefreshCw size={14} />
                  Try again
                </button>
              </>
            )}
            {state === "results" && (
              <>
                <button
                  onClick={runAnalysis}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors rounded-lg"
                >
                  <RefreshCw size={13} />
                  Regenerate
                </button>
                <button
                  onClick={handleApply}
                  disabled={selected.size === 0}
                  className="px-5 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {hasExistingSplits ? `Replace with ${selected.size} tab${selected.size !== 1 ? "s" : ""}` : `Add ${selected.size} tab${selected.size !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
