/**
 * Build a safe FTS5 MATCH query from raw user input.
 *
 * The trigram tokenizer indexes content as sliding 3-char windows, but FTS5's
 * *query parser* treats dots, dashes, and other punctuation as syntax, causing
 * "fts5: syntax error near '.'" for queries like "pgiagents.com".
 *
 * Fix: wrap each whitespace-delimited term in double quotes (phrase match).
 * This bypasses the query parser's special-char rules while still passing the
 * full string to the trigram tokenizer, which handles dots correctly.
 *
 * Terms shorter than 3 chars are skipped (trigram tokenizer minimum).
 * Returns null if no valid terms remain — caller should skip FTS5.
 */
export function buildFts5Query(rawQuery: string): string | null {
  const terms = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3) // trigram tokenizer minimum
    .map((t) => '"' + t.replace(/"/g, '""') + '"'); // phrase-quote each term

  return terms.length > 0 ? terms.join(" ") : null; // space = AND in FTS5
}
