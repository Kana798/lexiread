// LexiRead · © 2026 LSJKANA · AGPL-3.0
/**
 * Edge TTS voice catalogue (Microsoft neural voices).
 *
 * Single source of truth shared by the renderer (to build the pickers) and the
 * server (to validate the requested voice before synthesising). Neural voices
 * sound close to human and are free — no API key — which is exactly what the
 * system speech engine could not deliver.
 */

export type VoiceGender = 'female' | 'male';

export interface VoiceOption {
  /** Edge TTS voice id, e.g. "en-GB-SoniaNeural". */
  id: string;
  /** BCP-47 tag of the accent, e.g. "en-GB". */
  accent: string;
  gender: VoiceGender;
  /** Short Chinese label for the picker. */
  label: string;
}

export const ACCENT_LABELS: Record<string, string> = {
  'en-US': '美音',
  'en-GB': '英音',
  'en-AU': '澳音',
};

/**
 * A deliberately short list: the three accents learners actually ask for, each
 * with a female and a male voice. A 24-voice catalogue looked impressive but
 * made the picker unwieldy.
 */
export const EDGE_VOICES: VoiceOption[] = [
  { id: 'en-US-AriaNeural', accent: 'en-US', gender: 'female', label: '美音 · 女声' },
  { id: 'en-US-GuyNeural', accent: 'en-US', gender: 'male', label: '美音 · 男声' },
  { id: 'en-GB-SoniaNeural', accent: 'en-GB', gender: 'female', label: '英音 · 女声' },
  { id: 'en-GB-RyanNeural', accent: 'en-GB', gender: 'male', label: '英音 · 男声' },
  { id: 'en-AU-NatashaNeural', accent: 'en-AU', gender: 'female', label: '澳音 · 女声' },
  { id: 'en-AU-WilliamNeural', accent: 'en-AU', gender: 'male', label: '澳音 · 男声' },
];

export const DEFAULT_VOICE_ID = 'en-US-AriaNeural';

const VOICE_IDS = new Set(EDGE_VOICES.map((v) => v.id));

/** Guards the synthesise endpoint against arbitrary voice strings. */
export function isKnownVoice(id: string): boolean {
  return VOICE_IDS.has(id);
}

/** Voices for one accent, females first then males. */
export function voicesByAccent(accent: string): VoiceOption[] {
  return EDGE_VOICES.filter((v) => v.accent === accent);
}

/** Accents that actually have at least one voice. */
export function availableAccents(): string[] {
  return Object.keys(ACCENT_LABELS).filter((a) => EDGE_VOICES.some((v) => v.accent === a));
}

/** Derives the Edge `lang` parameter from a voice id ("en-GB-SoniaNeural" → "en-GB"). */
export function langOfVoice(id: string): string {
  const parts = id.split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-US';
}
