import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { setOriginalStageVisibility } from './original-playback';

test('reveals the PDF page and page navigation when entering original PDF mode', () => {
  const pdfStage = { hidden: true, style: { display: 'none' } };
  const editorialStage = { hidden: false, style: { display: '' } };
  const pageNavigation = { hidden: true, style: { display: 'none' } };

  setOriginalStageVisibility({ pdfStage, editorialStage, pageNavigation }, true);

  assert.equal(pdfStage.hidden, false);
  assert.equal(pdfStage.style.display, '');
  assert.equal(editorialStage.hidden, true);
  assert.equal(pageNavigation.hidden, false);
  assert.equal(pageNavigation.style.display, '');
});

test('restores the editorial stage and hides PDF-only controls outside PDF mode', () => {
  const pdfStage = { hidden: false, style: { display: '' } };
  const editorialStage = { hidden: true, style: { display: 'none' } };
  const pageNavigation = { hidden: false, style: { display: '' } };

  setOriginalStageVisibility({ pdfStage, editorialStage, pageNavigation }, false);

  assert.equal(pdfStage.hidden, true);
  assert.equal(editorialStage.hidden, false);
  assert.equal(editorialStage.style.display, '');
  assert.equal(pageNavigation.hidden, true);
});
