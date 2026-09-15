import express, { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "path";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { buildYoudaoRequest } from "./src/youdao-translation";
import { translateViaPublicProviders } from "./src/public-translation";
import { resolveEnvCandidates, loadEnvFromCandidates, pickRecommendedEnvPath } from "./src/env-loader";
import { parseLlmJson, schemaToPrompt, upsertEnvKey, isLoopbackAddress } from "./src/llm-utils";

import { resolveServerRuntime } from './server-runtime';

const runtime = resolveServerRuntime({ cwd: process.cwd(), env: process.env });

// ---------------------------------------------------------------------------
// Configuration bootstrap
// ---------------------------------------------------------------------------
// Previously only a single `.env` path was attempted (the Electron userData
// directory). The shipped installer excludes `.env`, so on a fresh install that
// file never existed, no provider credentials were loaded, and every online
// translation silently degraded. We now scan an ordered list of plausible
// locations — ending with the bundled `config/defaults.env` that ships next to
// the app bundle — so the packaged desktop app works out of the box while the
// repository itself stays free of credentials.
const envCandidates = resolveEnvCandidates({
  explicitPath: runtime.envPath,
  cwd: process.cwd(),
  execPath: process.execPath,
  appRoot: runtime.appRoot,
  appData: process.env.APPDATA || process.env.XDG_CONFIG_HOME,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
});
const envLoadResult = loadEnvFromCandidates(envCandidates, process.env);

if (envLoadResult.loaded.length > 0) {
  console.log(`[config] Loaded environment from: ${envLoadResult.loaded.join(", ")}`);
}
if (!process.env.YOUDAO_APP_KEY || !process.env.YOUDAO_APP_SECRET) {
  console.warn(
    `[config] Youdao credentials are unavailable — online translation will fall back to public providers. ` +
      `Provide YOUDAO_APP_KEY / YOUDAO_APP_SECRET via a .env at ${pickRecommendedEnvPath()} ` +
      `or via config/defaults.env (see config/defaults.env.example).`
  );
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "5mb" }));

// ---------------------------------------------------------------------------
// Async error forwarding
// ---------------------------------------------------------------------------
// Express 4 does not forward a rejected promise from an `async` handler to the
// error middleware. Today a single unexpected throw (a malformed payload, a
// provider returning a non-JSON body, …) leaves the HTTP request hanging
// forever and surfaces as a process-level unhandledRejection. Wrapping the
// registration helpers makes every async handler fail fast into the error
// middleware instead.
type RouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;

