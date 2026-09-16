// LexiRead · © 2026 LSJKANA · AGPL-3.0
import JSZip from 'jszip';

/**
 * Minimal EPUB reader: enough of the OPF/OCF spec to turn an .epub into
 * ordered, readable chapters. No DRM, no CSS/layout — the reader only needs
 * clean text with chapter boundaries preserved.
 */

export interface EpubChapter {
  id: string;
  href: string;
  title: string;
  /** Plain text of the chapter, paragraphs separated by blank lines. */
  text: string;
}

export interface EpubBook {
  title: string;
  author: string;
  chapters: EpubChapter[];
}

function textOf(node: Element | null | undefined): string {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Turns XHTML markup into paragraphs, keeping headings as their own lines. */
function extractChapterText(xhtml: string): string {
  // HTML parsing (not XHTML) on purpose: real-world EPUB files routinely ship
  // markup that fails strict XML parsing, and we only need the text.
  const doc = new DOMParser().parseFromString(xhtml, 'text/html');
  const body = doc.querySelector('body') || doc.documentElement;
  if (!body) return '';

  const blocks: string[] = [];
  let sawSkipped = false;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      // <nav> is the EPUB table of contents, not reading content — skip it
      if (tag === 'script' || tag === 'style' || tag === 'nav') {
        sawSkipped = true;
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        const heading = textOf(child);
        if (heading) blocks.push(`## ${heading}`);
        continue;
      }
      if (tag === 'p' || tag === 'li' || tag === 'blockquote' || tag === 'pre' || tag === 'div') {
        const nestedBlock = child.querySelector('p, li, div, blockquote');
        if (nestedBlock && tag !== 'p') {
          walk(child);
          continue;
        }
        const own = textOf(child);
        if (own) blocks.push(own);
        continue;
      }
      if (tag === 'br') {
        blocks.push('');
        continue;
      }
      // fall through for inline wrappers (span, em, a, section…)
      if (child.children.length) {
        walk(child);
      } else {
        const own = textOf(child);
        if (own) blocks.push(own);
      }
    }
  };
  walk(body);

  // If we only skipped structural elements (nav/script) and found no readable
  // blocks, this document has no content — return empty so it gets dropped.
  if (!blocks.length) {
    if (sawSkipped) return '';
    const raw = (body.textContent || '').replace(/[ \t]+/g, ' ').trim();
    return raw;
  }

  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Resolves a manifest href relative to the OPF file's directory. */
function resolvePath(opfPath: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#')[0]);
  if (decoded.startsWith('/')) return decoded.slice(1);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  return dir + decoded;
}

export async function parseEpub(file: File | Blob): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(file);

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml');
  const containerXml = await containerFile.async('string');
  // container.xml 也是固定结构，正则取 rootfile 的 full-path，绕开命名空间解析差异
  const opfMatch = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["']/i);
  const opfPath = opfMatch ? opfMatch[1] : '';
  if (!opfPath) throw new Error('不是有效的 EPUB：无法定位 OPF 文件');

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('EPUB 内容损坏：找不到 OPF 文件');
  const opfXml = await opfFile.async('string');

  // OPF 是结构固定的 XML，但字段带 EPUB 命名空间。用正则提取比依赖 DOM
  // 更鲁棒：既能绕开 jsdom 对带命名空间 XML 的解析缺陷，也对真实 EPUB 里
  // 各式不规范的写法（缺 xmlns、多余前缀、属性顺序不同）宽容。
  const grab = (xml: string, tag: string): string[] => {
    const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
  };
  const attrOf = (attrs: string, name: string): string => {
    const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return m ? m[1] : '';
  };

  // 标题：优先 dc:title 元素（含命名空间前缀的各种写法）
  const titleMatch =
    opfXml.match(/<(?:dc:)?title[^>]*>([\s\S]*?)<\/(?:dc:)?title>/i) ||
    opfXml.match(/<(?:dc:)?title\b[^>]*\/>/i);
  const title =
    (titleMatch && titleMatch[1] ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '') ||
    (file as File).name?.replace(/\.epub$/i, '') ||
    '未命名电子书';
  const authorMatch = opfXml.match(/<(?:dc:)?creator[^>]*>([\s\S]*?)<\/(?:dc:)?creator>/i);
  const author = authorMatch ? authorMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // manifest: id -> href
  const hrefById = new Map<string, string>();
  for (const attrs of grab(opfXml, 'item')) {
    const id = attrOf(attrs, 'id');
    const href = attrOf(attrs, 'href');
    if (id && href) hrefById.set(id, href);
  }

  // spine 阅读顺序
  const orderedIds: string[] = [];
  for (const attrs of grab(opfXml, 'itemref')) {
    const idref = attrOf(attrs, 'idref');
    if (idref) orderedIds.push(idref);
  }
  // Some books omit the spine: fall back to every XHTML in the manifest.
  if (!orderedIds.length) {
    for (const [id, href] of hrefById) {
      if (/\.(x?html|htm)$/i.test(href)) orderedIds.push(id);
    }
  }

  const chapters: EpubChapter[] = [];
  for (const id of orderedIds) {
    const href = hrefById.get(id);
    if (!href) continue;
    const path = resolvePath(opfPath, href);
    const docFile = zip.file(path);
    if (!docFile) continue;
    const xhtml = await docFile.async('string');
    const text = extractChapterText(xhtml);
    if (!text.trim()) continue; // skip nav/cover-only documents
    chapters.push({
      id,
      href: path,
      title: guessChapterTitle(xhtml, chapters.length + 1),
      text,
    });
  }

  if (!chapters.length) throw new Error('未能从该 EPUB 中提取到正文内容');
  return { title, author, chapters };
}

function guessChapterTitle(xhtml: string, fallbackIndex: number): string {
  try {
    const doc = new DOMParser().parseFromString(xhtml, 'text/html');
    for (const tag of ['h1', 'h2', 'h3', 'title']) {
      const el = doc.querySelector(tag);
      const value = textOf(el);
      if (value) return value.slice(0, 120);
    }
  } catch {
    // fall through to the numeric fallback
  }
  return `第 ${fallbackIndex} 章`;
}

/** Joins chapters into a single readable document for the article pipeline. */
export function chaptersToDocument(book: EpubBook): string {
  return book.chapters
    .map((chapter) => `## ${chapter.title}\n\n${chapter.text}`)
    .join('\n\n')
    .trim();
}
