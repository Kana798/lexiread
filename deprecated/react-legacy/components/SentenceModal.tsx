import React from "react";
import { X, Volume2, SplitSquareVertical, Loader2, Sparkles, BookOpen } from "lucide-react";
import { SentenceAnalysis, ReadingTheme } from "../types";
import { speakEnglish } from "../utils/speech";

interface SentenceModalProps {
  sentence: string;
  analysis: SentenceAnalysis | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onWordClick: (word: string) => void;
  theme: ReadingTheme;
}

export const SentenceModal: React.FC<SentenceModalProps> = ({
  sentence,
  analysis,
  loading,
  error,
  onClose,
  onWordClick,
  theme,
}) => {
  const getContainerStyle = () => {
    switch (theme) {
      case "dark":
        return "bg-slate-900 border-slate-800 text-slate-100";
      case "sepia":
        return "bg-[#fbf7ee] border-[#e7dec8] text-[#3e3122]";
      default:
        return "bg-white border-stone-200 text-stone-900";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="sentence-analysis-modal"
        className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transition-all ${getContainerStyle()}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center">
              <SplitSquareVertical className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">长难句语法剖析</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                主谓宾结构解构 · 从句拆解 · 地道中文翻译
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-stone-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Original sentence box */}
          <div className="p-4 rounded-xl bg-stone-50 dark:bg-slate-800/60 border border-stone-200 dark:border-slate-700/80 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-serif leading-relaxed text-stone-900 dark:text-slate-100 font-medium">
                {sentence}
              </p>
              <button
                onClick={() => speakEnglish(sentence)}
                className="p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors shrink-0"
                title="整句朗读"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>

            {/* Translation (if loaded) */}
            {analysis?.chineseTranslation && (
              <div className="pt-2 border-t border-stone-200/60 dark:border-slate-700/60">
                <span className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider block mb-0.5">
                  参考译文
                </span>
                <p className="text-sm text-stone-700 dark:text-slate-300 font-sans leading-relaxed">
                  {analysis.chineseTranslation}
                </p>
              </div>
            )}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-stone-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-sm font-medium">AI 正在深度解析句子句法与主干...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200 border border-rose-200 dark:border-rose-900 text-sm">
              {error}
            </div>
          )}

          {/* Detailed Grammar Structure Analysis */}
          {analysis && !loading && (
            <div className="space-y-5">
              {/* Level indicator */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500 dark:text-stone-400 font-medium">
                  句子难度等级:
                </span>
                <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  CEFR {analysis.cefrLevel || "B2"}
                </span>
              </div>

              {/* Syntactic Structure Grid */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                  句法成分拆解 (Syntactic Breakdown)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {analysis.structure?.subject && (
                    <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50">
                      <span className="text-xs font-bold text-sky-800 dark:text-sky-300">
                        主语 (Subject)
                      </span>
                      <p className="text-xs mt-1 text-sky-900/90 dark:text-sky-200 font-mono font-medium">
                        {analysis.structure.subject}
                      </p>
                    </div>
                  )}

                  {analysis.structure?.predicate && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                      <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                        谓语 (Predicate)
                      </span>
                      <p className="text-xs mt-1 text-emerald-900/90 dark:text-emerald-200 font-mono font-medium">
                        {analysis.structure.predicate}
                      </p>
                    </div>
                  )}

                  {analysis.structure?.objectOrComplement && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                      <span className="text-xs font-bold text-amber-800 dark:text-amber-300">
                        宾语 / 表语 (Object / Complement)
                      </span>
                      <p className="text-xs mt-1 text-amber-900/90 dark:text-amber-200 font-mono font-medium">
                        {analysis.structure.objectOrComplement}
                      </p>
                    </div>
                  )}

                  {analysis.structure?.adverbialOrModifier && (
                    <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50">
                      <span className="text-xs font-bold text-purple-800 dark:text-purple-300">
                        修饰成分 / 状语 (Modifier / Adverbial)
                      </span>
                      <p className="text-xs mt-1 text-purple-900/90 dark:text-purple-200 font-mono font-medium">
                        {analysis.structure.adverbialOrModifier}
                      </p>
                    </div>
                  )}
                </div>

                {analysis.structure?.clauseAnalysis && (
                  <div className="mt-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
                    <span className="text-xs font-bold text-rose-800 dark:text-rose-300">
                      从句结构解析 (Clause Analysis)
                    </span>
                    <p className="text-xs mt-1 text-rose-900/90 dark:text-rose-200 leading-relaxed">
                      {analysis.structure.clauseAnalysis}
                    </p>
                  </div>
                )}
              </div>

              {/* Grammar Points */}
              {analysis.grammarExplanation && analysis.grammarExplanation.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
                    重点语法与考点解析
                  </h4>
                  <ul className="space-y-2 text-xs">
                    {analysis.grammarExplanation.map((point, idx) => (
                      <li
                        key={idx}
                        className="p-2.5 rounded-lg bg-stone-100/70 dark:bg-slate-800/60 border border-stone-200/70 dark:border-slate-700/60 leading-relaxed"
                      >
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 mr-1.5">
                          #{idx + 1}
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key Words in this Sentence */}
              {analysis.keyWords && analysis.keyWords.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    本句核心词汇 (点击直接查词)
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {analysis.keyWords.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          onClose();
                          onWordClick(item.word);
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors flex items-center gap-1"
                      >
                        <span className="font-bold">{item.word}</span>
                        <span className="text-stone-500 dark:text-stone-400">· {item.meaning}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