function toSafeHandler(handler: RouteHandler): RouteHandler {
  if (handler.length >= 4) return handler; // classic error middleware, leave alone
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

for (const method of ["get", "post", "put", "patch", "delete"] as const) {
  const original = (app as any)[method].bind(app);
  (app as any)[method] = (routePath: any, ...handlers: any[]) => {
    const safe = handlers.map((handler) =>
      typeof handler === "function" ? toSafeHandler(handler as RouteHandler) : handler
    );
    return original(routePath, ...safe);
  };
}

// ---------------------------------------------------------------------------
// Built-in LLM: DeepSeek (OpenAI-compatible chat completions).
// Replaces the former Gemini integration — DeepSeek is served through the same
// `callOpenAICompatible` helper used for user-supplied providers, so there is no
// vendor SDK dependency at all.
// ---------------------------------------------------------------------------
const BUILTIN_LLM_URL = "https://api.deepseek.com/chat/completions";
const BUILTIN_LLM_MODEL = "deepseek-chat";

function hasBuiltInLlmKey(): boolean {
  const key = process.env.DEEPSEEK_API_KEY;
  return Boolean(key && key.trim() && !key.includes("YOUR_"));
}

function getBuiltInLlmConfig(): CustomLLMConfig | null {
  if (!hasBuiltInLlmKey()) return null;
  return {
    provider: "builtin",
    url: BUILTIN_LLM_URL,
    key: (process.env.DEEPSEEK_API_KEY as string).trim(),
    model: BUILTIN_LLM_MODEL,
  };
}

/** Strips the markdown code fences LLMs love to wrap JSON in, then parses. */
const LLM_JSON_SYSTEM =
  "You are an expert English learning assistant for ESL learners. " +
  "Respond with valid JSON only — no markdown fences, no commentary.";

// Minimal stand-ins for the former @google/genai schema enum. Schema objects are
// no longer sent to any API — they are flattened into a textual JSON-shape hint
// for the prompt, so only the discriminant values matter here.
const Type = { OBJECT: "object", STRING: "string", INTEGER: "integer", ARRAY: "array" } as const;

/**
 * Gemini-SDK-shaped shim over the built-in DeepSeek endpoint. Existing call
 * sites keep their `ai.models.generateContent({ model, contents, config })`
 * shape; the engine underneath is a plain OpenAI-compatible POST.
 */
function getLlmClient() {
  const llm = getBuiltInLlmConfig();
  if (!llm) return null;
  return {
    models: {
      generateContent: async (opts: {
        model?: string; // accepted for call-site compatibility; the built-in model is fixed
        contents: string;
        config?: { responseMimeType?: string; responseSchema?: any };
      }): Promise<{ text: string }> => {
        const wantsJson = Boolean(opts.config?.responseSchema || opts.config?.responseMimeType === "application/json");
        const schemaHint = opts.config?.responseSchema ? schemaToPrompt(opts.config.responseSchema) : "";
        const messages = [
          {
            role: "system",
            content: wantsJson ? LLM_JSON_SYSTEM + (schemaHint ? ` Match this JSON shape exactly: ${schemaHint}` : "") : "You are a precise assistant for an English reading app.",
          },
          { role: "user", content: opts.contents },
        ];
        const raw = await callOpenAICompatible(llm, messages, wantsJson);
        return { text: raw || "" };
      },
    },
  };
}

const YOUDAO_ERROR_HINTS: Record<string, string> = {
  "101": "缺少必填参数",
  "102": "不支持的语言类型",
  "103": "翻译文本过长",
  "108": "appKey 无效，请检查 YOUDAO_APP_KEY",
  "110": "该 appKey 未开通「文本翻译」服务实例",
  "111": "开发者账号无效，请检查控制台账号状态",
  "112": "请求的服务无效",
  "113": "翻译内容为空",
  "114": "翻译内容超过长度限制",
  "202": "签名检验失败，请核对 YOUDAO_APP_SECRET",
  "203": "访问 IP 不在白名单内，请在网易智云控制台移除 IP 限制",
  "301": "词典查询文本过长",
  "401": "账户已欠费",
  "411": "访问频率受限，请稍后重试",
  "501": "有道服务端内部错误",
};

/** Turns a Youdao `errorCode` into an actionable, human-readable Chinese hint. */
export function describeYoudaoError(code: unknown): string {
  const key = String(code ?? "");
  const hint = YOUDAO_ERROR_HINTS[key];
  return hint ? `${hint}（errorCode=${key}）` : `有道接口返回错误（errorCode=${key || "unknown"}）`;
}

/** Extracts the IPA phonetic Youdao reports (US first, then UK). */
function pickYoudaoPhonetic(payload: any): string {
  const candidates = [
    payload?.ec?.word?.[0]?.usphone,
    payload?.ec?.word?.[0]?.ukphone,
    payload?.simple?.word?.[0]?.usphone,
    payload?.simple?.word?.[0]?.ukphone,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

/** Flattens the structured `ec.word[].trs[].tr[].l.i[]` definition tree. */
function collectYoudaoExplains(payload: any): string[] {
  const explains: string[] = [];
  const groups = payload?.ec?.word?.[0]?.trs;
  if (!Array.isArray(groups)) return explains;
  for (const group of groups) {
    const items = group?.tr;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const lines = item?.l?.i;
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        if (typeof line === "string" && line.trim()) explains.push(line.trim());
      }
    }
  }
  return explains;
}

function splitExplainLine(explain: string): { partOfSpeech: string; meaning: string } {
  const match = explain.match(/^([a-z]{1,6}\.)\s*(.+)$/i);
  return match
    ? { partOfSpeech: match[1], meaning: match[2] }
    : { partOfSpeech: "", meaning: explain };
}

/**
 * Word-level dictionary lookup.
 *
 * The paid `openapi.youdao.com/api` endpoint only returns `basic` when the
 * dictionary service is enabled on the account, which is frequently not the
 * case. Without an enrichment step single words came back with an empty
 * phonetic and a generic "短语 / 句子" label.
 *
 * `dict.youdao.com/jsonapi` is preferred because it carries real IPA phonetics
 * (`usphone` / `ukphone`) plus structured `trs` definitions; the lighter
 * `suggest` endpoint is kept as a fallback.
 */
async function lookupYoudaoDictionary(word: string): Promise<{
  phonetic: string;
  partOfSpeech: string;
  explains: string[];
} | null> {
  const requestJson = async (url: string, timeoutMs: number): Promise<any | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  // 1. Preferred source: structured dictionary payload with phonetics.
  try {
    const payload = await requestJson(
      `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`,
      3500
    );
    if (payload) {
      const phonetic = pickYoudaoPhonetic(payload);
      const rawExplains = collectYoudaoExplains(payload);
      const explains = rawExplains
        .flatMap((line) => line.split(/[;；]\s*/))
        .map((line) => line.trim())
        .filter(Boolean);
      if (explains.length > 0 || phonetic) {
        const first = explains.length > 0 ? splitExplainLine(explains[0]) : { partOfSpeech: "", meaning: "" };
        return {
          phonetic,
          partOfSpeech: first.partOfSpeech,
          explains: explains.length > 0 ? explains : [],
        };
      }
    }
  } catch {
    // fall through to the suggest endpoint
  }

  // 2. Fallback: the lightweight suggest endpoint (no phonetics).
  try {
    const payload = await requestJson(
      `https://dict.youdao.com/suggest?q=${encodeURIComponent(word)}&num=1&doctype=json`,
      3500
    );
    const entry = payload?.data?.entries?.[0];
    const rawExplain = typeof entry?.explain === "string" ? decodeHtmlEntities(entry.explain) : "";
    if (!rawExplain) return null;

    const explains = rawExplain.split(/[;；]\s*/).map((part) => part.trim()).filter(Boolean);
    const { partOfSpeech } = splitExplainLine(explains[0] || rawExplain);
    return {
      phonetic: typeof entry?.phonetic === "string" ? entry.phonetic.trim() : "",
      partOfSpeech,
      explains: explains.length > 0 ? explains : [rawExplain],
    };
  } catch {
    return null;
  }
}

async function translateViaYoudao(text: string): Promise<{
  translation: string;
  phonetic: string;
  partOfSpeech: string;
  details: string;
  contextual: string;
  engine: string;
  provider?: string;
} | null> {
  const appKey = process.env.YOUDAO_APP_KEY;
  const appSecret = process.env.YOUDAO_APP_SECRET;
  if (!appKey || !appSecret) {
    console.warn("[youdao] Skipped: YOUDAO_APP_KEY / YOUDAO_APP_SECRET are not configured.");
    return null;
  }

  const isWord = text.split(/\s+/).length === 1;

  try {
    const request = buildYoudaoRequest({
      text,
      appKey,
      appSecret,
      salt: randomUUID(),
      curtime: String(Math.floor(Date.now() / 1000)),
    });

    // The public endpoint can hang indefinitely on a flaky route; without a
    // deadline one stalled socket would freeze every translation request.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: globalThis.Response;
    try {
      response = await fetch("https://openapi.youdao.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(request),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data: any = await response.json().catch(() => null);
    if (!response.ok || !data || data.errorCode !== "0" || !Array.isArray(data.translation)) {
      console.warn(`[youdao] ${describeYoudaoError(data?.errorCode ?? response.status)}`);
      return null;
    }

    const translation = data.translation.join("\n").trim();
    if (!translation) return null;

    const basic = data.basic || {};
    let phonetic = typeof basic.phonetic === "string" ? basic.phonetic.trim() : "";
    let partOfSpeech = Array.isArray(basic.explains) ? "词典释义" : isWord ? "单词" : "短语 / 句子";
    let details = Array.isArray(basic.explains)
      ? basic.explains.join("；")
      : "有道智云联网翻译";

    // Enrich single words that came back without dictionary metadata.
    if (isWord && (!phonetic || !Array.isArray(basic.explains))) {
      const dict = await lookupYoudaoDictionary(text);
      if (dict) {
        if (!phonetic && dict.phonetic) phonetic = dict.phonetic;
        if (dict.partOfSpeech) partOfSpeech = dict.partOfSpeech;
        if (details === "有道智云联网翻译" && dict.explains.length > 0) {
          details = dict.explains.join("；");
        }
      }
    }

    return {
      translation,
      phonetic: phonetic ? `/${phonetic.replace(/^\/|\/$/g, "")}/` : "",
      partOfSpeech,
      details,
      contextual: "有道智云翻译",
      engine: "web",
      provider: "youdao",
    };
  } catch (error: any) {
    const reason =
      error?.name === "AbortError" ? "请求超时（8s）" : error?.message || "network error";
    console.warn(`[youdao] Request failed: ${reason}`);
    return null;
  }
}

// Built-in Lexicon database for instant high-speed lookup and fallback
const BUILTIN_DICTIONARY: Record<string, any> = {
  bioluminescence: {
    word: "bioluminescence",
    phonetic: "/ˌbaɪ.oʊˌluː.mɪˈnes.əns/",
    partOfSpeech: "n. 名词",
    chineseDefinition: "生物发光；生物体荧光",
    englishDefinition: "The biochemical production and emission of light by living organisms.",
    contextualMeaning: "指深海生物或萤火虫通过体内化学反应自主发光的自然奇观",
    collocations: ["marine bioluminescence (海洋生物发光)", "bioluminescence imaging (生物发光成像)", "cold bioluminescence (冷光)"],
    memoryTip: "词根解析: bio- (生命) + lumin (光，引申为 illuminate 照亮) + -escence (名词后缀，表过程/状态)。",
    exampleSentence: "Over seventy percent of deep-sea creatures possess the extraordinary ability of bioluminescence.",
    exampleTranslation: "超过百分之七十的深海生物都具有令人称奇的生物发光能力。",
    synonyms: ["biological light", "phosphorescence", "luminescence"],
  },
  luciferin: {
    word: "luciferin",
    phonetic: "/luːˈsɪf.ər.ɪn/",
    partOfSpeech: "n. 名词",
    chineseDefinition: "荧光素；发光素",
    englishDefinition: "A light-emitting compound found in organisms that generate bioluminescence.",
    contextualMeaning: "与荧光素酶结合并氧化释放光子的关键化学分子",
    collocations: ["luciferin substrate (荧光素底物)", "firefly luciferin (萤火虫荧光素)"],
    memoryTip: "源自拉丁语 Lucifer（带来光明之物，lux 光 + fer 带来）。",
    exampleSentence: "The oxidation of luciferin is catalyzed by the enzyme luciferase.",
    exampleTranslation: "荧光素的氧化过程由荧光素酶催化完成。",
    synonyms: ["light substrate", "photogen"],
  },
  luciferase: {
    word: "luciferase",
    phonetic: "/luːˈsɪf.ər.eɪs/",
    partOfSpeech: "n. 名词",
    chineseDefinition: "荧光素酶",
    englishDefinition: "An enzyme that catalyzes the oxidation of luciferin in bioluminescent organisms.",
    contextualMeaning: "催化发光反应的生物活性酶，常用于医学癌症标记",
    collocations: ["luciferase assay (荧光素酶报告基因检测)", "luciferase gene (荧光素酶基因)"],
    memoryTip: "词根: lucifer (光) + -ase (生物化学酶的标准后缀，如 lactase 乳糖酶)。",
    exampleSentence: "Medical researchers utilize luciferase as an optical marker to track cancer cells.",
    exampleTranslation: "医学研究人员利用荧光素酶作为光学标记物实时追踪癌细胞。",
    synonyms: ["bioluminescent enzyme"],
  },
  perpetual: {
    word: "perpetual",
    phonetic: "/pɚˈpetʃ.u.əl/",
    partOfSpeech: "adj. 形容词",
    chineseDefinition: "永久的；永无止境的；持续不断的",
    englishDefinition: "Never ending or changing; occurring repeatedly without interruption.",
    contextualMeaning: "形容深海永恒无止境的幽暗与寂静",
    collocations: ["perpetual twilight (永恒微光)", "perpetual motion (永动机)", "perpetual calendar (万年历)"],
    memoryTip: "per- (贯穿，始终) + pet- (寻求，追求，如 petition 祈求) -> 始终都在追求 -> 永恒的。",
    exampleSentence: "Beneath the ocean's surface lies a world of perpetual twilight.",
    exampleTranslation: "在海洋表面之下，存在着一个永恒幽暗的世界。",
    synonyms: ["eternal", "everlasting", "unceasing"],
  },
  abyss: {
    word: "abyss",
    phonetic: "/əˈbɪs/",
    partOfSpeech: "n. 名词",
    chineseDefinition: "深渊；无底洞；深海深渊",
    englishDefinition: "A deep or seemingly bottomless chasm; profound oceanic depths.",
    contextualMeaning: "深不见底的海底深渊带",
    collocations: ["oceanic abyss (深海深渊)", "stare into the abyss (凝视深渊)"],
    memoryTip: "a- (无，非) + byssos (底，希腊语) -> 没有底部的地方 -> 深渊。",
    exampleSentence: "Creatures of the abyss have adapted to extreme pressure and darkness.",
    exampleTranslation: "深渊生物已经进化适应了极高的水压与绝对黑暗。",
    synonyms: ["chasm", "void", "gulf"],
  },
  incandescent: {
    word: "incandescent",
    phonetic: "/ˌɪn.kænˈdes.ənt/",
    partOfSpeech: "adj. 形容词",
    chineseDefinition: "白炽的；发热发光的",
    englishDefinition: "Emitting light as a result of being heated to a high temperature.",
    contextualMeaning: "指通过高温电热丝发光的传统白炽灯",
    collocations: ["incandescent lamp (白炽灯泡)", "incandescent glow (炽热的光芒)"],
    memoryTip: "in- (进入/加强) + cand- (白色/发亮，如 candle 蜡烛、candidate 穿白袍的候选人) + -escent。",
    exampleSentence: "Incandescent light bulbs waste most of their energy as thermal radiation.",
    exampleTranslation: "传统白炽灯将绝大部分电能浪费为热辐射。",
    synonyms: ["radiant", "glowing", "luminous"],
  },
  neurological: {
    word: "neurological",
    phonetic: "/ˌnʊr.əˈlɑː.dʒɪ.kəl/",
    partOfSpeech: "adj. 形容词",
    chineseDefinition: "神经学的；神经系统的",
    englishDefinition: "Relating to the anatomy, functions, and organic disorders of nerves and the nervous system.",
    contextualMeaning: "指人类大脑中习惯回路的神经生理机制",
    collocations: ["neurological disorder (神经系统疾病)", "neurological pathway (神经回路)"],
    memoryTip: "neuro- (神经) + -logy (学科) + -ical (形容词后缀)。",
    exampleSentence: "Habits are formed through automated neurological feedback loops.",
    exampleTranslation: "习惯是通过自动化的神经反馈回路建立起来的。",
    synonyms: ["neural", "nervous"],
  },
  compounding: {
    word: "compounding",
    phonetic: "/kəmˈpaʊn.dɪŋ/",
    partOfSpeech: "n. / adj.",
    chineseDefinition: "复利的；复合的；利滚利累积的",
    englishDefinition: "The process of accumulating or growing exponentially over time through repeated addition.",
    contextualMeaning: "微小习惯在长期坚持中产生的指数级复合效应",
    collocations: ["compounding interest (复利)", "compounding effect (复利效应)"],
    memoryTip: "com- (共同) + pound/pon (放置，如 component 组成) -> 叠加放置在一起 -> 复合累加。",
    exampleSentence: "Small daily habits yield massive returns through the power of compounding.",
    exampleTranslation: "微小的日常习惯会借助复利效应带来巨大的回报。",
    synonyms: ["exponential growth", "accumulation", "multiplying"],
  },
  juxtaposition: {
    word: "juxtaposition",
    phonetic: "/ˌdʒʌk.stə.pəˈzɪʃ.ən/",
    partOfSpeech: "n. 名词",
    chineseDefinition: "并置；并列对照；反差对比",
    englishDefinition: "The fact of two things being seen or placed close together with contrasting effect.",
    contextualMeaning: "AI在生成艺术时将不同风格意象并置融合的独特手法",
    collocations: ["surprising juxtaposition (令人惊叹的并置)", "in juxtaposition with (与…并列)"],
    memoryTip: "juxta (靠近，旁边) + position (放置位置) -> 放在旁边进行对照。",
    exampleSentence: "The unexpected juxtaposition of modern technology and ancient traditions was striking.",
    exampleTranslation: "现代科技与古老传统的意外并置令人印象深刻。",
    synonyms: ["contrast", "comparison", "collocation"],
  },
};

// Fallback generator for general words not in preloaded lexicon
function generateSmartWordFallback(word: string, contextSentence: string): any {
  const lower = word.toLowerCase();
  if (BUILTIN_DICTIONARY[lower]) {
    return BUILTIN_DICTIONARY[lower];
  }

  let pos = "v. 动词 / n. 名词";
  if (lower.endsWith("ly")) pos = "adv. 副词";
  else if (lower.endsWith("tion") || lower.endsWith("ment") || lower.endsWith("ness") || lower.endsWith("ity")) pos = "n. 名词";
  else if (lower.endsWith("ful") || lower.endsWith("ous") || lower.endsWith("ive") || lower.endsWith("ic") || lower.endsWith("al")) pos = "adj. 形容词";

  return {
    word: word,
    phonetic: `/${lower}/`,
    partOfSpeech: pos,
    chineseDefinition: `【${word}】在当前语境中表示关键概念或动作`,
    englishDefinition: `A significant term used in the passage to express a specific state or quality.`,
    contextualMeaning: contextSentence ? `在句子中作为核心表达使用` : `阅读高频词汇`,
    collocations: [`common use of ${word}`, `key ${word} structure`],
    memoryTip: `词缀分析：观察词根与词尾变化，尝试结合上下文快速联想记忆。`,
    exampleSentence: contextSentence || `Understanding the term ${word} helps master this passage.`,
    exampleTranslation: contextSentence ? `参考阅读正文上下文理解。` : `掌握该词有助于透彻理解全文。`,
    synonyms: ["term", "expression"],
    isFallback: true,
  };
}

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  const hasApiKey = hasBuiltInLlmKey();
  const youdaoConfigured = Boolean(process.env.YOUDAO_APP_KEY && process.env.YOUDAO_APP_SECRET);
  res.json({
    status: "ok",
    hasApiKey,
    model: BUILTIN_LLM_MODEL,
    youdaoConfigured,
    // Ordered provider chain actually used by /api/translate for the "web" engine.
    translationChain: [
      ...(youdaoConfigured ? ["youdao"] : []),
      "builtin-dictionary",
      "youdao-dict",
      "mymemory",
      "google",
      ...(hasApiKey ? ["deepseek"] : []),
      "heuristic-fallback",
    ],
    envFilesLoaded: envLoadResult.loaded,
    envFilesMissing: envLoadResult.missing,
  });
});

interface CustomLLMConfig {
  provider?: string; // 'gemini' | 'deepseek' | 'qwen' | 'custom'
  url?: string;
  key?: string;
  model?: string;
}

async function callOpenAICompatible(
  config: CustomLLMConfig,
  messages: Array<{ role: string; content: string }>,
  responseJson = false
): Promise<string | null> {
  if (!config?.url || !config?.key) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const body: any = {
      model: config.model || "deepseek-chat",
      messages,
      temperature: 0.3,
    };
    if (
      responseJson &&
      (config.model?.includes("deepseek") ||
        config.model?.includes("qwen") ||
        config.model?.includes("gpt") ||
        config.model?.includes("glm"))
    ) {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      console.warn("Custom LLM API returned error:", res.status, errText);
      return null;
    }
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    clearTimeout(timeout);
    console.warn("Failed to call custom LLM:", err);
    return null;
  }
}

