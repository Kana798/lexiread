// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formPdfLine } from './pdf-extraction';
import { pausePlaybackEngine, resumePlaybackEngine } from './playback-engine';

test('keeps adjacent fragments of one word together', () => {
  assert.equal(formPdfLine([
    { str: 'T', x: 10, width: 7, size: 12 },
    { str: 'he', x: 17, width: 12, size: 12 },
  ]), 'The');
});

test('separates words using measured PDF geometry', () => {
  assert.equal(formPdfLine([
    { str: 'two', x: 10, width: 19, size: 12 },
    { str: 'Words', x: 35, width: 32, size: 12 },
  ]), 'two Words');
});

test('preserves spaces already present in PDF text fragments', () => {
  assert.equal(formPdfLine([
    { str: 'Hello ', x: 10, width: 28, size: 12 },
    { str: 'world', x: 38, width: 29, size: 12 },
  ]), 'Hello world');
});

test('pausing and resuming imported audio keeps its exact position', () => {
  const calls: string[] = [];
  const audio = { currentTime: 42.75, pause() { calls.push('pause'); }, play() { calls.push('play'); return Promise.resolve(); } };
  pausePlaybackEngine(audio, null);
  resumePlaybackEngine(audio, null);
  assert.equal(audio.currentTime, 42.75);
  assert.deepEqual(calls, ['pause', 'play']);
});

test('pausing and resuming speech does not cancel the active utterance', () => {
  const calls: string[] = [];
  const speech = {
    pause() { calls.push('pause'); },
    resume() { calls.push('resume'); },
    cancel() { calls.push('cancel'); },
  };
  pausePlaybackEngine(null, speech);
  resumePlaybackEngine(null, speech);
  assert.deepEqual(calls, ['pause', 'resume']);
});
