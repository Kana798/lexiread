// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import {
  rateDifficulty,
  scoreToCefr,
  countSyllables,
  extractWords,
  extractSentences,
} from './difficulty';

// --- helpers ---------------------------------------------------------------

test('countSyllables 常见词估算正确', () => {
  assert.equal(countSyllables('cat'), 1);
  assert.equal(countSyllables('water'), 2);
  assert.equal(countSyllables('banana'), 3);
  assert.equal(countSyllables('attention'), 3);
  assert.equal(countSyllables(''), 0);
});

test('extractWords 忽略数字与纯符号', () => {
  assert.deepEqual(extractWords('Hello, world! 123 -- ok'), ['Hello', 'world', 'ok']);
  assert.deepEqual(extractWords("don't stop"), ["don't", 'stop']);
  assert.deepEqual(extractWords('!!! 456'), []);
});

test('extractSentences 按句末标点切分', () => {
  const s = extractSentences('One. Two! Three?');
  assert.equal(s.length, 3);
  assert.equal(s[0], 'One.');
  assert.deepEqual(extractSentences('   '), []);
});

// --- 等级映射 ---------------------------------------------------------------

test('scoreToCefr 分档正确', () => {
  assert.equal(scoreToCefr(5), 'A1');
  assert.equal(scoreToCefr(30), 'A2');
  assert.equal(scoreToCefr(45), 'B1');
  assert.equal(scoreToCefr(58), 'B2');
  assert.equal(scoreToCefr(70), 'C1');
  assert.equal(scoreToCefr(90), 'C2');
});

// --- 端到端评级 -------------------------------------------------------------

test('简单短句评为初级（A1/A2）', () => {
  const text = 'I have a cat. The cat is big. It likes fish. We play every day.';
  const r = rateDifficulty(text);
  assert.ok(['A1', 'A2'].includes(r.level), `实际 ${r.level}`);
  assert.ok(r.score < 36);
});

test('中等文本评为 B1/B2', () => {
  const text =
    'Learning a language takes time and patience. Many students give up because they expect quick results. ' +
    'However, progress comes from small daily habits. If you read a little every day, you will improve steadily.';
  const r = rateDifficulty(text);
  assert.ok(['B1', 'B2'].includes(r.level), `实际 ${r.level} (score=${r.score})`);
});

test('学术长句评为高级（C1/C2）', () => {
  const text =
    'The epistemological implications of contemporary neuroplasticity research necessitate a comprehensive ' +
    'reconsideration of pedagogical methodologies, particularly regarding the acquisition of linguistic ' +
    'competencies in adolescent populations, notwithstanding persistent methodological constraints that ' +
    'characterize longitudinal investigations in educational psychology.';
  const r = rateDifficulty(text);
  assert.ok(['C1', 'C2'].includes(r.level), `实际 ${r.level} (score=${r.score})`);
  assert.ok(r.score > 60);
});

test('难度随复杂度单调上升', () => {
  const easy = rateDifficulty('The dog runs. It is fast. We like it.');
  const hard = rateDifficulty(
    'The extraordinarily complicated phenomenon demonstrates substantial interconnectedness between ' +
    'multidisciplinary theoretical frameworks and empirical investigations.'
  );
  assert.ok(hard.score > easy.score, `${hard.score} 应大于 ${easy.score}`);
});

test('返回的指标自洽', () => {
  const r = rateDifficulty('Simple sentence here. Another one follows.');
  assert.ok(r.metrics.words > 0);
  assert.ok(r.metrics.sentences > 0);
  assert.ok(r.metrics.avgSentenceLength > 0);
  assert.ok(r.metrics.longWordRatio >= 0 && r.metrics.longWordRatio <= 1);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.advice.length > 0);
});

test('空输入不抛错且返回合法结构', () => {
  const r = rateDifficulty('');
  assert.ok(r.level.length === 2);
  assert.ok(Number.isFinite(r.score));
  assert.equal(r.metrics.words, 0);
});

test('无标点的长句仍能评级', () => {
  const r = rateDifficulty('this sentence has no terminal punctuation at all and just keeps going');
  assert.ok(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(r.level));
  assert.equal(r.metrics.sentences, 1);
});