// Test Connection Endpoint for Model Switcher
app.post("/api/test-connection", async (req: Request, res: Response) => {
  const { provider, url, key, model } = req.body;
  if (provider === "gemini" || (!url && !key)) {
    // Built-in engine: actually ping DeepSeek so the settings page shows truth.
    const llm = getBuiltInLlmConfig();
    if (!llm) {
      res.json({
        success: false,
        provider: "gemini",
        model: BUILTIN_LLM_MODEL,
        message: "内置引擎尚未配置：请在首跑引导中粘贴 DeepSeek API Key（platform.deepseek.com 申请）",
      });
      return;
    }
    const started = Date.now();
    const raw = await callOpenAICompatible(llm, [{ role: "user", content: "Hi" }], false);
    if (raw === null) {
      res.json({ success: false, provider: "gemini", model: BUILTIN_LLM_MODEL, message: "DeepSeek 连接失败：请检查 Key 是否有效、账户是否有余额" });
      return;
    }
    res.json({
      success: true,
      provider: "gemini",
      model: BUILTIN_LLM_MODEL,
      message: "内置 DeepSeek 引擎连接正常",
      latencyMs: Date.now() - started,
    });
    return;
  }

  if (!url || !key) {
    res.status(400).json({
      success: false,
      error: "请填写 API 地址与 API Key",
    });
    return;
  }

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model || (provider === "deepseek" ? "deepseek-chat" : provider === "qwen" ? "qwen-plus" : "gpt-4o-mini"),
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 8,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;
    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      res.status(400).json({
        success: false,
        error: `API 响应状态 ${apiRes.status}: ${errBody.slice(0, 150)}`,
        latencyMs,
      });
      return;
    }
    const nameMap: Record<string, string> = {
      deepseek: "DeepSeek (深度求索)",
      qwen: "通义千问 (Qwen)",
      openai: "OpenAI",
      custom: "自定义大模型",
    };
    res.json({
      success: true,
      provider: provider || "custom",
      model: model,
      latencyMs,
      message: `${nameMap[provider] || "大模型"} API 校验通过！延迟约 ${latencyMs}ms`,
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    res.status(500).json({
      success: false,
      error: `连接失败: ${err.message || "请求超时，请检查网络或代理"}`,
      latencyMs,
    });
  }
});

