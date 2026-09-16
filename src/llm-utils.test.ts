// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLlmJson, schemaToPrompt, upsertEnvKey, isLoopbackAddress } from './llm-utils';

// ---------------------------------------------------------------------------
// parseLlmJson — tolerates the code fences LLMs wrap JSON in
// ---------------------------------------------------------------------------
test('parseLlmJson parses clean JSON', () => {
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 });
});

test('parseLlmJson strips ```json fences', () => {
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('parseLlmJson strips bare ``` fences and whitespace', () => {
  assert.deepEqual(parseLlmJson('```\n\n{"a": [1, 2]}\n\n```'), { a: [1, 2] });
});

test('parseLlmJson throws on empty/null input', () => {
  assert.throws(() => parseLlmJson(null), /empty/);
  assert.throws(() => parseLlmJson(''), /empty|JSON/);
});

test('parseLlmJson throws on malformed JSON', () => {
  assert.throws(() => parseLlmJson('{oops}'), /JSON/);
});

// ---------------------------------------------------------------------------
// schemaToPrompt — Gemini-style schema -> compact JSON shape hint
// ---------------------------------------------------------------------------
test('schemaToPrompt renders scalar types', () => {
  assert.equal(schemaToPrompt({ type: 'string' }), '"..."');
  assert.equal(schemaToPrompt({ type: 'integer' }), '0');
});

test('schemaToPrompt renders nested objects with required marks', () => {
  const schema = {
    type: 'object',
    properties: {
      word: { type: 'string' },
      collocations: { type: 'array', items: { type: 'string' } },
      score: { type: 'integer' },
    },
    required: ['word', 'collocations'],
  };
  const out = schemaToPrompt(schema);
  assert.match(out, /"word": "\.\.\."/);
  assert.match(out, /"collocations": \["\.\.\."\]/);
  assert.match(out, /"score": 0 \/\* optional \*\//);
});

test('schemaToPrompt renders nested object fields', () => {
  const schema = {
    type: 'object',
    properties: {
      structure: {
        type: 'object',
        properties: { subject: { type: 'string' } },
        required: ['subject'],
      },
    },
    required: ['structure'],
  };
  const out = schemaToPrompt(schema);
  assert.match(out, /"structure": \{ "subject": "\.\.\." \}/);
});

test('schemaToPrompt tolerates junk input', () => {
  assert.equal(schemaToPrompt(null), '"..."');
  assert.equal(schemaToPrompt('nope'), '"..."');
});

// ---------------------------------------------------------------------------
// upsertEnvKey — idempotent key upsert with comment preservation
// ---------------------------------------------------------------------------
function withTempEnvFile(run: (file: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexi-env-'));
  const file = path.join(dir, '.env');
  try {
    run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('upsertEnvKey creates a new file when none exists', () => {
  withTempEnvFile((file) => {
    upsertEnvKey(file, 'DEEPSEEK_API_KEY', 'sk-test123');
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /DEEPSEEK_API_KEY="sk-test123"/);
  });
});

test('upsertEnvKey replaces an existing key without duplicating', () => {
  withTempEnvFile((file) => {
    upsertEnvKey(file, 'DEEPSEEK_API_KEY', 'sk-old');
    upsertEnvKey(file, 'DEEPSEEK_API_KEY', 'sk-new');
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /DEEPSEEK_API_KEY="sk-new"/);
    assert.equal((content.match(/DEEPSEEK_API_KEY=/g) || []).length, 1);
    assert.ok(!content.includes('sk-old'));
  });
});

test('upsertEnvKey preserves unrelated keys and comments', () => {
  withTempEnvFile((file) => {
    fs.writeFileSync(
      file,
      '# my credentials\nYOUDAO_APP_KEY="abc"\nDEEPSEEK_API_KEY="sk-old"\nYOUDAO_APP_SECRET="xyz"\n'
    );
    upsertEnvKey(file, 'DEEPSEEK_API_KEY', 'sk-new');
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /YOUDAO_APP_KEY="abc"/);
    assert.match(content, /YOUDAO_APP_SECRET="xyz"/);
    assert.match(content, /DEEPSEEK_API_KEY="sk-new"/);
    assert.ok(!content.includes('sk-old'));
  });
});

test('upsertEnvKey strips embedded quotes from the value', () => {
  withTempEnvFile((file) => {
    upsertEnvKey(file, 'DEEPSEEK_API_KEY', 'sk-a"b');
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /DEEPSEEK_API_KEY="sk-ab"/);
  });
});

// ---------------------------------------------------------------------------
// isLoopbackAddress — credential endpoints must be loopback-only
// ---------------------------------------------------------------------------
test('isLoopbackAddress accepts loopback variants', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('isLoopbackAddress rejects LAN and remote addresses', () => {
  assert.equal(isLoopbackAddress('192.168.1.5'), false);
  assert.equal(isLoopbackAddress('10.0.0.2'), false);
  assert.equal(isLoopbackAddress(''), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.5'), false);
});
