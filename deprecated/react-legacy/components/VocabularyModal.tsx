import React, { useState } from "react";
import { X, Volume2, Search, Trash2, CheckCircle, Download, Layers, RotateCw, Sparkles, BookOpen } from "lucide-react";
import { VocabularyItem, ReadingTheme } from "../types";
import { speakEnglish } from "../utils/speech";

interface VocabularyModalProps {
  vocabulary: VocabularyItem[];
  onRemoveWord: (word: string) => void;
  onToggleMastered: (id: string) => void;
  onClose: () => void;
  theme: ReadingTheme;
}

export const VocabularyModal: React.FC<VocabularyModalProps> = ({
  vocabulary,
  onRemoveWord,
  onToggleMastered,
  onClose,
  theme,
}) => {
  const [search, setSearch] = useState("");
  const [activeView, setActiveView] = useState<"list" | "flashcards">("list");
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

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

  const filteredVocab = vocabulary.filter(
    (item) =>
      item.word.toLowerCase().includes(search.toLowerCase()) ||
      item.chineseDefinition.includes(search)
  );

  const handleExportCSV = () => {
    if (vocabulary.length === 0) return;
    const header = "Word,Phonetic,PartOfSpeech,Definition,ContextSentence\n";
    const rows = vocabulary
      .map(
        (v) =>
          `"${v.word}","${v.phonetic || ""}","${v.partOfSpeech || ""}","${v.chineseDefinition.replace(/"/g, '""')}","${(v.contextSentence || "").replace(/"/g, '""')}"`
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `my_english_vocabulary_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentCard = filteredVocab[currentCardIndex];

  const handleNextCard = () => {
    setIsFlipped(false);
    setCurrentCardIndex((prev) => (prev + 1) % (filteredVocab.length || 1));
  };

  const handlePrevCard = () => {
    setIsFlipped(false);
    setCurrentCardIndex((prev) => (prev - 1 + filteredVocab.length) % (filteredVocab.length || 1));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="vocabulary-modal"
        className={`w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transition-all ${getContainerStyle()}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">我的生词本 & 闪卡复习</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                已收录 {vocabulary.length} 个阅读生词 · 支持导出 Anki/CSV
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center p-1 rounded-lg bg-stone-100 dark:bg-slate-800 border border-stone-200 dark:border-slate-700">
              <button
                onClick={() => setActiveView("list")}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activeView === "list"
                    ? "bg-white dark:bg-slate-700 shadow-xs text-indigo-600 dark:text-indigo-300 font-bold"
                    : "text-stone-500"
                }`}
              >
                词汇列表
              </button>
              <button
                onClick={() => {
                  setActiveView("flashcards");
                  setCurrentCardIndex(0);
                  setIsFlipped(false);
                }}
                disabled={filteredVocab.length === 0}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 ${
                  activeView === "flashcards"
                    ? "bg-white dark:bg-slate-700 shadow-xs text-indigo-600 dark:text-indigo-300 font-bold"
                    : "text-stone-500 disabled:opacity-40"
                }`}
              >
                <Layers className="w-3 h-3" />
                闪卡模式
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-stone-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {activeView === "list" ? (
            <>
              {/* Search & Export Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    placeholder="搜索生词或中文释义..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl text-xs border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={handleExportCSV}
                    disabled={vocabulary.length === 0}
                    className="px-3.5 py-2 rounded-xl border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    title="导出生词为 CSV，可无缝导入 Anki"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出 CSV (Anki)</span>
                  </button>
                </div>
              </div>

              {/* List */}
              {vocabulary.length === 0 ? (
                <div className="py-16 text-center text-stone-400 dark:text-stone-500">
                  <Sparkles className="w-10 h-10 mx-auto mb-2 text-stone-300 dark:text-stone-600" />
                  <p className="text-sm font-medium">生词本目前为空</p>
                  <p className="text-xs mt-1">
                    在阅读文章时，点击任何单词即可查看精析并一键加入生词本。
                  </p>
                </div>
              ) : filteredVocab.length === 0 ? (
                <div className="py-12 text-center text-stone-400">未找到匹配词汇</div>
              ) : (
                <div className="divide-y divide-stone-200 dark:divide-slate-800">
                  {filteredVocab.map((item) => (
                    <div
                      key={item.id}
                      className="py-3.5 flex items-start justify-between gap-4 group"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-base text-stone-900 dark:text-slate-100">
                            {item.word}
                          </h4>
                          {item.phonetic && (
                            <span className="text-xs font-mono text-stone-400">
                              {item.phonetic}
                            </span>
                          )}
                          <button
                            onClick={() => speakEnglish(item.word)}
                            className="p-1 text-stone-400 hover:text-indigo-600 rounded"
                            title="朗读"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-[11px] px-1.5 py-0.2 rounded font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            {item.partOfSpeech}
                          </span>
                        </div>
                        <p className="text-sm text-stone-700 dark:text-slate-300 font-medium">
                          {item.chineseDefinition}
                        </p>
                        {item.contextSentence && (
                          <p className="text-xs text-stone-500 dark:text-stone-400 italic line-clamp-2">
                            "{item.contextSentence}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 pt-1">
                        <button
                          onClick={() => onToggleMastered(item.id)}
                          className={`p-1.5 rounded-lg border text-xs transition-colors ${
                            item.mastered
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                              : "border-stone-200 dark:border-slate-700 text-stone-400 hover:text-stone-700"
                          }`}
                          title={item.mastered ? "已标为掌握" : "标记为已掌握"}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onRemoveWord(item.word)}
                          className="p-1.5 rounded-lg border border-transparent hover:border-rose-200 text-stone-400 hover:text-rose-600 transition-colors"
                          title="移出生词本"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Flashcard Anki View */
            <div className="py-4 flex flex-col items-center justify-center space-y-6">
              {currentCard && (
                <>
                  <div className="text-xs text-stone-400">
                    闪卡复习进度: {currentCardIndex + 1} / {filteredVocab.length}
                  </div>

                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="w-full max-w-md h-64 p-8 rounded-3xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800/70 shadow-lg cursor-pointer flex flex-col items-center justify-center text-center transition-all hover:scale-[1.01] select-none relative"
                  >
                    <span className="absolute top-4 right-4 text-xs text-stone-400 flex items-center gap-1">
                      <RotateCw className="w-3 h-3" /> 点击翻面
                    </span>

                    {!isFlipped ? (
                      /* Card Front */
                      <div className="space-y-3">
                        <h2 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-slate-100">
                          {currentCard.word}
                        </h2>
                        {currentCard.phonetic && (
                          <p className="text-sm font-mono text-stone-500">
                            {currentCard.phonetic}
                          </p>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            speakEnglish(currentCard.word);
                          }}
                          className="p-2 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300 hover:bg-indigo-100 inline-flex items-center justify-center"
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                        {currentCard.contextSentence && (
                          <p className="text-xs text-stone-500 italic mt-2 max-w-xs line-clamp-2">
                            "{currentCard.contextSentence}"
                          </p>
                        )}
                      </div>
                    ) : (
                      /* Card Back */
                      <div className="space-y-3 animate-in fade-in duration-200">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">
                          {currentCard.partOfSpeech}
                        </span>
                        <h3 className="text-xl font-bold text-stone-900 dark:text-slate-100">
                          {currentCard.chineseDefinition}
                        </h3>
                        {currentCard.englishDefinition && (
                          <p className="text-xs text-stone-500">
                            {currentCard.englishDefinition}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Navigation controls */}
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handlePrevCard}
                      className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-slate-800"
                    >
                      上一个
                    </button>
                    <button
                      onClick={() => onToggleMastered(currentCard.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 ${
                        currentCard.mastered
                          ? "bg-emerald-600 text-white"
                          : "border border-stone-300 dark:border-slate-700"
                      }`}
                    >
                      <CheckCircle className="w-4 h-4" />
                      {currentCard.mastered ? "已掌握" : "记住了"}
                    </button>
                    <button
                      onClick={handleNextCard}
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                    >
                      下一个
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
