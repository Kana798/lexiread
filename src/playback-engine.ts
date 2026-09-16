// LexiRead · © 2026 LSJKANA · AGPL-3.0
type AudioEngine = Pick<HTMLAudioElement, 'pause' | 'play' | 'currentTime'>;
type SpeechEngine = Pick<SpeechSynthesis, 'pause' | 'resume'>;

export function pausePlaybackEngine(audio: AudioEngine | null, speech: SpeechEngine | null): void {
  if (audio) audio.pause();
  else speech?.pause();
}

export function resumePlaybackEngine(audio: AudioEngine | null, speech: SpeechEngine | null): void {
  if (audio) void audio.play();
  else speech?.resume();
}