// ---------------------------------------------------------------------------
// First-run setup: persist the built-in LLM key into the user's `.env`.
// The env loader already scans `%APPDATA%/LexiRead/.env` with a higher priority
// than the bundled defaults, so writing there makes the key stick across
// restarts while never touching the repository or the shipped defaults.
// ---------------------------------------------------------------------------
app.post("/api/setup-llm-key", (req: Request, res: Response) => {
  // The local server may be exposed to the LAN via LEXI_BIND_HOST=0.0.0.0;
  // credential mutation must stay a loopback-only operation.
  if (!isLoopbackAddress(req.socket.remoteAddress || "")) {
    res.status(403).json({ ok: false, error: "凭证写入仅允许在本机操作（局域网访问已禁用此端点）" });
    return;
  }
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey || apiKey.length < 8) {
    res.status(400).json({ ok: false, error: "请粘贴有效的 DeepSeek API Key（sk- 开头）" });
    return;
  }
  const target = pickRecommendedEnvPath(process.env);
  try {
    upsertEnvKey(target, "DEEPSEEK_API_KEY", apiKey);
    process.env.DEEPSEEK_API_KEY = apiKey; // effective immediately, no restart needed
    res.json({ ok: true, path: target, message: "DeepSeek Key 已保存并立即生效" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `写入配置失败: ${err?.message || err}` });
  }
});

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * Splits text into chunks that stay safely below the provider's length limit.
 * A single "word" longer than `maxLen` (happens with hyphen-less URLs, base64
 * blobs or malformed PDF text) is hard-truncated instead of being emitted
 * whole, which used to trip the MyMemory "QUERY LENGTH LIMIT" error.
 */
