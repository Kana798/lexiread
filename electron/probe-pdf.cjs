/**
 * Probes the PDF engine the way the real app runs it: an HTTP origin served by
 * dist/server.cjs, loaded into a sandboxed renderer.
 *
 * Loading dist/index.html over file:// does NOT work for this bundle — ES
 * module scripts are blocked by CORS on file://, so app.ts never executes.
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const PORT = 39417;

const PROBE = `
(async () => {
  const out = [];
  try {
    out.push('pdfjsLib=' + (typeof window.pdfjsLib));
    if (typeof window.__pdfDiag === 'function') {
      out.push('diag=' + JSON.stringify(window.__pdfDiag()));
    }
    if (!window.pdfjsLib) return out.join(' | ');

    // A minimal but structurally valid PDF containing the text "Hello LexiRead".
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
      '4 0 obj<</Length 52>>stream',
      'BT /F1 14 Tf 20 120 Td (Hello LexiRead) Tj ET',
      'endstream endobj',
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\\n');

    const data = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) data[i] = pdf.charCodeAt(i) & 0xff;

    const doc = await window.pdfjsLib.getDocument({ data }).promise;
    out.push('pages=' + doc.numPages);

    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => i.str).join(' ').trim();
    out.push('extracted="' + text + '"');
    out.push('EXTRACT_OK=' + (text.includes('Hello LexiRead') ? 'YES' : 'NO'));

    // Rendering also exercises the worker's canvas path.
    const canvas = document.createElement('canvas');
    const viewport = page.getViewport({ scale: 1 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    out.push('RENDER_OK=YES(' + canvas.width + 'x' + canvas.height + ')');
  } catch (e) {
    out.push('ERROR=' + (e && e.message ? e.message : String(e)));
  }
  return out.join(' | ');
})()
`;

function waitFor(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not come up'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

app.whenReady().then(async () => {
  // 1) boot the real server bundle
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
    console.log('SERVER_FAILED: ' + e.message + '\n' + serverLog.slice(-400));
    server.kill();
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const logs = [];
  win.webContents.on('console-message', (_e, _lvl, message) => logs.push(message));

  try {
    await win.loadURL(base);
    await new Promise((r) => setTimeout(r, 2000));
    const result = await win.webContents.executeJavaScript(PROBE);
    console.log('PROBE_RESULT: ' + result);
  } catch (e) {
    console.log('PROBE_FAILED: ' + (e && e.message));
  }
  const errs = logs.filter((l) => /error|failed|Error/i.test(l)).slice(0, 8);
  if (errs.length) console.log('PAGE_ERRORS:\n' + errs.join('\n'));

  server.kill();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
