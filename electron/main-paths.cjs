const path = require('node:path');

function resolveDesktopPaths({ isPackaged, dirname, userDataPath }) {
  const appRoot = path.resolve(dirname, '..').replace(/\\/g, '/');
  return {
    appRoot,
    serverPath: path.join(appRoot, 'dist', 'server.cjs').replace(/\\/g, '/'),
    envPath: path.join(userDataPath, '.env').replace(/\\/g, '/'),
  };
}

module.exports = { resolveDesktopPaths };
