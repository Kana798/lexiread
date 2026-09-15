import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export interface EnvCandidate {
  /** Absolute path of a `.env` file that may exist. */
  path: string;
  /** Human readable origin, used for diagnostic logging. */
  source: string;
}

export interface EnvCandidateInput {
  /** Highest priority: explicitly requested by the Electron shell (`LEXI_ENV_PATH`). */
  explicitPath?: string;
  cwd: string;
  execPath: string;
  appRoot: string;
  appData?: string;
  portableDir?: string;
}

export interface EnvLoadResult {
  /** Paths that actually existed on disk and were parsed. */
  loaded: string[];
  /** Paths that were checked but missing (useful for support tickets). */
  missing: string[];
}

function normalize(p: string): string {
  return path.resolve(p);
}

/**
 * Builds the ordered list of `.env` locations to try.
 *
 * Priority (first match wins for any given key, because a value already present
 * in `process.env` is never overwritten):
 *
 *   1. `LEXI_ENV_PATH`                 — explicit override from the desktop shell
 *   2. portable executable directory   — electron-builder portable target
 *   3. directory of the running exe    — "drop a .env next to LexiRead.exe"
 *   4. `<appRoot>/.env`                — project root in dev, app bundle when packaged
 *   5. `<appRoot>/../.env`             — sibling of the app bundle
 *   6. `%APPDATA%/LexiRead/.env`       — documented user location
 *   7. `%APPDATA%/react-example/.env`  — real userData dir for legacy builds
 *   8. `<cwd>/.env`                    — plain `node dist/server.cjs` usage
 *   9. `config/defaults.env`           — LOWEST priority, see below
 *
 * `config/defaults.env` is the shipped-with-the-build fallback that keeps the
 * packaged desktop app working out of the box. It is deliberately **not** part
 * of the Git repository (it holds real provider credentials); it reaches the
 * installer through electron-builder's `extraResources`, landing next to the
 * app bundle as `resources/config/defaults.env`. It sits last so that anything
 * the user configures wins.
 */
export function resolveEnvCandidates(input: EnvCandidateInput): EnvCandidate[] {
  const { explicitPath, cwd, execPath, appRoot, appData, portableDir } = input;
  const candidates: EnvCandidate[] = [];
  const seen = new Set<string>();

  const push = (filePath: string | undefined | null, source: string) => {
    if (!filePath) return;
    const abs = normalize(filePath);
    if (seen.has(abs)) return;
    seen.add(abs);
    candidates.push({ path: abs, source });
  };

  push(explicitPath, 'LEXI_ENV_PATH');
  if (portableDir) push(path.join(portableDir, '.env'), 'portable executable directory');
  if (execPath) push(path.join(path.dirname(execPath), '.env'), 'executable directory');
  if (appRoot) {
    push(path.join(appRoot, '.env'), 'application root');
    push(path.join(appRoot, '..', '.env'), 'application root parent');
  }
  if (appData) {
    push(path.join(appData, 'LexiRead', '.env'), 'user data directory (LexiRead)');
    push(path.join(appData, 'react-example', '.env'), 'user data directory (legacy app name)');
  }
  if (cwd) push(path.join(cwd, '.env'), 'working directory');

  // Lowest priority: bundled defaults (development tree + packaged resources/).
  if (appRoot) push(path.join(appRoot, 'config', 'defaults.env'), 'bundled defaults (app root)');
  if (appRoot) push(path.join(appRoot, '..', 'config', 'defaults.env'), 'bundled defaults (resources)');
  if (portableDir) push(path.join(portableDir, 'config', 'defaults.env'), 'bundled defaults (portable dir)');
  if (cwd) push(path.join(cwd, 'config', 'defaults.env'), 'bundled defaults (working directory)');

  return candidates;
}

/** Parses every candidate that exists. Values already present in `env` are preserved. */
export function loadEnvFromCandidates(
  candidates: EnvCandidate[],
  env: Record<string, string | undefined> = process.env
): EnvLoadResult {
  const loaded: string[] = [];
  const missing: string[] = [];

  for (const candidate of candidates) {
    let exists = false;
    try {
      exists = fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile();
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(candidate.path);
      continue;
    }
    try {
      const parsed = dotenv.parse(fs.readFileSync(candidate.path, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (env[key] === undefined || env[key] === '') {
          env[key] = value;
        }
      }
      loaded.push(candidate.path);
    } catch (error: any) {
      console.warn(`[env] Failed to parse ${candidate.path}: ${error?.message || error}`);
    }
  }

  return { loaded, missing };
}

/** Resolves the first existing candidate directory for user-facing guidance. */
export function pickRecommendedEnvPath(env: Record<string, string | undefined> = process.env): string {
  const appData = env.APPDATA || env.XDG_CONFIG_HOME;
  if (appData) return path.join(appData, 'LexiRead', '.env');
  return path.resolve(process.cwd(), '.env');
}
