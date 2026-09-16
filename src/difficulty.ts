// LexiRead · © 2026 LSJKANA · AGPL-3.0
/**
 * Automatic CEFR difficulty rating for English text.
 *
 * Pure and dependency-free: uses classic readability signals (sentence length,
 * word length, syllable estimate) plus a long-word ratio, then maps the result
 * onto the CEFR scale. Good enough to answer "is this article right for me?"
 * without shipping a multi-megabyte frequency dictionary.
 */

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface DifficultyMetrics {
  words: number;
  sentences: number;
  /** Average words per sentence. */
  avgSentenceLength: number;
  /** Average characters per word. */
  avgWordLength: number;
  /** Share of words with 8+ characters (0–1). */
  longWordRatio: number;
  /** Flesch Reading Ease: higher = easier (typically 0–100). */
  fleschReadingEase: number;
}

export interface DifficultyRating {
  level: CefrLevel;
  /** 0–100, higher = harder. */
  score: number;
  metrics: DifficultyMetrics;
  /** Short Chinese hint for the learner. */
  advice: string;
}

/** Rough syllable count via vowel groups — the standard heuristic. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return groups ? Math.max(1, groups.length) : 1;
}

/** Splits text into words, ignoring numbers and bare punctuation. */
export function extractWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).filter((w) => w.replace(/[^A-Za-z]/g, '').length > 0);
}

/** Splits text into sentences, ignoring empty fragments. */
export function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => extractWords(s).length > 0);
}

/** Maps a 0–100 difficulty score onto CEFR. */
export function scoreToCefr(score: number): CefrLevel {
  if (score < 22) return 'A1';
  if (score < 36) return 'A2';
  if (score < 50) return 'B1';
  if (score < 64) return 'B2';
  if (score < 78) return 'C1';
  return 'C2';
}

const ADVICE: Record<CefrLevel, string> = {
  A1: '入门级，适合零基础起步阅读',
  A2: '基础级，句子短、词汇常见，适合日常泛读',
  B1: '进阶级，能读通大意，适合精读积累表达',
  B2: '中高级，长句与抽象表达增多，适合配合精读工具',
  C1: '高级，学术与修辞密集，建议逐段精读',
  C2: '接近母语书面语，难度较高，建议先做难度改写',
};

export function rateDifficulty(text: string): DifficultyRating {
  const words = extractWords(text);
  const sentences = extractSentences(text);

  const wordCount = Math.max(1, words.length);
  const sentenceCount = Math.max(1, sentences.length);

  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const longWords = words.filter((w) => w.length >= 8).length;

  const avgSentenceLength = wordCount / sentenceCount;
  const avgWordLength = totalChars / wordCount;
  const longWordRatio = longWords / wordCount;
  const syllablesPerWord = totalSyllables / wordCount;

  // Flesch Reading Ease (higher = easier)
  const fleschReadingEase =
    206.835 - 1.015 * avgSentenceLength - 84.6 * syllablesPerWord;

  // Difficulty score: invert FRE, then blend in long-word ratio so academic
  // vocabulary pushes the rating up even when sentences stay short.
  const freComponent = Math.min(100, Math.max(0, 100 - fleschReadingEase));
  const longWordComponent = Math.min(100, longWordRatio * 400); // 25% long words ≈ 100
  const score = Math.round(Math.min(100, Math.max(0, freComponent * 0.7 + longWordComponent * 0.3)));

  const level = scoreToCefr(score);

  return {
    level,
    score,
    metrics: {
      words: words.length,
      sentences: sentences.length,
      avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      avgWordLength: Math.round(avgWordLength * 100) / 100,
      longWordRatio: Math.round(longWordRatio * 1000) / 1000,
      fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
    },
    advice: ADVICE[level],
  };
}
