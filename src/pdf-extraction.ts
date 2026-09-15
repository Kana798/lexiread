export interface PdfLineItem {
  str: string;
  x: number;
  width: number;
  size: number;
}

export function formPdfLine(items: PdfLineItem[]): string {
  let text = '';
  let previous: PdfLineItem | null = null;
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    if (!item.str) continue;
    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      const threshold = Math.max(1.8, Math.min(previous.size, item.size) * 0.18);
      if (gap >= threshold && !/\s$/.test(text) && !/^\s/.test(item.str) && !/^[,.;:!?%)\]}]/.test(item.str)) {
        text += ' ';
      }
    }
    text += item.str;
    previous = item;
  }
  return text.replace(/\s+/g, ' ').trim();
}
