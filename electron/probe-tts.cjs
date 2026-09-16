// LexiRead · © 2026 LSJKANA · AGPL-3.0
/**
 * End-to-end check of the neural TTS path, in the real Electron renderer.
 *
 * Boots dist/server.cjs, loads the app over HTTP (file:// blocks ES modules)
 * and exercises /api/tts from the renderer: fetch → MP3 bytes → decodable
 * audio → accent actually changes the audio.
 *
 * Run with ELECTRON_RUN_AS_NODE cleared, otherwise electron.exe behaves as
 * plain Node and `require('electron')` is undefined.
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PORT = 39421;

const PROBE = `
(async () => {
  const out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const grab = async (voice, text) => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text || 'Attention has become one of our most valuable possessions.', voice }),
    });
    const buf = await res.arrayBuffer();
    return { status: res.status, type: res.headers.get('content-type'), buf };
  };

  try {
    // --- accent switching really changes the audio -------------------------
    const gb = await grab('en-GB-SoniaNeural');
    const us = await grab('en-US-AriaNeural');
    const u8 = new Uint8Array(gb.buf);
    out.push('isMpeg=' + (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0));
    out.push('accentDiffers=' + (us.buf.byteLength !== gb.buf.byteLength));

    // --- picker was slimmed down ------------------------------------------
    const select = document.querySelector('#voiceAccent');
    out.push('voiceCount=' + (select ? select.querySelectorAll('option').length : -1));
    out.push('accentGroups=' + (select ? select.querySelectorAll('optgroup').length : -1));

    // --- a second identical request is served from cache -------------------
    const t0 = performance.now();
    await grab('en-GB-SoniaNeural');
    out.push('cachedMs=' + Math.round(performance.now() - t0));

    // --- THE REGRESSION: rapid taps must not fall back to the system voice -
    // Reproduces tapping several words quickly: each tap cancels the previous
    // request. That cancellation used to be misread as a failure and dropped
    // playback to the robotic system voice (the "mystery male voice").
    const wordEls = Array.from(document.querySelectorAll('.read-word')).slice(0, 5);
    out.push('wordEls=' + wordEls.length);
    for (const el of wordEls) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(110);
    }
    await sleep(1200);

    const systemSpeaking = Boolean(window.speechSynthesis && window.speechSynthesis.speaking);
    out.push('systemEngineSpeaking=' + systemSpeaking);
    out.push('VERDICT=' + (systemSpeaking ? 'FAIL(发生了降级)' : 'PASS(未降级)'));
  } catch (e) {
    out.push('ERROR=' + (e && e.message));
  }
  return out.join(' | ');
})()
`;

function waitFor(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not come up'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

app.whenReady().then(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.cjs')], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (c) => (serverLog += c));
  server.stderr.on('data', (c) => (serverLog += c));

  const base = `http://127.0.0.1:${PORT}/`;
  try {
    await waitFor(base);
  } catch (e) {
    console.log('SERVER_FAILED: ' + e.message + '\n' + serverLog.slice(-300));
    server.kill();
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const logs = [];
  win.webContents.on('console-message', (_e, _l, m) => logs.push(m));

  try {
    await win.loadURL(base);
    await new Promise((r) => setTimeout(r, 2000));
    console.log('PROBE_RESULT: ' + (await win.webContents.executeJavaScript(PROBE)));
  } catch (e) {
    console.log('PROBE_FAILED: ' + (e && e.message));
  }
  const errs = logs.filter((l) => /error|failed/i.test(l)).slice(0, 6);
  if (errs.length) console.log('PAGE_ERRORS:\n' + errs.join('\n'));

  server.kill();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
