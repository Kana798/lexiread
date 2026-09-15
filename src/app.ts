// LexiRead Core Application Logic
// Inherited and enhanced with Gemini 3.8 Flash backend features
import { formPdfLine } from './pdf-extraction';
import { pausePlaybackEngine, resumePlaybackEngine } from './playback-engine';
import { diagnoseText as sharedDiagnoseText, repairText as sharedRepairText } from './text-quality';
import { setOriginalStageVisibility } from './original-playback';

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

const $ = (s: string) => document.querySelector(s) as any;
const $$ = (s: string) => [...document.querySelectorAll(s)] as any[];
const store = (k: string, v: any) => localStorage.setItem(k, JSON.stringify(v));
const load = (k: string, d: any) => {
  try {
    return JSON.parse(localStorage.getItem(k)!) ?? d;
  } catch {
    return d;
  }
};

interface ArticleItem {
  id: string;
  title: string;
  body: string;
  created: string;
  originalBody?: string;
  level?: string;
  translations?: string[]; // Pre-translated paragraph Chinese content
}

interface WordItem {
  text: string;
  meaning: string;
  phonetic?: string;
  example?: string;
}

interface NoteItem {
  id?: string;
  text: string;
  at: string;
  quote?: string;
  created?: string;
  articleId?: string;
  paraIndex?: number;
}

const defaultArticleBody = `In an age of endless notifications, attention has become one of our most valuable possessions. We give it away in small pieces: to a bright screen, a familiar sound, or the faint promise of something new.

Yet attention is more than a resource to be managed. It is a way of meeting the world. When we notice the light moving across a wall, or listen fully to a friend's story, ordinary moments begin to reveal their texture.

The practice is surprisingly simple, though not always easy. Choose one thing. Stay with it. When your mind wanders—as it naturally will—gently bring it back. Each return is not a failure, but a small act of care.

Over time, this kind of attention changes what we see. The world does not become quieter; we simply become better at hearing its many voices.`;

const defaultArticleTranslations: string[] = [
  "在这个充斥着无休止通知的时代，注意力已经成为我们最宝贵的财富之一。我们把它一点点散掷出去：给闪烁的屏幕、熟悉的声音，或是某种新鲜事物微弱的诱惑。",
  "然而，注意力不仅仅是一种有待调配的资源，更是我们与这个世界相遇的方式。当我们驻足凝望光影在墙面缓缓流动，或全神贯注地倾听朋友倾诉，平凡的瞬间便开始显露其丰富的质感。",
  "这种练习出奇地简单，尽管往往并不容易。挑选一件事物，与之相伴。当思绪不由自主地飘散时——正如它本能的那样——温和地将它拉回。每一次心念的归拢都不是失败，而是一次小小的关照。",
  "久而久之，这种专注将改变我们所看到的世界。世界并未变得更安静，只是我们开始更懂得聆听它交织的万千声音。"
];

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/\uFB05/g, "st")
    .replace(/\uFB06/g, "st")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, " — ")
    .replace(/\u2013/g, " – ")
    .replace(/\u00AD/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/(\b[A-Za-z]+)-\s*\n\s*([a-z]+\b)/g, "$1$2");
}

function paragraphsFromText(text: string) {
  const cleaned = cleanExtractedText(text);
  return cleaned
    .trim()
    .split(/\n\s*\n+/)
    .filter((p) => p.trim())
    .map((p) => {
      const pClean = p.replace(/\r/g, "").replace(/\n+/g, " ").replace(/[ \t]+/g, " ").trim();
      return `<p>${escapeHtml(pClean)}</p>`;
    })
    .join("");
}

let articles: ArticleItem[] = load("lexi-articles", [
  {
    id: "welcome",
    title: "The Art of Paying Attention",
    body: paragraphsFromText(defaultArticleBody),
    created: "今天",
    translations: defaultArticleTranslations,
  },
]);

// Ensure default or cached welcome article has full pre-translations
if (articles.length > 0 && articles[0].id === "welcome" && (!articles[0].translations || articles[0].translations.length === 0)) {
  articles[0].translations = defaultArticleTranslations;
  store("lexi-articles", articles);
}

let words: WordItem[] = load("lexi-words", []);
let notes: NoteItem[] = load("lexi-notes", []);
let current: ArticleItem = articles[0] || {
  id: "welcome",
  title: "The Art of Paying Attention",
  body: paragraphsFromText(defaultArticleBody),
  created: "今天",
  translations: defaultArticleTranslations,
};
let chosen = "";
let chosenParaIndex: number | undefined = undefined;
let editingExisting = true;
let bilingualActive = false;
let bilingualCache: Record<string, string> = {};

// Seed bilingualCache with pre-translations
// Keys are always namespaced by article id (`<id>-p-<index>`). A bare `p-<index>`
// key used to exist as a fallback and leaked translations across articles.
defaultArticleTranslations.forEach((text, idx) => {
  bilingualCache[`welcome-p-${idx}`] = text;
});

const miniDictionary: Record<string, string> = {
  attention: "注意力；专注",
  valuable: "有价值的；宝贵的",
  possession: "财产；拥有物",
  possessions: "财产；拥有物",
  notification: "通知；提醒",
  notifications: "通知；提醒",
  resource: "资源",
  managed: "被管理的",
  ordinary: "普通的；平凡的",
  moments: "时刻；瞬间",
  practice: "练习；实践",
  surprisingly: "令人惊讶地",
  naturally: "自然地",
  gently: "轻柔地；温和地",
  failure: "失败",
  world: "世界",
  hearing: "听见；听力",
  bioluminescence: "生物发光；生物体荧光",
  luciferin: "荧光素",
  luciferase: "荧光素酶",
  perpetual: "永恒的；持久的",
};

const keyWords = new Set([
  "confidence", "overconfidence", "performance", "abilities", "actual",
  "self-belief", "self-deception", "falsehoods", "evolutionary", "perspective",
  "deceive", "hesitation", "underlying", "beneficial", "attention",
  "valuable", "possession", "resource", "ordinary", "practice",
  "bioluminescence", "luciferin", "luciferase", "perpetual"
]);

const commonPhrases = [
  "according to", "more than", "lead to", "such as", "in order to",
  "as well as", "rather than", "because of", "as a result", "for example",
  "at least", "in fact", "in other words", "have to", "be able to",
  "be likely to", "be good for", "take away", "self belief", "pay attention",
  "over time", "stay with", "give away", "bring back"
];

