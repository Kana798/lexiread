const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { findFreeLoopbackPort, findStableLoopbackPort, waitForHealth } = require('./local-server.cjs');

const PREFERRED_PORTS = [39321, 39322, 39323, 39324, 39325];

/** 探测某个端口当前是否可绑定。测试不能假定环境是空闲的。 */
function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** 当前环境下固定端口范围内可用的端口，按范围顺序排列。 */
async function availablePreferredPorts() {
  const free = [];
  for (const candidate of PREFERRED_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(candidate)) free.push(candidate);
  }
  return free;
}

test('findFreeLoopbackPort returns a bindable loopback port', async () => {
  const port = await findFreeLoopbackPort();
  const server = http.createServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(port, '127.0.0.1', resolve),
  );
  await new Promise((resolve) => server.close(resolve));
});

test('findStableLoopbackPort takes the first available port in the fixed range, every time', async () => {
  // 环境不保证空闲：正在运行的 LexiRead 会占住 39321。先探测再断言。
  const free = await availablePreferredPorts();

  if (free.length === 0) {
    // 整个范围都被占满时回退到范围外端口，这是设计内的降级，不应判失败。
    const fallback = await findStableLoopbackPort();
    assert.equal(
      PREFERRED_PORTS.includes(fallback),
      false,
      'whole range occupied -> must fall back outside the range',
    );
    return;
  }

  assert.equal(await findStableLoopbackPort(), free[0], 'must take the first available port');
  // 稳定性才是这个函数的全部意义：每次启动都拿到同一个端口，
  // localStorage 才会固定挂在同一个源上，用户数据才不会"消失"。
  assert.equal(await findStableLoopbackPort(), free[0], 'must stay stable across repeated calls');
});

test('findStableLoopbackPort skips a port held by another process', async () => {
  const free = await availablePreferredPorts();
  if (free.length < 2) return; // 环境里没有足够余量来验证"跳过"行为

  const occupier = net.createServer();
  await new Promise((resolve, reject) => {
    occupier.once('error', reject);
    occupier.listen(free[0], '127.0.0.1', resolve);
  });
  try {
    assert.equal(await findStableLoopbackPort(), free[1], 'must skip the occupied port');
  } finally {
    await new Promise((resolve) => occupier.close(resolve));
  }
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
