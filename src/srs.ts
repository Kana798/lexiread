/**
 * Spaced-repetition scheduling (a lean FSRS-style model).
 *
 * Kept pure and side-effect free so it can be unit-tested and reused. The
 * renderer persists the returned fields onto each vocabulary item.
 */

export interface SrsState {
  reviewCount?: number;
  nextReviewAt?: number;
  intervalDays?: number;
  easeFactor?: number;
}

/** Rating the learner assigns after seeing the answer side of a card. */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the next SRS state for a card given a rating.
 * - again: reset interval to 0 (relearn today), ease drops
 * - hard : interval grows modestly, ease drops slightly
 * - good : interval grows at current ease, ease unchanged
 * - easy : interval grows faster, ease rises
 */
export function scheduleSrsReview(prev: SrsState, rating: ReviewRating, now = Date.now()): SrsState {
  const count = prev.reviewCount ?? 0;
  let ease = prev.easeFactor ?? 2.5;
  let interval = prev.intervalDays ?? 0;

  let nextInterval: number;
  switch (rating) {
    case 'again':
      ease = Math.max(1.3, ease - 0.3);
      nextInterval = 0; // relearn same session
      break;
    case 'hard':
      ease = Math.max(1.3, ease - 0.15);
      nextInterval = count === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
      break;
    case 'good':
      nextInterval = count === 0 ? 1 : count === 1 ? 3 : Math.max(1, Math.round(interval * ease));
      break;
    case 'easy':
      ease = Math.min(3.5, ease + 0.15);
      nextInterval = count === 0 ? 4 : Math.max(2, Math.round(interval * ease * 1.3));
      break;
  }

  // A card rated again is due again immediately (nextReviewAt = now); otherwise
  // schedule it nextInterval days out.
  const nextReviewAt = rating === 'again' ? now : now + nextInterval * DAY;

  return {
    reviewCount: count + 1,
    nextReviewAt,
    intervalDays: nextInterval,
    easeFactor: ease,
  };
}

/** True when the card is due for review now. New cards are always due. */
export function isDue(state: SrsState, now = Date.now()): boolean {
  const next = state.nextReviewAt;
  return next === undefined || next <= now;
}

/**
 * Orders a vocabulary list into a review queue: due cards first (oldest due
 * first), then the rest by nextReviewAt ascending. Returns indices into the
 * original array so the caller can render without reordering its data.
 */
export function buildReviewQueue(items: SrsState[], now = Date.now()): number[] {
  return items
    .map((_, i) => i)
    .filter((i) => isDue(items[i], now))
    .sort((a, b) => {
      const ta = items[a].nextReviewAt ?? 0;
      const tb = items[b].nextReviewAt ?? 0;
      return ta - tb;
    });
}
