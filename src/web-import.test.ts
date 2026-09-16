// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { isBlockedHost, decodeEntities, extractReadableText } from './web-import';

// ---------------------------------------------------------------------------
// isBlockedHost — SSRF guard
// ---------------------------------------------------------------------------

test('拦截 localhost 与 .local 域名', () => {
  assert.equal(isBlockedHost('localhost'), true);
  assert.equal(isBlockedHost('api.localhost'), true);
  assert.equal(isBlockedHost('printer.local'), true);
});

test('拦截 IPv4 回环与私有网段', () => {
  assert.equal(isBlockedHost('127.0.0.1'), true);
  assert.equal(isBlockedHost('127.1.2.3'), true);
  assert.equal(isBlockedHost('10.0.0.5'), true);
  assert.equal(isBlockedHost('192.168.1.1'), true);
  assert.equal(isBlockedHost('172.16.0.1'), true);
  assert.equal(isBlockedHost('172.31.255.254'), true);
  assert.equal(isBlockedHost('0.0.0.0'), true);
});

test('拦截云元数据与保留地址', () => {
  assert.equal(isBlockedHost('169.254.169.254'), true); // AWS/GCP metadata
  assert.equal(isBlockedHost('100.64.0.1'), true); // CGNAT
  assert.equal(isBlockedHost('224.0.0.1'), true); // multicast
});

test('拦截 IPv6 回环与内网地址', () => {
  assert.equal(isBlockedHost('::1'), true);
  assert.equal(isBlockedHost('[::1]'), true);
  assert.equal(isBlockedHost('fd00::1'), true); // unique-local
  assert.equal(isBlockedHost('fe80::1'), true); // link-local
});

test('放行正常公网域名与 IP', () => {
  assert.equal(isBlockedHost('example.com'), false);
  assert.equal(isBlockedHost('www.bbc.co.uk'), false);
  assert.equal(isBlockedHost('8.8.8.8'), false);
  assert.equal(isBlockedHost('172.32.0.1'), false); // 刚好在私有段之外
  assert.equal(isBlockedHost('172.15.0.1'), false);
});

test('空主机名视为不安全', () => {
  assert.equal(isBlockedHost(''), true);
});

// ---------------------------------------------------------------------------
// decodeEntities
// ---------------------------------------------------------------------------

test('解码常见 HTML 实体', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(decodeEntities('a &lt;b&gt; c'), 'a <b> c');
  assert.equal(decodeEntities('&quot;quoted&quot;'), '"quoted"');
  assert.equal(decodeEntities('caf&eacute;'), 'caf&eacute;'); // 未收录的实体保持原样
});

test('解码数字实体（十进制与十六进制）', () => {
  assert.equal(decodeEntities('&#39;'), "'");
  assert.equal(decodeEntities('&#x27;'), "'");
  assert.equal(decodeEntities('A&#8212;B'), 'A—B');
});

// ---------------------------------------------------------------------------
// extractReadableText
// ---------------------------------------------------------------------------

const SAMPLE = `<!doctype html>
<html><head><title>Attention &amp; Focus</title>
<style>body{color:red}</style>
<script>window.tracker=1</script>
</head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <header><p>Site header text that is long enough to look like content maybe not</p></header>
  <article>
    <h1>Attention &amp; Focus</h1>
    <p>Attention has become one of our most valuable possessions in an age of endless notifications.</p>
    <p>We give it away in small pieces: to a bright screen, a familiar sound, the promise of something new.</p>
    <p>Short.</p>
  </article>
  <footer><p>Copyright 2026 Example Corp. All rights reserved worldwide forever and ever.</p></footer>
</body></html>`;

test('提取标题并解码实体', () => {
  const { title } = extractReadableText(SAMPLE);
  assert.equal(title, 'Attention & Focus');
});

test('保留正文段落并去掉脚本样式', () => {
  const { text } = extractReadableText(SAMPLE);
  assert.match(text, /most valuable possessions/);
  assert.match(text, /give it away in small pieces/);
  assert.ok(!text.includes('window.tracker'));
  assert.ok(!text.includes('color:red'));
});

test('过滤导航与页脚等页面装饰', () => {
  const { text } = extractReadableText(SAMPLE);
  assert.ok(!text.includes('Site header'));
  assert.ok(!text.includes('All rights reserved'));
  assert.ok(!text.includes('Home'));
});

test('丢弃过短的段落', () => {
  const { text } = extractReadableText(SAMPLE);
  assert.ok(!text.includes('Short.'));
});

test('段落之间以空行分隔', () => {
  const { text } = extractReadableText(SAMPLE);
  assert.equal(text.split('\n\n').length, 2);
});

test('无 <p> 标签时退化为整块文本', () => {
  const html = '<html><body><div>Just one long block of text without any paragraph markup at all here.</div></body></html>';
  const { text } = extractReadableText(html);
  assert.match(text, /Just one long block/);
});

test('无标题时返回空标题', () => {
  const { title } = extractReadableText('<html><body><p>Body only content here for the test case.</p></body></html>');
  assert.equal(title, '');
});
