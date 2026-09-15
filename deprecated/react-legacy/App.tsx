import React, { useState, useEffect } from "react";
import { SAMPLE_ARTICLES } from "./data/sampleArticles";
import {
  Article,
  WordAnalysis,
  SentenceAnalysis,
  VocabularyItem,
  ReaderSettings,
} from "./types";
import { Navbar } from "./components/Navbar";
import { ReaderView } from "./components/ReaderView";
import { WordDrawer } from "./components/WordDrawer";
import { SentenceModal } from "./components/SentenceModal";
import { VocabularyModal } from "./components/VocabularyModal";
import { SettingsModal } from "./components/SettingsModal";
import { LibraryModal } from "./components/LibraryModal";
import { ImportModal } from "./components/ImportModal";
import { speakEnglish } from "./utils/speech";

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: "serif",
  theme: "light",
  bilingualMode: "off",
  autoSpeakOnSelect: true,
};

export default function App() {
  const [articles, setArticles] = useState<Article[]>(SAMPLE_ARTICLES);
  const [currentArticle, setCurrentArticle] = useState<Article>(SAMPLE_ARTICLES[0]);
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem("reader_settings");
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>(() => {
    const saved = localStorage.getItem("reader_vocabulary");
    return saved ? JSON.parse(saved) : [];
  });

  const [apiConnected, setApiConnected] = useState(false);

  // Word drawer state
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [contextSentence, setContextSentence] = useState<string>("");
  const [wordAnalysis, setWordAnalysis] = useState<WordAnalysis | null>(null);
  const [loadingWord, setLoadingWord] = useState(false);
  const [wordError, setWordError] = useState<string | null>(null);

  // Sentence modal state
  const [activeSentence, setActiveSentence] = useState<string | null>(null);
  const [sentenceAnalysis, setSentenceAnalysis] = useState<SentenceAnalysis | null>(null);
  const [loadingSentence, setLoadingSentence] = useState(false);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

  // Modals state
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isVocabOpen, setIsVocabOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Check health on mount
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "ok") {
          setApiConnected(true);
        }
      })
      .catch((err) => {
        console.error("Health check failed:", err);
        setApiConnected(false);
      });
  }, []);

  // Save settings and vocab to localStorage
  useEffect(() => {
    localStorage.setItem("reader_settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("reader_vocabulary", JSON.stringify(vocabulary));
  }, [vocabulary]);

  // Handle word selection & fetch lookup
  const handleWordClick = async (rawWord: string, sentence: string) => {
    // Strip trailing punctuation
    const cleanWord = rawWord.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    if (!cleanWord || cleanWord.length < 2) return;

    setActiveWord(cleanWord);
    setContextSentence(sentence);
    setLoadingWord(true);
    setWordError(null);
    setWordAnalysis(null);

    if (settings.autoSpeakOnSelect) {
      speakEnglish(cleanWord);
    }

    try {
      const res = await fetch("/api/analyze-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: cleanWord, contextSentence: sentence }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "查词分析失败");
      }
      const data = await res.json();
      setWordAnalysis(data);
    } catch (err: any) {
      setWordError(err?.message || "网络异常");
    } finally {
      setLoadingWord(false);
    }
  };

  // Handle sentence analysis
  const handleSentenceClick = async (sentence: string) => {
    setActiveSentence(sentence);
    setLoadingSentence(true);
    setSentenceError(null);
    setSentenceAnalysis(null);

    try {
      const res = await fetch("/api/analyze-sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "语法解构失败");
      }
      const data = await res.json();
      setSentenceAnalysis(data);
    } catch (err: any) {
      setSentenceError(err?.message || "网络异常");
    } finally {
      setLoadingSentence(false);
    }
  };

  // Vocabulary handlers
  const handleSaveToVocab = (item: Omit<VocabularyItem, "id" | "addedAt">) => {
    const newItem: VocabularyItem = {
      ...item,
      id: `vocab-${Date.now()}`,
      addedAt: Date.now(),
    };
    setVocabulary((prev) => [newItem, ...prev.filter((v) => v.word.toLowerCase() !== item.word.toLowerCase())]);
  };

  const handleRemoveFromVocab = (word: string) => {
    setVocabulary((prev) => prev.filter((v) => v.word.toLowerCase() !== word.toLowerCase()));
  };

  const handleToggleMastered = (id: string) => {
    setVocabulary((prev) =>
      prev.map((item) => (item.id === id ? { ...item, mastered: !item.mastered } : item))
    );
  };

  const handleImportArticle = (newArticle: Article) => {
    setArticles((prev) => [newArticle, ...prev]);
    setCurrentArticle(newArticle);
  };

  const isWordSaved = Boolean(
    activeWord &&
      vocabulary.some((v) => v.word.toLowerCase() === activeWord.toLowerCase())
  );

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${
        settings.theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : settings.theme === "sepia"
          ? "bg-[#fbf7ee] text-[#3e3122]"
          : "bg-white text-stone-900"
      }`}
    >
      {/* Top Navigation */}
      <Navbar
        currentArticle={currentArticle}
        onOpenLibrary={() => setIsLibraryOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenVocabulary={() => setIsVocabOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        vocabCount={vocabulary.length}
        apiConnected={apiConnected}
        theme={settings.theme}
      />

      {/* Main Reading Stage */}
      <ReaderView
        article={currentArticle}
        settings={settings}
        onWordClick={handleWordClick}
        onSentenceClick={handleSentenceClick}
        activeWord={activeWord || undefined}
        onToggleBilingual={() =>
          setSettings((prev) => ({
            ...prev,
            bilingualMode: prev.bilingualMode === "parallel" ? "off" : "parallel",
          }))
        }
      />

      {/* Word Detail Drawer */}
      {activeWord && (
        <WordDrawer
          word={activeWord}
          contextSentence={contextSentence}
          analysis={wordAnalysis}
          loading={loadingWord}
          error={wordError}
          onClose={() => setActiveWord(null)}
          onSaveToVocab={handleSaveToVocab}
          onRemoveFromVocab={handleRemoveFromVocab}
          isSaved={isWordSaved}
          onAnalyzeSentence={(s) => {
            setActiveWord(null);
            handleSentenceClick(s);
          }}
          theme={settings.theme}
        />
      )}

      {/* Sentence Syntax Dissection Modal */}
      {activeSentence && (
        <SentenceModal
          sentence={activeSentence}
          analysis={sentenceAnalysis}
          loading={loadingSentence}
          error={sentenceError}
          onClose={() => setActiveSentence(null)}
          onWordClick={(w) => handleWordClick(w, activeSentence)}
          theme={settings.theme}
        />
      )}

      {/* Vocabulary Notebook */}
      {isVocabOpen && (
        <VocabularyModal
          vocabulary={vocabulary}
          onRemoveWord={handleRemoveFromVocab}
          onToggleMastered={handleToggleMastered}
          onClose={() => setIsVocabOpen(false)}
          theme={settings.theme}
        />
      )}

      {/* Reader Settings Modal */}
      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdateSettings={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Library Switcher Modal */}
      {isLibraryOpen && (
        <LibraryModal
          articles={articles}
          currentArticleId={currentArticle.id}
          onSelectArticle={(art) => setCurrentArticle(art)}
          onClose={() => setIsLibraryOpen(false)}
          theme={settings.theme}
        />
      )}

      {/* Custom Article Import Modal */}
      {isImportOpen && (
        <ImportModal
          onImport={handleImportArticle}
          onClose={() => setIsImportOpen(false)}
          theme={settings.theme}
        />
      )}
    </div>
  );
}
