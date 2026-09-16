// LexiRead · © 2026 LSJKANA · AGPL-3.0
export interface TextDiagnosticResult {
  hasIssues: boolean;
  brokenHyphens: number;
  unnaturalLineBreaks: number;
  mergedPunctuation: number;
  garbledChars: number;
  multiSpaces: number;
  bulletOrPageNumbers: number;
  summary: string;
  details: string[];
}

export function diagnoseText(text: string): TextDiagnosticResult {
  const brokenHyphens = (text.match(/([A-Za-z]{2,})[ \t]*-[ \t]*\r?\n[ \t]*([A-Za-z]{2,})/g) || []).length;
  const unnaturalLineBreaks = (text.match(/([A-Za-z0-9,;])[ \t]*\r?\n[ \t]*(?=[A-Za-z0-9])/g) || []).length;
  const mergedPunctuation = (text.match(/([A-Za-z]{2,}[,.?!;:])([A-Za-z]{2,})/g) || []).length;
  const garbledChars = (text.match(/\uFFFD|[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  const multiSpaces = (text.match(/[ \t]{3,}/g) || []).length;
  const bulletOrPageNumbers = (text.match(/(?:^|\n)[ \t]*(?:page\s+\d+(?:\s+of\s+\d+)?|-?\s*\d+\s*-?)[ \t]*(?=\r?\n|$)/gi) || []).length;
  const total = brokenHyphens + unnaturalLineBreaks + mergedPunctuation + garbledChars + multiSpaces + bulletOrPageNumbers;
  const details: string[] = [];
  if (brokenHyphens) details.push(`发现 ${brokenHyphens} 处换行连字符截断`);
  if (unnaturalLineBreaks) details.push(`发现 ${unnaturalLineBreaks} 处句中异常折行`);
  if (mergedPunctuation) details.push(`发现 ${mergedPunctuation} 处标点后缺少空格`);
  if (garbledChars) details.push(`发现 ${garbledChars} 处乱码或控制字符`);
  if (multiSpaces) details.push(`发现 ${multiSpaces} 处冗余空白`);
  if (bulletOrPageNumbers) details.push(`发现 ${bulletOrPageNumbers} 处页码噪音`);
  return {
    hasIssues: total > 0,
    brokenHyphens,
    unnaturalLineBreaks,
    mergedPunctuation,
    garbledChars,
    multiSpaces,
    bulletOrPageNumbers,
    summary: total ? `⚠️ 发现 ${total} 处潜在提取排版缺陷` : '✓ 文本排版清晰规范',
    details,
  };
}

export function repairText(raw: string): { repaired: string; count: number } {
  const report = diagnoseText(raw);
  const repaired = raw
    .replace(/\u00AD/g, '')
    .replace(/[\uFB00]/g, 'ff').replace(/[\uFB01]/g, 'fi').replace(/[\uFB02]/g, 'fl')
    .replace(/[\uFB03]/g, 'ffi').replace(/[\uFB04]/g, 'ffl').replace(/[\uFB05\uFB06]/g, 'st')
    .replace(/(?:^|\n)[ \t]*(?:page\s+\d+(?:\s+of\s+\d+)?|-?\s*\d+\s*-?)[ \t]*(?=\r?\n|$)/gi, '')
    .replace(/([A-Za-z]{2,})[ \t]*-[ \t]*\r?\n[ \t]*([A-Za-z]{2,})/g, '$1$2')
    .replace(/([A-Za-z0-9,;])[ \t]*\r?\n[ \t]*(?=[A-Za-z0-9])/g, '$1 ')
    .replace(/([A-Za-z]{2,}[,.?!;:])([A-Za-z])/g, '$1 $2')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/\uFFFD|[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[ \t]{2,}/g, ' ').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { repaired, count: report.brokenHyphens + report.unnaturalLineBreaks + report.mergedPunctuation + report.bulletOrPageNumbers };
}