function escapeHtml(s: string) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Decorate words with spans and annotations (100% preserves punctuation and formatting)
function decorateWords() {
  const saved = new Set(
    words.flatMap((w) => w.text.toLowerCase().match(/[a-z0-9à-ÿ]+(?:['’-][a-z0-9à-ÿ]+)*/g) || [])
  );
  const container = $("#articleContent");
  if (!container) return;

  const paragraphs = [...container.querySelectorAll("p")];
  paragraphs.forEach((p: HTMLParagraphElement, pi: number) => {
    // If paragraph already has .read-word elements, update classes only without destroying DOM or punctuation
    const existingSpans = [...p.querySelectorAll(".read-word")] as HTMLElement[];
    if (existingSpans.length > 0) {
      existingSpans.forEach((span) => {
        const raw = (span.textContent || "").trim().toLowerCase();
        span.classList.toggle("vocab-word", saved.has(raw));
        span.classList.toggle("key-word", keyWords.has(raw));
      });
      return;
    }

    // Preserve bilingual translation if exists
    const existingTrans = p.querySelector(".bilingual-translation");
    const transText = existingTrans
      ? existingTrans.textContent
      : (current.translations?.[pi] || bilingualCache[`${current.id}-p-${pi}`] || null);

    // Extract raw text excluding auxiliary widgets
    const clone = p.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".bilingual-translation, .para-note-capsule, .para-num").forEach((el) => el.remove());
    const fullText = clone.textContent || "";

    // Word tokenization: capturing group retains all delimiters (spaces, punctuation, em-dashes, quotes)
    const tokens = fullText.split(/([A-Za-z0-9À-ÿ]+(?:['’\-][A-Za-z0-9À-ÿ]+)*)/g);
    let wi = 0;
    const fragment = document.createDocumentFragment();

    tokens.forEach((token) => {
      if (!token) return;
      if (/^[A-Za-z0-9À-ÿ]+(?:['’\-][A-Za-z0-9À-ÿ]+)*$/.test(token)) {
        const lower = token.toLowerCase();
        const span = document.createElement("span");
        span.className = "read-word";
        if (saved.has(lower)) span.classList.add("vocab-word");
        if (keyWords.has(lower)) span.classList.add("key-word");
        span.dataset.p = String(pi);
        span.dataset.w = String(wi++);
        span.textContent = token;
        fragment.appendChild(span);
      } else {
        // Punctuation, dashes, quotes, and spacing are 100% preserved as pure text nodes
        fragment.appendChild(document.createTextNode(token));
      }
    });

    p.innerHTML = "";
    p.appendChild(fragment);

    if (bilingualActive && transText) {
      const transEl = document.createElement("div");
      transEl.className = "bilingual-translation";
      transEl.textContent = transText;
      p.appendChild(transEl);
    }

    const spans = [...p.querySelectorAll(".read-word")] as HTMLElement[];
    const lowers = spans.map((s) => (s.textContent || "").toLowerCase());
    commonPhrases.forEach((phrase) => {
      const terms = phrase.split(" ");
      for (let i = 0; i <= lowers.length - terms.length; i++) {
        if (terms.every((term, j) => lowers[i + j] === term)) {
          for (let j = 0; j < terms.length; j++) {
            spans[i + j].classList.add("phrase-word");
            spans[i + j].title = `词组：${phrase}`;
          }
        }
      }
    });
  });
}

function renderParagraphNoteCapsules() {
  const container = $("#articleContent");
  if (!container) return;

  container.querySelectorAll(".para-note-capsule").forEach((c) => c.remove());

  const paragraphs = [...container.querySelectorAll("p")];
  if (!paragraphs.length) return;

  const currentNotes = notes.filter(
    (n) => !n.articleId || n.articleId === current.id || n.at === current.title
  );

  paragraphs.forEach((p, pi) => {
    const pText = (p.textContent || "").toLowerCase();
    const matched = currentNotes.filter((n) => {
      if (typeof n.paraIndex === "number" && n.paraIndex === pi) return true;
      if (n.quote && n.quote.trim().length > 8 && pText.includes(n.quote.trim().toLowerCase())) return true;
      return false;
    });

    if (matched.length > 0) {
      const capsule = document.createElement("button");
      capsule.className = "para-note-capsule";
      capsule.type = "button";
      capsule.title = `此段有 ${matched.length} 条阅读笔记，点击展开专属笔记`;
      capsule.innerHTML = `<span class="capsule-icon">✎</span><span class="capsule-count">${matched.length}条笔记</span>`;
      capsule.onclick = (e) => {
        e.stopPropagation();
        activateStudyTab("notes");
        const firstNoteId = matched[0].id;
        setTimeout(() => {
          if (firstNoteId) {
            const card = $(`#notesList .note-card[data-id="${firstNoteId}"]`);
            if (card) {
              card.scrollIntoView({ behavior: "smooth", block: "center" });
              card.classList.add("highlight-pulse");
              setTimeout(() => card.classList.remove("highlight-pulse"), 1800);
            }
          }
        }, 120);
      };
      p.appendChild(capsule);
    }
  });
}

function renderArticle() {
  if ($("#articleTitle")) $("#articleTitle").textContent = current.title;
  if ($("#articleContent")) $("#articleContent").innerHTML = current.body;
  if ($("#articleMetaText")) {
    const wordsCount = current.body.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
    const readMin = Math.max(1, Math.round(wordsCount / 180));
    const levelTag = current.level ? ` · ${current.level}` : "";
    $("#articleMetaText").textContent = `ESSAY · ${readMin} MIN READ${levelTag}`;
  }
  decorateWords();
  applyParaNumMode(currentParaNumMode);
  renderParagraphNoteCapsules();
  if (bilingualActive) {
    loadBilingualTranslations();
  }
  if (typeof pretranslateArticle === "function" && current) {
    pretranslateArticle(current);
  }
}

function updateCounts() {
  if ($("#wordCount")) $("#wordCount").textContent = String(words.length);
  if ($("#noteCount")) $("#noteCount").textContent = String(notes.length);
  if ($("#dockNoteCount")) $("#dockNoteCount").textContent = String(notes.length);
  if ($("#panelVocabCount")) $("#panelVocabCount").textContent = String(words.length);
}

function go(view: string) {
  if (view !== "reader" && typeof setImmersiveMode === "function" && immersiveActive) {
    setImmersiveMode(false);
  }
  $$(".view").forEach((x) => x.classList.toggle("active", x.id === view));
  $$(".nav-item[data-view]").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === view)
  );
  if (view === "library") renderLibrary();
  if (view === "words") renderWords();
  if (view === "settings") syncSettingsUI();
}

// ==========================================
// Sidebar Compact & Pin State Logic
// ==========================================
let isSidebarPinned = localStorage.getItem("lexi-sidebar-pinned") === "true";

function applySidebarState() {
  const sidebar = $("#appSidebar");
  const pinBtn = $("#sidebarPinBtn");
  const mainEl = document.querySelector("main");
  if (!sidebar) return;

  if (isSidebarPinned) {
    sidebar.classList.add("expanded");
    if (pinBtn) {
      pinBtn.classList.add("pinned");
      pinBtn.title = "已固定展开 · 点击恢复简洁图标模式";
      const pinLabel = pinBtn.querySelector(".pin-label");
      if (pinLabel) pinLabel.textContent = "已固定";
    }
    if (mainEl) {
      mainEl.style.marginLeft = "208px";
      mainEl.style.width = "calc(100% - 208px)";
    }
  } else {
    sidebar.classList.remove("expanded");
    if (pinBtn) {
      pinBtn.classList.remove("pinned");
      pinBtn.title = "点击锁定保持展开";
      const pinLabel = pinBtn.querySelector(".pin-label");
      if (pinLabel) pinLabel.textContent = "锁定展开";
    }
    if (mainEl) {
      mainEl.style.marginLeft = "58px";
      mainEl.style.width = "calc(100% - 58px)";
    }
  }
}

if ($("#sidebarPinBtn")) {
  $("#sidebarPinBtn").onclick = () => {
    isSidebarPinned = !isSidebarPinned;
    localStorage.setItem("lexi-sidebar-pinned", String(isSidebarPinned));
    applySidebarState();
  };
}

$$(".nav-item[data-view]").forEach((b) => {
  b.onclick = () => {
    go(b.dataset.view);
    if (!isSidebarPinned) {
      const sidebar = $("#appSidebar");
      if (sidebar) sidebar.classList.remove("expanded");
    }
  };
});

applySidebarState();

// ==========================================
// LLM Provider Presets & Helpers
// ==========================================
interface LLMSettings {
  provider: "gemini" | "deepseek" | "qwen" | "custom";
  url: string;
  key: string;
  model: string;
}

const providerPresets: Record<string, {
  url: string;
  defaultModel: string;
  models: string[];
  hint: string;
  label: string;
}> = {
  gemini: {
    url: "",
    defaultModel: "gemini-3.8-flash",
    models: ["gemini-3.8-flash"],
    hint: "系统原生免配置直连，高速稳定，专为英语阅读精调",
    label: "内置 Gemini 3.8",
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    hint: "请前往 platform.deepseek.com 控制台获取 API Key",
    label: "DeepSeek",
  },
  qwen: {
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen2.5-72b-instruct"],
    hint: "请前往 阿里云百炼控制台 (DashScope) 获取 API-Key",
    label: "通义千问 (Qwen)",
  },
  custom: {
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "moonshot-v1-8k", "glm-4-flash"],
    hint: "支持任何 OpenAI 兼容规范接口或本地 Ollama 端点",
    label: "自定义兼容模型",
  },
};

function getActiveLLMConfig() {
  const cfg: LLMSettings = load("lexi-api", {
    provider: "gemini",
    url: "",
    key: "",
    model: "",
  });
  if (cfg.provider && cfg.provider !== "gemini" && cfg.url && cfg.key) {
    const preset = providerPresets[cfg.provider] || providerPresets.custom;
    return {
      url: cfg.url,
      key: cfg.key,
      model: cfg.model || preset.defaultModel,
    };
  }
  return undefined;
}

function updateModelBadge() {
  const cfg: LLMSettings = load("lexi-api", {
    provider: "gemini",
    url: "",
    key: "",
    model: "",
  });
  const labelEl = $("#currentModelLabel");
  const badgeBtn = $("#currentModelBadge");
  const settingsStatusText = $("#settingsStatusText");

  let label = "内置 Gemini 3.8";
  if (cfg.provider === "deepseek") {
    label = `DeepSeek (${cfg.model || "chat"})`;
  } else if (cfg.provider === "qwen") {
    label = `通义千问 (${cfg.model || "plus"})`;
  } else if (cfg.provider === "custom" && cfg.url) {
    label = `自定义 (${cfg.model || "OpenAI"})`;
  }

  if (labelEl) labelEl.textContent = label;
  if (badgeBtn) badgeBtn.title = `当前大模型引擎：${label}，点击进入设置切换`;
  if (settingsStatusText) {
    settingsStatusText.textContent = cfg.provider === "gemini"
      ? "当前引擎：系统内置 Gemini 3.8 Flash 已就绪（免配置直连）"
      : `当前引擎：已配置接入 ${label}`;
  }
}

if ($("#currentModelBadge")) {
  $("#currentModelBadge").onclick = () => go("settings");
}

// ==========================================
// Translation Engine Management (Web vs. LLM)
// ==========================================
let activeTranslationEngine: "web" | "llm" =
  (localStorage.getItem("lexi-translation-engine") as "web" | "llm") || "web";

function getActiveTranslationEngine(): "web" | "llm" {
  return activeTranslationEngine;
}

function setActiveTranslationEngine(engine: "web" | "llm", retranslateIfActive = true) {
  activeTranslationEngine = engine;
  localStorage.setItem("lexi-translation-engine", engine);
  updateTranslationEngineUI();

  if (retranslateIfActive && chosen && chosen.trim()) {
    if (!$("#translationResult")?.hidden) {
      if ($("#translatedText")) {
        $("#translatedText").textContent =
          engine === "web" ? "正在通过联网词典快速翻译…" : "正在通过 AI 大模型深度意译…";
      }
      translate(chosen).then((res) => {
        if ($("#translatedText")) $("#translatedText").textContent = res.translation;
        if ($("#translationEngineBadge")) {
          $("#translationEngineBadge").textContent =
            res.engine === "llm" ? "🤖 AI 大模型意译" : "🌐 联网极速翻译";
        }
        if ($("#bubbleMeaning")) {
          $("#bubbleMeaning").textContent = res.translation;
          $("#bubbleMeaning").classList.remove("loading");
        }
      });
    }
  }
}

function updateTranslationEngineUI() {
  const isWeb = activeTranslationEngine === "web";
  const pillWeb = $("#enginePillWeb");
  const pillLlm = $("#enginePillLlm");
  if (pillWeb) pillWeb.classList.toggle("active", isWeb);
  if (pillLlm) pillLlm.classList.toggle("active", !isWeb);

  const radioWeb = document.querySelector('input[name="transEnginePref"][value="web"]') as HTMLInputElement;
  const radioLlm = document.querySelector('input[name="transEnginePref"][value="llm"]') as HTMLInputElement;
  if (radioWeb) radioWeb.checked = isWeb;
  if (radioLlm) radioLlm.checked = !isWeb;

  const cardWeb = $("#cardPrefWeb");
  const cardLlm = $("#cardPrefLlm");
  if (cardWeb) cardWeb.classList.toggle("active", isWeb);
  if (cardLlm) cardLlm.classList.toggle("active", !isWeb);
}

$("#enginePillWeb")?.addEventListener("click", () => setActiveTranslationEngine("web"));
$("#enginePillLlm")?.addEventListener("click", () => setActiveTranslationEngine("llm"));

document.querySelectorAll('input[name="transEnginePref"]').forEach((input) => {
  input.addEventListener("change", (e: any) => {
    if (e.target.checked) {
      setActiveTranslationEngine(e.target.value as "web" | "llm");
    }
  });
});

// Smart Translation with Engine (Web / LLM) and customConfig support
async function translate(
  text: string
): Promise<{ translation: string; details: string; phonetic?: string; engine?: string }> {
  const normalized = text.toLowerCase().replace(/[^a-z'-]/g, "");
  const customConfig = getActiveLLMConfig();
  const engine = activeTranslationEngine;

  // 1. Request via server proxy (supports fast Web dictionary or custom LLMs)
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        context: current.body ? current.body.replace(/<[^>]*>/g, " ").slice(0, 300) : "",
        engine,
        customConfig,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      let translation = data.translation || "释义获取中";
      if (translation.toUpperCase().includes("QUERY LENGTH LIMIT")) {
        translation = "正在分段意译中…";
      }
      return {
        translation,
        details: data.details || (data.partOfSpeech ? `${data.partOfSpeech} ${data.phonetic || ""}` : ""),
        phonetic: data.phonetic,
        engine: data.engine || engine,
      };
    }
  } catch (e) {
    console.warn("Backend translate failed:", e);
  }

  // 2. Built-in dictionary fallback
  if (miniDictionary[normalized]) {
    return {
      translation: miniDictionary[normalized],
      details: `/ ${normalized} / · 基础核心词汇`,
      phonetic: `/${normalized}/`,
      engine: "offline",
    };
  }

  return {
    translation: text.split(/\s+/).map((w) => miniDictionary[w.toLowerCase().replace(/[^a-z]/g, "")] || w).join(" "),
    details: "本地离线词典释义",
    engine: "offline",
  };
}

// Grammar Analysis with customConfig support
async function grammarAnalysis(text: string): Promise<string> {
  const customConfig = getActiveLLMConfig();
  try {
    const res = await fetch("/api/analyze-sentence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: text, customConfig }),
    });
    if (res.ok) {
      const data = await res.json();
      const s = data.structure || {};
      const points = (data.grammarExplanation || []).map((p: string) => `• ${p}`).join("\n");
      return `【1. 句子骨架】
主语：${s.subject || "无"}
谓语：${s.predicate || "无"}
宾语/表语：${s.objectOrComplement || "无"}
修饰/状语：${s.adverbialOrModifier || "无"}

【2. 从句与结构拆解】
${s.clauseAnalysis || "常规简单句或并列复合句，逻辑清晰。"}

【3. 关键语法要点】
${points}

【4. 自然中文释义】
${data.chineseTranslation || ""}`;
    }
  } catch (err) {
    console.warn("Analyze sentence error:", err);
  }

  return "语法解析请求未能完成，请检查网络或配置设置。";
}

// ==========================================
// Floating Selection Action Bubble
// ==========================================
let lastPhonetic = "";
const bubbleEl = $("#selectionBubble") as HTMLElement;
let bubbleCloseTimer: any = null;

function hideSelectionBubble() {
  if (bubbleEl) {
    if (bubbleCloseTimer) clearTimeout(bubbleCloseTimer);
    if (bubbleEl.style.display !== "none" && !bubbleEl.classList.contains("closing")) {
      bubbleEl.classList.add("closing");
      bubbleCloseTimer = setTimeout(() => {
        bubbleEl.style.display = "none";
        bubbleEl.classList.remove("closing");
        bubbleEl.classList.remove("flip-down");
      }, 140);
    } else if (bubbleEl.style.display === "none") {
      bubbleEl.classList.remove("closing");
      bubbleEl.classList.remove("flip-down");
    }
  }
}

function showSelectionBubble(text: string, rect: DOMRect) {
  if (!bubbleEl) return;
  if (bubbleCloseTimer) {
    clearTimeout(bubbleCloseTimer);
    bubbleCloseTimer = null;
  }
  bubbleEl.classList.remove("closing");

  const bubbleWord = $("#bubbleWord");
  const bubbleMeaning = $("#bubbleMeaning");

  if (bubbleWord) {
    bubbleWord.textContent = text.length > 24 ? text.slice(0, 24) + "…" : text;
  }
  if (bubbleMeaning) {
    bubbleMeaning.textContent = "正在护眼查词…";
    bubbleMeaning.classList.add("loading");
  }

  const bubbleHeight = 52;
  const isTooCloseToTop = rect.top < 85;

  bubbleEl.classList.toggle("flip-down", isTooCloseToTop);

  const top = isTooCloseToTop
    ? rect.bottom + 12
    : Math.max(12, rect.top - bubbleHeight - 12);
  const left = Math.min(window.innerWidth - 190, Math.max(190, rect.left + rect.width / 2));

  bubbleEl.style.top = `${top}px`;
  bubbleEl.style.left = `${left}px`;
  bubbleEl.style.display = "block";
}

let isDoubleClicked = false;

async function inspectWord(wordEl: HTMLElement, speak = true) {
  if (isDoubleClicked) return;
  const text = wordEl.textContent?.trim() || "";
  if (!text) return;

  // Eye-friendly focus indicator on the single-clicked word
  $$(".read-word").forEach((w: HTMLElement) => w.classList.remove("active-word-focus"));
  wordEl.classList.add("active-word-focus");

  chosen = text;
  activateStudyTab("translate");
  if ($("#grammarResult")) $("#grammarResult").hidden = true;
  if ($("#translationEmpty")) $("#translationEmpty").hidden = true;
  if ($("#translationResult")) $("#translationResult").hidden = false;
  if ($("#selectedText")) $("#selectedText").textContent = text;
  if ($("#translatedText")) $("#translatedText").textContent = "正在通过 AI 分析释义…";
  if ($("#wordDetails")) $("#wordDetails").textContent = "正在查询音标与词性…";

  // Position and show eye-friendly floating bubble above the clicked word
  const rect = wordEl.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    showSelectionBubble(text, rect);
  }

  // Play single word audio only when speak is requested (left-click speaks, right-click does not)
  if (speak) {
    speakWord(text);
  }

  // Fetch translation & definition
  const result = await translate(text);
  if (chosen === text && !isDoubleClicked) {
    if ($("#translatedText")) $("#translatedText").textContent = result.translation;
    if ($("#translationEngineBadge")) {
      $("#translationEngineBadge").textContent =
        result.engine === "llm" ? "🤖 AI 大模型意译" : "🌐 联网极速翻译";
    }
    if ($("#bubbleMeaning")) {
      $("#bubbleMeaning").textContent = result.translation;
      $("#bubbleMeaning").classList.remove("loading");
    }
    lastPhonetic = result.phonetic || "";
    if ($("#wordDetails")) {
      $("#wordDetails").textContent = `${result.phonetic ? result.phonetic + " · " : ""}${result.details || ""}\n点击“＋ 收藏”加入生词本以便复习`;
    }
  }
}

async function handleSelection() {
  if (isDoubleClicked) {
    hideSelectionBubble();
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    hideSelectionBubble();
    return;
  }
  const text = sel.toString().trim();
  const inReader =
    $("#articleContent")?.contains(sel.anchorNode) ||
    $("#pdfPreview")?.contains(sel.anchorNode);
  if (!text || !inReader) {
    hideSelectionBubble();
    return;
  }

  chosen = text;
  if (sel.anchorNode) {
    const node = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement;
    const p = (node as HTMLElement)?.closest("p");
    if (p) {
      const allP = [...($("#articleContent")?.querySelectorAll("p") || [])];
      const idx = allP.indexOf(p);
      chosenParaIndex = idx !== -1 ? idx : undefined;
    } else {
      chosenParaIndex = undefined;
    }
  } else {
    chosenParaIndex = undefined;
  }
  if ($("#grammarResult")) $("#grammarResult").hidden = true;
  if ($("#translationEmpty")) $("#translationEmpty").hidden = true;
  if ($("#translationResult")) $("#translationResult").hidden = false;
  if ($("#selectedText")) $("#selectedText").textContent = text;
  if ($("#translatedText")) $("#translatedText").textContent = "正在通过 AI 分析翻译…";
  if ($("#wordDetails")) $("#wordDetails").textContent = text.split(/\s+/).length === 1 ? "正在查询音标与词性…" : "";

  // Position and show floating bubble immediately
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      showSelectionBubble(text, rect);
    }
  } catch (e) {
    // Ignore range error
  }

  const result = await translate(text);
  if (chosen === text && !isDoubleClicked) {
    if ($("#translatedText")) $("#translatedText").textContent = result.translation;
    if ($("#translationEngineBadge")) {
      $("#translationEngineBadge").textContent =
        result.engine === "llm" ? "🤖 AI 大模型意译" : "🌐 联网极速翻译";
    }
    if ($("#bubbleMeaning")) {
      $("#bubbleMeaning").textContent = result.translation;
      $("#bubbleMeaning").classList.remove("loading");
    }
    lastPhonetic = result.phonetic || "";
    const isSingleWord = text.split(/\s+/).length === 1;
    if ($("#wordDetails")) {
      $("#wordDetails").textContent = isSingleWord
        ? `${result.phonetic ? result.phonetic + " · " : ""}${result.details || ""}\n点击“＋ 收藏”加入生词本以便闪卡复习`
        : `短语 / 长难句 · 点击“⌘ 语法解析”查看句法骨架`;
    }
  }
}

$("#articleContent")?.addEventListener("mouseup", () => setTimeout(handleSelection, 20));
$("#articleContent")?.addEventListener("keyup", () => setTimeout(handleSelection, 20));
$("#pdfPreview")?.addEventListener("mouseup", () => setTimeout(handleSelection, 20));

// Hide bubble on click outside or document scroll
document.addEventListener("mousedown", (e: MouseEvent) => {
  if (bubbleEl && !bubbleEl.contains(e.target as Node) && !$("#articleContent")?.contains(e.target as Node)) {
    hideSelectionBubble();
  }
});
window.addEventListener("scroll", () => hideSelectionBubble(), { passive: true });

// Bubble Action Buttons
if ($("#bubbleSpeak")) {
  $("#bubbleSpeak").onclick = (e: MouseEvent) => {
    e.stopPropagation();
    if (chosen) speak(chosen);
  };
}

if ($("#bubbleGrammar")) {
  $("#bubbleGrammar").onclick = (e: MouseEvent) => {
    e.stopPropagation();
    activateStudyTab("translate");
    $("#analyzeGrammar")?.click();
    hideSelectionBubble();
  };
}

if ($("#bubbleSave")) {
  $("#bubbleSave").onclick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!chosen) return;
    $("#saveWord")?.click();
    const btn = $("#bubbleSave");
    if (btn) {
      btn.textContent = "✓ 已收藏";
      setTimeout(() => {
        if (btn) btn.textContent = "＋ 收藏";
      }, 1500);
    }
  };
}

if ($("#bubbleNote")) {
  $("#bubbleNote").onclick = (e: MouseEvent) => {
    e.stopPropagation();
    openNoteEditor({ quote: chosen || "" });
    hideSelectionBubble();
  };
}

if ($("#addSelectionNote")) {
  $("#addSelectionNote").onclick = () => {
    openNoteEditor({ quote: chosen || "" });
  };
}

if ($("#bubbleAskAI")) {
  $("#bubbleAskAI").onclick = (e: MouseEvent) => {
    e.stopPropagation();
    activateStudyTab("ai-tutor");
    const isSingleWord = (chosen || "").split(/\s+/).length === 1;
    sendAIMessage(
      isSingleWord
        ? `请详细讲解单词「${chosen}」的核心用法、地道搭配及典型例句。`
        : `请深度剖析这句英文「${chosen}」的深层逻辑、语法结构与地道表达。`
    );
    hideSelectionBubble();
  };
}

let lastAnalyzedSentence = "";
let lastAnalyzedResult = "";

$("#analyzeGrammar")?.addEventListener("click", async () => {
  if (!chosen) return;
  const box = $("#grammarResult");
  const content = $("#grammarContent");
  if (!box || !content) return;
  box.hidden = false;
  content.textContent = "正在深度剖析句子语法骨架、主干成份与长难句逻辑…";
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });

  lastAnalyzedSentence = chosen;
  lastAnalyzedResult = await grammarAnalysis(chosen);
  content.textContent = lastAnalyzedResult;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

$("#expandGrammarModalBtn")?.addEventListener("click", () => {
  const dlg = $("#grammarModalDialog") as HTMLDialogElement;
  const quote = $("#grammarModalQuote");
  const body = $("#grammarModalBody");
  if (dlg && quote && body) {
    quote.textContent = lastAnalyzedSentence || chosen || "未选定句子";
    body.textContent =
      lastAnalyzedResult || $("#grammarContent")?.textContent || "暂无语法深度剖析内容，请先点击「语法解析」。";
    dlg.showModal();
  }
});

$("#closeGrammarResultBtn")?.addEventListener("click", () => {
  if ($("#grammarResult")) $("#grammarResult").hidden = true;
});

$("#closeGrammarModalBtn")?.addEventListener("click", () => {
  ($("#grammarModalDialog") as HTMLDialogElement)?.close();
});

$("#closeGrammarModalOkBtn")?.addEventListener("click", () => {
  ($("#grammarModalDialog") as HTMLDialogElement)?.close();
});

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setPlayerCollapsed(collapsed: boolean) {
  const player = $("#audioPlayer");
  if (!player) return;
  player.classList.toggle("collapsed", collapsed);
  const collapsedDock = $("#playerCollapsedDock") as HTMLElement;
  const fullContent = $("#playerFullContent") as HTMLElement;
  if (collapsedDock) collapsedDock.style.display = collapsed ? "flex" : "none";
  if (fullContent) fullContent.style.display = collapsed ? "none" : "flex";

  const btn = $("#toggleCollapsePlayer");
  if (btn) {
    btn.title = collapsed ? "展开完整播放面板" : "收起为迷你悬浮条";
  }
}

$("#toggleCollapsePlayer")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const player = $("#audioPlayer");
  const isCurrentlyCollapsed = player?.classList.contains("collapsed") || false;
  setPlayerCollapsed(!isCurrentlyCollapsed);
});

$("#expandPlayerBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  setPlayerCollapsed(false);
});

$("#miniTogglePlay")?.addEventListener("click", (e) => {
  e.stopPropagation();
  $("#togglePlay")?.click();
});

// Audio & TTS Player
let playbackIndex = 0;
let playbackWord = 0;
let isPaused = false;
let playbackActive = false;
let importedAudio: HTMLAudioElement | null = null;
let calibrationMode = false;
let isDraggingAudioProgress = false;
let activePdfDocument: any = null;
let selectedRate = 1;
let selectedAccent = "en-US";
let availableVoices: SpeechSynthesisVoice[] = [];
let audioMarkers: { w: HTMLElement; t: number }[] = [];

const accentLabels: Record<string, string> = {
  "en-US": "美式通用",
  "en-GB": "英式标准 RP",
  "en-AU": "澳式通用",
  "en-CA": "加式通用",
  "en-IE": "爱尔兰英语",
};

