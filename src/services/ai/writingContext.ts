import { getDb } from "@/services/db/connection";

export async function getWritingContext(accountId: string): Promise<string> {
  try {
    const db = await getDb();

    const profiles = await db.select<{
      name: string;
      tone: string;
      custom_instructions: string | null;
      learned_style: string | null;
    }[]>(
      "SELECT name, tone, custom_instructions, learned_style FROM writing_profiles WHERE account_id = ? AND is_default = 1 LIMIT 1",
      [accountId],
    );

    const brands = await db.select<{
      company_name: string | null;
      voice_description: string | null;
      dos: string | null;
      donts: string | null;
    }[]>(
      "SELECT company_name, voice_description, dos, donts FROM brand_guidelines WHERE id = 'default'",
    );

    const parts: string[] = [];

    if (profiles.length > 0) {
      const p = profiles[0]!;
      parts.push(`Writing tone: ${p.tone}`);
      if (p.custom_instructions?.trim()) {
        parts.push(`Style instructions: ${p.custom_instructions.trim()}`);
      }
      if (p.learned_style?.trim()) {
        parts.push(`Learned writing style: ${p.learned_style.trim()}`);
      }
    }

    if (brands.length > 0) {
      const b = brands[0]!;
      if (b.company_name?.trim()) parts.push(`Company: ${b.company_name.trim()}`);
      if (b.voice_description?.trim()) parts.push(`Brand voice: ${b.voice_description.trim()}`);
      if (b.dos?.trim()) parts.push(`Do: ${b.dos.trim()}`);
      if (b.donts?.trim()) parts.push(`Don't: ${b.donts.trim()}`);
    }

    if (parts.length === 0) return "";

    return `\n\n<writing_context>\nWhen drafting or composing emails, follow these guidelines:\n${parts.map((p) => `- ${p}`).join("\n")}\n</writing_context>`;
  } catch {
    return "";
  }
}
