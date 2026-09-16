// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import {
  EDGE_VOICES,
  ACCENT_LABELS,
  DEFAULT_VOICE_ID,
  isKnownVoice,
  voicesByAccent,
  availableAccents,
  langOfVoice,
} from './tts-voices';

test('语音清单无重复 id 且字段完整', () => {
  const ids = EDGE_VOICES.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, '存在重复的音色 id');
  for (const v of EDGE_VOICES) {
    assert.ok(v.id.endsWith('Neural'), `${v.id} 应以 Neural 结尾`);
    assert.ok(v.label.length > 0, `${v.id} 缺少标签`);
    assert.ok(['female', 'male'].includes(v.gender), `${v.id} 性别非法`);
    assert.ok(/^en-[A-Z]{2}$/.test(v.accent), `${v.id} 口音格式非法: ${v.accent}`);
  }
});

test('默认音色在清单内且可校验', () => {
  assert.ok(isKnownVoice(DEFAULT_VOICE_ID));
  assert.equal(isKnownVoice('en-US-AriaNeural'), true);
  assert.equal(isKnownVoice('en-US-NotRealNeural'), false);
  assert.equal(isKnownVoice(''), false);
});

test('langOfVoice 从音色 id 推导语言标签', () => {
  assert.equal(langOfVoice('en-GB-SoniaNeural'), 'en-GB');
  assert.equal(langOfVoice('en-US-AriaNeural'), 'en-US');
  assert.equal(langOfVoice('weird'), 'en-US'); // 兜底
});

test('voicesByAccent 返回该口音的音色', () => {
  const gb = voicesByAccent('en-GB');
  assert.ok(gb.length >= 2);
  assert.ok(gb.every((v) => v.accent === 'en-GB'));
  assert.ok(gb.some((v) => v.gender === 'female'));
  assert.ok(gb.some((v) => v.gender === 'male'));
  assert.deepEqual(voicesByAccent('en-XX'), []);
});

test('每个可选口音都至少有一个音色', () => {
  for (const accent of availableAccents()) {
    assert.ok(voicesByAccent(accent).length > 0, `${accent} 没有音色`);
    assert.ok(ACCENT_LABELS[accent], `${accent} 缺少中文标签`);
  }
});

test('availableAccents 覆盖主要英语口音', () => {
  const accents = availableAccents();
  for (const expected of ['en-US', 'en-GB', 'en-AU']) {
    assert.ok(accents.includes(expected), `缺少 ${expected}`);
  }
});

test('音色清单保持精简（避免选择器臃肿）', () => {
  assert.ok(EDGE_VOICES.length <= 8, `音色过多: ${EDGE_VOICES.length}`);
  assert.ok(availableAccents().length <= 4, `口音过多: ${availableAccents().length}`);
});

test('每个口音都同时提供男女声', () => {
  for (const accent of availableAccents()) {
    const voices = voicesByAccent(accent);
    assert.ok(voices.some((v) => v.gender === 'female'), `${accent} 缺女声`);
    assert.ok(voices.some((v) => v.gender === 'male'), `${accent} 缺男声`);
  }
});
