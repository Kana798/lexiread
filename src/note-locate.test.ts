// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { findNoteParagraph } from './note-locate';

const PARAS = [
  'In an age of endless notifications, attention has become valuable.',
  'We give it away in small pieces: to a bright screen, a familiar sound.',
  'The Art of Paying Attention is a skill we can rebuild.',
];

test('优先使用记录的段落索引', () => {
  assert.equal(findNoteParagraph(PARAS, { paraIndex: 1 }), 1);
  assert.equal(findNoteParagraph(PARAS, { paraIndex: 0, quote: 'rebuild' }), 0);
});

test('索引越界时回退到引文匹配', () => {
  assert.equal(findNoteParagraph(PARAS, { paraIndex: 99, quote: 'rebuild' }), 2);
  assert.equal(findNoteParagraph(PARAS, { paraIndex: -1, quote: 'bright screen' }), 1);
});

test('引文精确匹配（大小写不敏感）', () => {
  assert.equal(findNoteParagraph(PARAS, { quote: 'BECOME VALUABLE' }), 0);
  assert.equal(findNoteParagraph(PARAS, { quote: 'a familiar sound' }), 1);
});

test('引文宽松匹配（忽略标点与空白差异）', () => {
  // 引文里的冒号/逗号与原文不同，仍应命中
  assert.equal(findNoteParagraph(PARAS, { quote: 'We give it away in small pieces to a bright screen' }), 1);
  // 连字符 → 去标点后匹配
  assert.equal(findNoteParagraph(['A well-known problem.', 'Another line.'], { quote: 'wellknown problem' }), 0);
});

test('找不到时返回 -1', () => {
  assert.equal(findNoteParagraph(PARAS, { quote: 'this text does not exist' }), -1);
  assert.equal(findNoteParagraph(PARAS, {}), -1);
  assert.equal(findNoteParagraph(PARAS, { quote: '   ' }), -1);
});

test('纯标点引文不会误匹配', () => {
  assert.equal(findNoteParagraph(PARAS, { quote: '...' }), -1);
  assert.equal(findNoteParagraph(PARAS, { quote: '——' }), -1);
});

test('空段落数组安全返回 -1', () => {
  assert.equal(findNoteParagraph([], { paraIndex: 0 }), -1);
  assert.equal(findNoteParagraph([], { quote: 'anything' }), -1);
});

test('多段命中时返回第一段', () => {
  const paras = ['attention matters', 'attention again', 'other'];
  assert.equal(findNoteParagraph(paras, { quote: 'attention' }), 0);
});