function refreshVoices() {
  if ("speechSynthesis" in window) {
    availableVoices = speechSynthesis.getVoices();
  }
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

function setEnglishVoice(utterance: SpeechSynthesisUtterance) {
  utterance.lang = selectedAccent;
  const exact = availableVoices.find(
    (v) => v.lang.toLowerCase() === selectedAccent.toLowerCase()
  );
  const fallback = availableVoices.find((v) =>
    v.lang.toLowerCase().startsWith(selectedAccent.slice(0, 2).toLowerCase())
  );
  utterance.voice = exact || fallback || null;
  return utterance;
}

let activeUtteranceId = 0;
let currentSpeakingWordEl: HTMLElement | null = null;
let currentSpeakingParaEl: HTMLElement | null = null;

function clearSpeakingHighlights() {
  if (currentSpeakingWordEl) {
    currentSpeakingWordEl.classList.remove("speaking-word");
    currentSpeakingWordEl = null;
  }
  if (currentSpeakingParaEl) {
    currentSpeakingParaEl.classList.remove("speaking");
    currentSpeakingParaEl = null;
  }
  $$(".read-word.speaking-word").forEach((x) => x.classList.remove("speaking-word"));
  playbackParts().forEach((x) => x.classList.remove("speaking"));
}

let activeUtteranceRef: SpeechSynthesisUtterance | null = null;
let ttsKeepAliveTimer: any = null;

function startTtsKeepAlive() {
  stopTtsKeepAlive();
  ttsKeepAliveTimer = setInterval(() => {
    if (playbackActive && !isPaused && "speechSynthesis" in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setTimeout(() => {
        if (playbackActive && !isPaused && "speechSynthesis" in window && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }, 30);
    } else {
      stopTtsKeepAlive();
    }
  }, 8500);
}

function stopTtsKeepAlive() {
  if (ttsKeepAliveTimer) {
    clearInterval(ttsKeepAliveTimer);
    ttsKeepAliveTimer = null;
  }
}

function stopSpeechSafely(cancelSpeechEngine = true) {
  activeUtteranceId++;
  stopTtsKeepAlive();
  activeUtteranceRef = null;
  (window as any)._lexiActiveUtterance = null;
  if (cancelSpeechEngine && "speechSynthesis" in window) {
    try {
      speechSynthesis.cancel();
    } catch (_) {}
  }
}

function scrollIntoViewComfortably(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const topSafe = 80;
  const bottomSafe = window.innerHeight - 110;
  if (rect.top >= topSafe && rect.bottom <= bottomSafe) {
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function getParagraphCleanText(p: HTMLElement): string {
  const clone = p.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".bilingual-translation, .para-note-capsule, .para-num").forEach((el) => el.remove());
  return clone.textContent || "";
}

function playbackParts(): HTMLElement[] {
  if (isOriginalPlaybackMode && !activePdfDocument) {
    const origParas = [...($("#origEditorialContent")?.querySelectorAll(".orig-para") || [])] as HTMLElement[];
    if (origParas.length) return origParas.filter((p) => (p.textContent || "").trim());
  }
  const articleContent = $("#articleContent");
  if (!articleContent) return [];
  return ([...articleContent.querySelectorAll("p")] as HTMLElement[]).filter((p: HTMLElement) =>
    (p.textContent || "").trim()
  );
}

function wordsIn(p: HTMLElement): HTMLElement[] {
  const readWords = [...p.querySelectorAll(".read-word")] as HTMLElement[];
  if (readWords.length) return readWords;
  const origWords = [...p.querySelectorAll(".orig-word")] as HTMLElement[];
  if (origWords.length) return origWords;
  return [];
}

function finishPlayback() {
  playbackActive = false;
  isPaused = false;
  clearSpeakingHighlights();
  stopTtsKeepAlive();
  activeUtteranceRef = null;
  (window as any)._lexiActiveUtterance = null;
  const parts = playbackParts();
  if ($("#nowSpeaking")) $("#nowSpeaking").textContent = "已朗读完毕全文";
  if ($("#togglePlay")) {
    $("#togglePlay").textContent = "▶";
    $("#togglePlay").title = "重新播放 (空格键)";
  }
  if ($("#origPlayToggleBtn")) $("#origPlayToggleBtn").textContent = "▶ 重新播放";
  if ($("#origPlayStatusSub")) $("#origPlayStatusSub").textContent = "🎉 全文已朗读完毕 · 点击任意段落或单词可重播";
  if ($("#origProgressBadge")) $("#origProgressBadge").textContent = `第 ${parts.length} / ${parts.length} 段 (已完成)`;
  const wave = $("#voiceWaveIndicator");
  if (wave) wave.classList.remove("active");
  updatePlayer();
}

function updatePlayer() {
  const parts = playbackParts();
  const p = parts[playbackIndex] || null;
  const wordsList = p ? wordsIn(p) : [];
  const word = wordsList[playbackWord] || null;

  if (currentSpeakingParaEl !== p) {
    if (currentSpeakingParaEl) currentSpeakingParaEl.classList.remove("speaking");
    if (p) p.classList.add("speaking");
    currentSpeakingParaEl = p;
    if (p) {
      scrollIntoViewComfortably(p);
    }
  }

  if (currentSpeakingWordEl !== word) {
    if (currentSpeakingWordEl) currentSpeakingWordEl.classList.remove("speaking-word");
    if (word) word.classList.add("speaking-word");
    currentSpeakingWordEl = word;
  }

  const isPlaying = playbackActive && !isPaused;
  const wave = $("#voiceWaveIndicator");
  if (wave) wave.classList.toggle("active", isPlaying);
  const miniWave = $("#miniVoiceWave");
  if (miniWave) miniWave.classList.toggle("active", isPlaying);

  const statusText = word
    ? `第 ${playbackIndex + 1} 段 · ${(word.textContent || "").trim()}`
    : isPlaying
    ? `朗读第 ${playbackIndex + 1} / ${Math.max(1, parts.length)} 段…`
    : isPaused
    ? "已暂停"
    : "准备就绪";

  if ($("#nowSpeaking")) {
    $("#nowSpeaking").textContent = statusText;
  }
  if ($("#miniPlayStatus")) {
    $("#miniPlayStatus").textContent = statusText;
  }
  if ($("#togglePlay")) {
    $("#togglePlay").textContent = isPlaying ? "⏸" : "▶";
    $("#togglePlay").title = isPlaying ? "暂停 (空格键)" : "播放 (空格键)";
  }
  if ($("#miniTogglePlay")) {
    $("#miniTogglePlay").textContent = isPlaying ? "⏸" : "▶";
  }

  // Update progress bar if not currently dragging and imported audio is not loaded
  if (!isDraggingAudioProgress && !importedAudio) {
    const totalParas = Math.max(1, parts.length);
    const progressPercent = Math.min(100, Math.round(((playbackIndex + 1) / totalParas) * 100));
    const bar = $("#audioProgressBar") as HTMLInputElement;
    if (bar) bar.value = String(progressPercent);
    if ($("#playerCurrentTime")) $("#playerCurrentTime").textContent = `P.${playbackIndex + 1}`;
    if ($("#playerTotalTime")) $("#playerTotalTime").textContent = `P.${totalParas}`;
  }

  // Update Original Playback Topbar if visible
  if ($("#origPlayToggleBtn")) {
    $("#origPlayToggleBtn").textContent = isPlaying ? "⏸ 暂停播放" : "▶ 播放原版";
  }
  if ($("#origProgressBadge")) {
    $("#origProgressBadge").textContent = `第 ${playbackIndex + 1} / ${Math.max(1, parts.length)} 段`;
  }
  if ($("#origPlayStatusSub")) {
    $("#origPlayStatusSub").textContent = isPlaying
      ? `正在原声同步朗读第 ${playbackIndex + 1} / ${Math.max(1, parts.length)} 段 · 原版声画同步跟随`
      : "排版原版 · 点击任意段落或单词即可点读跟随";
  }
  if ($("#origSpeedSelect")) {
    ($("#origSpeedSelect") as HTMLSelectElement).value = String(selectedRate);
  }
}

function playFrom(index = 0, wordIndex = 0, isUserInitiated = true) {
  const parts = playbackParts();
  if (!parts.length) return;
  playbackIndex = Math.max(0, Math.min(index, parts.length - 1));
  const wordsList = wordsIn(parts[playbackIndex]);
  playbackWord = Math.max(0, Math.min(wordIndex, Math.max(0, wordsList.length - 1)));
  isPaused = false;
  playbackActive = true;
  if ($("#audioPlayer")) $("#audioPlayer").hidden = false;

  stopSpeechSafely(isUserInitiated);
  const thisUtteranceId = activeUtteranceId;
  updatePlayer();

  if (importedAudio) {
    const target = wordsList[playbackWord];
    if (target) {
      const marked = Number(target.dataset.time);
      if (Number.isFinite(marked)) {
        importedAudio.currentTime = marked;
      } else if (Number.isFinite(importedAudio.duration)) {
        const all = $$(".read-word");
        importedAudio.currentTime =
          (all.indexOf(target) / Math.max(1, all.length)) * importedAudio.duration;
      }
    }
    importedAudio.playbackRate = selectedRate;
    importedAudio.play();
    return;
  }

  if (!("speechSynthesis" in window)) {
    alert("当前浏览器不支持语音朗读");
    return;
  }

  const fullText = getParagraphCleanText(parts[playbackIndex]);
  let searchPos = 0;
  for (let i = 0; i < playbackWord; i++) {
    const w = (wordsList[i].textContent || "").trim();
    if (w) {
      const idx = fullText.indexOf(w, searchPos);
      if (idx !== -1) searchPos = idx + w.length;
    }
  }

  const textToSpeak = fullText.slice(searchPos).trimStart();
  const wordSpans: { start: number; end: number; wordIdx: number }[] = [];
  let scanOffset = 0;

  for (let i = playbackWord; i < wordsList.length; i++) {
    const raw = (wordsList[i].textContent || "").trim();
    if (!raw) continue;
    const idx = textToSpeak.indexOf(raw, scanOffset);
    if (idx !== -1) {
      wordSpans.push({ start: idx, end: idx + raw.length, wordIdx: i });
      scanOffset = idx + raw.length;
    } else {
      wordSpans.push({ start: scanOffset, end: scanOffset + raw.length, wordIdx: i });
      scanOffset += raw.length + 1;
    }
  }

  if (!textToSpeak.trim()) {
    if (playbackIndex < parts.length - 1) {
      setTimeout(() => playFrom(playbackIndex + 1, 0, false), 80);
    } else {
      finishPlayback();
    }
    return;
  }

  const utterance = setEnglishVoice(new SpeechSynthesisUtterance(textToSpeak));
  utterance.rate = Math.max(0.1, Math.min(10, 0.88 * selectedRate));

  activeUtteranceRef = utterance;
  (window as any)._lexiActiveUtterance = utterance;

  utterance.onboundary = (e) => {
    if (thisUtteranceId !== activeUtteranceId) return;
    if (e.name === "word") {
      const charIndex = e.charIndex;
      let matched = wordSpans.find((s) => charIndex >= s.start && charIndex < s.end);
      if (!matched) {
        for (let j = wordSpans.length - 1; j >= 0; j--) {
          if (wordSpans[j].start <= charIndex) {
            matched = wordSpans[j];
            break;
          }
        }
      }
      if (matched && matched.wordIdx !== playbackWord) {
        playbackWord = matched.wordIdx;
        updatePlayer();
      }
    }
  };

  utterance.onend = () => {
    if (thisUtteranceId !== activeUtteranceId || !playbackActive || isPaused) return;
    stopTtsKeepAlive();
    activeUtteranceRef = null;
    (window as any)._lexiActiveUtterance = null;
    if (playbackIndex < parts.length - 1) {
      // Transition smoothly to next paragraph without cancelling speech queue
      setTimeout(() => {
        if (playbackActive && !isPaused) {
          playFrom(playbackIndex + 1, 0, false);
        }
      }, 150);
    } else {
      finishPlayback();
    }
  };

  utterance.onerror = (e) => {
    if (thisUtteranceId !== activeUtteranceId) return;
    stopTtsKeepAlive();
    activeUtteranceRef = null;
    (window as any)._lexiActiveUtterance = null;
    if (e.error === "canceled" || e.error === "interrupted") {
      return;
    }
    console.warn("Speech synthesis notice:", e.error);
    // Auto-advance so audio playback never gets stuck halfway through an article!
    if (playbackActive && !isPaused && playbackIndex < parts.length - 1) {
      setTimeout(() => {
        if (playbackActive && !isPaused) {
          playFrom(playbackIndex + 1, 0, false);
        }
      }, 200);
    } else {
      finishPlayback();
    }
  };

  startTtsKeepAlive();
  speechSynthesis.speak(utterance);
}

function speak(text: string) {
  if (!text) return;
  const parts = playbackParts();
  const found = parts.findIndex((p) => p.innerText.trim() === text.trim());
  if (found >= 0) return playFrom(found);
  if (!("speechSynthesis" in window)) return alert("当前浏览器不支持语音朗读");
  stopSpeechSafely();
  const u = setEnglishVoice(new SpeechSynthesisUtterance(text));
  u.rate = Math.max(0.1, Math.min(10, 0.88 * selectedRate));
  speechSynthesis.speak(u);
}

function speakWord(word: string) {
  if (!("speechSynthesis" in window)) return alert("当前浏览器不支持语音朗读");
  if (importedAudio) importedAudio.pause();
  playbackActive = false;
  stopSpeechSafely();
  const u = setEnglishVoice(new SpeechSynthesisUtterance(word));
  u.rate = Math.max(0.1, Math.min(10, 0.88 * selectedRate));
  if ($("#audioPlayer")) $("#audioPlayer").hidden = false;
  if ($("#nowSpeaking")) {
    $("#nowSpeaking").textContent = `${accentLabels[selectedAccent]}单词朗读 · ${word}`;
  }
  speechSynthesis.speak(u);
}

if ($("#speakArticle")) $("#speakArticle").onclick = () => playFrom(0);
if ($("#speakSelection")) $("#speakSelection").onclick = () => speak(chosen);
if ($("#togglePlay")) {
  $("#togglePlay").onclick = () => {
    if (isPaused && playbackActive) {
      isPaused = false;
      if (importedAudio || activeUtteranceRef) {
        resumePlaybackEngine(importedAudio, importedAudio ? null : speechSynthesis);
        if (!importedAudio) startTtsKeepAlive();
        updatePlayer();
        return;
      }
      playFrom(playbackIndex, playbackWord);
      return;
    }
    if (!playbackActive) {
      playFrom(playbackIndex, playbackWord);
      return;
    }
    isPaused = true;
    stopTtsKeepAlive();
    pausePlaybackEngine(importedAudio, importedAudio ? null : speechSynthesis);
    updatePlayer();
  };
}

function shiftWords(amount: number) {
  const parts = playbackParts();
  let p = playbackIndex;
  let w = playbackWord + amount;
  while (w < 0 && p > 0) {
    p--;
    w += wordsIn(parts[p]).length;
  }
  while (w >= wordsIn(parts[p]).length && p < parts.length - 1) {
    w -= wordsIn(parts[p]).length;
    p++;
  }
  playFrom(p, Math.max(0, Math.min(w, wordsIn(parts[p]).length - 1)));
}

const progressBarEl = $("#audioProgressBar") as HTMLInputElement;
if (progressBarEl) {
  progressBarEl.addEventListener("mousedown", () => {
    isDraggingAudioProgress = true;
  });
  progressBarEl.addEventListener("touchstart", () => {
    isDraggingAudioProgress = true;
  }, { passive: true });

  progressBarEl.addEventListener("input", (e: any) => {
    const val = +e.target.value;
    if (importedAudio && Number.isFinite(importedAudio.duration) && importedAudio.duration > 0) {
      const targetTime = (val / 100) * importedAudio.duration;
      if ($("#playerCurrentTime")) {
        $("#playerCurrentTime").textContent = formatMediaTime(targetTime);
      }
    } else {
      const parts = playbackParts();
      const totalParas = Math.max(1, parts.length);
      const targetP = Math.min(totalParas, Math.max(1, Math.round((val / 100) * totalParas)));
      if ($("#playerCurrentTime")) {
        $("#playerCurrentTime").textContent = `P.${targetP}`;
      }
    }
  });

  const commitProgressSeek = (e: any) => {
    if (!isDraggingAudioProgress) return;
    isDraggingAudioProgress = false;
    const val = +e.target.value;
    if (importedAudio && Number.isFinite(importedAudio.duration) && importedAudio.duration > 0) {
      const targetTime = (val / 100) * importedAudio.duration;
      importedAudio.currentTime = targetTime;
      if ($("#playerCurrentTime")) {
        $("#playerCurrentTime").textContent = formatMediaTime(targetTime);
      }
    } else {
      const parts = playbackParts();
      const totalParas = Math.max(1, parts.length);
      const targetIndex = Math.min(totalParas - 1, Math.max(0, Math.floor((val / 100) * totalParas)));
      playFrom(targetIndex, 0);
    }
  };

  progressBarEl.addEventListener("change", commitProgressSeek);
  progressBarEl.addEventListener("mouseup", commitProgressSeek);
  progressBarEl.addEventListener("touchend", commitProgressSeek);
}

if ($("#skipBack")) {
  $("#skipBack").onclick = () => {
    if (importedAudio && Number.isFinite(importedAudio.duration)) {
      importedAudio.currentTime = Math.max(0, importedAudio.currentTime - 5);
    } else {
      shiftWords(-10);
    }
  };
}

if ($("#skipForward")) {
  $("#skipForward").onclick = () => {
    if (importedAudio && Number.isFinite(importedAudio.duration)) {
      importedAudio.currentTime = Math.min(importedAudio.duration, importedAudio.currentTime + 5);
    } else {
      shiftWords(10);
    }
  };
}

if ($("#closePlayerBtn")) {
  $("#closePlayerBtn").onclick = () => {
    playbackActive = false;
    isPaused = true;
    stopSpeechSafely();
    if (importedAudio) importedAudio.pause();
    clearSpeakingHighlights();
    const player = $("#audioPlayer");
    if (player) player.hidden = true;
    // Reset the collapsed state so the next playback opens the full panel.
    setPlayerCollapsed(false);
  };
}

if ($("#playbackRate")) {
  $("#playbackRate").onchange = (e: any) => {
    selectedRate = +e.target.value;
    if (importedAudio) importedAudio.playbackRate = selectedRate;
    if (playbackActive && !importedAudio) playFrom(playbackIndex, playbackWord);
  };
}

if ($("#voiceAccent")) {
  $("#voiceAccent").onchange = (e: any) => {
    selectedAccent = e.target.value;
    if (playbackActive && !importedAudio) {
      playFrom(playbackIndex, playbackWord);
    } else if ($("#nowSpeaking")) {
      $("#nowSpeaking").textContent = `已切换至${accentLabels[selectedAccent]}发音`;
    }
  };
}

// Click and Double Click on Words
let wordClickTimer: any;
function syncAudioMarkers() {
  audioMarkers = $$(".read-word[data-time]")
    .map((w: HTMLElement) => ({ w, t: +w.dataset.time! }))
    .sort((a, b) => a.t - b.t);
}

// Long-press Selection and Mouse Interactions
let isLongPressTriggered = false;
let longPressTimer: any = null;
let longPressTargetWord: HTMLElement | null = null;
let longPressStartX = 0;
let longPressStartY = 0;

// Prevent native browser double-click text selection so double-clicking does NOT select the word
$("#articleContent")?.addEventListener("mousedown", (e: MouseEvent) => {
  if (e.detail >= 2) {
    e.preventDefault();
  }

  // Clear any pending long-press timer
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressTargetWord) {
    longPressTargetWord.classList.remove("word-pressing");
    longPressTargetWord = null;
  }

  // Primary (Left) mouse button: initiate long-press tactile selection
  if (e.button === 0) {
    const word = (e.target as HTMLElement)?.closest(".read-word") as HTMLElement | null;
    if (word) {
      longPressTargetWord = word;
      word.classList.add("word-pressing");
      longPressStartX = e.clientX;
      longPressStartY = e.clientY;

      longPressTimer = setTimeout(() => {
        if (longPressTargetWord === word) {
          isLongPressTriggered = true;
          word.classList.remove("word-pressing");
          word.classList.add("word-long-selected");
          setTimeout(() => word.classList.remove("word-long-selected"), 380);

          // Select the entire word range in browser
          try {
            const range = document.createRange();
            range.selectNodeContents(word);
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch {
            // Ignore range selection errors
          }

          // Trigger spring-animated selection bubble and translation
          const rect = word.getBoundingClientRect();
          const wordText = word.textContent?.trim() || "";
          if (wordText && rect.width > 0) {
            chosen = wordText;
            showSelectionBubble(wordText, rect);
            translate(wordText).then((res) => {
              if (chosen === wordText) {
                if ($("#bubbleMeaning")) {
                  $("#bubbleMeaning").textContent = res.translation;
                  $("#bubbleMeaning").classList.remove("loading");
                }
                if ($("#translatedText")) $("#translatedText").textContent = res.translation;
              }
            });
          }
        }
      }, 300);
    }
  }
});

$("#articleContent")?.addEventListener("mousemove", (e: MouseEvent) => {
  if (longPressTimer && longPressTargetWord) {
    const dist = Math.hypot(e.clientX - longPressStartX, e.clientY - longPressStartY);
    if (dist > 7) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTargetWord.classList.remove("word-pressing");
      longPressTargetWord = null;
    }
  }
});

document.addEventListener("mouseup", () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressTargetWord) {
    longPressTargetWord.classList.remove("word-pressing");
    longPressTargetWord = null;
  }
  if (isLongPressTriggered) {
    setTimeout(() => {
      isLongPressTriggered = false;
    }, 120);
  }
});

