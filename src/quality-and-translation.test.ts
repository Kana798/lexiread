import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { diagnoseText, repairText } from './text-quality';
import { translateViaPublicProviders } from './public-translation';

test('detects common OCR and PDF line-break defects even when the next line is indented', () => {
  const report = diagnoseText('inter-\n  national effort,\n  next step.However it continues.\n\nPage 12\n');

  assert.equal(report.brokenHyphens, 1);
  assert.equal(report.unnaturalLineBreaks, 1);
  assert.equal(report.mergedPunctuation, 1);
  assert.equal(report.bulletOrPageNumbers, 1);
  assert.equal(report.hasIssues, true);
});

test('repairs detected PDF defects without flattening paragraph boundaries', () => {
  const result = repairText('inter-\n  national effort,\n  next step.However it continues.\n\nPage 12\n\nA new paragraph.');

  assert.equal(result.repaired, 'international effort, next step. However it continues.\n\nA new paragraph.');
  assert.equal(result.count, 4);
});

test('uses a secondary public translation service when the primary service is unavailable', async () => {
  const urls: string[] = [];
  const translation = await translateViaPublicProviders('A short sentence.', async (url) => {
    urls.push(String(url));
    if (urls.length === 1) throw new Error('primary unavailable');
    return new Response(JSON.stringify({ responseData: { translatedText: '一句简短的话。' } }), { status: 200 });
  });

  assert.equal(translation?.text, '一句简短的话。');
  assert.equal(translation?.provider, 'mymemory');
  assert.equal(urls.length, 2);
});