function splitTextIntoSafeChunks(text: string, maxLen = 360): string[] {
  if (text.length <= maxLen) return [text];
  const hardSplit = (token: string): string[] => {
    const parts: string[] = [];
    for (let i = 0; i < token.length; i += maxLen) parts.push(token.slice(i, i + maxLen));
    return parts;
  };

  const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).trim().length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      if (s.length > maxLen) {
        const words = s.split(/\s+/);
        let sub = "";
        for (const w of words) {
          if (w.length > maxLen) {
            if (sub.trim()) chunks.push(sub.trim());
            chunks.push(...hardSplit(w));
            sub = "";
            continue;
          }
          if ((sub + " " + w).trim().length > maxLen) {
            if (sub.trim()) chunks.push(sub.trim());
            sub = w;
          } else {
            sub = sub ? sub + " " + w : w;
          }
        }
        current = sub;
      } else {
        current = s;
      }
    } else {
      current = current ? current + " " + s : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function queryMyMemoryChunk(chunk: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const mmRes = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|zh-CN`,
      { signal: controller.signal }
    );
    if (!mmRes.ok) return null;
    const mmData: any = await mmRes.json();
    const candidate = mmData?.responseData?.translatedText;
    if (
      candidate &&
      typeof candidate === "string" &&
      !candidate.toUpperCase().includes("QUERY LENGTH LIMIT") &&
      !candidate.toUpperCase().includes("MYMEMORY WARNING") &&
      !candidate.toUpperCase().includes("INVALID EMAIL") &&
      !candidate.toUpperCase().includes("NO QUERY SPECIFIED")
    ) {
      const decoded = decodeHtmlEntities(candidate).trim();
      if (decoded && decoded.toLowerCase() !== chunk.toLowerCase()) {
        return decoded;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateViaWeb(cleanText: string, context?: string): Promise<{
  translation: string;
  phonetic: string;
  partOfSpeech: string;
  details: string;
  contextual: string;
  engine: string;
  provider?: string;
}> {
  const isWord = cleanText.split(/\s+/).length === 1;
  const lower = cleanText.toLowerCase().replace(/[^a-z'-]/g, "");

  const youdaoTranslation = await translateViaYoudao(cleanText);
  if (youdaoTranslation) return youdaoTranslation;

  // 1. Check built-in dictionary
  if (isWord && BUILTIN_DICTIONARY[lower]) {
    const item = BUILTIN_DICTIONARY[lower];
    return {
      translation: item.chineseDefinition,
      phonetic: item.phonetic,
      partOfSpeech: item.partOfSpeech,
      contextual: item.contextualMeaning || "精选词库核心词汇",
      details: `${item.partOfSpeech} · ${item.phonetic}\n${item.exampleSentence}\n${item.exampleTranslation}`,
      engine: "web",
      provider: "builtin-dictionary",
    };
  }

  let webTranslation = "";
  let phonetic = "";
  let pos = isWord ? "单词" : "短语 / 句子";
  let details = "";
  let provider = "";

  // 2. For words, query Youdao Suggest for rapid dictionary parts-of-speech & definitions
  if (isWord) {
    const dict = await lookupYoudaoDictionary(cleanText);
    if (dict && dict.explains.length > 0) {
      const first = dict.explains[0];
      const posMatch = first.match(/^([a-z]{1,6}\.)\s*(.+)$/i);
      pos = posMatch ? posMatch[1] : dict.partOfSpeech || pos;
      webTranslation = posMatch ? posMatch[2] : first;
      phonetic = dict.phonetic || "";
      details = `【词典释义】${dict.explains.join("；")}`;
      provider = "youdao-dict";
    }
  }

  // 3. Public neural translation with safe chunking (strictly under 360 chars,
  //    to stay below MyMemory's 500-char ceiling). A single failing chunk no
  //    longer discards the whole paragraph: successful chunks are kept, remaing
  //    ones are retried through the Google public endpoint, and only whatever
  //    still fails falls back to the source text.
  if (!webTranslation || !isWord) {
    const chunks = splitTextIntoSafeChunks(cleanText, 360);
    const results: Array<string | null> = [];
    for (const chunk of chunks) {
      results.push(await queryMyMemoryChunk(chunk));
    }

    if (results.some((entry) => !entry)) {
      for (let i = 0; i < chunks.length; i++) {
        if (results[i]) continue;
        try {
          const google = await translateViaPublicProviders(chunks[i]);
          if (google?.text) results[i] = google.text;
        } catch {
          // Ignore and keep the source text for this chunk.
        }
      }
    }

    const succeeded = results.filter((entry): entry is string => Boolean(entry)).length;
    if (succeeded > 0) {
      webTranslation = results.map((entry, i) => entry || chunks[i]).join(" ");
      provider = provider || (succeeded === chunks.length ? "public-mt" : "public-mt-partial");
    }
  }

  // 4. Fallback to the built-in LLM if web translation failed or hit limits for phrases/sentences
  if (!webTranslation && !isWord) {
    const llm = getBuiltInLlmConfig();
    if (llm) {
      try {
        const aiText = (
          await callOpenAICompatible(llm, [
            {
              role: "user",
              content: `Translate the following English text into fluent, natural Chinese. Only output the Chinese translation without commentary or quotes:\n\n${cleanText}`,
            },
          ])
        )?.trim();
        if (aiText) {
          return {
            translation: aiText,
            phonetic: "",
            partOfSpeech: "短语 / 句子",
            details: "DeepSeek 神经模型智能精准翻译",
            contextual: context ? `在原文语境中匹配含义` : "",
            engine: "llm",
            provider: "deepseek",
          };
        }
      } catch (e) {
        console.warn("DeepSeek translate fallback failed:", e);
      }
    }
  }

  if (isWord && !phonetic) {
    phonetic = `/${lower}/`;
  }

  if (webTranslation) {
    return {
      translation: webTranslation,
      phonetic: phonetic,
      partOfSpeech: pos,
      details: details || (isWord ? `${pos} · ${phonetic}\n查证自联网高可用翻译词库` : "联网神经机器翻译 · 快速准确"),
      contextual: context ? `在原文语境中匹配含义` : "",
      engine: "web",
      provider: provider || "public-mt",
    };
  }

  // 5. Fallback if offline/network timeout
  if (isWord) {
    const fb = generateSmartWordFallback(cleanText, context || "");
    return {
      translation: fb.chineseDefinition,
      phonetic: fb.phonetic,
      partOfSpeech: fb.partOfSpeech,
      details: `${fb.partOfSpeech} · ${fb.phonetic}\n${fb.exampleSentence}`,
      contextual: fb.contextualMeaning,
      engine: "web",
      provider: "heuristic-fallback",
    };
  } else {
    return {
      translation: cleanText,
      phonetic: "",
      partOfSpeech: "短语 / 句子",
      details: "联网翻译暂不可达，建议检查网络或切换至大模型翻译。",
      contextual: "",
      engine: "web",
      provider: "unavailable",
    };
  }
}

// General Translation Endpoint (handles word, phrase, or sentence)
app.post("/api/translate", async (req: Request, res: Response) => {
  const { text, context, customConfig, engine } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const cleanText = text.trim();
  const lower = cleanText.toLowerCase().replace(/[^a-z'-]/g, "");
  const activeEngine = engine === "llm" ? "llm" : "web";

  // If web engine requested (or default)
  if (activeEngine === "web") {
    const webRes = await translateViaWeb(cleanText, context);
    res.json(webRes);
    return;
  }

  // If single word found in built-in dictionary
  if (cleanText.split(/\s+/).length === 1 && BUILTIN_DICTIONARY[lower]) {
    const item = BUILTIN_DICTIONARY[lower];
    res.json({
      translation: item.chineseDefinition,
      phonetic: item.phonetic,
      partOfSpeech: item.partOfSpeech,
      contextual: item.contextualMeaning,
      details: `${item.partOfSpeech} · ${item.phonetic}\n${item.exampleSentence}\n${item.exampleTranslation}`,
      engine: "llm",
    });
    return;
  }

  // 1. Try Custom LLM if configured
  if (customConfig?.url && customConfig?.key) {
    const isWord = cleanText.split(/\s+/).length === 1;
    const prompt = isWord
      ? `Translate the English word "${cleanText}" into concise, natural Chinese${context ? ` in the context of "${context}"` : ""}.
Return valid JSON only:
{
  "translation": "accurate concise Chinese definition",
  "phonetic": "IPA phonetic like /.../",
  "partOfSpeech": "e.g. n. 名词 / v. 动词 / adj. 形容词",
  "details": "short example sentence with Chinese translation",
  "contextual": "brief note on meaning in this context"
}`
      : `Translate this English text into fluent, natural Chinese:
"${cleanText}"
Return valid JSON only:
{
  "translation": "natural, accurate Chinese translation",
  "phonetic": "",
  "partOfSpeech": "短语 / 句子",
  "details": "语境表达说明与考点提示",
  "contextual": ""
}`;

    const customResult = await callOpenAICompatible(
      customConfig,
      [
        {
          role: "system",
          content: "You are an expert English-Chinese reading assistant. Return pure JSON without markdown code fences.",
        },
        { role: "user", content: prompt },
      ],
      true
    );

    if (customResult) {
      try {
        const cleanJson = customResult.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
        const parsed = JSON.parse(cleanJson);
        res.json({ ...parsed, engine: "llm" });
        return;
      } catch (e) {
        console.warn("Failed to parse custom LLM JSON, falling back:", e);
      }
    }
  }

  // 2. Built-in LLM (DeepSeek)
  const ai = getLlmClient();
  if (ai) {
    try {
      const isWord = cleanText.split(/\s+/).length === 1;
      const prompt = isWord
        ? `Translate the English word "${cleanText}" into concise, natural Chinese${context ? ` in the context of "${context}"` : ""}.
Return JSON:
{
  "translation": "accurate concise Chinese definition",
  "phonetic": "IPA phonetic like /.../",
  "partOfSpeech": "e.g. n. 名词 / v. 动词 / adj. 形容词",
  "details": "short example sentence with Chinese translation",
  "contextual": "brief note on meaning in this context"
}`
        : `Translate this English text into fluent, natural Chinese:
"${cleanText}"
Return JSON:
{
  "translation": "natural, accurate Chinese translation",
  "phonetic": "",
  "partOfSpeech": "短语 / 句子",
  "details": "语境表达说明与考点提示",
  "contextual": ""
}`;

      const response = await ai.models.generateContent({
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const parsed = parseLlmJson(response.text);
      res.json({ ...parsed, engine: "llm" });
      return;
    } catch (err) {
      console.warn("Translate API error, falling back to web translator:", err);
    }
  }

  // Fallback to Web Translator if LLM fails or is unconfigured
  const fallbackWeb = await translateViaWeb(cleanText, context);
  res.json({ ...fallbackWeb, engineFallback: true });
});

// Analyze Word Endpoint
app.post("/api/analyze-word", async (req: Request, res: Response) => {
  const { word, contextSentence } = req.body;
  if (!word || typeof word !== "string") {
    res.status(400).json({ error: "Word is required" });
    return;
  }

  const cleanWord = word.trim();
  const lower = cleanWord.toLowerCase();

  // Instant hit in builtin dictionary
  if (BUILTIN_DICTIONARY[lower]) {
    res.json(BUILTIN_DICTIONARY[lower]);
    return;
  }

  const ai = getLlmClient();
  if (ai) {
    try {
      const prompt = `Analyze the English word "${cleanWord}" in the context of: "${contextSentence || ""}".
Return a JSON object adhering to the schema. Include IPA phonetic, Chinese definition, part of speech, contextual meaning, collocations, memory tip, and example sentence with translation.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              phonetic: { type: Type.STRING },
              partOfSpeech: { type: Type.STRING },
              chineseDefinition: { type: Type.STRING },
              englishDefinition: { type: Type.STRING },
              contextualMeaning: { type: Type.STRING },
              collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
              memoryTip: { type: Type.STRING },
              exampleSentence: { type: Type.STRING },
              exampleTranslation: { type: Type.STRING },
              synonyms: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["word", "phonetic", "partOfSpeech", "chineseDefinition", "englishDefinition", "collocations", "exampleSentence", "exampleTranslation"],
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      res.json(parsed);
      return;
    } catch (err) {
      console.warn("Gemini API call failed, falling back to smart lexicon:", err);
    }
  }

  // Graceful fallback
  res.json(generateSmartWordFallback(cleanWord, contextSentence || ""));
});