// Right-click Integration: Execute same inspection as left-click, but without reading aloud (不用朗读)
$("#articleContent")?.addEventListener("contextmenu", (e: MouseEvent) => {
  const word = (e.target as HTMLElement)?.closest(".read-word") as HTMLElement | null;
  const sel = window.getSelection();
  const selText = sel?.toString().trim();

  if (word || selText) {
    e.preventDefault(); // Suppress browser default context menu

    if (word) {
      word.classList.add("word-clicked");
      setTimeout(() => word.classList.remove("word-clicked"), 200);
      clearTimeout(wordClickTimer);
      // Execute word inspection WITHOUT speech
      inspectWord(word, false);
    } else if (selText) {
      // Analyze selected phrase/sentence
      handleSelection();
    }
  }
});

$("#articleContent")?.addEventListener("click", (e: any) => {
  if (isLongPressTriggered) {
    isLongPressTriggered = false;
    return;
  }
  // If user was drag-selecting a phrase or sentence, let handleSelection process it
  if (window.getSelection()?.toString().trim()) return;
  const word = e.target.closest(".read-word");
  if (word) {
    word.classList.add("word-clicked");
    setTimeout(() => word.classList.remove("word-clicked"), 200);
    if (calibrationMode && importedAudio) {
      word.dataset.time = importedAudio.currentTime.toFixed(2);
      word.classList.add("calibrated");
      syncAudioMarkers();
      if ($("#nowSpeaking")) {
        $("#nowSpeaking").textContent = `已校准 ${word.textContent} · ${importedAudio.currentTime.toFixed(2)} 秒`;
      }
      return;
    }
    clearTimeout(wordClickTimer);
    // Single-click debounced to ensure double click cancels it
    wordClickTimer = setTimeout(() => {
      if (!isDoubleClicked) {
        inspectWord(word, true); // Left click pronounces the word
      }
    }, 240);
    return;
  }
  const p = e.target.closest("p");
  if (p && !e.target.closest(".read-word") && !e.target.closest(".para-note-capsule")) {
    const index = playbackParts().indexOf(p);
    if (index >= 0) playFrom(index, 0);
  }
});

$("#articleContent")?.addEventListener("dblclick", (e: any) => {
  const word = e.target.closest(".read-word");
  if (!word) return;

  // Cancel single-click word inspection and pronunciation
  clearTimeout(wordClickTimer);
  isDoubleClicked = true;
  setTimeout(() => {
    isDoubleClicked = false;
  }, 350);

  // Strictly ensure word is NOT 显化 (no selection bubble, no text range, no word focus)
  hideSelectionBubble();
  window.getSelection()?.removeAllRanges();
  $$(".read-word").forEach((w: HTMLElement) => w.classList.remove("active-word-focus"));

  // Play full paragraph audio
  playFrom(+word.dataset.p, +word.dataset.w);
  if ($("#nowSpeaking")) {
    $("#nowSpeaking").textContent = importedAudio
      ? `音频已跳转至第 ${+word.dataset.p + 1} 段 · ${word.textContent}`
      : `正在朗读第 ${+word.dataset.p + 1} 段 · ${word.textContent} …`;
  }
});

// Vocabulary Book Actions
if ($("#saveWord")) {
  $("#saveWord").onclick = () => {
    if (!chosen) return;
    const cleanWord = chosen.trim();
    if (!words.some((w) => w.text.toLowerCase() === cleanWord.toLowerCase())) {
      words.unshift({
        text: cleanWord,
        meaning: $("#translatedText")?.textContent || "生词记录",
        phonetic: lastPhonetic,
        example: current.body.replace(/<[^>]*>/g, " ").slice(0, 100),
      });
      store("lexi-words", words);
      decorateWords();
      updateCounts();
    }
    $("#saveWord").textContent = "✓ 已收藏";
    setTimeout(() => {
      if ($("#saveWord")) $("#saveWord").textContent = "＋ 收藏";
    }, 2000);
  };
}

if ($("#clearMarks")) {
  $("#clearMarks").onclick = () => {
    window.getSelection()?.removeAllRanges();
    chosen = "";
    if ($("#translationResult")) $("#translationResult").hidden = true;
    if ($("#translationEmpty")) $("#translationEmpty").hidden = false;
  };
}

// Text Quality Inspection & Auto-Repair Logic
interface TextDiagnosticResult {
  hasIssues: boolean;
  brokenHyphens: number;
  unnaturalLineBreaks: number;
  mergedPunctuation: number;
  garbledChars: number;
  multiSpaces: number;
  bulletOrPageNumbers: number;
  summary: string;
  details: string[];
}

function diagnoseTextQuality(text: string): TextDiagnosticResult {
  if (!text || !text.trim()) {
    return {
      hasIssues: false,
      brokenHyphens: 0,
      unnaturalLineBreaks: 0,
      mergedPunctuation: 0,
      garbledChars: 0,
      multiSpaces: 0,
      bulletOrPageNumbers: 0,
      summary: "文本为空",
      details: [],
    };
  }

  // 1. Broken line-wrap hyphens e.g. "inter-\nnational", "com-\nputer"
  const brokenHyphenMatches = text.match(/([a-zA-Z]{2,})-\r?\n\s*([a-zA-Z]{2,})/g) || [];
  const brokenHyphens = brokenHyphenMatches.length;

  // 2. Unnatural single line-breaks inside a sentence (ending with lowercase/comma then newline then lowercase)
  const unnaturalBreakMatches = text.match(/([a-z0-9,;])\r?\n([a-z0-9])/g) || [];
  const unnaturalLineBreaks = unnaturalBreakMatches.length;

  // 3. Merged punctuation missing space e.g. "world.However", "book,and"
  const mergedPunctMatches = text.match(/([a-z]{2,}[,\.\?!;:])([A-Za-z]{2,})/g) || [];
  const mergedPunctuation = mergedPunctMatches.length;

  // 4. Common PDF encoding artifacts and corrupted characters
  const garbledMatches = text.match(/(\uFFFD|[â€œâ€\x00-\x08\x0B\x0C\x0E-\x1F])/g) || [];
  const garbledChars = garbledMatches.length;

  // 5. Redundant multiple spaces or hard tabs
  const multiSpaceMatches = text.match(/[ \t]{3,}/g) || [];
  const multiSpaces = multiSpaceMatches.length;

  // 6. Standalone page numbers on their own lines e.g. "\n12\n" or "\n- 12 -\n"
  const pageNumMatches = text.match(/\n\s*(?:page\s+)?\d+\s*\n/gi) || [];
  const bulletOrPageNumbers = pageNumMatches.length;

  const total = brokenHyphens + unnaturalLineBreaks + mergedPunctuation + garbledChars + multiSpaces + bulletOrPageNumbers;
  const hasIssues = total > 0;

  const details: string[] = [];
  if (brokenHyphens > 0) details.push(`发现 ${brokenHyphens} 处换行连字符截断（如 inter-\\n net）`);
  if (unnaturalLineBreaks > 0) details.push(`发现 ${unnaturalLineBreaks} 处句中异常折行（单行换行截断长句）`);
  if (mergedPunctuation > 0) details.push(`发现 ${mergedPunctuation} 处标点后紧挨英文字母缺失空格（如 .However）`);
  if (garbledChars > 0) details.push(`发现 ${garbledChars} 处编码乱码或非打印控制字符`);
  if (multiSpaces > 0) details.push(`发现 ${multiSpaces} 处多余空白与制表符`);
  if (bulletOrPageNumbers > 0) details.push(`发现 ${bulletOrPageNumbers} 处独立页码噪音干扰段落`);

  const summary = hasIssues
    ? `⚠️ 发现 ${total} 处潜在提取排版缺陷`
    : `✓ 文本排版清晰规范`;

  return {
    hasIssues,
    brokenHyphens,
    unnaturalLineBreaks,
    mergedPunctuation,
    garbledChars,
    multiSpaces,
    bulletOrPageNumbers,
    summary,
    details,
  };
}

function repairEnglishText(raw: string): { repaired: string; count: number } {
  let text = raw;
  let count = 0;

  // 1. Remove standalone page number lines e.g. "\nPage 14\n" or "\n 23 \n"
  const pageMatches = text.match(/\n\s*(?:page\s+)?\d+\s*\n/gi);
  if (pageMatches) {
    count += pageMatches.length;
    text = text.replace(/\n\s*(?:page\s+)?\d+\s*\n/gi, "\n\n");
  }

  // 2. Normalize smart quotes and weird dashes
  const beforeChars = text;
  text = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/\uFFFD/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  if (text !== beforeChars) count++;

  // 3. Fix words hyphenated across line breaks: "inter-\n  national" -> "international"
  const hyphenMatches = text.match(/([a-zA-Z]{2,})-\r?\n\s*([a-zA-Z]{2,})/g);
  if (hyphenMatches) {
    count += hyphenMatches.length;
    text = text.replace(/([a-zA-Z]{2,})-\r?\n\s*([a-zA-Z]{2,})/g, "$1$2");
  }

  // 4. Merge unnatural single line-breaks within the same sentence
  const breakMatches = text.match(/([a-z0-9,;])\r?\n\s*([a-z0-9])/g);
  if (breakMatches) {
    count += breakMatches.length;
    text = text.replace(/([a-z0-9,;])\r?\n\s*([a-z0-9])/g, "$1 $2");
  }

  // 5. Add missing spaces after punctuation when followed by words: e.g. "world.However" -> "world. However"
  const punctMatches = text.match(/([a-z]{2,}[\.\?!;:])([A-Z])/g);
  if (punctMatches) {
    count += punctMatches.length;
    text = text.replace(/([a-z]{2,}[\.\?!;:])([A-Z])/g, "$1 $2");
  }
  const commaMatches = text.match(/([a-z]{2,},)([a-z])/gi);
  if (commaMatches) {
    count += commaMatches.length;
    text = text.replace(/([a-z]{2,},)([a-z])/gi, "$1 $2");
  }

  // 6. Fix multiple spaces and tabs within lines
  const multiSpaceMatches = text.match(/[ \t]{2,}/g);
  if (multiSpaceMatches) {
    count += multiSpaceMatches.length;
    text = text.replace(/[ \t]{2,}/g, " ");
  }

  // 7. Consolidate 3+ consecutive linebreaks into clean paragraph breaks (\n\n)
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return { repaired: text.trim(), count };
}

function updateEditorDiagnosticUI() {
  const bodyEl = $("#editorBody") as HTMLTextAreaElement;
  const summaryEl = $("#textIssueSummary");
  const suggestionsBox = $("#repairSuggestionsBox");
  if (!bodyEl || !summaryEl) return;

  const report = sharedDiagnoseText(bodyEl.value);
  summaryEl.textContent = report.summary;
  summaryEl.className = `text-issue-summary ${report.hasIssues ? "has-issues" : "clean"}`;

  if (suggestionsBox) {
    if (report.hasIssues && report.details.length > 0) {
      suggestionsBox.style.display = "block";
      suggestionsBox.innerHTML = `<b>检测到以下排版问题，建议一键修复：</b><ul>${report.details
        .map((d) => `<li>${d}</li>`)
        .join("")}</ul>`;
    } else {
      suggestionsBox.style.display = "none";
      suggestionsBox.innerHTML = "";
    }
  }
}

// Editor Dialog
function openEditor(article = current, isExisting = true) {
  editingExisting = isExisting;
  if ($("#editorTitle")) $("#editorTitle").value = article.title;
  if ($("#editorBody")) {
    $("#editorBody").value = article.body
      .replace(/<div class="bilingual-translation">.*?<\/div>/g, "")
      .replace(/<p>/g, "")
      .replace(/<\/p>/g, "\n\n")
      .replace(/<br>/g, "\n")
      .trim();
  }
  updateEditorDiagnosticUI();
  $("#editorDialog")?.showModal();
}

$("#editorBody")?.addEventListener("input", () => {
  updateEditorDiagnosticUI();
});

$("#detectTextErrorsBtn")?.addEventListener("click", () => {
  updateEditorDiagnosticUI();
});

$("#autoRepairTextBtn")?.addEventListener("click", () => {
  const bodyEl = $("#editorBody") as HTMLTextAreaElement;
  if (!bodyEl || !bodyEl.value) return;
  const original = bodyEl.value;
  const result = sharedRepairText(original);
  lastRepairOriginal = original;
  bodyEl.value = result.repaired;
  updateEditorDiagnosticUI();
  const undoBtn = $("#undoRepairBtn") as HTMLButtonElement;
  if (undoBtn) undoBtn.style.display = "inline-flex";

  const btn = $("#autoRepairTextBtn");
  if (btn) {
    const origText = btn.innerHTML;
    btn.innerHTML = `✓ 已修复 ${result.count} 处问题`;
    setTimeout(() => {
      btn.innerHTML = origText;
    }, 2200);
  }
});

let lastRepairOriginal = "";

$("#aiRepairTextBtn")?.addEventListener("click", async () => {
  const bodyEl = $("#editorBody") as HTMLTextAreaElement;
  const btn = $("#aiRepairTextBtn") as HTMLButtonElement;
  if (!bodyEl?.value || !btn) return;
  const original = bodyEl.value;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = "正在精修…";
  try {
    const response = await fetch("/api/repair-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: original, useAi: true, customConfig: getActiveLLMConfig() }),
    });
    const result = await response.json();
    if (!response.ok || !result.repaired) throw new Error(result.error || "修复服务未返回结果");
    lastRepairOriginal = original;
    bodyEl.value = result.repaired;
    updateEditorDiagnosticUI();
    const undoBtn = $("#undoRepairBtn") as HTMLButtonElement;
    if (undoBtn) undoBtn.style.display = "inline-flex";
    btn.textContent = result.usedAi ? "✓ AI 精修完成" : `✓ 已完成规则修复 ${result.count || 0} 处`;
  } catch (error: any) {
    btn.textContent = `✗ 精修失败：${error.message || "网络异常"}`;
  } finally {
    setTimeout(() => { btn.innerHTML = label; btn.disabled = false; }, 2200);
  }
});

