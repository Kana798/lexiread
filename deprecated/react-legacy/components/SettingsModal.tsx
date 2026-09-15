import React from "react";
import { X, Type, Sun, Moon, Coffee, ShieldCheck } from "lucide-react";
import { ReaderSettings, ReadingTheme, FontFamily, BilingualMode } from "../types";

interface SettingsModalProps {
  settings: ReaderSettings;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const getContainerStyle = () => {
    switch (settings.theme) {
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
        id="settings-modal"
        className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border transition-all ${getContainerStyle()}`}
      >
        <div className="sticky top-0 z-10 px-6 py-4 border-b backdrop-blur-md flex items-center justify-between bg-inherit">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center">
              <Type className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base">阅读体验与排版设置</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                个性化调整字号、色彩主题与双语对照模式
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

        <div className="p-6 space-y-6 text-sm">
          {/* Theme selection */}
          <div>
            <label className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider block mb-2">
              背景与配色主题
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: "light", label: "素雅明亮", icon: Sun, bg: "bg-white border-stone-300 text-stone-800" },
                { id: "sepia", label: "羊皮纸护眼", icon: Coffee, bg: "bg-[#f5ebd7] border-[#dfd2ba] text-[#4d3a24]" },
                { id: "dark", label: "深色夜间", icon: Moon, bg: "bg-slate-900 border-slate-700 text-slate-100" },
              ].map((t) => {
                const Icon = t.icon;
                const isSelected = settings.theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => onUpdateSettings({ theme: t.id as ReadingTheme })}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${t.bg} ${
                      isSelected ? "ring-2 ring-indigo-500 shadow-md font-bold" : "opacity-75 hover:opacity-100"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font Family */}
          <div>
            <label className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider block mb-2">
              正文字体类型
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "serif", label: "古典衬线 (Serif)", style: "font-serif" },
                { id: "sans", label: "现代无衬线 (Sans)", style: "font-sans" },
                { id: "mono", label: "等宽清晰 (Mono)", style: "font-mono" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => onUpdateSettings({ fontFamily: f.id as FontFamily })}
                  className={`p-2.5 rounded-xl border text-xs text-center transition-all ${f.style} ${
                    settings.fontFamily === f.id
                      ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold"
                      : "border-stone-200 dark:border-slate-800 hover:border-stone-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size & Line Height */}
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="font-bold text-stone-500 dark:text-stone-400">正文字号大小</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {settings.fontSize}px
                </span>
              </div>
              <input
                type="range"
                min={15}
                max={26}
                step={1}
                value={settings.fontSize}
                onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="font-bold text-stone-500 dark:text-stone-400">段落行高间距</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {settings.lineHeight}x
                </span>
              </div>
              <input
                type="range"
                min={1.5}
                max={2.4}
                step={0.1}
                value={settings.lineHeight}
                onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Bilingual Reading Mode */}
          <div>
            <label className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider block mb-2">
              双语阅读模式
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "off", label: "纯英文沉浸", desc: "纯英文阅读无干扰" },
                { id: "hover", label: "悬浮译文", desc: "悬浮句子显示翻译" },
                { id: "parallel", label: "逐句双语对照", desc: "英文下方附中文" },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => onUpdateSettings({ bilingualMode: m.id as BilingualMode })}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    settings.bilingualMode === m.id
                      ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                      : "border-stone-200 dark:border-slate-800"
                  }`}
                >
                  <span className="font-bold text-xs block">{m.label}</span>
                  <span className="text-[10px] text-stone-400 block mt-0.5">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Connection Note */}
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300 mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span>为什么之前的本地 index.html 无法连通 API？</span>
            </div>
            <p className="text-emerald-900/80 dark:text-emerald-200/90 leading-relaxed">
              在本地直接打开 HTML 文件（<code>file://</code> 协议）调用大模型 API 时，会被浏览器的同源策略（CORS）拦截，并且无法安全托管 API 密钥。我们已为你架构了 Express 后端代理与 Gemini 3.8 Flash，所有查词、改写与答疑均由服务器安全转发，彻底解决了无法接入的问题！
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
