<div align="center">

</div>


## 日常启动

双击 `启动阅读器.bat`，浏览器会打开 `http://localhost:3000`。保持该命令窗口开启；关闭窗口会停止服务。

## 修改代码后重新打包

双击 `重新打包.bat`，完成后再启动阅读器。

## 首次环境准备

- 安装 Node.js 18 或更高版本。
- 安装依赖：`npm install`（会按 `package-lock.json` 还原）。
- **配置在线翻译密钥**（可选但推荐）：

  ```
  cp config/defaults.env.example config/defaults.env
  ```

  然后填入自己的有道智云 `YOUDAO_APP_KEY` / `YOUDAO_APP_SECRET`。
  该文件已被 `.gitignore` 排除，不会被提交。不配置也能运行，
  在线翻译会自动降级到公共接口（MyMemory / Google）。
- 如需 Gemini AI 功能，复制 `.env.example` 为 `.env` 并填写 `GEMINI_API_KEY`；
  不配置时，查词与语法功能会使用内置降级结果。

## 代码结构

真正运行的前端只有一份：`index.html` → `src/app.ts`（原生 TypeScript + `src/style.css`）。
早期的 React 实现已整体归档到 `deprecated/react-legacy/`（不参与构建、不随包分发、
已被 `tsconfig.json` 排除）——详见该目录下的 README。

后端为单文件 `server.ts`（Express），开发用 `tsx` 直跑，生产用 `esbuild` 打包成
`dist/server.cjs`；桌面壳在 `electron/`。

> ⚠️ **不要随意重命名应用**
> `package.json` 顶层的 `name` 是 `react-example`，这决定了 Electron 的 userData 目录为
> `%APPDATA%\react-example`。用户文章库、生词本与全部阅读设置都存放在该目录下的
> `Local Storage` 中。修改顶层 `name` 或新增顶层 `productName` 会改变 userData 路径，
> **导致用户数据"凭空消失"**（实际是换了目录）。如需更名，必须同时迁移该目录。

# Original AI Studio notes

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/14ce5319-797b-481a-813c-44129a380a86

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Windows Desktop

The application is available as an NSIS installer (`LexiRead Setup 0.0.0.exe`) and a
portable executable (`LexiRead 0.0.0.exe`), both produced under `release/`
(this repair pass wrote its output to `release-fixed/` so the previous build in
`release/` was left untouched).

### 在线翻译（有道智云）的配置优先级

打包版本按以下顺序查找配置文件，**先找到的生效**，缺失的键才继续向后回退：

1. `LEXI_ENV_PATH`（桌面壳显式指定的路径，即应用的 userData 目录）
2. 便携版可执行文件所在目录（`PORTABLE_EXECUTABLE_DIR/.env`）
3. `LexiRead.exe` 同级目录
4. 应用根目录（开发时为项目根目录，打包后为 `resources/app.asar`）
5. 应用根目录的上一级
6. `%APPDATA%\LexiRead\.env`
7. `%APPDATA%\react-example\.env`（旧版打包产物的 userData 目录）
8. 当前工作目录
9. **内置默认值** `<app 根>/config/defaults.env`（开发树）或
   `resources/config/defaults.env`（打包后）

需要换成自己的有道智云账号时，改 `config/defaults.env` 即可：

```
YOUDAO_APP_KEY="你的应用ID"
YOUDAO_APP_SECRET="你的应用密钥"
```

或直接在 `LexiRead.exe` 同级目录放一个 `.env`（优先级更高，无需重新打包）。
占位值（例如 `YOUR_YOUDAO_APP_KEY`）会被视为未配置。

> **关于 `config/defaults.env`**
> 该文件**不在 Git 仓库中**（已被 `.gitignore` 排除），里面是真实的凭证。
> 首次克隆本项目后，请执行 `cp config/defaults.env.example config/defaults.env`
> 并填入自己的密钥；不填也能跑，只是在线翻译会退化为公共接口（MyMemory / Google）。
> 打包时它通过 electron-builder 的 `extraResources` 复制到安装目录的
> `resources/config/` 下，让最终用户开箱即用。

### 排查

`GET /api/health` 会返回当前的配置状态，便于快速定位问题：

```json
{
  "youdaoConfigured": true,
  "translationChain": ["youdao", "builtin-dictionary", "youdao-dict", "mymemory", "google", "heuristic-fallback"],
  "envFilesLoaded": [".../config/defaults.env"],
  "envFilesMissing": ["..."]
}
```

`envFilesLoaded` 里出现 `config/defaults.env`，说明用的是内置默认凭证。
每次 `/api/translate` 响应中的 `provider` 字段会标明实际生效的翻译来源
（`youdao` / `youdao-dict` / `builtin-dictionary` / `public-mt` / `gemini` / `heuristic-fallback`）。

### 网络与安全

服务默认只监听 `127.0.0.1`（接口会代理付费凭证且无鉴权）。
如需在局域网内用手机访问，显式设置 `LEXI_BIND_HOST=0.0.0.0` 启动，并自行承担凭证被滥用的风险。

### 数据持久化与端口

桌面版由 Electron 启动一个本地服务，窗口加载 `http://127.0.0.1:<端口>`。
浏览器的 `localStorage` 是**按源（协议 + 主机 + 端口）隔离**的，因此端口一旦变化，
用户就会看到"文章库/生词本/设置全部清空"。

为此 `electron/local-server.cjs` 使用 `findStableLoopbackPort()`：优先占用固定端口
`39321`–`39325`，全部被占用时才回退到随机端口。**请勿改成每次随机取端口**，
否则每次启动都会丢失用户数据。