$("#undoRepairBtn")?.addEventListener("click", () => {
  const bodyEl = $("#editorBody") as HTMLTextAreaElement;
  if (!bodyEl || !lastRepairOriginal) return;
  bodyEl.value = lastRepairOriginal;
  lastRepairOriginal = "";
  updateEditorDiagnosticUI();
  const undoBtn = $("#undoRepairBtn") as HTMLButtonElement;
  if (undoBtn) undoBtn.style.display = "none";
});

if ($("#editText")) $("#editText").onclick = () => openEditor();
if ($("#newText")) {
  $("#newText").onclick = () =>
    openEditor({ id: "", title: "Untitled Reading", body: "", created: "刚刚" }, false);
}

if ($("#saveArticle")) {
  $("#saveArticle").onclick = (e: any) => {
    e.preventDefault();
    const title = $("#editorTitle")?.value.trim() || "Untitled Reading";
    const rawBody = $("#editorBody")?.value.trim() || "Start writing your English text here.";
    const body = rawBody
      .split(/\n\s*\n/)
      .map((p: string) => `<p>${escapeHtml(p)}</p>`)
      .join("");

    let existing = editingExisting && articles.find((a) => a.id === current.id);
    if (existing) {
      existing.title = title;
      existing.body = body;
      current = existing;
    } else {
      current = {
        id: Date.now().toString(),
        title,
        body,
        created: "刚刚",
      };
      articles.unshift(current);
    }
    store("lexi-articles", articles);
    renderArticle();
    $("#editorDialog")?.close();
    go("reader");
  };
}

// Library View
function renderLibrary() {
  const container = $("#libraryList");
  if (!container) return;
  container.innerHTML = articles
    .map(
      (a) => `<article class="library-card" data-id="${a.id}">
        <h2>${escapeHtml(a.title)}</h2>
        <p>${a.body.replace(/<[^>]*>/g, " ").trim().slice(0, 140)}…</p>
        <div style="font-size:11px;color:var(--muted);margin-top:10px;font-family:'DM Mono';">创建时间: ${a.created || "此前"}</div>
      </article>`
    )
    .join("");

  $$(".library-card").forEach((c: HTMLElement) => {
    c.onclick = () => {
      const found = articles.find((a) => a.id === c.dataset.id);
      if (found) {
        // Stop any in-flight read-aloud first: otherwise the previous article
        // keeps speaking and its highlight timers point at DOM nodes that are
        // about to be replaced.
        stopSpeechSafely();
        if (importedAudio) {
          importedAudio.pause();
          if (importedAudio.src.startsWith("blob:")) URL.revokeObjectURL(importedAudio.src);
          importedAudio = null;
        }
        current = found;
        bilingualCache = {};
        renderArticle();
        go("reader");
      }
    };
  });
}

// Vocabulary View
function renderWords() {
  const container = $("#wordList");
  if (!container) return;
  container.innerHTML = words.length
    ? words
        .map(
          (w, i) => `<article class="word-card">
            <div>
              <h2>${escapeHtml(w.text)} <small style="font-size:13px;color:var(--muted);font-weight:normal;font-family:'DM Mono';">${w.phonetic ? escapeHtml(w.phonetic) : ""}</small></h2>
              <p>${escapeHtml(w.meaning)}</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button data-speak="${escapeHtml(w.text)}" title="朗读" style="color:var(--blue);font-size:14px;">🔊</button>
              <button data-i="${i}" title="移除生词">×</button>
            </div>
          </article>`
        )
        .join("")
    : `<div class="empty-state">
        <div class="empty-icon">◇</div>
        <h3>生词本还是空的</h3>
        <p>在阅读界面划选或点击单词，点击“＋ 收藏”即可加入此处复习</p>
      </div>`;

  $$(".word-card button[data-i]").forEach((b: HTMLElement) => {
    b.onclick = () => {
      words.splice(+b.dataset.i!, 1);
      store("lexi-words", words);
      renderWords();
      updateCounts();
      decorateWords();
    };
  });

  $$(".word-card button[data-speak]").forEach((b: HTMLElement) => {
    b.onclick = (e) => {
      e.stopPropagation();
      speakWord(b.dataset.speak!);
    };
  });
}

// ==========================================
// Notes Panel & Editor Logic
// ==========================================
let editingNoteId: string | null = null;
let pendingNoteQuote = "";
let pendingNoteParaIndex: number | undefined = undefined;

function openNoteEditor(options?: { id?: string; quote?: string; initialText?: string; paraIndex?: number }) {
  const dialog = $("#noteEditDialog") as HTMLDialogElement;
  if (!dialog) return;

  editingNoteId = options?.id || null;
  pendingNoteQuote = options?.quote !== undefined ? options.quote : (chosen || "");
  pendingNoteParaIndex = options?.paraIndex !== undefined ? options.paraIndex : chosenParaIndex;

  // Reset AI Polish Box
  const polishBox = $("#noteAiPolishBox");
  if (polishBox) polishBox.style.display = "none";
  const loading = $("#noteAiPolishLoading");
  if (loading) loading.style.display = "none";
  const content = $("#noteAiPolishContent");
  if (content) content.style.display = "none";

  const titleEl = $("#noteModalTitle");
  const quoteBox = $("#noteContextQuote");
  const quoteText = $("#noteQuoteText");
  const input = $("#noteContentInput") as HTMLTextAreaElement;

  if (titleEl) {
    titleEl.textContent = editingNoteId ? "编辑阅读笔记" : "添加阅读笔记";
  }

  // Handle quote display
  if (pendingNoteQuote.trim()) {
    if (quoteBox) quoteBox.style.display = "block";
    if (quoteText) quoteText.textContent = pendingNoteQuote.trim();
  } else {
    if (quoteBox) quoteBox.style.display = "none";
    if (quoteText) quoteText.textContent = "";
  }

  if (input) {
    if (options?.initialText !== undefined) {
      input.value = options.initialText;
    } else if (editingNoteId) {
      const existing = notes.find((n) => n.id === editingNoteId);
      input.value = existing?.text || "";
      if (typeof existing?.paraIndex === "number") {
        pendingNoteParaIndex = existing.paraIndex;
      }
      if (existing?.quote && quoteBox && quoteText) {
        quoteBox.style.display = "block";
        quoteText.textContent = existing.quote;
        pendingNoteQuote = existing.quote;
      }
    } else {
      input.value = "";
    }
  }

  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute("open", "true");
  }

  setTimeout(() => input?.focus(), 50);
}

function closeNoteEditor() {
  const dialog = $("#noteEditDialog") as HTMLDialogElement;
  if (!dialog) return;
  try {
    dialog.close();
  } catch {
    dialog.removeAttribute("open");
  }
  editingNoteId = null;
  pendingNoteQuote = "";
  pendingNoteParaIndex = undefined;
}

function saveCurrentNote() {
  const input = $("#noteContentInput") as HTMLTextAreaElement;
  const content = (input?.value || "").trim();
  if (!content) {
    input?.focus();
    return;
  }

  const now = new Date();
  const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // If paraIndex was not directly set, match quote with current article paragraphs
  if (typeof pendingNoteParaIndex !== "number" && pendingNoteQuote) {
    const paragraphs = [...($("#articleContent")?.querySelectorAll("p") || [])];
    const idx = paragraphs.findIndex((p) =>
      p.textContent?.toLowerCase().includes(pendingNoteQuote.toLowerCase().trim())
    );
    if (idx !== -1) pendingNoteParaIndex = idx;
  }

  if (editingNoteId) {
    const idx = notes.findIndex((n) => n.id === editingNoteId);
    if (idx !== -1) {
      notes[idx].text = content;
      if (pendingNoteQuote) notes[idx].quote = pendingNoteQuote;
      if (typeof pendingNoteParaIndex === "number") {
        notes[idx].paraIndex = pendingNoteParaIndex;
      }
    }
  } else {
    const newNote: NoteItem = {
      id: "note-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      text: content,
      at: current.title || "阅读笔记",
      quote: pendingNoteQuote || undefined,
      paraIndex: pendingNoteParaIndex,
      created: timeStr,
      articleId: current.id,
    };
    notes.unshift(newNote);
  }

  store("lexi-notes", notes);
  renderNotes();
  renderParagraphNoteCapsules();
  updateCounts();
  closeNoteEditor();
  activateStudyTab("notes");
}

async function polishCurrentNote() {
  const input = $("#noteContentInput") as HTMLTextAreaElement;
  const text = (input?.value || "").trim();
  if (!text) {
    input?.focus();
    input.placeholder = "请先输入一些文字（心得、短评或翻译尝试），再进行 AI 批改与润色…";
    return;
  }

  const box = $("#noteAiPolishBox");
  const loading = $("#noteAiPolishLoading");
  const content = $("#noteAiPolishContent");
  const polishTextEl = $("#polishResultText");
  const grammarEl = $("#polishGrammarFeedback");
  const vocabBox = $("#polishVocabBox");
  const vocabList = $("#polishVocabList");
  const overallEl = $("#polishOverallComment");

  if (box) box.style.display = "flex";
  if (loading) loading.style.display = "flex";
  if (content) content.style.display = "none";

  try {
    const customConfig = getActiveLLMConfig();
    const res = await fetch("/api/polish-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        noteText: text,
        quoteContext: pendingNoteQuote || "",
        customConfig,
      }),
    });

    const data = await res.json();
    if (loading) loading.style.display = "none";
    if (content) content.style.display = "flex";

    if (polishTextEl) polishTextEl.textContent = data.polished || text;
    if (grammarEl) grammarEl.textContent = data.grammarFeedback || "语法结构通顺，表达地道清晰。";

    if (vocabBox && vocabList) {
      if (data.vocabSuggestions && Array.isArray(data.vocabSuggestions) && data.vocabSuggestions.length > 0) {
        vocabBox.style.display = "block";
        vocabList.innerHTML = data.vocabSuggestions
          .map(
            (v: any) => `
          <div class="vocab-tag-row">
            <div class="vocab-tag-words">
              <span class="vocab-orig">${escapeHtml(v.original || "")}</span>
              <span class="vocab-arrow">➔</span>
              <span class="vocab-sugg">${escapeHtml(v.suggested || "")}</span>
            </div>
            <div class="vocab-reason">${escapeHtml(v.reason || "")}</div>
          </div>`
          )
          .join("");
      } else {
        vocabBox.style.display = "none";
      }
    }

    if (overallEl) {
      overallEl.textContent = `💡 助教点评：${data.overallComment || "观点清晰，坚持用英文记录阅读思考！"}`;
    }

    const adoptBtn = $("#adoptPolishedBtn");
    if (adoptBtn) {
      adoptBtn.textContent = "✓ 一键采纳替换";
      adoptBtn.onclick = () => {
        if (input && data.polished) {
          input.value = data.polished;
          adoptBtn.textContent = "✓ 已采纳替换";
          setTimeout(() => {
            if (adoptBtn) adoptBtn.textContent = "✓ 一键采纳替换";
          }, 1500);
          input.focus();
        }
      };
    }
  } catch (err) {
    if (loading) loading.style.display = "none";
    if (content) content.style.display = "flex";
    if (polishTextEl) polishTextEl.textContent = "批改请求出现异常，请稍后重试。";
  }
}

if ($("#aiPolishNoteBtn")) {
  $("#aiPolishNoteBtn").onclick = () => polishCurrentNote();
}

if ($("#closeAiPolishBoxBtn")) {
  $("#closeAiPolishBoxBtn").onclick = () => {
    const box = $("#noteAiPolishBox");
    if (box) box.style.display = "none";
  };
}

if ($("#addNote")) {
  $("#addNote").onclick = () => {
    openNoteEditor({ quote: chosen || "" });
  };
}

if ($("#closeNoteModalBtn")) {
  $("#closeNoteModalBtn").onclick = () => closeNoteEditor();
}

if ($("#cancelNoteModalBtn")) {
  $("#cancelNoteModalBtn").onclick = () => closeNoteEditor();
}

if ($("#saveNoteModalBtn")) {
  $("#saveNoteModalBtn").onclick = () => saveCurrentNote();
}

// Ctrl+Enter or Cmd+Enter to quickly save note
$("#noteContentInput")?.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    saveCurrentNote();
  }
});

function locateAndHighlightQuote(quoteText: string) {
  if (!quoteText) return;
  const container = $("#articleContent");
  if (!container) return;

  const clean = quoteText.trim().toLowerCase();
  const paragraphs = [...container.querySelectorAll("p")];
  for (const p of paragraphs) {
    if (p.textContent?.toLowerCase().includes(clean)) {
      p.scrollIntoView({ behavior: "smooth", block: "center" });
      p.style.transition = "background-color 0.4s ease";
      p.style.backgroundColor = "rgba(56, 142, 94, 0.16)";
      setTimeout(() => {
        p.style.backgroundColor = "";
      }, 1800);
      break;
    }
  }
}

function renderNotes() {
  const container = $("#notesList");
  if (!container) return;

  // Filter notes for current article, or display all if general
  const currentNotes = notes.filter((n) => !n.articleId || n.articleId === current.id || n.at === current.title);
  const displayNotes = currentNotes.length ? currentNotes : notes;

  if (!displayNotes.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✦</div>
        <h3>留下你的想法</h3>
        <p>划选词句点击“✎ 笔记”，或点击上方“＋ 新建笔记”记录学习心得与思考</p>
      </div>`;
    return;
  }

  container.innerHTML = displayNotes
    .map((n, i) => {
      const noteId = n.id || `legacy-${i}`;
      const quoteHtml = n.quote
        ? `<div class="note-quote-preview" data-quote="${escapeHtml(n.quote)}" title="点击在正文中高亮定位此句">
            “${escapeHtml(n.quote.length > 80 ? n.quote.slice(0, 80) + "…" : n.quote)}”
          </div>`
        : "";

      return `
        <article class="note-card" data-id="${noteId}">
          <div class="note-card-meta">
            <span class="note-source-badge" title="${escapeHtml(n.at)}">${escapeHtml(n.at)}</span>
            <span>${escapeHtml(n.created || "此前记录")}</span>
          </div>
          ${quoteHtml}
          <div class="note-text-content">${escapeHtml(n.text)}</div>
          <div class="note-card-actions">
            ${n.quote ? `<button class="note-action-btn locate-btn" data-quote="${escapeHtml(n.quote)}">🎯 定位原文</button>` : ""}
            <button class="note-action-btn edit-btn" data-id="${noteId}">✎ 编辑</button>
            <button class="note-action-btn delete delete-btn" data-id="${noteId}">🗑 删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  // Bind note actions
  container.querySelectorAll(".locate-btn, .note-quote-preview").forEach((el: Element) => {
    (el as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const quote = (el as HTMLElement).dataset.quote;
      if (quote) locateAndHighlightQuote(quote);
    };
  });

  container.querySelectorAll(".edit-btn").forEach((btn: Element) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      const targetNote = notes.find((n, idx) => (n.id || `legacy-${idx}`) === id);
      if (targetNote) {
        openNoteEditor({
          id: targetNote.id,
          quote: targetNote.quote || "",
          initialText: targetNote.text,
        });
      }
    };
  });

  container.querySelectorAll(".delete-btn").forEach((btn: Element) => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      const targetIdx = notes.findIndex((n, idx) => (n.id || `legacy-${idx}`) === id);
      if (targetIdx !== -1) {
        notes.splice(targetIdx, 1);
        store("lexi-notes", notes);
        renderNotes();
        renderParagraphNoteCapsules();
        updateCounts();
      }
    };
  });
}

// ==========================================
// Collapsible Study Panel & Legacy Tools Dock
// ==========================================
let panelCollapsed = false;

function setPanelCollapsed(collapsed: boolean) {
  panelCollapsed = collapsed;
  $("#readerLayout")?.classList.toggle("panel-collapsed", collapsed);
  $("#studyPanel")?.classList.toggle("collapsed", collapsed);

  const toggleBtn = $("#togglePanelBtn");
  if (toggleBtn) {
    toggleBtn.classList.toggle("active", !collapsed);
    toggleBtn.textContent = collapsed ? "◧ 展开功能区" : "◨ 功能区";
  }

  try {
    localStorage.setItem("lexi-panel-collapsed", collapsed ? "true" : "false");
  } catch {}
}

function syncToolsPanelUI() {
  const levelBadge = $("#toolCardLevelBadge");
  if (levelBadge) {
    levelBadge.textContent = current?.level ? `CEFR ${current.level}` : "原文";
  }
  const bilingualStatus = $("#panelBilingualStatus");
  if (bilingualStatus) {
    bilingualStatus.textContent = bilingualActive ? "已开启" : "已关闭";
    bilingualStatus.style.color = bilingualActive ? "var(--blue)" : "#797368";
  }
  const paraNumStatus = $("#panelParaNumStatus");
  if (paraNumStatus) {
    paraNumStatus.textContent = currentParaNumMode === "prominent" ? "醒目" : currentParaNumMode === "subtle" ? "极简" : currentParaNumMode === "hidden" ? "隐藏" : "清晰";
  }
}

function renderPanelVocab(filterQuery = "") {
  const container = $("#panelVocabList");
  const countEl = $("#panelVocabCount");
  if (countEl) countEl.textContent = String(words.length);
  if (!container) return;

  const q = filterQuery.trim().toLowerCase();
  const filtered = q ? words.filter(w => w.text.toLowerCase().includes(q) || (w.meaning && w.meaning.toLowerCase().includes(q))) : words;

  if (!filtered.length) {
    container.innerHTML = `<div style="text-align:center;padding:24px 10px;color:var(--muted);font-size:12px;">
      ${q ? "未找到匹配生词" : "生词本为空，划词点击“＋ 收藏”即可加入"}
    </div>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 40).map((w, i) => `
    <div class="panel-word-item">
      <div class="panel-word-info">
        <div class="panel-word-head">
          <span class="panel-word-text">${escapeHtml(w.text)}</span>
          ${w.phonetic ? `<span class="panel-word-phonetic">${escapeHtml(w.phonetic)}</span>` : ""}
        </div>
        <div class="panel-word-meaning">${escapeHtml(w.meaning || "未记录详细释义")}</div>
      </div>
      <div class="panel-word-ops">
        <button type="button" data-panel-speak="${escapeHtml(w.text)}" title="朗读发音">🔊</button>
        <button type="button" data-panel-del="${i}" title="移出生词本">✕</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-panel-speak]").forEach((btn: HTMLElement) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      speakWord(btn.dataset.panelSpeak || "");
    };
  });

  container.querySelectorAll("[data-panel-del]").forEach((btn: HTMLElement) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.panelDel);
      words.splice(idx, 1);
      store("lexi-words", words);
      renderWords();
      renderPanelVocab(($("#panelVocabSearch") as HTMLInputElement)?.value || "");
      updateCounts();
      decorateWords();
    };
  });
}

