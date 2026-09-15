const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { findFreeLoopbackPort, findStableLoopbackPort, waitForHealth } = require('./local-server.cjs');

const PREFERRED_PORTS = [39321, 39322, 39323, 39324, 39325];

test('findFreeLoopbackPort returns a bindable loopback port', async () => {
  const port = await findFreeLoopbackPort();
  const server = http.createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(port, '127.0.0.1', resolve),
  );
  await new Promise((resolve) => server.close(resolve));
});

test('findStableLoopbackPort sticks to the first preferred port so the origin does not change', async () => {
  const occupier = net.createServer();
  if (!(await new Promise((resolve) => {
    occupier.once('error', () => resolve(false));
    occupier.listen(PREFERRED_PORTS[0], '127.0.0.1', () => resolve(true));
  }))) {
    // Preferred port already taken by the environment; the assertion below still holds.
  }

  const port = await findStableLoopbackPort();
  assert.equal(PREFERRED_PORTS.includes(port), true, 'must pick from the deterministic range');
  assert.notEqual(port, PREFERRED_PORTS[0], 'must skip the occupied port');

  await new Promise((resolve) => occupier.close(resolve));

  // Once the range is free again the very first preferred port is reused, which
  // is what keeps localStorage attached to a stable origin.
  assert.equal(await findStableLoopbackPort(), PREFERRED_PORTS[0]);
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
