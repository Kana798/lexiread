/**
 * Locating a note's source paragraph.
 *
 * Kept as a pure function over paragraph texts so the matching strategy is
 * unit-testable without a DOM. The renderer feeds it the visible paragraphs
 * and acts on the returned index.
 */

export interface NoteLocator {
  /** Recorded paragraph index — the most reliable signal. */
  paraIndex?: number;
  /** Selected text of the note, used when no index was recorded. */
  quote?: string;
}

/** Collapses punctuation and whitespace so near-misses still match. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Returns the index of the paragraph a note points at, or -1 when nothing
 * matches. Strategy, in order:
 *   1. the recorded paragraph index (if still in range)
 *   2. a strict, case-insensitive substring match on the quote
 *   3. a punctuation/whitespace-insensitive match (handles OCR/format drift)
 */
export function findNoteParagraph(paragraphs: string[], locator: NoteLocator): number {
  const { paraIndex, quote } = locator;

  if (typeof paraIndex === "number" && paraIndex >= 0 && paraIndex < paragraphs.length) {
    return paraIndex;
  }

  const needle = (quote || "").trim();
  if (!needle) return -1;

  const lower = needle.toLowerCase();
  const strict = paragraphs.findIndex((p) => p.toLowerCase().includes(lower));
  if (strict !== -1) return strict;

  const loose = normalize(needle);
  if (!loose) return -1;
  return paragraphs.findIndex((p) => normalize(p).includes(loose));
}