// Tabs Switch in Study Panel
function activateStudyTab(panelName: string) {
  $$(".tab").forEach((x: HTMLElement) =>
    x.classList.toggle("active", x.dataset.panel === panelName)
  );
  $$(".dock-nav-item").forEach((x: HTMLElement) =>
    x.classList.toggle("active", x.dataset.panel === panelName)
  );
  if ($("#translatePanel")) $("#translatePanel").classList.toggle("active", panelName === "translate");
  if ($("#notesPanel")) $("#notesPanel").classList.toggle("active", panelName === "notes");
  if ($("#aiTutorPanel")) $("#aiTutorPanel").classList.toggle("active", panelName === "ai-tutor");
  if ($("#toolsPanel")) $("#toolsPanel").classList.toggle("active", panelName === "tools");
  if ($("#vocabPanel")) $("#vocabPanel").classList.toggle("active", panelName === "vocab");

  if (panelName === "notes") renderNotes();
  if (panelName === "vocab") renderPanelVocab();
  if (panelName === "tools") syncToolsPanelUI();
}

$$(".tab").forEach((b: HTMLElement) => {
  b.onclick = () => activateStudyTab(b.dataset.panel || "translate");
});

$$(".dock-nav-item").forEach((btn: HTMLElement) => {
  btn.onclick = () => {
    setPanelCollapsed(false);
    activateStudyTab(btn.dataset.panel || "translate");
  };
});

if ($("#collapseStudyPanelBtn")) {
  $("#collapseStudyPanelBtn").onclick = () => setPanelCollapsed(true);
}
if ($("#expandStudyPanelBtn")) {
  $("#expandStudyPanelBtn").onclick = () => setPanelCollapsed(false);
}
if ($("#togglePanelBtn")) {
  $("#togglePanelBtn").onclick = () => setPanelCollapsed(!panelCollapsed);
}

// Tools Panel actions
if ($("#panelToolSimplify")) {
  $("#panelToolSimplify").onclick = () => $("#openSimplify")?.click();
}
if ($("#panelRestoreOriginal")) {
  $("#panelRestoreOriginal").onclick = () => {
    if (current?.originalBody) {
      current.body = current.originalBody;
      delete current.level;
      store("lexi-articles", articles);
      renderArticle();
      syncToolsPanelUI();
      alert("已恢复原版正文内容");
    } else {
      alert("当前文章已是原版内容");
    }
  };
}
if ($("#panelToolQuiz")) {
  $("#panelToolQuiz").onclick = () => $("#openQuiz")?.click();
}
if ($("#panelToolBilingual")) {
  $("#panelToolBilingual").onclick = () => {
    $("#toggleBilingual")?.click();
    syncToolsPanelUI();
  };
}
if ($("#panelToolParaNum")) {
  $("#panelToolParaNum").onclick = () => {
    $("#toggleParaNum")?.click();
    syncToolsPanelUI();
  };
}
if ($("#panelToolPdfView")) {
  $("#panelToolPdfView").onclick = () => $("#togglePdfView")?.click();
}
if ($("#panelToolSpeakAll")) {
  $("#panelToolSpeakAll").onclick = () => $("#speakArticle")?.click();
}
if ($("#panelToolEditArticle")) {
  $("#panelToolEditArticle").onclick = () => $("#editText")?.click();
}
if ($("#panelToolClearMarks")) {
  $("#panelToolClearMarks").onclick = () => $("#clearMarks")?.click();
}
if ($("#panelGoWordsView")) {
  $("#panelGoWordsView").onclick = () => go("words");
}
if ($("#panelVocabSearch")) {
  $("#panelVocabSearch").oninput = (e) => {
    renderPanelVocab((e.target as HTMLInputElement).value);
  };
}

// ==========================================
// Settings View & Model Switcher Logic
// ==========================================
let currentSelectedProvider: "gemini" | "deepseek" | "qwen" | "custom" = "gemini";

function selectProvider(provider: "gemini" | "deepseek" | "qwen" | "custom", shouldPopulateDefaults = true) {
  currentSelectedProvider = provider;
  const preset = providerPresets[provider] || providerPresets.custom;

  // Update button active state
  $$(".provider-btn").forEach((btn: HTMLElement) => {
    btn.classList.toggle("active", btn.dataset.provider === provider);
  });

  const customFields = $("#customConfigFields");
  const presetsContainer = $("#modelPresetsContainer");
  const presetChips = $("#presetChips");
  const hintEl = $("#providerKeyHint");
  const urlInput = $("#apiUrl") as HTMLInputElement;
  const modelInput = $("#modelName") as HTMLInputElement;

  if (hintEl) hintEl.textContent = preset.hint;

  if (provider === "gemini") {
    if (customFields) customFields.style.display = "none";
    if (presetsContainer) presetsContainer.style.display = "none";
  } else {
    if (customFields) customFields.style.display = "block";
    if (presetsContainer) presetsContainer.style.display = "block";

    if (shouldPopulateDefaults) {
      if (urlInput) urlInput.value = preset.url;
      if (modelInput) modelInput.value = preset.defaultModel;
    }

    // Render preset chips
    if (presetChips) {
      presetChips.innerHTML = preset.models
        .map(
          (m) =>
            `<button type="button" class="preset-chip ${
              (modelInput?.value || preset.defaultModel) === m ? "active" : ""
            }" data-model="${m}">${m}</button>`
        )
        .join("");

      presetChips.querySelectorAll(".preset-chip").forEach((chip: HTMLElement) => {
        chip.onclick = () => {
          const m = chip.dataset.model!;
          if (modelInput) modelInput.value = m;
          presetChips
            .querySelectorAll(".preset-chip")
            .forEach((c: HTMLElement) => c.classList.toggle("active", c === chip));
        };
      });
    }
  }

  const resultBox = $("#connectionResultBox");
  if (resultBox) {
    resultBox.style.display = "none";
    resultBox.className = "connection-status-box";
  }
}

function syncSettingsUI() {
  const cfg: LLMSettings = load("lexi-api", {
    provider: "gemini",
    url: "",
    key: "",
    model: "",
  });

  currentSelectedProvider = cfg.provider || "gemini";
  selectProvider(currentSelectedProvider, false);

  if ($("#apiUrl")) ($("#apiUrl") as HTMLInputElement).value = cfg.url || (providerPresets[currentSelectedProvider]?.url || "");
  if ($("#apiKey")) ($("#apiKey") as HTMLInputElement).value = cfg.key || "";
  if ($("#modelName")) ($("#modelName") as HTMLInputElement).value = cfg.model || (providerPresets[currentSelectedProvider]?.defaultModel || "");

  updateModelBadge();
  updateTranslationEngineUI();
}

// Provider button clicks
$$(".provider-btn").forEach((btn: HTMLElement) => {
  btn.onclick = () => {
    const p = btn.dataset.provider as any;
    if (p) selectProvider(p, true);
  };
});

// Toggle API Key visibility
if ($("#toggleKeyVisibility")) {
  $("#toggleKeyVisibility").onclick = () => {
    const keyInput = $("#apiKey") as HTMLInputElement;
    if (!keyInput) return;
    const isPassword = keyInput.type === "password";
    keyInput.type = isPassword ? "text" : "password";
    $("#toggleKeyVisibility").textContent = isPassword ? "🔒" : "👁";
  };
}

// Test Connection
if ($("#testConnectionBtn")) {
  $("#testConnectionBtn").onclick = async () => {
    const box = $("#connectionResultBox");
    if (!box) return;

    if (currentSelectedProvider === "gemini") {
      box.style.display = "block";
      box.className = "connection-status-box success";
      box.textContent = "✓ 系统内置 Gemini 3.8 Flash 已就绪，免配置直连运行正常！";
      return;
    }

    const url = ($("#apiUrl") as HTMLInputElement)?.value.trim();
    const key = ($("#apiKey") as HTMLInputElement)?.value.trim();
    const model = ($("#modelName") as HTMLInputElement)?.value.trim();

    if (!key) {
      box.style.display = "block";
      box.className = "connection-status-box error";
      box.textContent = "✗ 请先填写 API Key 才能进行连接测试。";
      return;
    }

    box.style.display = "block";
    box.className = "connection-status-box loading";
    box.textContent = "正在测试 API 端点响应与网络延迟…";

    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: currentSelectedProvider, url, key, model }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        box.className = "connection-status-box success";
        box.textContent = `✓ 接口连接成功！模型响应正常 (耗时: ${data.latencyMs}ms)`;
      } else {
        box.className = "connection-status-box error";
        box.textContent = `✗ 连接失败: ${data.error || "未能收到正确响应，请检查 Key 或 URL"}`;
      }
    } catch (e: any) {
      box.className = "connection-status-box error";
      box.textContent = `✗ 请求出错: ${e.message || "网络异常"}`;
    }
  };
}

// Reset Default
if ($("#resetDefaultBtn")) {
  $("#resetDefaultBtn").onclick = () => {
    if (confirm("确定要恢复使用系统默认的 Gemini 3.8 Flash 吗？")) {
      const defaultCfg: LLMSettings = {
        provider: "gemini",
        url: "",
        key: "",
        model: "gemini-3.8-flash",
      };
      store("lexi-api", defaultCfg);
      selectProvider("gemini", true);
      if ($("#apiUrl")) ($("#apiUrl") as HTMLInputElement).value = "";
      if ($("#apiKey")) ($("#apiKey") as HTMLInputElement).value = "";
      if ($("#modelName")) ($("#modelName") as HTMLInputElement).value = "";
      updateModelBadge();
      const box = $("#connectionResultBox");
      if (box) {
        box.style.display = "block";
        box.className = "connection-status-box success";
        box.textContent = "✓ 已恢复默认使用系统内置 Gemini 3.8 Flash";
      }
    }
  };
}

// Save Settings
if ($("#saveSettings")) {
  $("#saveSettings").onclick = () => {
    const cfg: LLMSettings = {
      provider: currentSelectedProvider,
      url: ($("#apiUrl") as HTMLInputElement)?.value.trim() || "",
      key: ($("#apiKey") as HTMLInputElement)?.value.trim() || "",
      model: ($("#modelName") as HTMLInputElement)?.value.trim() || "",
    };
    store("lexi-api", cfg);
    updateModelBadge();

    const box = $("#connectionResultBox");
    if (box) {
      box.style.display = "block";
      box.className = "connection-status-box success";
      box.textContent = `✓ 设置已保存！当前大模型引擎：${
        cfg.provider === "gemini" ? "系统内置 Gemini 3.8 Flash" : `${cfg.provider.toUpperCase()} (${cfg.model || "默认"})`
      }`;
    }
    const saveBtn = $("#saveSettings");
    if (saveBtn) {
      const origText = saveBtn.textContent;
      saveBtn.textContent = "✓ 保存成功";
      setTimeout(() => {
        if (saveBtn) saveBtn.textContent = origText;
      }, 1500);
    }
  };
}

if ($("#exportWords")) {
  $("#exportWords").onclick = () => {
    if (!words.length) return alert("生词本为空，请先收藏单词！");
    const blob = new Blob(
      [words.map((w) => `${w.text}\t${w.phonetic || ""}\t${w.meaning}`).join("\n")],
      { type: "text/plain;charset=utf-8" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lexiread-vocabulary.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download before the browser has
    // started reading the blob; defer it to the next tick instead.
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// PDF Support with High-Precision Text Reconstruction
async function extractPdf(file: File) {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent({ normalizeWhitespace: false });

    interface ExtractedItem {
      str: string;
      x: number;
      y: number;
      width: number;
      size: number;
      hasEOL: boolean;
    }

    const items: ExtractedItem[] = [];
    const pageH = viewport.height || (page.view ? Math.abs(page.view[3] - page.view[1]) : 842);
    const pageW = viewport.width || (page.view ? Math.abs(page.view[2] - page.view[0]) : 595);

    // Margins to filter running headers/footers
    const headerLimit = pageH - 34;
    const footerLimit = 32;

    for (const rawItem of content.items as any[]) {
      if (!rawItem.str || !rawItem.str.trim()) continue;
      const tx = rawItem.transform[4];
      const ty = rawItem.transform[5];
      const fontH = Math.hypot(rawItem.transform[2], rawItem.transform[3]) || Math.abs(rawItem.transform[0]) || 12;
      const itemW = typeof rawItem.width === "number" && rawItem.width > 0
        ? rawItem.width
        : rawItem.str.length * fontH * 0.55;

      // Filter out lone page numbers or running headers/footers
      const isHeaderFooter = ty > headerLimit || ty < footerLimit;
      const isPageNum = /^(?:page\s*)?\d+(?:\s*\/\s*\d+)?$/i.test(rawItem.str.trim());
      if (isHeaderFooter && isPageNum) continue;

      items.push({
        str: rawItem.str,
        x: tx,
        y: ty,
        width: itemW,
        size: fontH,
        hasEOL: Boolean(rawItem.hasEOL),
      });
    }

    if (items.length === 0) continue;

    // Multi-column layout detection (e.g. 2-column academic papers)
    const midX = pageW / 2;
    const leftColumnItems: ExtractedItem[] = [];
    const rightColumnItems: ExtractedItem[] = [];

    const leftCount = items.filter((it) => it.x + it.width < midX - 8).length;
    const rightCount = items.filter((it) => it.x > midX + 8).length;
    const crossingCount = items.filter((it) => it.x < midX - 10 && it.x + it.width > midX + 10).length;

    const isTwoColumn = leftCount > 10 && rightCount > 10 && crossingCount <= Math.max(2, items.length * 0.035);

    if (isTwoColumn) {
      for (const it of items) {
        if (it.x < midX) {
          leftColumnItems.push(it);
        } else {
          rightColumnItems.push(it);
        }
      }
    }

    const columns = isTwoColumn ? [leftColumnItems, rightColumnItems] : [items];
    const columnParagraphs: string[] = [];

    for (const colItems of columns) {
      if (colItems.length === 0) continue;

      // Sort vertically to cluster baselines
      colItems.sort((a, b) => b.y - a.y || a.x - b.x);

      interface LineGroup {
        y: number;
        size: number;
        items: ExtractedItem[];
      }

      const lines: LineGroup[] = [];
      for (const it of colItems) {
        // Group items within 45% font size into the same line
        const threshold = Math.max(3.5, it.size * 0.45);
        let line = lines.find((l) => Math.abs(l.y - it.y) <= threshold);
        if (!line) {
          line = { y: it.y, size: it.size, items: [] };
          lines.push(line);
        }
        line.items.push(it);
      }

      // Sort lines top to bottom (descending Y)
      lines.sort((a, b) => b.y - a.y);

      // Assemble each line with accurate word spacing
      interface FormedLine {
        text: string;
        y: number;
        x: number;
        size: number;
      }

      const formedLines: FormedLine[] = [];
      for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x);
        const lineMinX = line.items[0]?.x ?? 0;
        const cleanLine = formPdfLine(line.items);
        if (cleanLine) {
          formedLines.push({
            text: cleanLine,
            y: line.y,
            x: lineMinX,
            size: line.size,
          });
        }
      }

      if (formedLines.length === 0) continue;

      // Assemble lines into coherent paragraphs
      const lineDeltas: number[] = [];
      for (let k = 0; k < formedLines.length - 1; k++) {
        const delta = formedLines[k].y - formedLines[k + 1].y;
        if (delta > 0 && delta < 50) {
          lineDeltas.push(delta);
        }
      }
      lineDeltas.sort((a, b) => a - b);
      const medianDelta = lineDeltas.length > 0 ? lineDeltas[Math.floor(lineDeltas.length / 2)] : 14;

      const paragraphs: string[] = [];
      let currentPara = "";

      for (let k = 0; k < formedLines.length; k++) {
        const cur = formedLines[k];
        const next = formedLines[k + 1];

        if (!currentPara) {
          currentPara = cur.text;
        } else {
          // Check for hyphen continuation at wrap
          if (/(?:[A-Za-z])-$/.test(currentPara) && /^[a-z]/.test(cur.text)) {
            currentPara = currentPara.slice(0, -1) + cur.text;
          } else {
            currentPara += " " + cur.text;
          }
        }

        if (!next) {
          paragraphs.push(currentPara);
          currentPara = "";
          continue;
        }

        const deltaY = cur.y - next.y;
        const isWideVerticalGap = deltaY >= medianDelta * 1.55;
        const endsWithPunctuation = /[.?!:;"”’]$/.test(cur.text);
        const nextIsIndented = next.x > cur.x + Math.max(12, cur.size * 0.9);

        if (isWideVerticalGap || (endsWithPunctuation && (nextIsIndented || deltaY >= medianDelta * 1.3))) {
          paragraphs.push(currentPara);
          currentPara = "";
        }
      }

      if (currentPara) {
        paragraphs.push(currentPara);
      }

      columnParagraphs.push(paragraphs.join("\n\n"));
    }

    pageTexts.push(columnParagraphs.join("\n\n"));
  }

  const fullRawText = pageTexts.join("\n\n");
  const cleaned = cleanExtractedText(fullRawText);
  return { text: cleaned, doc };
}

if ($("#importText")) $("#importText").onclick = () => $("#textFileInput")?.click();
if ($("#openPdfReader")) {
  $("#openPdfReader").onclick = () => {
    if ($("#textFileInput")) {
      $("#textFileInput").dataset.openDirect = "true";
      $("#textFileInput").accept = ".pdf,application/pdf";
      $("#textFileInput").click();
    }
  };
}

async function renderPdfPreview() {
  if (!activePdfDocument) return;
  const box = $("#pdfPreview");
  if (!box) return;
  box.innerHTML = '<p class="pdf-loading">正在渲染 PDF 原版页面…</p>';
  for (let i = 1; i <= activePdfDocument.numPages; i++) {
    const page = await activePdfDocument.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const available = Math.max(320, box.clientWidth - 28);
    const viewport = page.getViewport({ scale: Math.min(1.55, available / base.width) });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const wrap = document.createElement("figure");
    const textLayer = document.createElement("div");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    wrap.innerHTML = `<figcaption>第 ${i} 页 · 原版布局（可直接划选文字）</figcaption>`;
    textLayer.className = "pdf-text-layer";
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    wrap.append(canvas, textLayer);
    box.append(wrap);
    const task = window.pdfjsLib?.renderTextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayer,
      viewport,
      textDivs: [],
    });
    if (task?.promise) await task.promise;
  }
  box.querySelector(".pdf-loading")?.remove();
}

