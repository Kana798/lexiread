export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface Article {
  id: string;
  title: string;
  category: string;
  level: CEFRLevel;
  content: string;
  summary?: string;
  wordCount: number;
  readTimeMin: number;
}

export interface WordAnalysis {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  chineseDefinition: string;
  englishDefinition: string;
  contextualMeaning?: string;
  collocations?: string[];
  memoryTip?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  synonyms?: string[];
}

export interface SentenceStructure {
  subject?: string;
  predicate?: string;
  objectOrComplement?: string;
  adverbialOrModifier?: string;
  clauseAnalysis?: string;
}

export interface SentenceAnalysis {
  original: string;
  chineseTranslation: string;
  cefrLevel: string;
  structure: SentenceStructure;
  grammarExplanation: string[];
  keyWords: { word: string; meaning: string }[];
}

export interface SimplifiedResult {
  simplifiedText: string;
  targetLevel: string;
  summaryChinese: string;
  adaptations?: {
    originalPhrase: string;
    simplifiedPhrase: string;
    reason: string;
  }[];
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export interface VocabularyItem {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  chineseDefinition: string;
  englishDefinition?: string;
  contextSentence: string;
  sourceArticleTitle: string;
  addedAt: number;
  mastered: boolean;
}

export type ReadingTheme = "light" | "sepia" | "dark";
export type FontFamily = "serif" | "sans" | "mono";
export type BilingualMode = "off" | "parallel" | "hover";

export interface ReaderSettings {
  fontSize: number; // e.g. 18
  lineHeight: number; // e.g. 1.8
  fontFamily: FontFamily;
  theme: ReadingTheme;
  bilingualMode: BilingualMode;
  autoSpeakOnSelect: boolean;
}
