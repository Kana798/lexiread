import React from "react";
import { BookOpen, Sparkles, Bookmark, Settings, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { Article, ReadingTheme } from "../types";

interface NavbarProps {
  currentArticle: Article;
  onOpenLibrary: () => void;
  onOpenImport: () => void;
  onOpenVocabulary: () => void;
  onOpenSettings: () => void;
  vocabCount: number;
  apiConnected: boolean;
  theme: ReadingTheme;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentArticle,
  onOpenLibrary,
  onOpenImport,
  onOpenVocabulary,
  onOpenSettings,
  vocabCount,
  apiConnected,
  theme,
}) => {
  const getThemeClasses = () => {
    switch (theme) {
      case "dark":
        return "bg-slate-900/90 border-slate-800 text-slate-100";
      case "sepia":
        return "bg-[#f4ecd8]/90 border-[#e3d7bf] text-[#433422]";
      default:
        return "bg-white/90 border-stone-200 text-stone-800";
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

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-200 ${getThemeClasses()}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo & App Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center shadow-sm shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg tracking-tight truncate">
                英语阅读器
              </span>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 truncate hidden sm:block">
              点击单词查释义发音 · 长句翻译与语法
            </p>
          </div>
        </div>

        {/* Current Article quick switcher */}
        <div className="hidden lg:flex items-center gap-2 max-w-sm px-3 py-1.5 rounded-lg border border-stone-200/80 dark:border-slate-800 bg-stone-50/50 dark:bg-slate-800/50 text-xs">
          <span className="text-stone-400 dark:text-stone-500 shrink-0">正在阅读:</span>
          <span className="font-medium truncate">{currentArticle.title}</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${getLevelColor(
              currentArticle.level
            )}`}
          >
            {currentArticle.level}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* API Status indicator */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
            style={{
              backgroundColor: apiConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
              borderColor: apiConnected ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)",
              color: apiConnected ? "#059669" : "#d97706",
            }}
            title={
              apiConnected
                ? "后端 API 代理已正常连接 (Gemini 3.8 Flash)"
                : "后端 API 正在准备，请稍候"
            }
          >
            {apiConnected ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>API 已接入</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5" />
                <span>API 连接中</span>
              </>
            )}
          </div>

          <button
            id="nav-btn-library"
            onClick={onOpenLibrary}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">精选文库</span>
          </button>

          <button
            id="nav-btn-import"
            onClick={onOpenImport}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">导入文章</span>
          </button>

          <button
            id="nav-btn-vocab"
            onClick={onOpenVocabulary}
            className="relative px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <Bookmark className="w-4 h-4" />
            <span>生词本</span>
            {vocabCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 bg-white text-indigo-700 font-bold rounded-full text-[10px]">
                {vocabCount}
              </span>
            )}
          </button>

          <button
            id="nav-btn-settings"
            onClick={onOpenSettings}
            className="p-2 rounded-lg border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors"
            title="阅读设置 (字号/配色/字体)"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