// ==========================================
// Original Playback Mode System
// ==========================================
let isOriginalPlaybackMode = false;
let origPdfCurrentPage = 1;

function enterOriginalPlaybackMode() {
  isOriginalPlaybackMode = true;
  const container = $("#originalPlaybackContainer");
  const articleContent = $("#articleContent");
  const toggleBtn = $("#togglePdfView");

  if (container) container.hidden = false;
  if (articleContent) articleContent.hidden = true;
  if (toggleBtn) {
    toggleBtn.textContent = "📖 返回学习版";
    toggleBtn.classList.add("active");
  }

  // Sync speed in orig topbar
  const origSpeed = $("#origSpeedSelect") as HTMLSelectElement;
  if (origSpeed) origSpeed.value = String(selectedRate);

  renderOriginalPlaybackView();
}

function exitOriginalPlaybackMode() {
  isOriginalPlaybackMode = false;
  const container = $("#originalPlaybackContainer");
  const articleContent = $("#articleContent");
  const toggleBtn = $("#togglePdfView");

  if (container) container.hidden = true;
  if (articleContent) articleContent.hidden = false;
  if (toggleBtn) {
    toggleBtn.textContent = "🎧 原版播放";
    toggleBtn.classList.remove("active");
  }

  // Stop any active speech smoothly if switching modes
  clearSpeakingHighlights();
  if ($("#audioPlayer")) {
    updatePlayer();
  }
}

function toggleOriginalPlaybackMode() {
  if (isOriginalPlaybackMode) {
    exitOriginalPlaybackMode();
  } else {
    enterOriginalPlaybackMode();
  }
}

