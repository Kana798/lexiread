// LexiRead · © 2026 LSJKANA · AGPL-3.0
type JsonResponse = { ok: boolean; json(): Promise<unknown> };
type PublicFetch = (url: string) => Promise<JsonResponse>;

function getGoogleText(payload: unknown): string | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const text = payload[0].map((part: unknown) => Array.isArray(part) ? part[0] : '').filter((part: unknown) => typeof part === 'string').join('').trim();
  return text || null;
}

export async function translateViaPublicProviders(text: string, fetchImpl?: PublicFetch): Promise<{ text: string; provider: 'google' | 'mymemory' } | null> {
  const request = fetchImpl || ((url: string) => fetch(url));
  try {
    const google = await request(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`);
    if (google.ok) {
      const translated = getGoogleText(await google.json());
      if (translated) return { text: translated, provider: 'google' };
    }
  } catch {}
  try {
    const memory = await request(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
    const payload: any = memory.ok ? await memory.json() : null;
    const translated = payload?.responseData?.translatedText;
    if (typeof translated === 'string' && translated.trim() && !translated.toUpperCase().includes('QUERY LENGTH LIMIT')) {
      return { text: translated.trim(), provider: 'mymemory' };
    }
  } catch {}
  return null;
}
