# Windows Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build installable and portable Windows 10/11 versions of LexiRead that run without a separately installed Node.js runtime.

**Architecture:** Electron launches the compiled Express server on a free loopback port, waits for its health endpoint, then opens a locked-down desktop \`BrowserWindow\` pointing at that local service. Electron Builder packages Electron, the production server dependencies, and the \`dist/\` files into both NSIS installer and portable executable targets.

**Tech Stack:** Electron, Electron Builder, Node.js child processes, Express, Vite, esbuild, Node test runner with tsx.

**Spec:** \`docs/superpowers/specs/2026-09-15-windows-desktop-packaging-design.md\`

## Global Constraints

- Target Windows 10/11 only.
- Produce both NSIS installer and single-file portable \`.exe\` artifacts in \`release/\`.
- Do not package the developer \`.env\`, source tests, or development dependencies.
- Preserve Express API routes, PDF import, text repair, speech, and online translation.
- Use only a local loopback HTTP address; do not expose the service on LAN interfaces in desktop mode.
- Store user-provided server environment values in the Windows per-user app-data location, never in the release artifact.
- Do not claim success until unit tests, type checking, build, packaging, and launch validation have fresh successful output.

---

## File Structure

| File | Responsibility |
| --- | --- |
| \`server-runtime.ts\` | Computes static web root, bind host, and optional environment-file location without starting Express. |
| \`server-runtime.test.ts\` | Covers packaged and CLI path selection. |
| \`server.ts\` | Uses runtime configuration to load environment values and serve the correct \`dist/\` directory. |
| \`electron/local-server.cjs\` | Allocates a free loopback port, starts the Node-mode Express child, waits for health, and stops it safely. |
| \`electron/local-server.test.cjs\` | Exercises free-port allocation and health polling with real local test servers. |
| \`electron/main-paths.cjs\` | Pure Electron resource and per-user configuration path resolver. |
| \`electron/main-paths.test.cjs\` | Regression coverage for packaged and development paths. |
| \`electron/main.cjs\` | Electron lifecycle, server launch, BrowserWindow creation, and error reporting. |
| \`package.json\` | Desktop dependencies, scripts, metadata, package filters, and Windows targets. |
| \`.gitignore\` / \`README.md\` | Release exclusions and user distribution/configuration instructions. |

## Task 1: Make Server Paths Configurable for a Packaged Runtime

**Files:**

- Create: \`server-runtime.ts\`
- Create: \`server-runtime.test.ts\`
- Modify: \`server.ts:1-12,1484-1505\`

**Interfaces:**

- Produces \`resolveServerRuntime(options): { appRoot: string; distPath: string; envPath?: string; bindHost: string }\`.
- \`server.ts\` consumes \`LEXI_APP_ROOT\`, \`LEXI_ENV_PATH\`, and \`LEXI_BIND_HOST\`.
- Electron relies on \`LEXI_BIND_HOST=127.0.0.1\`.

- [ ] **Step 1: Write the failing runtime-path tests**

~~~ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveServerRuntime } from './server-runtime';

test('uses the Electron app root and loopback host', () => {
  const runtime = resolveServerRuntime({
    cwd: 'C:/ignored',
    env: {
      LEXI_APP_ROOT: 'C:/Program Files/LexiRead/resources/app.asar',
      LEXI_ENV_PATH: 'C:/Users/Ada/AppData/Roaming/LexiRead/.env',
      LEXI_BIND_HOST: '127.0.0.1',
    },
  });

  assert.equal(runtime.distPath, 'C:/Program Files/LexiRead/resources/app.asar/dist');
  assert.equal(runtime.envPath, 'C:/Users/Ada/AppData/Roaming/LexiRead/.env');
  assert.equal(runtime.bindHost, '127.0.0.1');
});

test('uses the CLI working directory and current LAN default', () => {
  const runtime = resolveServerRuntime({ cwd: 'C:/work/LexiRead', env: {} });
  assert.equal(runtime.distPath, 'C:/work/LexiRead/dist');
  assert.equal(runtime.envPath, undefined);
  assert.equal(runtime.bindHost, '0.0.0.0');
});
~~~

- [ ] **Step 2: Run the test to verify it is red**

Run: \`./node_modules/.bin/tsx.cmd --test ./server-runtime.test.ts\`

Expected: \`ERR_MODULE_NOT_FOUND\` for \`server-runtime\`.

- [ ] **Step 3: Implement the isolated resolver**

~~~ts
import path from 'node:path';

export interface ServerRuntimeOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

export function resolveServerRuntime({ cwd, env }: ServerRuntimeOptions) {
  const appRoot = env.LEXI_APP_ROOT || cwd;
  return {
    appRoot,
    distPath: path.join(appRoot, 'dist'),
    envPath: env.LEXI_ENV_PATH,
    bindHost: env.LEXI_BIND_HOST || '0.0.0.0',
  };
}
~~~

- [ ] **Step 4: Run the focused test to verify it is green**

Run: \`./node_modules/.bin/tsx.cmd --test ./server-runtime.test.ts\`

Expected: 2 passing tests.

- [ ] **Step 5: Consume this resolver in the server**

Replace unconditional dotenv initialization with:

~~~ts
const runtime = resolveServerRuntime({ cwd: process.cwd(), env: process.env });
dotenv.config(runtime.envPath ? { path: runtime.envPath } : undefined);
~~~

Use \`runtime.distPath\` for production static assets and \`runtime.bindHost\` in \`app.listen\`. Do not change API routes or development Vite behavior.

- [ ] **Step 6: Verify server regression coverage and type safety**

Run: \`./node_modules/.bin/tsx.cmd --test ./src/*.test.ts ./server-runtime.test.ts; ./node_modules/.bin/tsc.cmd --noEmit\`

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 7: Record a checkpoint**

This workspace is not a Git repository. Record completion in the task output; if Git is later initialized, commit with \`feat: prepare server for desktop runtime\`.

## Task 2: Implement the Local Service Launcher

**Files:**

- Create: \`electron/local-server.cjs\`
- Create: \`electron/local-server.test.cjs\`

**Interfaces:**

- Produces \`findFreeLoopbackPort(): Promise<number>\`.
- Produces \`waitForHealth(port, timeoutMs): Promise<void>\`.
- Produces \`startLocalServer(options): Promise<{ port: number; child: ChildProcess; stop(): Promise<void> }>\`.
- \`main.cjs\` only opens the window after \`startLocalServer\` resolves.

- [ ] **Step 1: Write failing local-service tests using real loopback sockets**

~~~js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { findFreeLoopbackPort, waitForHealth } = require('./local-server.cjs');

test('findFreeLoopbackPort returns a bindable loopback port', async () => {
  const port = await findFreeLoopbackPort();
  const server = http.createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(port, '127.0.0.1', resolve),
  );
  await new Promise((resolve) => server.close(resolve));
});

test('waitForHealth resolves after the health endpoint responds', async () => {
  const port = await findFreeLoopbackPort();
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/api/health' ? 200 : 404).end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  await waitForHealth(port, 500);
  await new Promise((resolve) => server.close(resolve));
});
~~~

- [ ] **Step 2: Run the test to verify it is red**

Run: \`node --test ./electron/local-server.test.cjs\`

Expected: module or export error for \`findFreeLoopbackPort\`.

- [ ] **Step 3: Implement port allocation and health polling**

Use \`net.createServer()\` on host \`127.0.0.1\`, port \`0\`, then close the socket after reading its allocated port. Use \`http.get\` retries with a deadline in \`waitForHealth\`; include the last failure in the timeout error. Never bind to \`0.0.0.0\`.

- [ ] **Step 4: Implement Electron-as-Node child startup and idempotent cleanup**

~~~js
function startLocalServer({ electronExecutable, serverPath, appRoot, envPath }) {
  return findFreeLoopbackPort().then(async (port) => {
    const child = spawn(electronExecutable, [serverPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(port),
        LEXI_BIND_HOST: '127.0.0.1',
        LEXI_APP_ROOT: appRoot,
        ...(envPath ? { LEXI_ENV_PATH: envPath } : {}),
      },
      stdio: 'pipe',
      windowsHide: true,
    });
    await waitForHealth(port, 10_000);
    return { port, child, stop: () => stopChild(child) };
  });
}
~~~

Implement \`stopChild\` to terminate normally first, use a bounded Windows fallback only if needed, and safely accept repeated calls.

- [ ] **Step 5: Verify focused and existing tests**

Run: \`node --test ./electron/local-server.test.cjs; ./node_modules/.bin/tsx.cmd --test ./src/*.test.ts ./server-runtime.test.ts\`

Expected: all tests pass and no open-handle warning.

- [ ] **Step 6: Record a checkpoint**

If Git is initialized later, commit with \`feat: add local desktop service launcher\`; otherwise record completion in task output.

## Task 3: Create the Electron Application Entry Point

**Files:**

- Create: \`electron/main-paths.cjs\`
- Create: \`electron/main-paths.test.cjs\`
- Create: \`electron/main.cjs\`

**Interfaces:**

- Produces \`resolveDesktopPaths({ isPackaged, dirname, userDataPath }): { appRoot, serverPath, envPath }\`.
- Consumes \`startLocalServer\` from Task 2.
- Opens only \`http://127.0.0.1:<port>/\` with sandboxed renderer settings.

- [ ] **Step 1: Write the failing Electron path test**

~~~js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDesktopPaths } = require('./main-paths.cjs');

test('resolves packaged resources and per-user environment path', () => {
  assert.deepEqual(
    resolveDesktopPaths({
      isPackaged: true,
      dirname: 'C:/Program Files/LexiRead/resources/app.asar/electron',
      userDataPath: 'C:/Users/Ada/AppData/Roaming/LexiRead',
    }),
    {
      appRoot: 'C:/Program Files/LexiRead/resources/app.asar',
      serverPath: 'C:/Program Files/LexiRead/resources/app.asar/dist/server.cjs',
      envPath: 'C:/Users/Ada/AppData/Roaming/LexiRead/.env',
    },
  );
});
~~~

- [ ] **Step 2: Run the test to verify it is red**

Run: \`node --test ./electron/main-paths.test.cjs\`

Expected: module-not-found error for \`main-paths.cjs\`.

- [ ] **Step 3: Implement and verify pure Electron paths**

Use \`path.resolve(dirname, '..')\` as the app root, \`path.join(appRoot, 'dist', 'server.cjs')\` as server path, and \`path.join(userDataPath, '.env')\` as user configuration path.

Run: \`node --test ./electron/main-paths.test.cjs\`

Expected: the path test passes.

- [ ] **Step 4: Implement Electron lifecycle**

\`electron/main.cjs\` must:

1. await \`app.whenReady()\`;
2. resolve paths and start the local service;
3. make a \`BrowserWindow\` sized 1280×840 with minimum 960×640 and title \`LexiRead · 英语阅读器\`;
4. set \`contextIsolation: true\`, \`nodeIntegration: false\`, and \`sandbox: true\`;
5. call \`loadURL('http://127.0.0.1:' + port + '/')\` after health readiness;
6. show \`dialog.showErrorBox('LexiRead 无法启动', message)\` then quit on startup failure;
7. stop the local server once during \`before-quit\`.

- [ ] **Step 5: Build and manually smoke-test the desktop shell**

Run: \`npm run build; npx electron ./electron/main.cjs\`

Expected: a LexiRead desktop window opens, local health requests succeed, and closing it leaves no local listener.

- [ ] **Step 6: Record a checkpoint**

If Git is initialized later, commit with \`feat: add LexiRead desktop shell\`; otherwise record completion in task output.

## Task 4: Configure Electron Builder and Produce Artifacts

**Files:**

- Modify: \`package.json\`
- Modify: \`.gitignore\`
- Modify: \`README.md\`

**Interfaces:**

- \`npm run desktop:pack\` builds the app and produces an unpacked Windows directory.
- \`npm run desktop:dist\` builds the app and produces NSIS plus portable artifacts in \`release/\`.

- [ ] **Step 1: Add explicit desktop dependencies**

Run: \`npm install --save-dev electron electron-builder\`

Expected: \`package.json\` and lock file include Electron and Electron Builder.

- [ ] **Step 2: Add scripts and build metadata**

Add \`main: \"electron/main.cjs\"\`, along with:

~~~json
{
  "scripts": {
    "test": "tsx --test src/*.test.ts server-runtime.test.ts && node --test electron/*.test.cjs",
    "desktop:pack": "npm run build && electron-builder --dir",
    "desktop:dist": "npm run build && electron-builder --win nsis portable"
  },
  "build": {
    "appId": "com.lexiread.desktop",
    "productName": "LexiRead",
    "directories": { "output": "release" },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "package.json",
      "node_modules/**/*",
      "!**/*.test.*",
      "!src/**/*",
      "!.env"
    ],
    "win": { "target": ["nsis", "portable"] },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true }
  }
}
~~~

Do not add \`.env\`, API keys, or source tests to packaged resources.

- [ ] **Step 3: Exclude generated output and document user configuration**

Append \`release/\` and \`dist/win-unpacked/\` to \`.gitignore\`.

Add a Windows desktop section to \`README.md\` that identifies the NSIS installer, portable executable, and optional \`%APPDATA%\\LexiRead\\.env\` configuration file. State that credential-backed services require the recipient's authorized credentials; no developer credential ships in the app.

- [ ] **Step 4: Run verification before packaging**

Run: \`npm run test; npm run lint; npm run build\`

Expected: all tests pass, type check exits 0, and \`dist/index.html\` plus \`dist/server.cjs\` exist.

- [ ] **Step 5: Build both Windows distribution targets**

Run: \`npm run desktop:dist\`

Expected: \`release/\` contains one NSIS setup executable and one portable executable for the current version.

- [ ] **Step 6: Check artifacts and unsigned status**

Run: \`Get-ChildItem release -File | Select-Object Name,Length,LastWriteTime\`

Expected: both executable files are non-empty. State clearly whether a signing certificate exists; do not present an unsigned package as signed.

- [ ] **Step 7: Record the release configuration checkpoint**

If Git is initialized later, commit with \`build: package LexiRead for Windows\`; otherwise record completion in task output.

## Task 5: Validate the Portable Release End to End

**Files:** none unless validation exposes a defect.

**Interfaces:** consumes the portable executable from Task 4 and proves it serves the production application with no separately installed Node.js runtime.

- [ ] **Step 1: Resolve one exact portable executable path**

Run: \`Get-ChildItem release -File | Where-Object { $_.Name -match 'portable' -and $_.Extension -eq '.exe' } | Select-Object -ExpandProperty FullName\`

Expected: one absolute path contained by \`release/\`.

- [ ] **Step 2: Launch the exact portable executable and observe it**

Launch only the resolved path after verifying it remains inside \`release/\`.

Expected: a \`LexiRead · 英语阅读器\` desktop window renders the default reader, not a blank surface or server error dialog.

- [ ] **Step 3: Verify local service and cleanup**

Observe the successful local health state, close the window, then confirm no LexiRead child process or loopback listener remains.

Expected: the app works without an installed Node.js runtime and shuts down its local service.

- [ ] **Step 4: Record final evidence**

Report artifact names, sizes, automated test/build output, launch outcome, and any unsigned-app warning. Never delete release artifacts during validation.

