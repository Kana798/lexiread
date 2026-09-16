// LexiRead · © 2026 LSJKANA · AGPL-3.0
/**
 * Captures the three screenshots referenced by README.md.
 *
 * Everything here is genuine: the app runs from dist/ over HTTP, data is seeded
 * into localStorage, and the PDF view is reached by really handing a PDF to the
 * file input through the DevTools protocol — no mocked-up DOM.
 *
 * Run from the repo root, with ELECTRON_RUN_AS_NODE cleared.
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const PORT = 39479;
const WIDTH = 1440;
const HEIGHT = 900;

// Run against a throwaway profile. The real profile accumulates imported
// articles in localStorage, which would leak into the screenshots (an earlier
// run left the PDF's title on the reader page). Must be set before app is ready.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lexi-shot-profile-'));
app.setPath('userData', USER_DATA);

/** Sample article used to build the PDF (mirrors the app's built-in essay). */
const PDF_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>The Quiet Power of Attention</title><style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1f1d1a; line-height: 1.95;
         padding: 62px 72px; font-size: 11.5pt; }
  h1 { font-size: 23pt; margin: 0 0 8px; letter-spacing: -0.01em; }
  .meta { color: #8a8478; font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase;
          margin-bottom: 30px; padding-bottom: 14px; border-bottom: 1px solid #ddd7c9; }
  h2 { font-size: 13pt; margin: 26px 0 9px; color: #2a2724; }
  p { margin: 0 0 13px; text-align: justify; }
  blockquote { margin: 18px 0 18px 20px; padding-left: 16px; border-left: 3px solid #c9c1ae;
               color: #4a463f; font-style: italic; }
</style></head><body>
<h1>The Quiet Power of Attention</h1>
<div class="meta">Essay &nbsp;·&nbsp; 6 min read</div>

<p>In an age of endless notifications, attention has become one of our most valuable possessions. We give it away in small pieces: to a bright screen, a familiar sound, or the faint promise of something new.</p>

<p>Yet attention is more than a resource to be managed. It is a way of meeting the world. When we notice the light moving across a wall, or listen fully to a friend's story, ordinary moments begin to reveal their texture.</p>

<h2>The Practice</h2>

<p>The practice is surprisingly simple, though not always easy. Choose one thing. Stay with it. When your mind wanders—as it naturally will—gently bring it back. Each return is not a failure, but a small act of care.</p>

<blockquote>Over time, this kind of attention changes what we see. The world does not become quieter; we simply become better at hearing its many voices.</blockquote>

<h2>Why It Matters</h2>

<p>Reading is where this practice becomes visible. A page demands a certain patience: it will not reward a glance. To read well is to consent to slowness, to let a sentence finish its thought before rushing to the next.</p>

<p>What we call comprehension is rarely a single act. It is a series of small returns—to a clause, to a word you half-know, to the shape of an argument as it unfolds. The reader who pauses is not falling behind; the reader who pauses is reading.</p>

<p>Vocabulary grows in the same unhurried way. A word met once is a stranger; met five times across different sentences, it becomes an acquaintance; used in your own thinking, it becomes yours. That is why context matters more than lists.</p>

<h2>A Different Kind of Speed</h2>

<p>There is a speed that comes from skipping, and a speed that comes from fluency. The first is easy to mistake for progress, because it produces the feeling of having covered ground. The second arrives slowly and then all at once, when the machinery of a language stops demanding your notice.</p>

<p>Until then, every attentive minute is doing quiet work. The mind is not merely storing what it reads; it is building the routes it will later travel without effort. Nothing is wasted, not even confusion.</p>

<p>So the invitation is modest. Put the phone face down. Let the room be slightly boring. Read one page properly, and then another. Attention, given freely and without drama, is still the rarest gift we can offer to a text—and to each other.</p>
</body></html>`;

/** Seeded vocabulary so the sidebar and the flashcard deck have real content. */
const WORDS = [
  {
    text: 'possession',
    meaning: 'n. 财产；占有物',
    phonetic: '/pəˈzeʃ(ə)n/',
    example: 'Attention has become one of our most valuable possessions.',
    reviewCount: 0,
    intervalDays: 0,
    easeFactor: 2.5,
  },
  {
    text: 'notification',
    meaning: 'n. 通知；提醒',
    phonetic: '/ˌnəʊtɪfɪˈkeɪʃ(ə)n/',
    example: 'We give it away in small pieces: to a bright screen, a familiar notification.',
    reviewCount: 1,
    intervalDays: 1,
    easeFactor: 2.5,
  },
  {
    text: 'fragmented',
    meaning: 'adj. 碎片化的；支离的',
    phonetic: '/fræɡˈmentɪd/',
    example: 'A fragmented attention rarely finishes what it begins.',
    reviewCount: 0,
    intervalDays: 0,
    easeFactor: 2.5,
  },
  {
    text: 'deliberate',
    meaning: 'adj. 刻意的；从容的',
    phonetic: '/dɪˈlɪb(ə)rət/',
    example: 'Reading well is a deliberate act, not a reflex.',
    reviewCount: 0,
    intervalDays: 0,
    easeFactor: 2.5,
  },
  {
    text: 'acquaintance',
    meaning: 'n. 相识；略有交情的人',
    phonetic: '/əˈkweɪntəns/',
    example: 'A word met once is a stranger; met five times, an acquaintance.',
    reviewCount: 0,
    intervalDays: 0,
    easeFactor: 2.5,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForServer(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(base, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not start'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

/**
 * Builds the sample PDF with Chromium's own print pipeline.
 *
 * The window is intentionally NOT destroyed: Electron quits by default once
 * the last window closes, and at this point the main window doesn't exist yet.
 * The caller keeps the reference alive.
 */
async function buildSamplePdf(target) {
  const win = new BrowserWindow({ show: false, width: 800, height: 1100 });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PDF_HTML));
  await sleep(400);
  const buffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'default' },
  });
  fs.writeFileSync(target, buffer);
  return win;
}

/** Hands a real file to a <input type="file">, firing the app's import path. */
async function setFileInput(win, selector, filePath) {
  win.webContents.debugger.attach('1.3');
  const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 });
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`找不到元素: ${selector}`);
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
    files: [filePath],
    nodeId,
  });
  win.webContents.debugger.detach();
}

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`saved ${name} (${width}x${height}, ${Math.round(fs.statSync(file).size / 1024)}KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = `http://127.0.0.1:${PORT}/`;
  const step = (msg) => console.log(`[step] ${msg}`);

  // ---- 1. sample PDF -------------------------------------------------------
  const pdfPath = path.join(os.tmpdir(), 'lexiread-sample.pdf');
  const pdfWin = await buildSamplePdf(pdfPath);
  step(`sample pdf built: ${Math.round(fs.statSync(pdfPath).size / 1024)}KB`);

  // ---- 2. server ----------------------------------------------------------
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexi-shot-'));
  const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.cjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      LEXI_ENV_PATH: path.join(envDir, '.env'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (c) => (serverLog += c));
  server.stderr.on('data', (c) => (serverLog += c));

  try {
    await waitForServer(base, 10000);
    step('server is up');
  } catch (e) {
    console.log('SERVER_FAILED: ' + e.message + '\n--- log ---\n' + serverLog.slice(-500));
    server.kill();
    return;
  }

  // ---- 3. app window ------------------------------------------------------
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    backgroundColor: '#fbf9f4',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const logs = [];
  win.webContents.on('console-message', (_e, _l, m) => logs.push(m));

  await win.loadURL(base);
  await sleep(2500);
  step('app loaded');

  // Seed data, then reload so the app boots with it already in place.
  // Note: the first-run guide is gated on *sessionStorage* (per session), not
  // localStorage — seeding the wrong store leaves the modal covering the page.
  await win.webContents.executeJavaScript(`
    sessionStorage.setItem('lexi-setup-dismissed', '1');
    localStorage.setItem('lexi-words', ${JSON.stringify(JSON.stringify(WORDS))});
    localStorage.setItem('lexi-voice', 'en-US-AriaNeural');
    'seeded'
  `);
  await win.webContents.reload();
  await sleep(3000);
  step('data seeded + reloaded');

  // Silence confirm/alert: the PDF import asks "read it directly?" and a native
  // modal would block the capture.
  await win.webContents.executeJavaScript(`
    window.confirm = () => true;
    window.alert = () => {};
    'patched'
  `);

  // Belt and braces: if the guide still managed to open, dismiss it.
  await win.webContents.executeJavaScript(`
    document.querySelector('#setupGuideLaterBtn')?.click();
    document.querySelector('#setupGuideDialog')?.close();
    'dismissed'
  `);
  await sleep(600);

  // Sidebar visible with vocabulary alongside the article.
  await win.webContents.executeJavaScript(`
    document.querySelector('#appSidebar')?.classList.add('pinned');
    'ok'
  `);
  await sleep(500);

  // Show the vocabulary panel so the sidebar isn't an empty placeholder.
  await win.webContents.executeJavaScript(`
    document.querySelector('[data-panel="vocab"]')?.click();
    'ok'
  `);
  await sleep(900);

  // ---- 4. reading --------------------------------------------------------
  await capture(win, 'reading.png');
  step('reading done');

  // ---- 5. flashcards -----------------------------------------------------
  // Done BEFORE the PDF import: importing swaps the toolbar and the flashcard
  // entry button disappears.
  try {
    const diag = await win.webContents.executeJavaScript(`
      (() => {
        const btn = document.querySelector('#openFlashcards');
        const info = { hasButton: !!btn, wordsInPanel: document.querySelectorAll('#wordList > *').length };
        btn && btn.click();
        info.dialogOpen = !!document.querySelector('#flashcardDialog')?.open;
        info.cardWord = (document.querySelector('.flashcard-word')?.textContent || '').trim();
        return JSON.stringify(info);
      })()
    `);
    step('srs diag: ' + diag);
    await sleep(1600);
    await capture(win, 'srs.png');
    step('srs done');
    await win.webContents.executeJavaScript(`
      document.querySelector('#closeFlashcardBtn')?.click();
      document.querySelector('#flashcardDialog')?.close();
      'closed'
    `);
    await sleep(600);
  } catch (e) {
    console.log('SRS CAPTURE FAILED: ' + (e && e.message));
  }

  // ---- 6. PDF view (real import through the file input) -------------------
  try {
    await setFileInput(win, '#textFileInput', pdfPath);
    await sleep(4500);
    await capture(win, 'pdf.png');
    step('pdf done');
  } catch (e) {
    console.log('PDF CAPTURE FAILED: ' + (e && e.message));
  }

  const errs = logs.filter((l) => /error|failed/i.test(l)).slice(0, 5);
  if (errs.length) console.log('PAGE_ERRORS:\n' + errs.join('\n'));

  server.kill();
  fs.rmSync(envDir, { recursive: true, force: true });
}

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION: ' + (reason && reason.stack ? reason.stack : reason));
});

// NOTE: deliberately no `window-all-closed` handler here. Building the sample
// PDF destroys its temporary window, which would otherwise fire that event
// while the main window does not exist yet — quitting the app mid-script.
// Exit is controlled explicitly by the chain below.
app.whenReady()
  .then(main)
  .catch((err) => {
    console.error('FATAL: ' + (err && err.stack ? err.stack : err));
  })
  .finally(() => app.quit());
