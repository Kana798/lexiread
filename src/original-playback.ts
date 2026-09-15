export interface OriginalPlaybackStage {
  hidden: boolean;
  style: { display: string };
}

export interface OriginalPlaybackStages {
  pdfStage?: OriginalPlaybackStage | null;
  editorialStage?: OriginalPlaybackStage | null;
  pageNavigation?: OriginalPlaybackStage | null;
}

function show(stage: OriginalPlaybackStage | null | undefined): void {
  if (!stage) return;
  stage.hidden = false;
  stage.style.display = '';
}

function hide(stage: OriginalPlaybackStage | null | undefined): void {
  if (!stage) return;
  stage.hidden = true;
  stage.style.display = '';
}

export function setOriginalStageVisibility(stages: OriginalPlaybackStages, showPdf: boolean): void {
  if (showPdf) {
    show(stages.pdfStage);
    hide(stages.editorialStage);
    show(stages.pageNavigation);
    return;
  }

  hide(stages.pdfStage);
  show(stages.editorialStage);
  hide(stages.pageNavigation);
}
