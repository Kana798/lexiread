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

test('defaults to loopback so the credential proxy stays off the LAN', () => {
  const runtime = resolveServerRuntime({ cwd: 'C:/work/LexiRead', env: {} });
  assert.equal(runtime.distPath, 'C:/work/LexiRead/dist');
  assert.equal(runtime.envPath, undefined);
  assert.equal(runtime.bindHost, '127.0.0.1');
});

test('allows an explicit LAN opt-in through LEXI_BIND_HOST', () => {
  const runtime = resolveServerRuntime({ cwd: 'C:/work/LexiRead', env: { LEXI_BIND_HOST: '0.0.0.0' } });
  assert.equal(runtime.bindHost, '0.0.0.0');
});
