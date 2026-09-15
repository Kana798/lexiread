import React, { useState } from "react";
import { X, Upload, FileText, Check, AlertCircle } from "lucide-react";
import { Article, ReadingTheme, CEFRLevel } from "../types";

interface ImportModalProps {
  onImport: (article: Article) => void;
  onClose: () => void;
  theme: ReadingTheme;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onImport,
  onClose,
  theme,
}) => {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("User Import");
  const [level, setLevel] = useState<CEFRLevel>("B1");
  const [error, setError] = useState<string | null>(null);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setContent(text);
        if (!title) {
          setTitle(file.name.replace(/\.[^/.]+$/, ""));
        }
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError("请输入或粘贴文章英文正文");
      return;
    }

    const words = content.trim().split(/\s+/).length;
    const readTimeMin = Math.max(1, Math.round(words / 180));

    const newArticle: Article = {
      id: `imported-${Date.now()}`,
      title: title.trim() || "未命名导入文章",
      category,
      level,
      content: content.trim(),
      wordCount: words,
      readTimeMin,
    };

    onImport(newArticle);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="import-modal"
        className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transition-all ${getContainerStyle()}`}
      >
        <div className="sticky top-0 z-10 px-6 py-4 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">导入自定义英文文章</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                支持直接粘贴或导入 TXT / Markdown 文件
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Title & Level */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-stone-600 dark:text-stone-300 block mb-1">
                文章标题
              </label>
              <input
                type="text"
                placeholder="例如: How Electric Vehicles Change Cities"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-stone-600 dark:text-stone-300 block mb-1">
                预估难度
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as CEFRLevel)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="A2">A2 初级</option>
                <option value="B1">B1 中级</option>
                <option value="B2">B2 进阶</option>
                <option value="C1">C1 高级</option>
              </select>
            </div>
          </div>

          {/* File Upload Trigger */}
          <div className="p-3 rounded-xl border border-dashed border-stone-300 dark:border-slate-700 flex items-center justify-between gap-3 text-xs bg-stone-50/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2 text-stone-600 dark:text-stone-400">
              <FileText className="w-4 h-4 text-indigo-500" />
              <span>从电脑本地选择文本文件 (.txt, .md)</span>
            </div>
            <label className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-stone-300 dark:border-slate-700 hover:border-indigo-400 font-medium cursor-pointer transition-colors">
              选择文件
              <input
                type="file"
                accept=".txt,.md"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Content TextArea */}
          <div>
            <label className="text-xs font-semibold text-stone-600 dark:text-stone-300 block mb-1">
              英文正文 (支持分段)
            </label>
            <textarea
              rows={8}
              placeholder="在此粘贴任何你想精读的英文文章、外刊新闻或小说选段..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full p-3 text-xs font-serif leading-relaxed rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {content && (
              <p className="text-[11px] text-stone-400 mt-1">
                字数统计: {content.trim().split(/\s+/).length} 词 · 预计阅读时间: ~
                {Math.max(1, Math.round(content.trim().split(/\s+/).length / 180))} 分钟
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl border border-stone-300 dark:border-slate-700 hover:bg-stone-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              立即导入并阅读
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
