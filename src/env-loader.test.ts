import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEnvCandidates, loadEnvFromCandidates, pickRecommendedEnvPath } from './env-loader';

test('candidate order puts the explicit path first and never duplicates entries', () => {
  const candidates = resolveEnvCandidates({
    explicitPath: 'C:/Users/Ada/AppData/Roaming/LexiRead/.env',
    cwd: 'C:/app',
    execPath: 'C:/app/LexiRead.exe',
    appRoot: 'C:/app/resources/app.asar',
    appData: 'C:/Users/Ada/AppData/Roaming',
  });

  const paths = candidates.map((candidate) => candidate.path.replace(/\\/g, '/'));
  assert.equal(paths[0], 'C:/Users/Ada/AppData/Roaming/LexiRead/.env');
  assert.equal(new Set(paths).size, paths.length, 'candidate paths must be unique');
  assert.ok(paths.includes('C:/app/resources/app.asar/.env'));
  assert.ok(paths.includes('C:/app/.env'));
  // The real userData folder of legacy builds must still be scanned.
  assert.ok(paths.includes('C:/Users/Ada/AppData/Roaming/react-example/.env'));
});

test('bundled config/defaults.env is scanned last so user settings always win', () => {
  const candidates = resolveEnvCandidates({
    explicitPath: 'C:/Users/Ada/AppData/Roaming/LexiRead/.env',
    cwd: 'C:/app',
    execPath: 'C:/app/resources/app.asar/electron/../x.exe',
    appRoot: 'C:/app/resources/app.asar',
    appData: 'C:/Users/Ada/AppData/Roaming',
  });

  const paths = candidates.map((candidate) => candidate.path.replace(/\\/g, '/'));
  // Packaged layout: the extraResources copy lands next to the app bundle.
  assert.ok(paths.includes('C:/app/resources/config/defaults.env'));
  // Development layout: the file sits in the project tree.
  assert.ok(paths.includes('C:/app/config/defaults.env'));

  const bundled = paths.filter((p) => p.endsWith('config/defaults.env'));
  const lastBundled = Math.max(...bundled.map((p) => paths.indexOf(p)));
  assert.equal(
    paths.length - 1,
    lastBundled,
    'every user-configurable .env must be consulted before the bundled defaults'
  );
});

test('loads every existing .env without overwriting already-set variables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexi-env-'));
  try {
    const high = path.join(dir, 'high.env');
    const low = path.join(dir, 'low.env');
    fs.writeFileSync(high, 'YOUDAO_APP_KEY="from-high"\nONLY_HIGH=1\n');
    fs.writeFileSync(low, 'YOUDAO_APP_KEY="from-low"\nONLY_LOW=1\n');

    const env: Record<string, string | undefined> = { PRESET: 'kept' };
    const result = loadEnvFromCandidates(
      [
        { path: high, source: 'high' },
        { path: path.join(dir, 'missing.env'), source: 'missing' },
        { path: low, source: 'low' },
      ],
      env
    );

    assert.deepEqual(result.loaded, [high, low]);
    assert.deepEqual(result.missing, [path.join(dir, 'missing.env')]);
    assert.equal(env.YOUDAO_APP_KEY, 'from-high', 'first match wins');
    assert.equal(env.ONLY_LOW, '1');
    assert.equal(env.PRESET, 'kept');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a real env variable always beats the bundled defaults file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexi-env-'));
  try {
    const defaultsDir = path.join(dir, 'config');
    fs.mkdirSync(defaultsDir);
    const defaults = path.join(defaultsDir, 'defaults.env');
    fs.writeFileSync(defaults, 'YOUDAO_APP_KEY="bundled"\nYOUDAO_APP_SECRET="bundled-secret"\n');

    const env: Record<string, string | undefined> = { YOUDAO_APP_KEY: 'from-process-env' };
    loadEnvFromCandidates([{ path: defaults, source: 'bundled defaults' }], env);

    assert.equal(env.YOUDAO_APP_KEY, 'from-process-env');
    assert.equal(env.YOUDAO_APP_SECRET, 'bundled-secret');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recommended env path points at the documented user data location', () => {
  assert.equal(
    pickRecommendedEnvPath({ APPDATA: 'C:/Users/Ada/AppData/Roaming' }).replace(/\\/g, '/'),
    'C:/Users/Ada/AppData/Roaming/LexiRead/.env'
  );
});
