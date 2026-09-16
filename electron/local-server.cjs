// LexiRead · © 2026 LSJKANA · AGPL-3.0
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

/**
 * Deterministic loopback port range.
 *
 * The renderer is served over `http://127.0.0.1:<port>`, and the browser scopes
 * `localStorage` by origin — which includes the port. Picking a *random* free
 * port on every launch therefore handed the app a brand-new origin each time,
 * so the article library, vocabulary list and reader settings appeared to be
 * wiped on every restart. Preferring a small fixed range keeps the origin (and
 * thus the user's data) stable, while still falling back to a random port if
 * something else already owns them.
 */
const PREFERRED_PORTS = [39321, 39322, 39323, 39324, 39325];

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findStableLoopbackPort() {
  for (const port of PREFERRED_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) return port;
  }
  return findFreeLoopbackPort();
}

function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForHealth(port, timeoutMs, getChildError) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let lastError = null;
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    }

    function check() {
      if (settled) return;

      // If the child already died (bad path, crash on boot) there is no point
      // waiting for the full timeout.
      const childError = typeof getChildError === 'function' ? getChildError() : null;
      if (childError) {
        return finish(new Error('Server process exited before becoming ready: ' + childError.message));
      }
      if (Date.now() - startTime > timeoutMs) {
        return finish(new Error('Health check timed out. Last error: ' + (lastError ? lastError.message : 'none')));
      }

      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          finish(null);
        } else {
          lastError = new Error('Status code: ' + res.statusCode);
          // Drain the body, otherwise the keep-alive socket is never released
          // and the retry loop slowly leaks connections.
          res.resume();
          setTimeout(check, 100);
        }
      });
      req.on('error', (err) => {
        lastError = err;
        setTimeout(check, 100);
      });
      req.end();
    }

    check();
  });
}

function startLocalServer({ electronExecutable, serverPath, appRoot, envPath }) {
  return findStableLoopbackPort().then(async (port) => {
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
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let childError = null;
    child.on('error', (err) => {
      childError = err;
    });
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        childError = new Error(`exit code ${code}${signal ? ` (${signal})` : ''}`);
      }
    });

    // Surface the server's own diagnostics (config loading, provider errors)
    // in the desktop console instead of silently discarding them.
    if (child.stdout) child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    if (child.stderr) child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

    let stopped = false;
    function stopChild() {
      if (stopped) return Promise.resolve();
      stopped = true;
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
        // Fallback for Windows if it doesn't close within 5s
        setTimeout(() => {
          try {
            if (!child.killed) {
              process.kill(child.pid, 'SIGKILL');
            }
          } catch (e) {
            // Ignore if already dead
          }
        }, 5000);
      });
    }

    try {
      await waitForHealth(port, 10000, () => childError);
    } catch (error) {
      await stopChild();
      throw error;
    }

    return { port, child, stop: stopChild };
  });
}

module.exports = {
  findFreeLoopbackPort,
  findStableLoopbackPort,
  waitForHealth,
  startLocalServer,
};
