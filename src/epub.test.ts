// LexiRead · © 2026 LSJKANA · AGPL-3.0
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { parseEpub, chaptersToDocument } from './epub';

// The parser relies on the browser's DOMParser; jsdom supplies one under Node.
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  (globalThis as any).DOMParser = dom.window.DOMParser;
});

/** Builds a minimal but spec-shaped EPUB in memory. */
async function buildEpub(
  chapters: Array<{ title: string; paragraphs: string[] }>,
  opts: { title?: string; author?: string; withSpine?: boolean } = {}
): Promise<Blob> {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
       <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
     </container>`
  );

  const manifest = chapters
    .map((_, i) => `<item id="chap${i}" href="chap${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('');
  const spine = opts.withSpine === false
    ? ''
    : `<spine>${chapters.map((_, i) => `<itemref idref="chap${i}"/>`).join('')}</spine>`;

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">
       <metadata>
         <dc:title>${opts.title || '测试电子书'}</dc:title>
         <dc:creator>${opts.author || '某作者'}</dc:creator>
       </metadata>
       <manifest>${manifest}</manifest>
       ${spine}
     </package>`
  );

  chapters.forEach((chapter, i) => {
    const body = chapter.paragraphs.map((p) => `<p>${p}</p>`).join('');
    zip.file(
      `OEBPS/chap${i}.xhtml`,
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>
         <title>${chapter.title}</title></head><body><h2>${chapter.title}</h2>${body}</body></html>`
    );
  });

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new Blob([buffer]);
}

test('解析章节顺序与元数据', async () => {
  const blob = await buildEpub([
    { title: '第一章 启程', paragraphs: ['First paragraph.', 'Second paragraph.'] },
    { title: '第二章 深入', paragraphs: ['Third paragraph.'] },
  ], { title: '我的书', author: '张三' });

  const book = await parseEpub(blob);
  assert.equal(book.title, '我的书');
  assert.equal(book.author, '张三');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, '第一章 启程');
  assert.equal(book.chapters[1].title, '第二章 深入');
});

test('章节正文保留段落与标题层级', async () => {
  const blob = await buildEpub([
    { title: '章节标题', paragraphs: ['Paragraph one.', 'Paragraph two.'] },
  ]);
  const book = await parseEpub(blob);
  const text = book.chapters[0].text;
  assert.match(text, /## 章节标题/);
  assert.match(text, /Paragraph one\./);
  assert.match(text, /Paragraph two\./);
  // paragraphs stay separated
  assert.match(text, /Paragraph one\.\n\nParagraph two\./);
});

test('缺少 spine 时按 manifest 顺序兜底', async () => {
  const blob = await buildEpub([
    { title: 'A', paragraphs: ['Alpha content.'] },
    { title: 'B', paragraphs: ['Beta content.'] },
  ], { withSpine: false });

  const book = await parseEpub(blob);
  assert.equal(book.chapters.length, 2);
});

test('跳过无正文的导航页', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>');
  zip.file('content.opf',
    '<package xmlns="http://www.idpf.org/2007/opf"><metadata><dc:title>书</dc:title></metadata>' +
    '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
    '<spine><itemref idref="nav"/><itemref idref="c1"/></spine></package>');
  zip.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ul><li>a</li></ul></nav></body></html>');
  zip.file('c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>正文</h1><p>Real content here.</p></body></html>');

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const book = await parseEpub(new Blob([buffer]));
  assert.equal(book.chapters.length, 1);
  assert.match(book.chapters[0].text, /Real content here\./);
});

test('非 EPUB 文件抛出可读错误', async () => {
  const zip = new JSZip();
  zip.file('readme.txt', 'not an epub');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => parseEpub(new Blob([buffer])), /EPUB/);
});

test('chaptersToDocument 拼接为带章节标题的正文', async () => {
  const blob = await buildEpub([
    { title: '第一章', paragraphs: ['One.'] },
    { title: '第二章', paragraphs: ['Two.'] },
  ]);
  const book = await parseEpub(blob);
  const doc = chaptersToDocument(book);
  assert.match(doc, /## 第一章/);
  assert.match(doc, /## 第二章/);
  assert.equal(doc.includes('One.'), true);
  assert.equal(doc.includes('Two.'), true);
});
