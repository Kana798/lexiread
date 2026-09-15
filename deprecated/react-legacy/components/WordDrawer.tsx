import React from "react";
import { Volume2, Bookmark, BookmarkCheck, X, Sparkles, SplitSquareVertical, Loader2, ArrowRight } from "lucide-react";
import { WordAnalysis, VocabularyItem, ReadingTheme } from "../types";
import { speakEnglish } from "../utils/speech";

interface WordDrawerProps {
  word: string;
  contextSentence: string;
  analysis: WordAnalysis | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSaveToVocab: (item: Omit<VocabularyItem, "id" | "addedAt">) => void;
  onRemoveFromVocab: (word: string) => void;
  isSaved: boolean;
  onAnalyzeSentence: (sentence: string) => void;
  theme: ReadingTheme;
}

export const WordDrawer: React.FC<WordDrawerProps> = ({
  word,
  contextSentence,
  analysis,
  loading,
  error,
  onClose,
  onSaveToVocab,
  onRemoveFromVocab,
  isSaved,
  onAnalyzeSentence,
  theme,
}) => {
  const getContainerStyle = () => {
    switch (theme) {
      case "dark":
        return "bg-slate-900 border-slate-800 text-slate-100";
      case "sepia":
        return "bg-[#fbf7ee] border-[#e7dec8] text-[#3e3122]";
      default:
        return "bg-white border-stone-200 text-stone-850";
    }
  };

  const handleToggleVocab = () => {
    if (!analysis) return;
    if (isSaved) {
      onRemoveFromVocab(analysis.word);
    } else {
      onSaveToVocab({
        word: analysis.word,
        phonetic: analysis.phonetic,
        partOfSpeech: analysis.partOfSpeech,
        chineseDefinition: analysis.chineseDefinition,
        englishDefinition: analysis.englishDefinition,
        contextSentence: contextSentence || analysis.exampleSentence || "",
        sourceArticleTitle: "当前文章",
        mastered: false,
      });
    }
  };

  return (
    <div
      id="word-analysis-drawer"
      className={`fixed bottom-0 right-0 z-50 w-full sm:w-[420px] max-h-[85vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-tl-2xl sm:rounded-tr-none shadow-2xl border transition-all ${getContainerStyle()}`}
    >
      {/* Header bar */}
      <div className="sticky top-0 z-10 px-5 py-3.5 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            单词智能精析
          </span>
          {loading && (
            <span className="flex items-center gap-1 text-xs text-stone-400">
              <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
              AI 解析中...
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-stone-200/60 dark:hover:bg-slate-800 transition-colors"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Word and pronunciation */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-2xl font-bold tracking-tight">{word}</h3>
              <button
                id="btn-speak-word"
                onClick={() => speakEnglish(word)}
                className="p-1.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                title="发音朗读"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            {analysis?.phonetic && (
              <p className="text-xs font-mono text-stone-500 dark:text-stone-400 mt-1">
                {analysis.phonetic}
              </p>
            )}
          </div>

          {/* Add to Vocab Button */}
          {analysis && (
            <button
              id="btn-save-vocab"
              onClick={handleToggleVocab}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                isSaved
                  ? "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800"
                  : "bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800"
              }`}
            >
              {isSaved ? (
                <>
                  <BookmarkCheck className="w-3.5 h-3.5 text-amber-600" />
                  <span>已入生词本</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>加入生词本</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Loading state skeleton */}
        {loading && (
          <div className="space-y-3 animate-pulse pt-2">
            <div className="h-5 bg-stone-200 dark:bg-slate-800 rounded w-1/3" />
            <div className="h-14 bg-stone-200 dark:bg-slate-800 rounded w-full" />
            <div className="h-16 bg-stone-200 dark:bg-slate-800 rounded w-full" />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
            <p className="font-semibold">解析提示</p>
            <p className="mt-0.5">{error}</p>
          </div>
        )}

        {/* Analysis content */}
        {analysis && !loading && (
          <div className="space-y-4 text-sm">
            {/* Core Definition */}
            <div className="p-3 rounded-xl bg-stone-100/70 dark:bg-slate-800/60 border border-stone-200/70 dark:border-slate-700/60">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                  {analysis.partOfSpeech}
                </span>
                <span className="font-semibold text-stone-900 dark:text-slate-100">
                  {analysis.chineseDefinition}
                </span>
              </div>
              <p className="text-xs text-stone-600 dark:text-slate-400 mt-1">
                {analysis.englishDefinition}
              </p>
            </div>

            {/* Contextual Meaning */}
            {analysis.contextualMeaning && (
              <div>
                <span className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider block mb-1">
                  语境义 (当前句)
                </span>
                <p className="text-xs text-stone-700 dark:text-stone-300 italic bg-amber-50/50 dark:bg-amber-950/20 p-2.5 rounded-lg border border-amber-200/50 dark:border-amber-900/30">
                  "{analysis.contextualMeaning}"
                </p>
              </div>
            )}

            {/* Collocations */}
            {analysis.collocations && analysis.collocations.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider block mb-1.5">
                  常见地道搭配
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.collocations.map((col, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2.5 py-1 rounded-md bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 font-medium"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Memory Hook / Etymology */}
            {analysis.memoryTip && (
              <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/40 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>词根词缀 & 助记</span>
                </div>
                <p className="text-emerald-900/80 dark:text-emerald-200/90 leading-relaxed">
                  {analysis.memoryTip}
                </p>
              </div>
            )}

            {/* Example sentence */}
            {analysis.exampleSentence && (
              <div className="pt-1">
                <span className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider block mb-1">
                  例句
                </span>
                <div className="text-xs space-y-1 bg-stone-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-stone-200/60 dark:border-slate-700/60">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-stone-800 dark:text-stone-200">
                      {analysis.exampleSentence}
                    </p>
                    <button
                      onClick={() => speakEnglish(analysis.exampleSentence!)}
                      className="p-1 text-stone-400 hover:text-indigo-600 shrink-0"
                      title="朗读例句"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {analysis.exampleTranslation && (
                    <p className="text-stone-500 dark:text-stone-400">
                      {analysis.exampleTranslation}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Jump to Sentence Breakdown */}
            {contextSentence && (
              <div className="pt-2">
                <button
                  id="btn-inspect-sentence-from-word"
                  onClick={() => onAnalyzeSentence(contextSentence)}
                  className="w-full py-2 px-3 text-xs font-medium rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors flex items-center justify-between"
                >
                  <span className="flex items-center gap-1.5">
                    <SplitSquareVertical className="w-3.5 h-3.5" />
                    深入剖析当前长难句语法
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
