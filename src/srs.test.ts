import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { scheduleSrsReview, isDue, buildReviewQueue, type SrsState, type ReviewRating } from './srs';

const DAY = 24 * 60 * 60 * 1000;

test('新卡第一次评分 good → 间隔 1 天', () => {
  const next = scheduleSrsReview({}, 'good', 1000);
  assert.equal(next.intervalDays, 1);
  assert.equal(next.nextReviewAt, 1000 + DAY);
  assert.equal(next.reviewCount, 1);
  assert.equal(next.easeFactor, 2.5);
});

test('again 重置间隔并立即到期', () => {
  const prev: SrsState = { reviewCount: 3, intervalDays: 7, easeFactor: 2.5, nextReviewAt: 0 };
  const next = scheduleSrsReview(prev, 'again', 5000);
  assert.equal(next.intervalDays, 0);
  assert.equal(next.nextReviewAt, 5000);
  assert.equal(next.easeFactor, 2.2);
});

test('good 按 ease 增长间隔', () => {
  const prev: SrsState = { reviewCount: 2, intervalDays: 3, easeFactor: 2.5 };
  const next = scheduleSrsReview(prev, 'good', 0);
  assert.equal(next.intervalDays, Math.round(3 * 2.5));
});

test('easy 加速增长并提升 ease', () => {
  const prev: SrsState = { reviewCount: 1, intervalDays: 3, easeFactor: 2.5 };
  const next = scheduleSrsReview(prev, 'easy', 0);
  assert.ok(next.intervalDays > 3);
  assert.ok(next.easeFactor! > 2.5);
});

test('ease 被钳制在 1.3–3.5', () => {
  const low: SrsState = { reviewCount: 5, easeFactor: 1.4 };
  assert.equal(scheduleSrsReview(low, 'again', 0).easeFactor, 1.3);
  const high: SrsState = { reviewCount: 5, easeFactor: 3.45 };
  assert.equal(scheduleSrsReview(high, 'easy', 0).easeFactor, 3.5);
});

test('isDue：新卡与到期卡为 true，未到期为 false', () => {
  assert.equal(isDue({}), true);
  assert.equal(isDue({ nextReviewAt: 100 }, 200), true);
  assert.equal(isDue({ nextReviewAt: 300 }, 200), false);
});

test('buildReviewQueue 只返回到期项并按到期时间排序', () => {
  const now = 1000;
  const items: SrsState[] = [
    { nextReviewAt: 500 },        // due, earliest
    { nextReviewAt: 2000 },       // not due
    { nextReviewAt: 800 },        // due, later
    {},                            // new card, due immediately
  ];
  const q = buildReviewQueue(items, now);
  assert.deepEqual(q, [3, 0, 2]);
});

test('buildReviewQueue 无到期项时返回空数组', () => {
  const items: SrsState[] = [{ nextReviewAt: 5000 }, { nextReviewAt: 9000 }];
  assert.deepEqual(buildReviewQueue(items, 1000), []);
});

test('完整复习周期：again→good→easy 递进', () => {
  let s: SrsState = {};
  s = scheduleSrsReview(s, 'again', 0);
  assert.equal(s.intervalDays, 0);
  assert.equal(s.reviewCount, 1);
  s = scheduleSrsReview(s, 'good', DAY);
  // reviewCount 已是 1，good 走 count===1 → 3 天
  assert.equal(s.intervalDays, 3);
  s = scheduleSrsReview(s, 'easy', DAY * 10);
  assert.ok(s.intervalDays! > 3);
  // ease 从 again 的 2.2 经 easy +0.15 → 2.35，比 again 后的 2.2 高
  assert.ok(s.easeFactor! > 2.2);
});
