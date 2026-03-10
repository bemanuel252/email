import { useState, useEffect, useCallback } from "react";
import { getDb } from "@/services/db/connection";
import { getActiveProvider } from "@/services/ai/providerManager";
import { useAccountStore } from "@/stores/accountStore";
import { Sparkles, Plus, Trash2, Check, Loader2, BookOpen } from "lucide-react";

interface WritingProfile {
  id: string;
  name: string;
  tone: "professional" | "casual" | "friendly" | "formal" | "concise";
  customInstructions: string;
  learnedStyle: string | null;
  isDefault: boolean;
}

interface BrandGuidelines {
  companyName: string;
  voiceDescription: string;
  dos: string;
  donts: string;
}

const TONES = [
  { id: "professional", label: "Professional" },
  { id: "casual", label: "Casual" },
  { id: "friendly", label: "Friendly" },
  { id: "formal", label: "Formal" },
  { id: "concise", label: "Concise" },
] as const;

export function WritingSettings() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const [profiles, setProfiles] = useState<WritingProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<Partial<WritingProfile>>({});
  const [brand, setBrand] = useState<BrandGuidelines>({
    companyName: "",
    voiceDescription: "",
    dos: "",
    donts: "",
  });
  const [learning, setLearning] = useState(false);
  const [learnDone, setLearnDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);

  const loadProfiles = useCallback(async () => {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      name: string;
      tone: string;
      custom_instructions: string | null;
      learned_style: string | null;
      is_default: number;
    }[]>(
      "SELECT * FROM writing_profiles WHERE account_id = ? ORDER BY created_at ASC",
      [activeAccountId ?? ""],
    );
    setProfiles(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        tone: r.tone as WritingProfile["tone"],
        customInstructions: r.custom_instructions ?? "",
        learnedStyle: r.learned_style,
        isDefault: r.is_default === 1,
      })),
    );
  }, [activeAccountId]);

  const loadBrand = useCallback(async () => {
    const db = await getDb();
    const rows = await db.select<{
      company_name: string | null;
      voice_description: string | null;
      dos: string | null;
      donts: string | null;
    }[]>("SELECT company_name, voice_description, dos, donts FROM brand_guidelines WHERE id = 'default'");
    const row = rows[0];
    if (row) {
      setBrand({
        companyName: row.company_name ?? "",
        voiceDescription: row.voice_description ?? "",
        dos: row.dos ?? "",
        donts: row.donts ?? "",
      });
    }
  }, []);

  useEffect(() => {
    loadBrand();
  }, [loadBrand]);

  useEffect(() => {
    loadProfiles();
  }, [activeAccountId, loadProfiles]);

  const handleNewProfile = useCallback(async () => {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT INTO writing_profiles (id, name, tone, account_id) VALUES (?, ?, ?, ?)",
      [id, "New Profile", "professional", activeAccountId ?? null],
    );
    await loadProfiles();
    setSelectedProfileId(id);
    setEditingProfile({ name: "New Profile", tone: "professional", customInstructions: "" });
  }, [loadProfiles, activeAccountId]);

  const handleSaveProfile = useCallback(async () => {
    if (!selectedProfileId) return;
    setSaving(true);
    try {
      const db = await getDb();
      await db.execute(
        "UPDATE writing_profiles SET name = ?, tone = ?, custom_instructions = ?, updated_at = unixepoch() WHERE id = ?",
        [editingProfile.name ?? "", editingProfile.tone ?? "professional", editingProfile.customInstructions ?? "", selectedProfileId],
      );
      await loadProfiles();
    } finally {
      setSaving(false);
    }
  }, [selectedProfileId, editingProfile, loadProfiles]);

  const handleDeleteProfile = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM writing_profiles WHERE id = ?", [id]);
    if (selectedProfileId === id) {
      setSelectedProfileId(null);
      setEditingProfile({});
    }
    await loadProfiles();
  }, [selectedProfileId, loadProfiles]);

  const handleSetDefault = useCallback(async (id: string) => {
    const db = await getDb();
    await db.execute("UPDATE writing_profiles SET is_default = 0");
    await db.execute("UPDATE writing_profiles SET is_default = 1 WHERE id = ?", [id]);
    await loadProfiles();
  }, [loadProfiles]);

  const handleLearnStyle = useCallback(async () => {
    if (!activeAccountId || !selectedProfileId || learning) return;
    setLearning(true);
    setLearnDone(false);
    try {
      const db = await getDb();
      const sentMsgs = await db.select<{ subject: string | null; body_text: string | null }[]>(
        `SELECT m.subject, m.body_text FROM messages m
         JOIN thread_labels tl ON tl.thread_id = m.thread_id
         WHERE tl.label_id = 'SENT' AND m.account_id = ?
         ORDER BY m.date DESC LIMIT 30`,
        [activeAccountId],
      );

      if (sentMsgs.length === 0) {
        return;
      }

      const sampleText = sentMsgs
        .map((m) => `Subject: ${m.subject ?? "(none)"}\n${(m.body_text ?? "").slice(0, 300)}`)
        .join("\n\n---\n\n")
        .slice(0, 8000);

      const provider = await getActiveProvider();
      const analysis = await provider.complete({
        systemPrompt: "You are a writing analyst. Analyze the email samples and describe the sender's writing style in 3-5 sentences. Focus on tone, formality, sentence structure, vocabulary, and communication patterns. Be specific and actionable.",
        userContent: `Analyze the writing style from these sent emails:\n\n${sampleText}`,
        maxTokens: 300,
      });

      const db2 = await getDb();
      await db2.execute(
        "UPDATE writing_profiles SET learned_style = ?, updated_at = unixepoch() WHERE id = ?",
        [analysis, selectedProfileId],
      );
      await loadProfiles();
      setEditingProfile((prev) => ({ ...prev, learnedStyle: analysis }));
      setLearnDone(true);
    } catch (err) {
      console.error("Style learning failed:", err);
    } finally {
      setLearning(false);
    }
  }, [activeAccountId, selectedProfileId, learning, loadProfiles]);

  const handleSaveBrand = useCallback(async () => {
    const db = await getDb();
    await db.execute(
      "UPDATE brand_guidelines SET company_name = ?, voice_description = ?, dos = ?, donts = ?, updated_at = unixepoch() WHERE id = 'default'",
      [brand.companyName, brand.voiceDescription, brand.dos, brand.donts],
    );
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 2000);
  }, [brand]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const selectProfile = (id: string) => {
    const p = profiles.find((pr) => pr.id === id);
    if (!p) return;
    setSelectedProfileId(id);
    setEditingProfile({
      name: p.name,
      tone: p.tone,
      customInstructions: p.customInstructions,
      learnedStyle: p.learnedStyle,
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Writing Style Profiles */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Writing Style Profiles</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Define how the AI writes emails on your behalf. The default profile is used automatically.
            </p>
          </div>
          <button
            onClick={handleNewProfile}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus size={12} />
            New Profile
          </button>
        </div>

        <div className="flex gap-3">
          {/* Profile list */}
          <div className="w-44 shrink-0 space-y-1">
            {profiles.length === 0 && (
              <p className="text-xs text-text-tertiary px-2">No profiles for this account yet</p>
            )}
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProfile(p.id)}
                className={`w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center gap-1.5 transition-colors ${
                  selectedProfileId === p.id
                    ? "bg-accent/10 text-accent font-medium"
                    : "hover:bg-bg-hover text-text-primary"
                }`}
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.isDefault && (
                  <span className="text-[0.6rem] text-text-tertiary shrink-0">default</span>
                )}
              </button>
            ))}
          </div>

          {/* Profile editor */}
          {selectedProfileId && (
            <div className="flex-1 border border-border-primary rounded-lg p-4 space-y-4 bg-bg-secondary">
              <div className="flex items-center justify-between">
                <input
                  type="text"
                  value={editingProfile.name ?? ""}
                  onChange={(e) => setEditingProfile((p) => ({ ...p, name: e.target.value }))}
                  className="text-sm font-medium bg-transparent border-b border-border-primary focus:border-accent outline-none text-text-primary py-0.5 flex-1 mr-2"
                  placeholder="Profile name"
                />
                <div className="flex items-center gap-1">
                  {!selectedProfile?.isDefault && (
                    <button
                      onClick={() => handleSetDefault(selectedProfileId)}
                      className="text-[0.6rem] text-text-tertiary hover:text-accent transition-colors px-1.5 py-1 border border-border-primary rounded"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProfile(selectedProfileId)}
                    className="p-1.5 text-text-tertiary hover:text-danger transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Tone */}
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1.5">Tone</label>
                <div className="flex flex-wrap gap-1.5">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setEditingProfile((p) => ({ ...p, tone: t.id }))}
                      className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                        editingProfile.tone === t.id
                          ? "bg-accent text-white"
                          : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom instructions */}
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1.5">
                  Custom instructions
                </label>
                <textarea
                  value={editingProfile.customInstructions ?? ""}
                  onChange={(e) => setEditingProfile((p) => ({ ...p, customInstructions: e.target.value }))}
                  rows={3}
                  placeholder="e.g. Always sign off with 'Best regards'. Never use exclamation marks. Keep replies under 150 words."
                  className="w-full text-xs bg-bg-tertiary border border-border-primary rounded-md px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none resize-none"
                />
              </div>

              {/* Learn from sent */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-text-secondary">Learned style</label>
                  <button
                    onClick={handleLearnStyle}
                    disabled={learning || !activeAccountId}
                    className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {learning ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : learnDone ? (
                      <Check size={11} />
                    ) : (
                      <Sparkles size={11} />
                    )}
                    {learning ? "Analyzing..." : "Learn from sent emails"}
                  </button>
                </div>
                {editingProfile.learnedStyle ? (
                  <p className="text-xs text-text-secondary bg-bg-tertiary rounded-md px-3 py-2 border border-border-primary leading-relaxed">
                    {editingProfile.learnedStyle}
                  </p>
                ) : (
                  <p className="text-xs text-text-tertiary italic">
                    Click "Learn from sent emails" to auto-detect your writing style.
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Brand Guidelines */}
      <section>
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-text-primary">Brand Guidelines</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Company voice and standards applied when drafting emails.
          </p>
        </div>
        <div className="border border-border-primary rounded-lg p-4 space-y-4 bg-bg-secondary">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Company name</label>
            <input
              type="text"
              value={brand.companyName}
              onChange={(e) => setBrand((b) => ({ ...b, companyName: e.target.value }))}
              className="w-full text-xs bg-bg-tertiary border border-border-primary rounded-md px-3 py-1.5 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
              placeholder="e.g. Acme Corp"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Voice & tone</label>
            <textarea
              value={brand.voiceDescription}
              onChange={(e) => setBrand((b) => ({ ...b, voiceDescription: e.target.value }))}
              rows={3}
              placeholder="Describe your brand's communication style, values, and personality..."
              className="w-full text-xs bg-bg-tertiary border border-border-primary rounded-md px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Do's</label>
              <textarea
                value={brand.dos}
                onChange={(e) => setBrand((b) => ({ ...b, dos: e.target.value }))}
                rows={3}
                placeholder="One item per line..."
                className="w-full text-xs bg-bg-tertiary border border-border-primary rounded-md px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Don'ts</label>
              <textarea
                value={brand.donts}
                onChange={(e) => setBrand((b) => ({ ...b, donts: e.target.value }))}
                rows={3}
                placeholder="One item per line..."
                className="w-full text-xs bg-bg-tertiary border border-border-primary rounded-md px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSaveBrand}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
            >
              {brandSaved ? <Check size={11} /> : null}
              {brandSaved ? "Saved" : "Save Guidelines"}
            </button>
          </div>
        </div>
      </section>

      {/* Templates note */}
      <section>
        <div className="flex items-start gap-3 px-4 py-3 bg-bg-secondary border border-border-primary rounded-lg">
          <BookOpen size={14} className="text-text-tertiary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-text-primary">Email Templates</p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Manage reusable email templates in{" "}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("velo-nav-settings", { detail: "composing" }))}
                className="text-accent hover:underline"
              >
                Composing settings
              </button>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
