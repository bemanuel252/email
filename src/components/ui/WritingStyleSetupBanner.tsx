import { useState, useCallback } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { getDb } from "@/services/db/connection";
import { getActiveProvider } from "@/services/ai/providerManager";

interface WritingStyleSetupBannerProps {
  accountId: string;
  accountEmail: string;
  onDismiss: () => void;
}

export function WritingStyleSetupBanner({ accountId, accountEmail, onDismiss }: WritingStyleSetupBannerProps) {
  const [learning, setLearning] = useState(false);
  const [done, setDone] = useState(false);

  const handleLearn = useCallback(async () => {
    setLearning(true);
    try {
      const db = await getDb();

      // Create a default profile for this account if none exists
      const existing = await db.select<{ id: string }[]>(
        "SELECT id FROM writing_profiles WHERE account_id = ? LIMIT 1",
        [accountId],
      );

      let profileId: string;
      if (existing.length > 0) {
        profileId = existing[0]!.id;
      } else {
        profileId = crypto.randomUUID();
        await db.execute(
          "INSERT INTO writing_profiles (id, name, tone, is_default, account_id) VALUES (?, ?, ?, 1, ?)",
          [profileId, "My Style", "professional", accountId],
        );
      }

      // Fetch sent messages
      const sentMsgs = await db.select<{ subject: string | null; body_text: string | null }[]>(
        `SELECT m.subject, m.body_text FROM messages m
         JOIN thread_labels tl ON tl.thread_id = m.thread_id
         WHERE tl.label_id = 'SENT' AND m.account_id = ?
         ORDER BY m.date DESC LIMIT 30`,
        [accountId],
      );

      if (sentMsgs.length > 0) {
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

        await db.execute(
          "UPDATE writing_profiles SET learned_style = ?, updated_at = unixepoch() WHERE id = ?",
          [analysis, profileId],
        );
      }

      setDone(true);
      setTimeout(onDismiss, 2000);
    } catch {
      onDismiss();
    } finally {
      setLearning(false);
    }
  }, [accountId, onDismiss]);

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-bg-primary border border-accent/30 rounded-xl shadow-xl max-w-sm w-full">
      <Sparkles size={16} className="text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        {done ? (
          <p className="text-xs text-text-primary font-medium">Writing style saved for {accountEmail}!</p>
        ) : (
          <>
            <p className="text-xs font-medium text-text-primary">Learn your writing style?</p>
            <p className="text-[0.625rem] text-text-tertiary mt-0.5">
              Analyze sent emails from {accountEmail} to personalize AI drafts.
            </p>
          </>
        )}
      </div>
      {!done && (
        <>
          <button
            onClick={handleLearn}
            disabled={learning}
            className="shrink-0 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-60 transition-colors flex items-center gap-1.5"
          >
            {learning && <Loader2 size={11} className="animate-spin" />}
            {learning ? "Analyzing..." : "Analyze"}
          </button>
          <button
            onClick={onDismiss}
            className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  );
}