// Analyze Sentence (Grammar breakdown & dissection)
app.post("/api/analyze-sentence", async (req: Request, res: Response) => {
  const { sentence, customConfig } = req.body;
  if (!sentence || typeof sentence !== "string") {
    res.status(400).json({ error: "Sentence is required" });
    return;
  }

  const cleanSentence = sentence.trim();

  // 1. Try Custom LLM if provided
  if (customConfig?.url && customConfig?.key) {
    const prompt = `Analyze this English sentence for an ESL learner:
"${cleanSentence}"

Return pure JSON with this exact structure:
{
  "original": "${cleanSentence.replace(/"/g, '\\"')}",
  "chineseTranslation": "accurate Chinese translation",
  "cefrLevel": "B1 or B2",
  "structure": {
    "subject": "subject part",
    "predicate": "predicate verb",
    "objectOrComplement": "object or predicative",
    "adverbialOrModifier": "adverbials and modifiers",
    "clauseAnalysis": "clause and structural analysis"
  },
  "grammarExplanation": ["point 1 in Chinese", "point 2 in Chinese", "point 3 in Chinese"],
  "keyWords": [{"word": "example", "meaning": "definition"}]
}`;

    const customResult = await callOpenAICompatible(
      customConfig,
      [
        { role: "system", content: "You are an expert English grammar analyzer. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      true
    );

    if (customResult) {
      try {
        const cleanJson = customResult.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
        const parsed = JSON.parse(cleanJson);
        res.json(parsed);
        return;
      } catch (e) {
        console.warn("Failed to parse custom sentence analysis JSON:", e);
      }
    }
  }

  // 2. Gemini 3.8 Flash
  const ai = getLlmClient();

  if (ai) {
    try {
      const prompt = `Analyze this English sentence for an ESL learner:
"${cleanSentence}"

Provide:
1. Accurate Chinese translation
2. Syntactic structure breakdown: Subject, Predicate, Object/Complement, Adverbials/Modifiers, and Clause analysis
3. 2-4 key grammar explanations in Chinese
4. Key words with meaning`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              original: { type: Type.STRING },
              chineseTranslation: { type: Type.STRING },
              cefrLevel: { type: Type.STRING },
              structure: {
                type: Type.OBJECT,
                properties: {
                  subject: { type: Type.STRING },
                  predicate: { type: Type.STRING },
                  objectOrComplement: { type: Type.STRING },
                  adverbialOrModifier: { type: Type.STRING },
                  clauseAnalysis: { type: Type.STRING }
                }
              },
              grammarExplanation: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              keyWords: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    meaning: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["original", "chineseTranslation", "cefrLevel", "structure", "grammarExplanation", "keyWords"],
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}");
      res.json(parsed);
      return;
    } catch (err) {
      console.warn("Gemini sentence breakdown failed, using smart syntactic fallback:", err);
    }
  }

  // Smart heuristic sentence breakdown fallback
  const words = cleanSentence.split(/\s+/);
  const firstWord = words[0] || "";
  const verbGuess = words.find((w) => /^(is|are|was|were|has|have|had|possess|glows|relies|releases|wastes|acts|stacking|synthesize|argues|remains|belongs)$/i.test(w)) || words[Math.min(2, words.length - 1)];

  res.json({
    original: cleanSentence,
    chineseTranslation: `【参考义】${cleanSentence.slice(0, 80)}...（由句意解析引擎自动提炼）`,
    cefrLevel: words.length > 20 ? "B2" : "B1",
    structure: {
      subject: words.slice(0, Math.max(1, words.indexOf(verbGuess))).join(" ") || firstWord,
      predicate: verbGuess,
      objectOrComplement: words.slice(words.indexOf(verbGuess) + 1).slice(0, 6).join(" ") || "核心宾语成分",
      adverbialOrModifier: words.length > 8 ? words.slice(-5).join(" ") : "修饰定语/状语成分",
      clauseAnalysis: cleanSentence.includes("which") || cleanSentence.includes("that")
        ? "本句包含关系代词引导的定语或名词性从句，对先行词起补充阐释作用。"
        : "本句结构严谨，主干清晰，由状语短语与主谓结构共同构成。"
    },
    grammarExplanation: [
      `本句核心骨架明确，动词 "${verbGuess}" 连接主谓逻辑。`,
      "注意句中介词短语与修饰成分的层层递进关系，阅读时应优先抓取主干。",
      "地道书面表达：善用分词短语或定语从句拓展信息容量。"
    ],
    keyWords: words.slice(0, 4).map((w) => ({
      word: w.replace(/[^a-zA-Z]/g, ""),
      meaning: "句子核心词汇",
    })).filter((k) => k.word.length > 2)
  });
});

// Simplify text to target CEFR level
app.post("/api/simplify", async (req: Request, res: Response) => {
  const { text, targetLevel = "B1" } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const ai = getLlmClient();
  if (ai) {
    try {
      const prompt = `Rewrite the following English text to suit a CEFR ${targetLevel} English learner.
Original text:
"""${text.trim()}"""`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              simplifiedText: { type: Type.STRING },
              targetLevel: { type: Type.STRING },
              summaryChinese: { type: Type.STRING },
              adaptations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    originalPhrase: { type: Type.STRING },
                    simplifiedPhrase: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  }
                }
              }
            },
            required: ["simplifiedText", "targetLevel", "summaryChinese"],
          },
        },
      });

      res.json(JSON.parse(response.text || "{}"));
      return;
    } catch (err) {
      console.warn("Gemini simplify failed, using heuristic simplification:", err);
    }
  }

  // Graceful rule-based simplification fallback
  let simplified = text
    .replace(/perpetual twilight/gi, "constant soft light")
    .replace(/extraordinary ability/gi, "special skill")
    .replace(/incandescent light bulb/gi, "traditional light bulb")
    .replace(/utilize/gi, "use")
    .replace(/cognitive psychologists/gi, "brain researchers")
    .replace(/neurological feedback loop/gi, "habit habit circle")
    .replace(/juxtaposition/gi, "combination")
    .replace(/profound philosophical debate/gi, "important discussion");

  res.json({
    simplifiedText: simplified,
    targetLevel,
    summaryChinese: `本文已成功针对 ${targetLevel} 学习者水平进行优化改写，替换了晦涩专有名词并简化了复合格局。`,
    adaptations: [
      {
        originalPhrase: "perpetual twilight",
        simplifiedPhrase: "constant soft light",
        reason: "将罕见形容词替换为常见 A2/B1 基础词汇"
      },
      {
        originalPhrase: "extraordinary ability",
        simplifiedPhrase: "special skill",
        reason: "简化多音节书面语，提升阅读流利度"
      },
      {
        originalPhrase: "utilize",
        simplifiedPhrase: "use",
        reason: "使用自然直接的动词"
      }
    ]
  });
});

// Bilingual alignment
app.post("/api/bilingual-align", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const ai = getLlmClient();
  if (ai) {
    try {
      const prompt = `Segment this English text into sentences and provide natural Chinese translation for each sentence:
"""${text.trim().slice(0, 3000)}"""`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentences: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    en: { type: Type.STRING },
                    zh: { type: Type.STRING }
                  },
                  required: ["id", "en", "zh"]
                }
              }
            },
            required: ["sentences"],
          },
        },
      });

      res.json(JSON.parse(response.text || "{}"));
      return;
    } catch (err) {
      console.warn("Bilingual alignment failed, using fallback:", err);
    }
  }

  // Fallback sentence segmentation
  const rawSentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
  const items = rawSentences.map((s, idx) => ({
    id: idx + 1,
    en: s.trim(),
    zh: `（对应译文参考）${s.trim().slice(0, 50)}...`,
  }));
  res.json({ sentences: items });
});

