/**
 * Web article import helpers.
 *
 * Kept separate from server.ts so the security-critical host check and the
 * HTML→text extraction can be unit-tested without booting the server.
 */

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '\u2019', lsquo: '\u2018',
  ldquo: '\u201C', rdquo: '\u201D', middot: '·', copy: '©',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return ' ';
      }
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return ' ';
      }
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * True when a hostname must not be fetched: loopback, private ranges,
 * link-local (cloud metadata) and other reserved space. Prevents the import
 * proxy from being used to probe the user's own network (SSRF).
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
  }

  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique-local
  if (/^fe80:/.test(host)) return true; // link-local
  return false;
}

/** Dependency-free readability: drop page chrome, keep real paragraphs. */
export function extractReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';

  // Prefer a semantic container when the page provides one.
  let scope = html;
  const article = html.match(/<article[\s\S]*?<\/article>/i);
  const main = html.match(/<main[\s\S]*?<\/main>/i);
  if (article && article[0].length > 500) scope = article[0];
  else if (main && main[0].length > 500) scope = main[0];

  const cleaned = scope
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside|form|iframe|button|select)[\s\S]*?<\/\1>/gi, ' ');

  const paragraphs: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    // Short <p>s are almost always navigation/captions, not article prose.
    if (text.length >= 40) paragraphs.push(text);
  }

  if (!paragraphs.length) {
    const flat = decodeEntities(cleaned.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return { title, text: flat };
  }
  return { title, text: paragraphs.join('\n\n') };
}
