import { useState, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, GripVertical, ChevronDown, ChevronRight, X,
  Sparkles, Loader2, Bot, Info,
} from "lucide-react";
import { useInboxSplitsStore } from "@/stores/inboxSplitsStore";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import type { InboxSplit, InboxSplitRule } from "@/services/db/inboxSplits";
import { getLabelsForAccount, type DbLabel } from "@/services/db/labels";
import { getDistinctCrmTags } from "@/services/db/contacts";
import {
  RULE_TYPE_LABELS,
  RULE_TYPE_HAS_VALUE,
  RULE_TYPE_PLACEHOLDER,
  type RuleType,
} from "@/services/splits/splitRuleEngine";
import {
  naturalLanguageToRules,
  classifyThreadsForSplits,
  saveAiClassifications,
  clearAiClassificationsForSplit,
  getUnassignedInboxThreads,
  getInboxSenderPatterns,
} from "@/services/splits/aiSplitAnalyzer";
import { AiSplitSetupWizard } from "./AiSplitSetupWizard";

const ALL_RULE_TYPES: RuleType[] = [
  "from_domain",
  "from_address",
  "from_name_contains",
  "subject_contains",
  "has_label",
  "contact_tag",
  "to_address",
  "is_unread",
  "is_starred",
  "has_attachment",
  "list_unsubscribe",
];

const SPLIT_ICONS = ["📥", "⭐", "📰", "💼", "🔔", "📦", "👤", "🏷️", "📎", "🗓️", "💬", "🔗", "📊", "🛒", "✈️", "🎯", "🤖", "💡", "🔥", "🌐"];

interface RuleFormItem {
  id: string;
  ruleType: RuleType;
  ruleValue: string;
}

interface SplitFormState {
  id: string | null;
  name: string;
  icon: string;
  ruleOperator: "AND" | "OR";
  isCatchAll: boolean;
  aiDescription: string;
  aiClassificationEnabled: boolean;
  rules: RuleFormItem[];
}

function newRuleForm(): RuleFormItem {
  return { id: crypto.randomUUID(), ruleType: "from_domain", ruleValue: "" };
}

/** Hoisted to module scope so SortableSplitRow can reference it. */
function splitToForm(split: InboxSplit): SplitFormState {
  return {
    id: split.id,
    name: split.name,
    icon: split.icon ?? "📥",
    ruleOperator: split.ruleOperator,
    isCatchAll: split.isCatchAll,
    aiDescription: split.aiDescription ?? "",
    aiClassificationEnabled: split.aiClassificationEnabled,
    rules: split.rules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType,
      ruleValue: r.ruleValue ?? "",
    })),
  };
}

// ─── Natural Language Rule Builder ────────────────────────────────────────────