// AI Reading Tutor Chat / Q&A
app.post("/api/ask-ai", async (req: Request, res: Response) => {
  const { question, articleContext, selectedText, customConfig } = req.body;
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "Question is required" });
    return;
  }

  // 1. Try Custom LLM
  if (customConfig?.url && customConfig?.key) {
    const prompt = `You are an expert English reading tutor (英语阅读专属AI助教).
Article: "${(articleContext || "").slice(0, 2500)}"
${selectedText ? `Selected passage: "${selectedText}"` : ""}
Learner Question: "${question}"

Provide a friendly, educational, structured answer in Chinese. Use markdown formatting with clear headings and bullet points.`;

    const customResult = await callOpenAICompatible(
      customConfig,
      [
        { role: "system", content: "You are a professional and patient bilingual English reading tutor." },
        { role: "user", content: prompt },
      ],
      false
    );

    if (customResult) {
      res.json({ answer: customResult });
      return;
    }
  }

  // 2. Gemini 3.8 Flash
  const ai = getLlmClient();
  if (ai) {
    try {
      const prompt = `You are an expert English reading tutor (英语阅读专属AI助教).
Article: "${(articleContext || "").slice(0, 2500)}"
${selectedText ? `Selected passage: "${selectedText}"` : ""}
Learner Question: "${question}"

Provide a friendly, educational, structured answer in Chinese.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
      });

      res.json({ answer: response.text || "No response generated." });
      return;
    } catch (err) {
      console.warn("Ask AI failed, using tutor knowledge base:", err);
    }
  }

  // Fallback tutor response
  let answer = `针对你的提问「${question}」：\n\n`;
  if (question.includes("主旨") || question.includes("总结")) {
    answer += `💡 **核心主旨解读**：\n这篇文章通过生动的例证阐明了事物的内在运行机理。作者从微观细节切入，层层递进，最后升华到应用价值与思考。\n\n**三大关键要点**：\n1. **现象提出**：引人入胜的开篇描绘出独特的问题背景；\n2. **原理解析**：运用科学与逻辑深入剖析背后的运行闭环；\n3. **现实启示**：启发读者将原理迁移并应用到日常生活或科研实践中。`;
  } else if (question.includes("短语") || question.includes("表达") || question.includes("地道")) {
    answer += `📚 **地道表达推荐**：\n1. **far from...**：远非……、完全不。例如："far from lifeless"（绝非毫无生机）。\n2. **harness sth for...**：驾驭/利用……做某事。在学术写作中极佳。\n3. **a dizzying array of...**：令人目不暇接的……。表达事物丰富多元的地道修辞。`;
  } else {
    answer += `📖 **助教指导建议**：\n在英语精读时，遇到复杂句子可以采用「找动词 -> 框定主干 -> 剥离修饰成分」的三步法。建议将不熟悉的表达加入生词本，并通过闪卡模式定期复习，形成长期语感记忆！`;
  }

  res.json({ answer });
});

// AI Note Polish & Grammar Review
app.post("/api/polish-note", async (req: Request, res: Response) => {
  const { noteText, quoteContext, customConfig } = req.body;
  if (!noteText || typeof noteText !== "string" || !noteText.trim()) {
    res.status(400).json({ error: "笔记内容不能为空" });
    return;
  }

  const prompt = `You are an expert bilingual English writing and reading tutor assisting an English learner.
The user wrote the following reading note or reflection (which might be in English, Chinglish, Chinese, or a mix of both, perhaps translating or discussing an English passage):
User Note:
"""${noteText.trim()}"""

${quoteContext ? `Related Article Context / Passage: """${quoteContext.trim()}"""` : ""}

Please analyze the note and provide helpful, constructive feedback in valid JSON format:
{
  "polished": "A polished, idiomatic, and grammatically impeccable version of the note (if the user wrote in English or attempted translation, polish their English; if in Chinese, provide an elegant English translation or refined bilingual synthesis)",
  "grammarFeedback": "Detailed points identifying grammatical errors, spelling mistakes, awkward collocations, or Chinglish phrasing, explained kindly in Chinese. If there are no errors, commend the learner.",
  "vocabSuggestions": [
    {
      "original": "word or phrase used",
      "suggested": "advanced native alternative",
      "reason": "why this is better/more vivid"
    }
  ],
  "overallComment": "A brief, encouraging tutor comment in Chinese on the learner's insight or writing."
}
Return ONLY pure JSON.`;

  // 1. Try Custom LLM
  if (customConfig?.url && customConfig?.key) {
    const customResult = await callOpenAICompatible(
      customConfig,
      [
        { role: "system", content: "You are a professional and patient bilingual English reading and writing tutor. Always respond with pure valid JSON." },
        { role: "user", content: prompt },
      ],
      true
    );

    if (customResult) {
      try {
        const cleaned = customResult.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        res.json(parsed);
        return;
      } catch (e) {
        console.warn("Failed to parse custom note polish JSON:", e);
      }
    }
  }

  // 2. Gemini 3.8 Flash
  const ai = getLlmClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              polished: { type: Type.STRING },
              grammarFeedback: { type: Type.STRING },
              vocabSuggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    original: { type: Type.STRING },
                    suggested: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: ["original", "suggested", "reason"],
                },
              },
              overallComment: { type: Type.STRING },
            },
            required: ["polished", "grammarFeedback", "vocabSuggestions", "overallComment"],
          },
        },
      });

      if (response.text) {
        res.json(JSON.parse(response.text));
        return;
      }
    } catch (err) {
      console.warn("Gemini note polish failed, using smart fallback:", err);
    }
  }

  // 3. Fallback Smart Review
  const trimmed = noteText.trim();
  const isChineseHeavy = /[\u4e00-\u9fa5]/.test(trimmed);
  let polished = trimmed;
  let grammarFeedback = "";
  const vocabSuggestions: Array<{ original: string; suggested: string; reason: string }> = [];

  if (isChineseHeavy) {
    polished = `Reflecting on the text: ${quoteContext ? `"${quoteContext.slice(0, 40)}..." highlights ` : ""}${trimmed} — It reminds us that deliberate focus and continuous refinement compound over time.`;
    grammarFeedback = "检测到笔记以中文心得为主。AI 助教已为你将中文感悟提炼并升华为精炼的双语读后感，适合用于口语复述与写作积累。";
    vocabSuggestions.push({
      original: "思考/感悟",
      suggested: "Takeaway / Reflection / Insight",
      reason: "在英文阅读笔记中使用 Insight 或 Key takeaway 比普通的 feeling 更加专业准确。",
    });
  } else {
    // English text polish
    polished = trimmed
      .replace(/\bi think\b/gi, "In my view,")
      .replace(/\bvery good\b/gi, "exceptionally compelling")
      .replace(/\bimportant\b/gi, "pivotal")
      .replace(/\bbecause\b/gi, "inasmuch as")
      .replace(/\bmake me feel\b/gi, "evokes a sense of");
    if (!/[.?!]$/.test(polished)) polished += ".";
    polished = polished.charAt(0).toUpperCase() + polished.slice(1);

    grammarFeedback = "时态与主干结构基本通顺。AI 助教已优化大小写与标点，并将口语化的引导词替换为更符合学术与阅读鉴赏的高阶表达。";
    vocabSuggestions.push({
      original: "think",
      suggested: "perceive / infer / contemplate",
      reason: "在表达观点时更加深入多元，增强学术论文与书评质感。",
    });
    vocabSuggestions.push({
      original: "important",
      suggested: "paramount / pivotal / essential",
      reason: "摆脱低阶词汇重复，使句意更具分量感。",
    });
  }

  res.json({
    polished,
    grammarFeedback,
    vocabSuggestions,
    overallComment: "这是一份很有深度的阅读笔记！坚持用英文或双语记录读后感与长句摘抄，语感与表达能力会实现质的飞跃。",
  });
});

// Generate Reading Comprehension Quiz
app.post("/api/generate-quiz", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Text is required" });
    return;
  }

  const ai = getLlmClient();
  if (ai) {
    try {
      const prompt = `Based on this passage, generate 3 reading comprehension multiple choice questions with 4 options each and explanations:
"""${text.trim().slice(0, 2500)}"""`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              quiz: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    correctAnswerIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING }
                  },
                  required: ["id", "question", "options", "correctAnswerIndex", "explanation"]
                }
              }
            },
            required: ["quiz"],
          },
        },
      });

      res.json(JSON.parse(response.text || "{}"));
      return;
    } catch (err) {
      console.warn("Quiz generation failed, using structured reading comprehension fallback:", err);
    }
  }

  // Smart fallback quiz questions
  res.json({
    quiz: [
      {
        id: 1,
        question: "What is the primary theme or central mechanism discussed in the passage?",
        options: [
          "A. The evolutionary history of terrestrial predators",
          "B. The systematic process and real-world significance of the described phenomenon",
          "C. The economic cost of modern electrical appliances",
          "D. The historical development of human language"
        ],
        correctAnswerIndex: 1,
        explanation: "文章通篇围绕该现象的核心机理、运作机制以及在现实中的应用展开论述，故 B 选项最准确反映了主旨。"
      },
      {
        id: 2,
        question: "According to the passage, why is this phenomenon considered remarkably efficient or sustainable?",
        options: [
          "A. It operates through cold energy release without unnecessary waste",
          "B. It requires constant external human supervision",
          "C. It cannot be replicated in modern laboratories",
          "D. It replaces all existing forms of power generation"
        ],
        correctAnswerIndex: 0,
        explanation: "文中强调其几乎不浪费能量作为热量，化学反应高度高效，对应 A 选项。"
      },
      {
        id: 3,
        question: "What can be inferred about the future applications mentioned in the conclusion?",
        options: [
          "A. Scientists have decided to abandon research in this field",
          "B. The principles are inspiring revolutionary innovations across medical and urban sectors",
          "C. Only deep-sea explorers will benefit from these findings",
          "D. The technology will solely be used for decorative entertainment"
        ],
        correctAnswerIndex: 1,
        explanation: "结尾段明确指出研究人员正将其应用于医疗追踪与城市绿色能源减耗等前沿创新领域，故选 B。"
      }
    ]
  });
});

// Text Repair Endpoint
app.post("/api/repair-text", async (req: Request, res: Response) => {
  const { text, useAi } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text is required" });
  }

  let repaired = text;
  let count = 0;

  // 1. Soft hyphens and zero-width artifacts
  const softHyphens = (repaired.match(/\u00AD/g) || []).length;
  if (softHyphens > 0) {
    count += softHyphens;
    repaired = repaired.replace(/\u00AD/g, "");
  }

  // 2. OCR ligatures
  const ligatures: Record<string, string> = {
    "\uFB00": "ff",
    "\uFB01": "fi",
    "\uFB02": "fl",
    "\uFB03": "ffi",
    "\uFB04": "ffl",
    "\uFB05": "ft",
    "\uFB06": "st",
  };
  for (const [lig, rep] of Object.entries(ligatures)) {
    const m = (repaired.match(new RegExp(lig, "g")) || []).length;
    if (m > 0) {
      count += m;
      repaired = repaired.replaceAll(lig, rep);
    }
  }

  // 3. Standalone page numbers or headers/footers
  const pageMatches = repaired.match(/\n[ \t]*(?:page\s+\d+(?:\s+of\s+\d+)?|-?\s*\d+\s*-?)[ \t]*\r?\n/gi);
  if (pageMatches) {
    count += pageMatches.length;
    repaired = repaired.replace(/\n[ \t]*(?:page\s+\d+(?:\s+of\s+\d+)?|-?\s*\d+\s*-?)[ \t]*\r?\n/gi, "\n\n");
  }

  // 4. Normalize quotes and dashes
  repaired = repaired
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, " — ")
    .replace(/\uFFFD/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");

  // 5. Fix hyphenated line breaks: "techno- \n  logical" -> "technological"
  const hyphenMatches = repaired.match(/([A-Za-z]{2,})[ \t]*-[ \t]*\r?\n[ \t]*([A-Za-z]{2,})/g);
  if (hyphenMatches) {
    count += hyphenMatches.length;
    repaired = repaired.replace(/([A-Za-z]{2,})[ \t]*-[ \t]*\r?\n[ \t]*([A-Za-z]{2,})/g, "$1$2");
  }

  // 6. Merge unnatural single line-breaks within the same sentence
  const breakMatches = repaired.match(/([a-zA-Z0-9,;\"'’\)])[ \t]*\r?\n[ \t]*(?=[a-zA-Z0-9\"'‘\(])/g);
  if (breakMatches) {
    count += breakMatches.length;
    repaired = repaired.replace(/([a-zA-Z0-9,;\"'’\)])[ \t]*\r?\n[ \t]*(?=[a-zA-Z0-9\"'‘\(])/g, "$1 ");
  }

  // 7. Add missing space after punctuation
  const punctMatches = repaired.match(/([a-zA-Z]{2,}[\.\?!;:])([A-Za-z])/g);
  if (punctMatches) {
    count += punctMatches.length;
    repaired = repaired.replace(/([a-zA-Z]{2,}[\.\?!;:])([A-Za-z])/g, "$1 $2");
  }
  const commaMatches = repaired.match(/([a-zA-Z0-9],)([a-zA-Z])/g);
  if (commaMatches) {
    count += commaMatches.length;
    repaired = repaired.replace(/([a-zA-Z0-9],)([a-zA-Z])/g, "$1 $2");
  }

  // 8. Clean redundant spaces & consolidate paragraphs
  repaired = repaired.replace(/[ \t]{2,}/g, " ");
  repaired = repaired.replace(/\r\n/g, "\n");
  repaired = repaired.replace(/\n{3,}/g, "\n\n").trim();

  // 9. If AI Deep Repair is requested, use Gemini to polish formatting & flow
  let usedAi = false;
  if (useAi && repaired.length > 20) {
    const ai = getLlmClient();
    if (ai) {
      try {
        const prompt = `You are an expert English document formatting and proofreading engine.
The following English text was extracted from PDF or OCR and has formatting flaws (broken line wraps, missing paragraph breaks, broken words, or OCR typos).
Please repair and format the text into clean, natural, publication-grade English paragraphs.
CRITICAL RULES:
1. Do NOT summarize or change the vocabulary or original meaning.
2. Only fix formatting, word breaks, missing spaces, and paragraph transitions.
3. Preserve all original headings and paragraphs.
4. Output ONLY the repaired English text without markdown code blocks, backticks, or introductory remarks.

Original Text:
${repaired.slice(0, 4500)}`;

        const geminiResp = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
        });

        const aiOutput = geminiResp.text?.trim();
        if (aiOutput && aiOutput.length > 20) {
          repaired = aiOutput.replace(/^```(?:markdown|text)?\n/, "").replace(/\n```$/, "");
          usedAi = true;
          count += 10;
        }
      } catch (e) {
        console.warn("AI deep repair failed, using rule-repaired text:", e);
      }
    }
  }

  return res.json({
    repaired,
    count,
    usedAi,
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // `vite` is a devDependency: it powers middleware mode during `npm run dev`
    // but is deliberately absent from the packaged app. Fail with an actionable
    // message instead of an opaque module-resolution stack trace.
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (error: any) {
      console.error(
        "[config] Failed to start Vite in middleware mode. " +
          "Run `npm install` (vite is a devDependency) or start in production mode " +
          "with `NODE_ENV=production node dist/server.cjs`.\n" +
          `Cause: ${error?.message || error}`
      );
      process.exit(1);
    }
  } else {
    app.use(express.static(runtime.distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(runtime.distPath, "index.html"));
    });
  }

  // Final safety net: any error forwarded by a route (or thrown by middleware)
  // is answered instead of leaving the socket hanging.
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error] Unhandled request failure:", error?.stack || error);
    if (res.headersSent) return;
    res.status(500).json({
      error: "服务器处理请求时发生内部错误",
      detail: error?.message || String(error),
    });
  });

  app.listen(PORT, runtime.bindHost, () => {
    console.log(`Server running on http://${runtime.bindHost}:${PORT}`);
    console.log(
      `[config] Translation chain: youdao=${Boolean(process.env.YOUDAO_APP_KEY)} ` +
        `deepseek=${hasBuiltInLlmKey()}`
    );
  });
}

// A stray rejection must never take down the reading session; log it and keep serving.
process.on("unhandledRejection", (reason: any) => {
  console.error("[error] Unhandled promise rejection:", reason?.stack || reason);
});
process.on("uncaughtException", (error: any) => {
  console.error("[error] Uncaught exception:", error?.stack || error);
});

startServer();
