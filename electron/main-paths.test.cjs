// LexiRead · © 2026 LSJKANA · AGPL-3.0
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