function NlRuleBuilder({
  onRulesGenerated,
  topDomains,
}: {
  onRulesGenerated: (rules: RuleFormItem[]) => void;
  topDomains: string[];
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = useCallback(async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    try {
      const aiRules = await naturalLanguageToRules(input.trim(), { topDomains });
      const items: RuleFormItem[] = aiRules.map((r) => ({
        id: crypto.randomUUID(),
        ruleType: r.ruleType,
        ruleValue: r.ruleValue ?? "",
      }));
      onRulesGenerated(items);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate rules");
    } finally {
      setLoading(false);
    }
  }, [input, topDomains, onRulesGenerated]);

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles size={12} className="text-accent" />
        <span className="text-xs font-medium text-accent">Describe with AI</span>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          placeholder='e.g. "emails from my bank" or "GitHub notifications"'
          className="flex-1 bg-bg-primary border border-border-primary rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={handleGenerate}
          disabled={!input.trim() || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {loading ? "Thinking..." : "Build rules"}
        </button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

// ─── Single Split Editor Form ──────────────────────────────────────────────────

function SplitEditor({
  initial,
  topDomains,
  labels,
  contactTags,
  onSave,
  onCancel,
}: {
  initial: SplitFormState;
  topDomains: string[];
  labels: DbLabel[];
  contactTags: string[];
  onSave: (form: SplitFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SplitFormState>(initial);
  const [showNlBuilder, setShowNlBuilder] = useState(false);

  const setField = <K extends keyof SplitFormState>(key: K, val: SplitFormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const updateRule = (id: string, patch: Partial<RuleFormItem>) =>
    setForm((f) => ({ ...f, rules: f.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const removeRule = (id: string) =>
    setForm((f) => ({ ...f, rules: f.rules.filter((r) => r.id !== id) }));

  const addRulesFromNl = (rules: RuleFormItem[]) => {
    setForm((f) => ({ ...f, rules: [...f.rules, ...rules] }));
    setShowNlBuilder(false);
  };

  const isValid = form.name.trim() !== "" && (form.isCatchAll || form.rules.length > 0 || form.aiClassificationEnabled);

  return (
    <div className="p-4 space-y-3.5">
      {/* Name + Icon */}
      <div className="flex items-center gap-2.5">
        <select
          value={form.icon}
          onChange={(e) => setField("icon", e.target.value)}
          className="text-lg bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 cursor-pointer shrink-0"
        >
          {SPLIT_ICONS.map((ic) => (
            <option key={ic} value={ic}>{ic}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Tab name"
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          className="flex-1 bg-bg-tertiary border border-border-primary rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* AI Description */}
      <div>
        <label className="block text-xs text-text-tertiary mb-1">
          AI description <span className="text-text-quaternary">(helps AI classify emails into this tab)</span>
        </label>
        <input
          type="text"
          value={form.aiDescription}
          onChange={(e) => setField("aiDescription", e.target.value)}
          placeholder='e.g. "Work notifications from project management tools"'
          className="w-full bg-bg-tertiary border border-border-primary rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Catch-all toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.isCatchAll}
          onChange={(e) => setField("isCatchAll", e.target.checked)}
          className="w-4 h-4 accent-accent rounded"
        />
        <span className="text-sm text-text-secondary">Catch-all (shows everything not matched elsewhere)</span>
      </label>

      {/* AI Classification toggle */}
      <label className="flex items-start gap-2.5 cursor-pointer select-none p-2.5 rounded-lg border border-accent/20 bg-accent/5">
        <input
          type="checkbox"
          checked={form.aiClassificationEnabled}
          onChange={(e) => setField("aiClassificationEnabled", e.target.checked)}
          className="w-4 h-4 accent-accent rounded mt-0.5"
        />
        <div>
          <div className="flex items-center gap-1.5">
            <Bot size={13} className="text-accent" />
            <span className="text-sm font-medium text-text-primary">AI classification</span>
          </div>
          <p className="text-xs text-text-tertiary mt-0.5">
            AI assigns emails to this tab even when they don't match specific rules
          </p>
        </div>
      </label>

      {/* Rules section */}
      {!form.isCatchAll && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Filter rules</span>
            <div className="flex items-center gap-2">
              {form.rules.length > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-text-tertiary">Match</span>
                  <select
                    value={form.ruleOperator}
                    onChange={(e) => setField("ruleOperator", e.target.value as "AND" | "OR")}
                    className="text-xs bg-bg-tertiary border border-border-primary rounded px-1.5 py-0.5"
                  >
                    <option value="OR">ANY rule</option>
                    <option value="AND">ALL rules</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {form.rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2">
                <select
                  value={rule.ruleType}
                  onChange={(e) => updateRule(rule.id, { ruleType: e.target.value as RuleType, ruleValue: "" })}
                  className="text-xs bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 shrink-0"
                >
                  {ALL_RULE_TYPES.map((rt) => (
                    <option key={rt} value={rt}>{RULE_TYPE_LABELS[rt]}</option>
                  ))}
                </select>

                {RULE_TYPE_HAS_VALUE[rule.ruleType] ? (
                  rule.ruleType === "has_label" && labels.length > 0 ? (
                    <select
                      value={rule.ruleValue}
                      onChange={(e) => updateRule(rule.id, { ruleValue: e.target.value })}
                      className="flex-1 bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">Select label…</option>
                      {labels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : rule.ruleType === "contact_tag" ? (
                    <>
                      <input
                        type="text"
                        list={`ctags-${rule.id}`}
                        value={rule.ruleValue}
                        onChange={(e) => updateRule(rule.id, { ruleValue: e.target.value })}
                        placeholder={contactTags.length > 0 ? "Type or choose a tag…" : "e.g. active client"}
                        className="flex-1 bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      {contactTags.length > 0 && (
                        <datalist id={`ctags-${rule.id}`}>
                          {contactTags.map((t) => <option key={t} value={t} />)}
                        </datalist>
                      )}
                    </>
                  ) : (
                    <input
                      type="text"
                      value={rule.ruleValue}
                      onChange={(e) => updateRule(rule.id, { ruleValue: e.target.value })}
                      placeholder={RULE_TYPE_PLACEHOLDER[rule.ruleType]}
                      className="flex-1 bg-bg-tertiary border border-border-primary rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  )
                ) : (
                  <span className="flex-1 text-xs text-text-tertiary italic">No value needed</span>
                )}

                <button
                  onClick={() => removeRule(rule.id)}
                  className="p-1 text-text-tertiary hover:text-error transition-colors rounded shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* NL builder */}
          {showNlBuilder ? (
            <NlRuleBuilder onRulesGenerated={addRulesFromNl} topDomains={topDomains} />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, rules: [...f.rules, newRuleForm()] }))}
                className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <Plus size={13} />
                Add rule
              </button>
              <span className="text-text-quaternary text-xs">·</span>
              <button
                onClick={() => setShowNlBuilder(true)}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                <Sparkles size={12} />
                Describe with AI
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-secondary">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded"
        >
          Cancel
        </button>
        <button
          onClick={() => isValid && onSave(form)}
          disabled={!isValid}
          className="px-4 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          Save tab
        </button>
      </div>
    </div>
  );
}

// ─── AI Classify Button ────────────────────────────────────────────────────────

function AiClassifyButton({ accountId }: { accountId: string }) {
  const splitsStore = useInboxSplitsStore();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [count, setCount] = useState(0);

  const run = useCallback(async () => {
    setStatus("running");
    try {
      const enabledSplits = splitsStore.splits.filter((s) => s.isEnabled && !s.isCatchAll);
      if (enabledSplits.length === 0) { setStatus("idle"); return; }

      const unassigned = await getUnassignedInboxThreads(accountId, 150);
      if (unassigned.length === 0) { setStatus("done"); setCount(0); return; }

      const splitsForAi = enabledSplits.map((s) => ({
        id: s.id,
        name: s.name,
        aiDescription: s.aiDescription,
      }));

      const assignments = await classifyThreadsForSplits(unassigned, splitsForAi);
      await saveAiClassifications(accountId, assignments);
      await splitsStore.refreshUnreadCounts(accountId);
      setCount(assignments.size);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, [accountId, splitsStore]);

  return (
    <button
      onClick={run}
      disabled={status === "running"}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        status === "done"
          ? "border-green-500/30 bg-green-500/10 text-green-600"
          : status === "error"
          ? "border-error/30 bg-error/10 text-error"
          : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
      } disabled:opacity-50`}
    >
      {status === "running" ? (
        <><Loader2 size={12} className="animate-spin" /> Classifying...</>
      ) : status === "done" ? (
        <>✓ Classified {count} email{count !== 1 ? "s" : ""}</>
      ) : status === "error" ? (
        <>Failed — retry</>
      ) : (
        <><Bot size={12} /> Classify unmatched emails</>
      )}
    </button>
  );
}

// ─── Sortable Split Row ────────────────────────────────────────────────────────

function SortableSplitRow({
  split,
  isExpanded,
  topDomains,
  labels,
  contactTags,
  onExpand,
  onDelete,
  onToggleEnabled,
  onSave,
  onCancel,
}: {
  split: InboxSplit;
  isExpanded: boolean;
  topDomains: string[];
  labels: DbLabel[];
  contactTags: string[];
  onExpand: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onSave: (form: SplitFormState) => void;
  onCancel: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: split.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border rounded-xl border-border-primary bg-bg-primary"
    >
      {isExpanded ? (
        <SplitEditor
          initial={splitToForm(split)}
          topDomains={topDomains}
          labels={labels}
          contactTags={contactTags}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5">
          <GripVertical
            size={14}
            className="text-text-tertiary cursor-grab shrink-0 touch-none"
            {...attributes}
            {...listeners}
          />
          <span className="text-base leading-none shrink-0">{split.icon ?? "📥"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary truncate">{split.name}</span>
              {split.isCatchAll && (
                <span className="text-[0.6rem] text-text-tertiary border border-border-secondary rounded px-1 py-0.5">catch-all</span>
              )}
              {split.aiClassificationEnabled && (
                <span title="AI classification enabled">
                  <Bot size={11} className="text-accent shrink-0" />
                </span>
              )}
            </div>
            {!split.isCatchAll && (
              <p className="text-xs text-text-tertiary mt-0.5 truncate">
                {split.rules.length} rule{split.rules.length !== 1 ? "s" : ""}
                {split.rules.length > 1 && ` · ${split.ruleOperator}`}
                {split.aiDescription && ` · ${split.aiDescription}`}
              </p>
            )}
          </div>

          {/* Enabled toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
            title={split.isEnabled ? "Disable tab" : "Enable tab"}
            className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
              split.isEnabled ? "bg-accent" : "bg-bg-tertiary border border-border-primary"
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                split.isEnabled ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>

          <button
            onClick={onExpand}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors rounded"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-text-tertiary hover:text-error transition-colors rounded"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Editor ───────────────────────────────────────────────────────────────

export function InboxSplitsEditor() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const splitsStore = useInboxSplitsStore();
  const { splits } = splitsStore;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [topDomains, setTopDomains] = useState<string[]>([]);
  const [labels, setLabels] = useState<DbLabel[]>([]);
  const [contactTags, setContactTags] = useState<string[]>([]);

  const sensors = useSensors(useSensor(PointerSensor));

  // Load top domains once for NL rule builder context
  const loadTopDomains = useCallback(async () => {
    if (!activeAccountId || topDomains.length > 0) return;
    try {
      const patterns = await getInboxSenderPatterns(activeAccountId);
      setTopDomains(patterns.slice(0, 30).map((p) => p.domain));
    } catch { /* ignore */ }
  }, [activeAccountId, topDomains.length]);

  // Load account labels for "has_label" rule autocomplete
  const loadLabels = useCallback(async () => {
    if (!activeAccountId || labels.length > 0) return;
    try {
      const result = await getLabelsForAccount(activeAccountId);
      setLabels(result);
    } catch { /* ignore */ }
  }, [activeAccountId, labels.length]);

  // Load CRM contact tags for "contact_tag" rule autocomplete
  const loadContactTags = useCallback(async () => {
    if (contactTags.length > 0) return;
    try {
      const tags = await getDistinctCrmTags();
      setContactTags(tags);
    } catch { /* ignore */ }
  }, [contactTags.length]);

  const loadContext = useCallback(() => {
    loadTopDomains();
    loadLabels();
    loadContactTags();
  }, [loadTopDomains, loadLabels, loadContactTags]);

  const handleSave = useCallback(
    async (form: SplitFormState) => {
      if (!activeAccountId) return;
      const splitId = form.id ?? crypto.randomUUID();
      const existing = splits.find((s) => s.id === splitId);

      await splitsStore.saveSplit(
        {
          id: splitId,
          accountId: activeAccountId,
          name: form.name.trim(),
          icon: form.icon || null,
          color: null,
          position: existing?.position ?? splits.length,
          isEnabled: existing?.isEnabled ?? true,
          ruleOperator: form.ruleOperator,
          isCatchAll: form.isCatchAll,
          aiDescription: form.aiDescription.trim() || null,
          aiClassificationEnabled: form.aiClassificationEnabled,
        },
        form.rules
          .filter((r) => r.ruleType && (RULE_TYPE_HAS_VALUE[r.ruleType] ? r.ruleValue.trim() : true))
          .map((r, i): InboxSplitRule => ({
            id: r.id,
            splitId,
            accountId: activeAccountId,
            ruleType: r.ruleType,
            ruleValue: RULE_TYPE_HAS_VALUE[r.ruleType] ? r.ruleValue.trim() : null,
            position: i,
          })),
        activeAccountId,
      );

      // If AI classification was disabled, clear old assignments
      if (!form.aiClassificationEnabled && existing?.aiClassificationEnabled) {
        await clearAiClassificationsForSplit(activeAccountId, splitId);
      }

      setExpandedId(null);
      setAddingNew(false);
      splitsStore.refreshUnreadCounts(activeAccountId);
    },
    [activeAccountId, splits, splitsStore],
  );

  const handleDelete = useCallback(
    async (splitId: string) => {
      if (!activeAccountId) return;
      await splitsStore.removeSplit(splitId, activeAccountId);
    },
    [activeAccountId, splitsStore],
  );

  const handleToggleEnabled = useCallback(
    async (split: InboxSplit) => {
      if (!activeAccountId) return;
      await splitsStore.saveSplit({ ...split, isEnabled: !split.isEnabled }, split.rules, activeAccountId);
    },
    [activeAccountId, splitsStore],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !activeAccountId) return;
      const ids = splits.map((s) => s.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(ids, oldIndex, newIndex);
      await splitsStore.moveSplit(activeAccountId, reordered);
    },
    [activeAccountId, splits, splitsStore],
  );

  if (!activeAccountId) {
    return <p className="text-sm text-text-tertiary">No account selected.</p>;
  }

  const isCustomSplitMode = inboxViewMode === "custom-split";

  return (
    <div className="space-y-3">
      {/* AI Setup + Classify bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover transition-colors shadow-sm"
        >
          <Sparkles size={13} />
          Set up with AI
        </button>
        {splits.length > 0 && <AiClassifyButton accountId={activeAccountId} />}
        {!isCustomSplitMode && splits.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-600">
            <Info size={12} />
            Switch to "Custom Splits" mode to see these tabs in your inbox
          </div>
        )}
      </div>

      {/* Split list */}
      {splits.length === 0 && !addingNew ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-tertiary mb-1">No tabs yet</p>
          <p className="text-xs text-text-quaternary">Use "Set up with AI" to get started instantly, or add tabs manually.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={splits.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {splits.map((split) => (
                <SortableSplitRow
                  key={split.id}
                  split={split}
                  isExpanded={expandedId === split.id}
                  topDomains={topDomains}
                  labels={labels}
                  contactTags={contactTags}
                  onExpand={() => { setExpandedId(split.id); loadContext(); }}
                  onDelete={() => handleDelete(split.id)}
                  onToggleEnabled={() => handleToggleEnabled(split)}
                  onSave={handleSave}
                  onCancel={() => setExpandedId(null)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add new form */}
      {addingNew && (
        <div className="border-2 border-dashed border-accent/30 rounded-xl bg-bg-primary">
          <SplitEditor
            initial={{
              id: null,
              name: "",
              icon: "📥",
              ruleOperator: "OR",
              isCatchAll: false,
              aiDescription: "",
              aiClassificationEnabled: false,
              rules: [newRuleForm()],
            }}
            topDomains={topDomains}
            labels={labels}
            contactTags={contactTags}
            onSave={handleSave}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      )}

      {!addingNew && (
        <button
          onClick={() => { setAddingNew(true); loadContext(); }}
          className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-text-tertiary hover:text-text-secondary border border-dashed border-border-primary hover:border-border-hover rounded-xl transition-colors"
        >
          <Plus size={14} />
          Add tab manually
        </button>
      )}

      <p className="text-xs text-text-tertiary pt-0.5">
        Drag the grip handle to reorder. Threads match the first tab whose rules they satisfy.
      </p>

      {/* AI Wizard Modal */}
      {showWizard && <AiSplitSetupWizard onClose={() => { setShowWizard(false); splitsStore.loadSplits(activeAccountId); }} />}
    </div>
  );
}
