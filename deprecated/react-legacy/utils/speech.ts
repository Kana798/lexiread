// Speech synthesis utility for English audio playback

export function speakEnglish(text: string, rate: number = 0.9): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    console.warn("Speech synthesis not supported in this browser.");
    return;
  }

  window.speechSynthesis.cancel(); // Stop any pending speech

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.lang = "en-US";

  // Try to find a high quality English voice if available
  const voices = window.speechSynthesis.getVoices();
  const naturalVoice = voices.find(
    (v) =>
      v.lang.startsWith("en") &&
      (v.name.includes("Natural") ||
        v.name.includes("Google") ||
        v.name.includes("Samantha") ||
        v.name.includes("Daniel") ||
        v.name.includes("Premium"))
  );

  if (naturalVoice) {
    utterance.voice = naturalVoice;
  } else {
    const genericEn = voices.find((v) => v.lang.startsWith("en"));
    if (genericEn) utterance.voice = genericEn;
  }

  window.speechSynthesis.speak(utterance);
}