async function renderOriginalPlaybackView() {
  const pdfView = $("#pdfPreview");
  const editorialView = $("#originalEditorialView");
  const pageNav = $("#origPageNavWrap");
  const origTitle = $("#origEditorialTitle");
  const origContent = $("#origEditorialContent");

  if (activePdfDocument) {
    setOriginalStageVisibility({
      pdfStage: pdfView,
      editorialStage: editorialView,
      pageNavigation: pageNav,
    }, true);
    if (pdfView) {
      await renderPdfPreview();
    }
    if (pageNav) {
      if ($("#origPageIndicator")) {
        $("#origPageIndicator").textContent = `第 ${origPdfCurrentPage} / ${activePdfDocument.numPages} 页`;
      }
    }
    if ($("#origPlayStatusSub")) {
      $("#origPlayStatusSub").textContent = "PDF 原版排版 · 点击页面文本即可原声点读跟随";
    }
  } else {
    setOriginalStageVisibility({
      pdfStage: pdfView,
      editorialStage: editorialView,
      pageNavigation: pageNav,
    }, false);

    if (origTitle) {
      origTitle.textContent = current.title || "原版刊物赏析";
    }

    if (origContent) {
      origContent.innerHTML = "";
      const div = document.createElement("div");
      div.innerHTML = current.body || "";
      div.querySelectorAll(".bilingual-translation, .para-note-capsule, .para-num").forEach((el) => el.remove());
      const ps = [...div.querySelectorAll("p")];
      const paragraphs = ps.length > 0
        ? ps.map((p) => p.textContent?.trim() || "")
        : (current.body || "").split(/\n\n+/).map((p) => p.trim());

      const fragment = document.createDocumentFragment();

      paragraphs.filter(Boolean).forEach((pText, pIdx) => {
        const pEl = document.createElement("p");
        pEl.className = "orig-para";
        pEl.dataset.paraIdx = String(pIdx);

        // Word tokenization preserving exact punctuation and delimiters
        const tokens = pText.split(/([A-Za-z0-9À-ÿ]+(?:['’\-][A-Za-z0-9À-ÿ]+)*)/g);
        let wIdx = 0;

        tokens.forEach((token) => {
          if (!token) return;
          if (/^[A-Za-z0-9À-ÿ]+(?:['’\-][A-Za-z0-9À-ÿ]+)*$/.test(token)) {
            const currentWordIdx = wIdx++;
            const span = document.createElement("span");
            span.className = "orig-word";
            span.textContent = token;
            span.dataset.p = String(pIdx);
            span.dataset.w = String(currentWordIdx);
            span.title = `点击从 "${token}" 开始点读 · 右键查词`;
            span.onclick = (e) => {
              e.stopPropagation();
              playFrom(pIdx, currentWordIdx);
            };
            span.oncontextmenu = (e) => {
              e.preventDefault();
              e.stopPropagation();
              inspectWord(span, false);
            };
            pEl.appendChild(span);
          } else {
            pEl.appendChild(document.createTextNode(token));
          }
        });

        pEl.onclick = () => {
          playFrom(pIdx, 0);
        };

        fragment.appendChild(pEl);
      });

      origContent.oncontextmenu = (e) => {
        const selText = window.getSelection()?.toString().trim();
        if (selText) {
          e.preventDefault();
          handleSelection();
        }
      };

      origContent.appendChild(fragment);
    }

    if ($("#origPlayStatusSub")) {
      $("#origPlayStatusSub").textContent = "精校原版排版 · 点击任意段落或单词即可开始原声点读";
    }
  }

  updatePlayer();
}

// Wire Original Playback Topbar Controls
$("#origPrevParaBtn")?.addEventListener("click", () => {
  if (playbackIndex > 0) {
    playFrom(playbackIndex - 1, 0, true);
  }
});

$("#origNextParaBtn")?.addEventListener("click", () => {
  const parts = playbackParts();
  if (playbackIndex < parts.length - 1) {
    playFrom(playbackIndex + 1, 0, true);
  }
});

$("#origPlayToggleBtn")?.addEventListener("click", () => {
  if (playbackActive) {
    if ($("#togglePlay")) $("#togglePlay").click();
  } else {
    playFrom(playbackIndex || 0, playbackWord || 0);
  }
});

$("#origReplayBtn")?.addEventListener("click", () => {
  playFrom(0, 0);
});

$("#origSpeedSelect")?.addEventListener("change", (e: any) => {
  selectedRate = Number(e.target.value) || 1;
  const mainSelect = $("#playbackRate") as HTMLSelectElement;
  if (mainSelect) mainSelect.value = String(selectedRate);
  if (importedAudio) importedAudio.playbackRate = selectedRate;
  if (playbackActive && !importedAudio) playFrom(playbackIndex, playbackWord);
});

$("#origImportMediaBtn")?.addEventListener("click", () => {
  $("#audioFileInput")?.click();
});

$("#origExitBtn")?.addEventListener("click", () => {
  exitOriginalPlaybackMode();
});

$("#origPrevPageBtn")?.addEventListener("click", () => {
  if (activePdfDocument && origPdfCurrentPage > 1) {
    origPdfCurrentPage--;
    renderOriginalPlaybackView();
  }
});

$("#origNextPageBtn")?.addEventListener("click", () => {
  if (activePdfDocument && origPdfCurrentPage < activePdfDocument.numPages) {
    origPdfCurrentPage++;
    renderOriginalPlaybackView();
  }
});

if ($("#togglePdfView")) {
  $("#togglePdfView").onclick = () => {
    toggleOriginalPlaybackMode();
  };
}

function openImportedReading(file: File, text: string, pdfDoc: any = null) {
  activePdfDocument = pdfDoc;
  origPdfCurrentPage = 1;
  current = {
    id: Date.now().toString(),
    title: file.name.replace(/\.[^.]+$/, ""),
    body:
      paragraphsFromText(text) ||
      "<p>此 PDF 未找到可选择的文本，可能是扫描件。请使用带 OCR 文本层的 PDF。</p>",
    created: "刚刚",
  };
  articles.unshift(current);
  store("lexi-articles", articles);
  renderArticle();
  if ($("#togglePdfView")) {
    $("#togglePdfView").hidden = false;
    $("#togglePdfView").textContent = "🎧 原版播放";
  }
  if (pdfDoc) {
    enterOriginalPlaybackMode();
  } else {
    exitOriginalPlaybackMode();
  }
  go("reader");
  window.scrollTo(0, 0);
}

if ($("#textFileInput")) {
  $("#textFileInput").onchange = async (e: any) => {
    const file = e.target.files[0];
    const direct = e.target.dataset.openDirect === "true";
    delete e.target.dataset.openDirect;
    if (!file) return;
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const extracted = await extractPdf(file);
        const report = diagnoseTextQuality(extracted.text);
        let finalText = extracted.text;

        if (report.hasIssues) {
          if (confirm(`导入的 PDF 文本检测到 ${report.summary}（包含折行截断或标点异常）。\n是否立即执行智能修复？\n【确定】：应用智能排版修复\n【取消】：保留原始提取结果`)) {
            const repairedResult = repairEnglishText(extracted.text);
            finalText = repairedResult.repaired;
          }
        }

        if (direct || confirm("直接进入阅读器阅读此 PDF？选择“取消”可先进入编辑器精修。")) {
          openImportedReading(file, finalText, extracted.doc);
        } else {
          openEditor({ id: "", title: file.name.replace(/\.[^.]+$/, ""), body: finalText, created: "刚刚" }, false);
        }
      } else {
        const text = await file.text();
        const report = diagnoseTextQuality(text);
        let finalText = text;

        if (report.hasIssues) {
          if (confirm(`导入的文本检测到 ${report.summary}（如折行连词截断或标点缺失）。\n是否立即自动修复并导入编辑器？\n【确定】：自动修复后打开\n【取消】：保留原样打开`)) {
            finalText = repairEnglishText(text).repaired;
          }
        }

        openEditor({ id: "", title: file.name.replace(/\.[^.]+$/, ""), body: finalText, created: "刚刚" }, false);
      }
    } catch {
      alert("无法读取该文件。PDF 导入需要网络连接以加载解析组件。");
    } finally {
      e.target.value = "";
      e.target.accept = ".txt,.pdf,text/plain,application/pdf";
    }
  };
}

// Audio Import and Sync Calibration
if ($("#importAudio")) $("#importAudio").onclick = () => $("#audioFileInput")?.click();
if ($("#audioFileInput")) {
  $("#audioFileInput").onchange = (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    if (importedAudio) URL.revokeObjectURL(importedAudio.src);
    importedAudio = new Audio(URL.createObjectURL(file));
    syncAudioMarkers();
    let markerCursor = 0;

    importedAudio.addEventListener("loadedmetadata", () => {
      if (importedAudio && Number.isFinite(importedAudio.duration)) {
        if ($("#playerTotalTime")) {
          $("#playerTotalTime").textContent = formatMediaTime(importedAudio.duration);
        }
        if ($("#playerCurrentTime")) {
          $("#playerCurrentTime").textContent = formatMediaTime(importedAudio.currentTime);
        }
        const bar = $("#audioProgressBar") as HTMLInputElement;
        if (bar) {
          bar.max = "100";
          bar.value = "0";
        }
      }
    });

    importedAudio.addEventListener("timeupdate", () => {
      if (!importedAudio) return;

      // Update progress bar and time labels if user is not actively dragging
      if (!isDraggingAudioProgress && Number.isFinite(importedAudio.duration) && importedAudio.duration > 0) {
        const percent = (importedAudio.currentTime / importedAudio.duration) * 100;
        const bar = $("#audioProgressBar") as HTMLInputElement;
        if (bar) bar.value = String(percent);
        if ($("#playerCurrentTime")) {
          $("#playerCurrentTime").textContent = formatMediaTime(importedAudio.currentTime);
        }
        if ($("#playerTotalTime")) {
          $("#playerTotalTime").textContent = formatMediaTime(importedAudio.duration);
        }
      }

      while (
        markerCursor < audioMarkers.length - 1 &&
        audioMarkers[markerCursor + 1].t <= importedAudio!.currentTime
      ) {
        markerCursor++;
      }
      while (markerCursor > 0 && audioMarkers[markerCursor].t > importedAudio!.currentTime) {
        markerCursor--;
      }
      const marker = audioMarkers[markerCursor];
      if (marker && marker.t <= importedAudio!.currentTime) {
        const nextIdx = +marker.w.dataset.p!;
        const nextWord = +marker.w.dataset.w!;
        if (nextIdx !== playbackIndex || nextWord !== playbackWord) {
          playbackIndex = nextIdx;
          playbackWord = nextWord;
          updatePlayer();
        }
      }
    });
    importedAudio.addEventListener("ended", () => {
      playbackActive = false;
      isPaused = false;
      clearSpeakingHighlights();
      if ($("#togglePlay")) $("#togglePlay").textContent = "▶";
      if ($("#miniTogglePlay")) $("#miniTogglePlay").textContent = "▶";
      if ($("#nowSpeaking")) $("#nowSpeaking").textContent = "音频播放完毕";
      if ($("#miniPlayStatus")) $("#miniPlayStatus").textContent = "已播完";
      const bar = $("#audioProgressBar") as HTMLInputElement;
      if (bar) bar.value = "100";
    });
    if ($("#audioPlayer")) $("#audioPlayer").hidden = false;
    if ($("#nowSpeaking")) {
      $("#nowSpeaking").textContent = `已导入音频：${file.name}；可点击“校准”建立逐词时间点`;
    }
    e.target.value = "";
  };
}

if ($("#calibrateAudio")) {
  $("#calibrateAudio").onclick = () => {
    if (!importedAudio) return alert("请先导入音频文件");
    calibrationMode = !calibrationMode;
    $("#calibrateAudio").classList.toggle("calibrating", calibrationMode);
    $("#calibrateAudio").textContent = calibrationMode ? "✓ 校准中" : "◎ 校准";
    if ($("#nowSpeaking")) {
      $("#nowSpeaking").textContent = calibrationMode
        ? "校准中：播放音频，按朗读进度依次点击单词"
        : "已退出校准模式";
    }
  };
}

// Keyboard shortcuts
document.addEventListener("keydown", (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  if (target.matches("input,textarea,[contenteditable='true']")) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("#togglePlay")?.click();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    $("#skipBack")?.click();
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    $("#skipForward")?.click();
  } else if (e.code === "Escape") {
    if (immersiveActive) {
      setImmersiveMode(false);
      return;
    }
    const player = $("#audioPlayer");
    if (player && !player.hidden) {
      // First Esc collapses the player into the mini dock; a second Esc closes
      // it completely (same as the ✕ button).
      if (!player.classList.contains("collapsed")) {
        setPlayerCollapsed(true);
      } else {
        $("#closePlayerBtn")?.click();
      }
    }
  } else if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if ($("#reader")?.classList.contains("active")) {
      setImmersiveMode(!immersiveActive);
    }
  } else if ((e.key === "]" || e.key === "[" || e.key === "\\") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if ($("#reader")?.classList.contains("active")) {
      e.preventDefault();
      setPanelCollapsed(!panelCollapsed);
    }
  }
});

// Footer shortcut & gestures guide link
if ($("#footerShortcutLink")) {
  $("#footerShortcutLink").onclick = (e) => {
    e.preventDefault();
    go("settings");
    setTimeout(() => {
      const guide = $("#settingsShortcutsGuide");
      if (guide) {
        guide.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
  };
}

// Reading Progress on Scroll
let scrollPending = false;
window.addEventListener(
  "scroll",
  () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight - innerHeight;
      if ($("#readingProgress")) {
        $("#readingProgress").textContent = `${Math.min(
          100,
          Math.max(0, Math.round((scrollY / (h || 1)) * 100))
        )}% READ`;
      }
      scrollPending = false;
    });
  },
  { passive: true }
);

// ==========================================
// FEATURE 1: Pre-Translated Bilingual Parallel Mode (提前翻译·瞬时对照)
// ==========================================
async function pretranslateArticle(article: ArticleItem) {
  if (!article || !article.body) return;
  if (!article.translations) article.translations = [];

  const temp = document.createElement("div");
  temp.innerHTML = article.body;
  const ps = [...temp.querySelectorAll("p")];
  if (ps.length === 0) return;

  let changed = false;
  for (let i = 0; i < ps.length; i++) {
    const key = `${article.id}-p-${i}`;
    if (article.translations[i] && article.translations[i].trim()) {
      bilingualCache[key] = article.translations[i];
      continue;
    }
    if (bilingualCache[key]) {
      article.translations[i] = bilingualCache[key];
      changed = true;
      continue;
    }

    const text = (ps[i].textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    try {
      const res = await translate(text);
      if (res && res.translation) {
        article.translations[i] = res.translation;
        bilingualCache[key] = res.translation;
        changed = true;

        if (current && current.id === article.id && bilingualActive) {
          const activeP = $("#articleContent")?.querySelectorAll("p")[i];
          if (activeP && !activeP.querySelector(".bilingual-translation")) {
            const t = document.createElement("div");
            t.className = "bilingual-translation";
            t.textContent = res.translation;
            activeP.appendChild(t);
          }
        }
      }
    } catch {
      // Continue next paragraph gracefully
    }
  }

  if (changed) {
    store("lexi-articles", articles);
  }
}

async function loadBilingualTranslations() {
  const container = $("#articleContent") as HTMLElement | null;
  if (!container) return;

  // Pin the article that is on screen right now. Translation requests resolve
  // asynchronously, so without this the callback below used to write results
  // into whatever `current` pointed at *after* the user switched articles —
  // mixing one article's Chinese translation into another one's paragraphs.
  const article = current;
  const articleId = article.id;
  const isStillActive = () => current && current.id === articleId;

  const rawParagraphs = [...container.querySelectorAll("p")];
  for (let i = 0; i < rawParagraphs.length; i++) {
    const p = rawParagraphs[i];
    if (p.querySelector(".bilingual-translation")) continue;

    // Check pre-translated content first
    const cached = article.translations?.[i] || bilingualCache[`${articleId}-p-${i}`];

    if (cached) {
      const t = document.createElement("div");
      t.className = "bilingual-translation";
      t.textContent = cached;
      p.appendChild(t);
      continue;
    }

    // If not yet translated, extract full clean text of the paragraph
    const clone = p.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".bilingual-translation, .para-note-capsule, .para-num").forEach((el) => el.remove());
    const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    // Translate and save to article pretranslations
    translate(text).then((res) => {
      if (!res || !res.translation) return;
      if (!isStillActive() || !p.isConnected) return;

      if (!article.translations) article.translations = [];
      article.translations[i] = res.translation;
      bilingualCache[`${articleId}-p-${i}`] = res.translation;
      store("lexi-articles", articles);
      if (bilingualActive && !p.querySelector(".bilingual-translation")) {
        const t = document.createElement("div");
        t.className = "bilingual-translation";
        t.textContent = res.translation;
        p.appendChild(t);
      }
    });
  }
}

if ($("#toggleBilingual")) {
  $("#toggleBilingual").onclick = () => {
    bilingualActive = !bilingualActive;
    $("#toggleBilingual").style.backgroundColor = bilingualActive ? "#eef3ff" : "";
    $("#toggleBilingual").style.borderColor = bilingualActive ? "#2457d6" : "";
    $("#toggleBilingual").style.color = bilingualActive ? "#2457d6" : "";
    $("#toggleBilingual").textContent = bilingualActive ? "✓ 双语对照中" : "⇄ 双语对照";

    if (bilingualActive) {
      loadBilingualTranslations();
    } else {
      $$(".bilingual-translation").forEach((el) => el.remove());
    }
  };
}

// ==========================================
// FEATURE: Immersive Reading Mode (沉浸式专注阅读)
// ==========================================
let immersiveActive = false;

function setImmersiveMode(active: boolean) {
  immersiveActive = active;
  document.body.classList.toggle("immersive-reading-mode", active);

  const check = $("#toggleImmersiveCheck") as HTMLInputElement | null;
  if (check) check.checked = active;

  const railBtn = $("#railImmersiveBtn");
  if (railBtn) {
    railBtn.classList.toggle("active", active);
    const railLabel = railBtn.querySelector(".rail-label");
    if (railLabel) railLabel.textContent = active ? "退出沉浸" : "沉浸阅读";
  }

  const exitHud = $("#immersiveFloatingExit");
  if (exitHud) {
    exitHud.style.display = active ? "block" : "none";
  }

  try {
    localStorage.setItem("lexi-immersive", active ? "true" : "false");
  } catch {}
}

const toggleImmersiveCheckEl = $("#toggleImmersiveCheck") as HTMLInputElement | null;
if (toggleImmersiveCheckEl) {
  toggleImmersiveCheckEl.onchange = (e) => {
    setImmersiveMode((e.target as HTMLInputElement).checked);
  };
}

const railImmersiveBtnEl = $("#railImmersiveBtn");
if (railImmersiveBtnEl) {
  railImmersiveBtnEl.onclick = () => {
    setImmersiveMode(!immersiveActive);
  };
}

const exitImmersiveBtnEl = $("#exitImmersiveBtn");
if (exitImmersiveBtnEl) {
  exitImmersiveBtnEl.onclick = () => {
    setImmersiveMode(false);
  };
}

// ==========================================
// Natural Paragraph Numbering Prominence Mode
// ==========================================
type ParaNumMode = "standard" | "prominent" | "subtle" | "hidden";
const paraNumLabels: Record<ParaNumMode, string> = {
  standard: "¶ 段号: 清晰",
  prominent: "¶ 段号: 醒目",
  subtle: "¶ 段号: 极简",
  hidden: "¶ 段号: 隐藏",
};

let currentParaNumMode: ParaNumMode = load("lexi-para-num-mode", "standard");

function applyParaNumMode(mode: ParaNumMode) {
  currentParaNumMode = mode;
  store("lexi-para-num-mode", mode);
  const content = $("#articleContent");
  if (content) {
    content.classList.remove("para-prominent", "para-subtle", "para-hidden");
    if (mode === "prominent") content.classList.add("para-prominent");
    else if (mode === "subtle") content.classList.add("para-subtle");
    else if (mode === "hidden") content.classList.add("para-hidden");
  }
  const btn = $("#toggleParaNum");
  if (btn) {
    btn.textContent = paraNumLabels[mode] || "¶ 段号: 清晰";
    btn.style.backgroundColor = mode === "prominent" ? "rgba(56, 142, 94, 0.12)" : "";
    btn.style.borderColor = mode === "prominent" ? "rgba(45, 130, 80, 0.55)" : "";
    btn.style.color = mode === "prominent" ? "#124324" : "";
  }
}

if ($("#toggleParaNum")) {
  $("#toggleParaNum").onclick = () => {
    const cycle: ParaNumMode[] = ["standard", "prominent", "subtle", "hidden"];
    const nextIdx = (cycle.indexOf(currentParaNumMode) + 1) % cycle.length;
    applyParaNumMode(cycle[nextIdx]);
  };
}

// Initialize paragraph numbering mode
applyParaNumMode(currentParaNumMode);

// ==========================================
// FEATURE 2: CEFR Level Adaptation & Simplification
// ==========================================
let selectedTargetLevel = "B1";
let lastSimplifiedResult: any = null;

if ($("#openSimplify")) {
  $("#openSimplify").onclick = () => {
    $("#simplifyDialog")?.showModal();
    if (!current.originalBody) {
      current.originalBody = current.body;
    }
    if ($("#restoreOriginalBtn")) {
      $("#restoreOriginalBtn").style.display = current.level ? "inline-flex" : "none";
    }
    fetchSimplification(selectedTargetLevel);
  };
}

$$(".cefr-chip").forEach((chip: HTMLElement) => {
  chip.onclick = () => {
    $$(".cefr-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    selectedTargetLevel = chip.dataset.level || "B1";
    fetchSimplification(selectedTargetLevel);
  };
});

async function fetchSimplification(level: string) {
  const statusEl = $("#simplifyStatus");
  const box = $("#simplifyResultBox");
  const applyBtn = $("#applySimplifyBtn");
  if (!statusEl || !box || !applyBtn) return;

  statusEl.textContent = `正在使用 Gemini 3.8 Flash 将文章改写为 CEFR ${level} 等级…`;
  box.style.display = "none";
  applyBtn.disabled = true;

  const rawText = (current.originalBody || current.body).replace(/<[^>]*>/g, "\n");
  try {
    const res = await fetch("/api/simplify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rawText, targetLevel: level }),
    });
    if (res.ok) {
      const data = await res.json();
      lastSimplifiedResult = data;
      statusEl.textContent = `✓ 已生成 ${level} 改写版本（难度适配完成）`;
      box.style.display = "block";

      const diffPills = (data.adaptations || [])
        .map(
          (ad: any) =>
            `<span class="diff-pill" title="${escapeHtml(ad.reason || "")}">
              <s>${escapeHtml(ad.originalPhrase)}</s> → <b>${escapeHtml(ad.simplifiedPhrase)}</b>
            </span>`
        )
        .join(" ");

      box.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;color:#2457d6;">💡 改写说明：${escapeHtml(data.summaryChinese || "")}</div>
        ${diffPills ? `<div style="margin:10px 0;"><b>核心难词替换：</b><br>${diffPills}</div>` : ""}
        <div style="margin-top:10px;font-style:italic;color:#555;"><b>改写后预览：</b><br>${escapeHtml(data.simplifiedText.slice(0, 240))}…</div>
      `;
      applyBtn.disabled = false;
      return;
    }
  } catch (err) {
    console.warn("Simplify error:", err);
  }

  statusEl.textContent = "改写服务未能连接，请稍后再试。";
}

if ($("#applySimplifyBtn")) {
  $("#applySimplifyBtn").onclick = () => {
    if (!lastSimplifiedResult) return;
    if (!current.originalBody) {
      current.originalBody = current.body;
    }
    current.body = paragraphsFromText(lastSimplifiedResult.simplifiedText);
    current.level = selectedTargetLevel;
    store("lexi-articles", articles);
    renderArticle();
    $("#simplifyDialog")?.close();
  };
}

if ($("#restoreOriginalBtn")) {
  $("#restoreOriginalBtn").onclick = () => {
    if (current.originalBody) {
      current.body = current.originalBody;
      delete current.level;
      store("lexi-articles", articles);
      renderArticle();
      $("#simplifyDialog")?.close();
    }
  };
}

if ($("#closeSimplifyBtn")) $("#closeSimplifyBtn").onclick = () => $("#simplifyDialog")?.close();
if ($("#cancelSimplifyBtn")) $("#cancelSimplifyBtn").onclick = () => $("#simplifyDialog")?.close();

// ==========================================
// FEATURE 3: AI Reading Tutor Chat
// ==========================================
async function sendAIMessage(question: string) {
  const container = $("#aiMessagesList");
  const input = $("#aiQuestionInput") as HTMLInputElement;
  if (!container || !question.trim()) return;

  const userMsg = document.createElement("div");
  userMsg.className = "ai-msg user";
  userMsg.textContent = question;
  container.appendChild(userMsg);

  const loadingMsg = document.createElement("div");
  loadingMsg.className = "ai-msg assistant";
  loadingMsg.textContent = "助教正在思考并组织回答…";
  container.appendChild(loadingMsg);
  container.scrollTop = container.scrollHeight;

  if (input) input.value = "";

  try {
    const rawText = current.body.replace(/<[^>]*>/g, " ");
    const customConfig = getActiveLLMConfig();
    const res = await fetch("/api/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        articleContext: rawText.slice(0, 2500),
        selectedText: chosen || undefined,
        customConfig,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      loadingMsg.textContent = data.answer || "助教已生成回答。";
      container.scrollTop = container.scrollHeight;
      return;
    }
  } catch (err) {
    console.warn("AI Tutor error:", err);
  }

  loadingMsg.textContent = "抱歉，网络连接异常，请重试。";
}

$$(".quick-prompt-btn").forEach((btn: HTMLElement) => {
  btn.onclick = () => {
    sendAIMessage(btn.dataset.ask || btn.textContent || "");
  };
});

if ($("#aiSendBtn")) {
  $("#aiSendBtn").onclick = () => {
    const text = ($("#aiQuestionInput") as HTMLInputElement)?.value;
    if (text) sendAIMessage(text);
  };
}

if ($("#aiQuestionInput")) {
  $("#aiQuestionInput").onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const text = ($("#aiQuestionInput") as HTMLInputElement)?.value;
      if (text) sendAIMessage(text);
    }
  };
}

// ==========================================
// FEATURE 4: AI Reading Quiz Modal
// ==========================================
async function loadQuiz() {
  const container = $("#quizContainer");
  if (!container) return;
  container.innerHTML = '<p style="font-size:13px;color:var(--muted);padding:20px 0;">正在根据文章生成理解与词汇测验题…</p>';

  const rawText = current.body.replace(/<[^>]*>/g, " ");
  try {
    const res = await fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rawText.slice(0, 2500) }),
    });
    if (res.ok) {
      const data = await res.json();
      const questions = data.questions || [];
      if (!questions.length) throw new Error("No questions");

      container.innerHTML = questions
        .map(
          (q: any, qi: number) => `
          <div class="quiz-question-card" data-correct="${escapeHtml(q.correctAnswer)}">
            <div class="quiz-question-title">${qi + 1}. ${escapeHtml(q.question)}</div>
            <div>
              ${q.options
                .map(
                  (opt: string) =>
                    `<button class="quiz-option" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`
                )
                .join("")}
            </div>
            <div class="quiz-explanation" style="display:none;font-size:12px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);color:#444;">
              💡 <b>解析：</b>${escapeHtml(q.explanation || "正确选项如上标注")}
            </div>
          </div>
        `
        )
        .join("");

      $$(".quiz-question-card").forEach((card: HTMLElement) => {
        const correct = card.dataset.correct;
        const options = card.querySelectorAll(".quiz-option");
        const exp = card.querySelector(".quiz-explanation") as HTMLElement;

        options.forEach((btn: any) => {
          btn.onclick = () => {
            const isCorrect = btn.dataset.opt === correct;
            options.forEach((o: any) => (o.disabled = true));
            if (isCorrect) {
              btn.classList.add("correct");
            } else {
              btn.classList.add("wrong");
              options.forEach((o: any) => {
                if (o.dataset.opt === correct) o.classList.add("correct");
              });
            }
            if (exp) exp.style.display = "block";
          };
        });
      });
      return;
    }
  } catch (err) {
    console.warn("Quiz load error:", err);
  }

  container.innerHTML = '<p style="font-size:13px;color:#c5221f;">生成测验失败，请检查网络后点击重新生成。</p>';
}

if ($("#openQuiz")) {
  $("#openQuiz").onclick = () => {
    $("#quizDialog")?.showModal();
    loadQuiz();
  };
}
if ($("#closeQuizBtn")) $("#closeQuizBtn").onclick = () => $("#quizDialog")?.close();
if ($("#finishQuizBtn")) $("#finishQuizBtn").onclick = () => $("#quizDialog")?.close();
if ($("#regenerateQuizBtn")) $("#regenerateQuizBtn").onclick = () => loadQuiz();

// ==========================================
// FEATURE 5: Flashcard Review Mode
// ==========================================
let currentFcIndex = 0;

function updateFlashcard() {
  if (!words.length) {
    if ($("#fcWord")) $("#fcWord").textContent = "暂无生词";
    if ($("#fcPhonetic")) $("#fcPhonetic").textContent = "";
    if ($("#fcMeaning")) $("#fcMeaning").textContent = "在阅读时点击单词加入收藏";
    if ($("#flashcardProgress")) $("#flashcardProgress").textContent = "0 / 0";
    return;
  }
  currentFcIndex = Math.max(0, Math.min(currentFcIndex, words.length - 1));
  const w = words[currentFcIndex];
  if ($("#fcWord")) $("#fcWord").textContent = w.text;
  if ($("#fcPhonetic")) $("#fcPhonetic").textContent = w.phonetic || `/${w.text}/`;
  if ($("#fcMeaning")) $("#fcMeaning").textContent = w.meaning || "未记录详细释义";
  if ($("#fcExample")) $("#fcExample").textContent = w.example ? `"${w.example}"` : "";
  if ($("#flashcardProgress")) {
    $("#flashcardProgress").textContent = `卡片 ${currentFcIndex + 1} / ${words.length}`;
  }

  // Reset flip
  $("#flashcardInner")?.classList.remove("flipped");
}

if ($("#openFlashcards")) {
  $("#openFlashcards").onclick = () => {
    if (!words.length) return alert("生词本还是空的，快去阅读中收藏生词吧！");
    currentFcIndex = 0;
    $("#flashcardDialog")?.showModal();
    updateFlashcard();
  };
}

if ($("#closeFlashcardBtn")) $("#closeFlashcardBtn").onclick = () => $("#flashcardDialog")?.close();

if ($("#flashcardStage")) {
  $("#flashcardStage").onclick = () => {
    $("#flashcardInner")?.classList.toggle("flipped");
  };
}

if ($("#fcSpeakBtn")) {
  $("#fcSpeakBtn").onclick = (e: Event) => {
    e.stopPropagation();
    if (words[currentFcIndex]) {
      speakWord(words[currentFcIndex].text);
    }
  };
}

if ($("#fcPrevBtn")) {
  $("#fcPrevBtn").onclick = () => {
    if (currentFcIndex > 0) {
      currentFcIndex--;
      updateFlashcard();
    }
  };
}

if ($("#fcNextBtn")) {
  $("#fcNextBtn").onclick = () => {
    if (currentFcIndex < words.length - 1) {
      currentFcIndex++;
      updateFlashcard();
    } else {
      alert("太棒了！你已复习完生词本中的所有卡片！");
      $("#flashcardDialog")?.close();
    }
  };
}

if ($("#fcRememberedBtn")) {
  $("#fcRememberedBtn").onclick = () => {
    if ($("#fcNextBtn")) $("#fcNextBtn").click();
  };
}

// Initial bootstrap
renderArticle();
renderNotes();
renderPanelVocab();
updateCounts();
updateModelBadge();
syncSettingsUI();
syncToolsPanelUI();
updateTranslationEngineUI();

try {
  const savedCollapsed = localStorage.getItem("lexi-panel-collapsed");
  if (savedCollapsed === "true") {
    setPanelCollapsed(true);
  }
} catch {}
