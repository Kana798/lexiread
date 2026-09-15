# React 遗留实现（未使用，仅存档）

这里保存的是 LexiRead 早期版本的 React 界面。**它没有参与构建，也没有随应用分发。**

## 为什么被归档

真正运行的前端是 `index.html` → `/src/app.ts`（原生 TypeScript，直接操作静态标记，
样式来自 `src/style.css`）。`index.html` 里从来没有 `<div id="root">`，
也没有引用过 `main.tsx`，因此下面这些文件是**死代码**：

```
App.tsx  main.tsx  types.ts  index.css
components/*.tsx     (ImportModal / LibraryModal / Navbar / ReaderView /
                      SentenceModal / SettingsModal / VocabularyModal / WordDrawer)
data/sampleArticles.ts
utils/speech.ts
```

它们此前会让代码库显得有两套前端，并且引出了 4 个完全用不到的运行时依赖
（`react`、`react-dom`、`lucide-react`(42 MB)、`motion`）。这些依赖过去被列在
`dependencies` 中，于是被完整打进安装包——asar 因此多出约 50 MB 的无用体积。

## 如果你要恢复

需要同时：

1. 把文件移回 `src/` 对应位置，并在 `index.html` 中挂载 `<div id="root">`；
2. 在 `vite.config.ts` 中重新加入 `@vitejs/plugin-react`（以及需要 Tailwind 时的 `@tailwindcss/vite`）；
3. 把对应的依赖加回 `package.json` 的 `dependencies`；
4. 从 `tsconfig.json` 的 `exclude` 中移除 `deprecated`。

`deprecated/` 已被 `tsconfig.json` 排除，因此不参与 `npm run lint`；
`package.json` 的 `build.files` 也显式排除了它，因此不会进入安装包。
