// LexiRead · © 2026 LSJKANA · AGPL-3.0
const { app, BrowserWindow, dialog } = require('electron');
const { resolveDesktopPaths } = require('./main-paths.cjs');
const { startLocalServer } = require('./local-server.cjs');

let serverStop = null;

async function bootstrap() {
  await app.whenReady();
  
  try {
    const { appRoot, serverPath, envPath } = resolveDesktopPaths({
      isPackaged: app.isPackaged,
      dirname: __dirname,
      userDataPath: app.getPath('userData')
    });

    const serverInfo = await startLocalServer({
      electronExecutable: process.execPath,
      serverPath,
      appRoot,
      envPath
    });
    
    serverStop = serverInfo.stop;

    const win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 960,
      minHeight: 640,
      title: 'LexiRead · 英语阅读器',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    // Hide menu bar for cleaner look, similar to typical desktop apps
    win.setMenu(null);

    await win.loadURL('http://127.0.0.1:' + serverInfo.port + '/');
  } catch (err) {
    dialog.showErrorBox('LexiRead 无法启动', err.message);
    app.quit();
  }
}

app.on('before-quit', async (e) => {
  if (serverStop) {
    e.preventDefault();
    const stopFn = serverStop;
    serverStop = null;
    await stopFn();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

bootstrap();
