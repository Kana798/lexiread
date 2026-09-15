import React, { useState } from "react";
import { X, BookOpen, Clock, BarChart3, Check } from "lucide-react";
import { Article, ReadingTheme, CEFRLevel } from "../types";

interface LibraryModalProps {
  articles: Article[];
  currentArticleId: string;
  onSelectArticle: (article: Article) => void;
  onClose: () => void;
  theme: ReadingTheme;
}

export const LibraryModal: React.FC<LibraryModalProps> = ({
  articles,
  currentArticleId,
  onSelectArticle,
  onClose,
  theme,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<string>("ALL");

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

  const getLevelColor = (level: string) => {
    switch (level) {
      case "A1":
      case "A2":
        return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800";
      case "B1":
      case "B2":
        return "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800";
      case "C1":
      case "C2":
        return "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800";
      default:
        return "bg-stone-100 text-stone-800 border-stone-300";
    }
  };

  const filteredArticles = articles.filter((a) => {
    if (selectedLevel === "ALL") return true;
    return a.level === selectedLevel;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="library-modal"
        className={`w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transition-all ${getContainerStyle()}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">精选英文分级文库</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                涵盖自然科学、经典文学、心理认知、前沿科技等多元领域
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

        <div className="p-6 space-y-4">
          {/* Level Filter chips */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-400 font-medium">难度筛选:</span>
            {["ALL", "A2", "B1", "B2", "C1"].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all border ${
                  selectedLevel === lvl
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "border-stone-300 dark:border-slate-700 hover:border-indigo-300 text-stone-600 dark:text-stone-300"
                }`}
              >
                {lvl === "ALL" ? "全部" : lvl}
              </button>
            ))}
          </div>

          {/* Articles list */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
            {filteredArticles.map((article) => {
              const isCurrent = article.id === currentArticleId;
              return (
                <div
                  key={article.id}
                  onClick={() => {
                    onSelectArticle(article);
                    onClose();
                  }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between group ${
                    isCurrent
                      ? "border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/20 dark:bg-indigo-950/20"
                      : "border-stone-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 bg-stone-50/50 dark:bg-slate-800/30"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                        {article.category}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getLevelColor(
                          article.level
                        )}`}
                      >
                        {article.level}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-stone-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {article.title}
                    </h4>

                    {article.summary && (
                      <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 leading-relaxed">
                        {article.summary}
                      </p>
                    )}
                  </div>

                  <div className="pt-4 mt-2 border-t border-stone-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs text-stone-400">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <BarChart3 className="w-3.5 h-3.5" />
                        {article.wordCount} 词
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />~{article.readTimeMin} 分钟
                      </span>
                    </div>

                    {isCurrent ? (
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        当前阅读中
                      </span>
                    ) : (
                      <span className="text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                        点击开始阅读 →
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
