import React, { useState, useEffect, useMemo } from "react";
import { Volume2, SplitSquareVertical } from "lucide-react";
import { Article, ReaderSettings } from "../types";
import { speakEnglish } from "../utils/speech";

interface ReaderViewProps {
  article: Article;
  settings: ReaderSettings;
  onWordClick: (word: string, contextSentence: string) => void;
  onSentenceClick: (sentence: string) => void;
  activeWord?: string;
  onToggleBilingual?: () => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  article,
  settings,
  onWordClick,
  onSentenceClick,
  activeWord,
}) => {
  const [bilingualSentences, setBilingualSentences] = useState<{ en: string; zh: string }[]>([]);
  const [loadingBilingual, setLoadingBilingual] = useState(false);
  const [readingSeconds, setReadingSeconds] = useState(0);

  // Reading timer
  useEffect(() => {
    const timer = setInterval(() => {
      setReadingSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch bilingual alignment when mode is parallel or hover
  useEffect(() => {
    let isCancelled = false;
    if (settings.bilingualMode === "parallel") {
      setLoadingBilingual(true);
      fetch("/api/bilingual-align", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: article.content }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!isCancelled && data.sentences) {
            setBilingualSentences(data.sentences);
          }
        })
        .catch((err) => console.error("Error aligning bilingual:", err))
        .finally(() => {
          if (!isCancelled) setLoadingBilingual(false);
        });
    }
    return () => {
      isCancelled = true;
    };
  }, [article.content, settings.bilingualMode]);

  // Clean paragraphs into structured tokens
  const paragraphs = useMemo(() => {
    return article.content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  }, [article.content]);

  // Font family class
  const getFontFamilyClass = () => {
    switch (settings.fontFamily) {
      case "serif":
        return "font-serif";
      case "mono":
        return "font-mono";
      default:
        return "font-sans";
    }
  };

  const getContainerStyle = () => {
    switch (settings.theme) {
      case "dark":
        return "bg-slate-950 text-slate-200";
      case "sepia":
        return "bg-[#fbf7ee] text-[#3c2f1f]";
      default:
        return "bg-stone-50/50 text-stone-900";
    }
  };

  const getPaperCardStyle = () => {
    switch (settings.theme) {
      case "dark":
        return "bg-slate-900/90 border-slate-800 shadow-xl";
      case "sepia":
        return "bg-[#f7f0e0] border-[#e8ddc4] shadow-md";
      default:
        return "bg-white border-stone-200/90 shadow-sm";
    }
  };

  // Helper to split paragraph into sentences and words
  const renderParagraph = (pText: string, pIdx: number) => {
    // Regex matching sentences while preserving punctuation
    const rawSentences = pText.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [pText];

    return (
      <div key={pIdx} className="mb-6 last:mb-0">
        <p
          className="leading-relaxed"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
          }}
        >
          {rawSentences.map((sentence, sIdx) => {
            const trimmedSentence = sentence.trim();
            // Split sentence into words and punctuation
            const words = sentence.split(/([a-zA-Z0-9'-]+)/);

            return (
              <span
                key={sIdx}
                className="group/sentence relative inline rounded px-0.5 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 transition-colors"
              >
                {words.map((chunk, cIdx) => {
                  const isWord = /^[a-zA-Z0-9'-]+$/.test(chunk);
                  if (!isWord) {
                    return <span key={cIdx}>{chunk}</span>;
                  }

                  const isCurrentActive =
                    activeWord &&
                    activeWord.toLowerCase() === chunk.toLowerCase();

                  return (
                    <span
                      key={cIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onWordClick(chunk, trimmedSentence);
                      }}
                      className={`cursor-pointer rounded-xs px-0.5 transition-all hover:bg-indigo-200 dark:hover:bg-indigo-800/80 hover:text-indigo-950 dark:hover:text-white ${
                        isCurrentActive
                          ? "bg-amber-200 dark:bg-amber-800 font-bold text-amber-950 dark:text-amber-100 ring-2 ring-amber-400"
                          : ""
                      }`}
                      title="点击查词释义"
                    >
                      {chunk}
                    </span>
                  );
                })}

                {/* Sentence action trigger icon on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSentenceClick(trimmedSentence);
                  }}
                  className="opacity-0 group-hover/sentence:opacity-100 inline-flex items-center ml-1 p-0.5 text-stone-400 hover:text-indigo-600 dark:hover:text-indigo-400 align-middle transition-opacity"
                  title="分析此句语法"
                >
                  <SplitSquareVertical className="w-3.5 h-3.5 inline" />
                </button>
              </span>
            );
          })}
        </p>

        {/* Parallel Bilingual view if enabled */}
        {settings.bilingualMode === "parallel" && bilingualSentences.length > 0 && (
          <div className="mt-2.5 p-3 rounded-xl bg-stone-100/70 dark:bg-slate-800/50 border border-stone-200/60 dark:border-slate-700/60 text-xs font-sans text-stone-600 dark:text-slate-300 space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">
              段落中文对照
            </span>
            {rawSentences.map((sentence, sIdx) => {
              const matched = bilingualSentences.find(
                (b) =>
                  b.en.toLowerCase().includes(sentence.trim().slice(0, 20).toLowerCase()) ||
                  sentence.trim().toLowerCase().includes(b.en.slice(0, 20).toLowerCase())
              );
              return (
                <p key={sIdx} className="leading-normal">
                  {matched ? matched.zh : ""}
                </p>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <main className={`min-h-[calc(100vh-4rem)] p-4 sm:p-8 transition-colors ${getContainerStyle()}`}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Article Paper Container */}
        <article className={`p-6 sm:p-12 rounded-3xl border transition-all ${getPaperCardStyle()} ${getFontFamilyClass()}`}>
          {/* Header Metadata */}
          <div className="border-b border-stone-200/80 dark:border-slate-800 pb-6 mb-8 space-y-3 font-sans">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {article.category}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded border border-stone-300 dark:border-slate-700 text-stone-600 dark:text-stone-300">
                  难度: {article.level}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-stone-400">
                <span>{article.wordCount} 词</span>
                <span>·</span>
                <span>已读: {formatTime(readingSeconds)}</span>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 pt-1">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-stone-900 dark:text-slate-100">
                {article.title}
              </h1>
              <button
                onClick={() => speakEnglish(article.title)}
                className="p-2 rounded-xl border border-stone-200 dark:border-slate-700 text-stone-400 hover:text-indigo-600 hover:border-indigo-300 shrink-0"
                title="朗读标题"
              >
                <Volume2 className="w-5 h-5" />
              </button>
            </div>

            {article.summary && (
              <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 italic">
                {article.summary}
              </p>
            )}
          </div>

          {/* Body Content */}
          <div className="relative selection:bg-indigo-500 selection:text-white">
            {paragraphs.map((p, idx) => renderParagraph(p, idx))}
          </div>
        </article>
      </div>
    </main>
  );
};
