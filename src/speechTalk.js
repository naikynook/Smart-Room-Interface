/**
 * Browser text-to-speech helper — prefers a male English voice,
 * with word-timed talk pulses for lip sync.
 */

let cachedVoices = null;

function loadVoices() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (voices.length) cachedVoices = voices;
  return cachedVoices || [];
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function scoreVoice(voice) {
  const name = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;

  if (/^en(-|_)/i.test(voice.lang)) score += 40;
  if (/en(-|_)us/i.test(voice.lang)) score += 30;

  // Strongly prefer male voices (closer to the default before voice picking)
  // Includes Apple's male voices so iPhones pick a similar character
  if (
    /microsoft david|microsoft mark|microsoft guy|google us english male|google uk english male|\bmale\b|daniel|alex(?!a)|fred|bruce|junior|ralph|tom|james|george|thomas|aaron|arthur|gordon|rishi|reed/.test(
      name
    )
  ) {
    score += 90;
  }

  if (/neural|natural|premium|enhanced|online \(natural\)/.test(name)) score += 25;
  if (/microsoft|google|apple/.test(name)) score += 10;

  // Push female / clearly feminine voices down
  if (
    /aria|jenny|sara|zira|samantha|karen|susan|hazel|helena|catherine|moira|fiona|veena|martha|linda|female|woman|girl/.test(
      name
    )
  ) {
    score -= 100;
  }

  if (/compact|whisper|zarvox|trinoids|bad news|good news/.test(name)) score -= 40;
  return score;
}

function pickVoice() {
  const voices = loadVoices();
  if (!voices.length) return null;
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

function splitPhrases(text) {
  const parts = String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [String(text)];
}

function wordStrength(word) {
  const clean = word.replace(/[^a-z']/gi, "");
  if (!clean) return 0.35;
  const vowels = (clean.match(/[aeiouy]/gi) || []).length;
  const openVowels = (clean.match(/[aeiou]/gi) || []).length;
  // Longer / vowel-heavy words open the mouth more
  return Math.min(1, 0.32 + openVowels * 0.2 + vowels * 0.06 + Math.min(clean.length, 7) * 0.03);
}

/**
 * Rough word timeline so lips can pulse even when onboundary is flaky.
 */
function buildWordSchedule(phrase, rate) {
  const words = phrase.match(/\S+/g) || [];
  const msPerUnit = 155 / Math.max(0.7, rate);
  let t = 40;
  return words.map((word) => {
    const clean = word.replace(/[^a-z']/gi, "");
    const units = Math.max(
      1,
      (clean.match(/[aeiouy]+/gi) || []).length || Math.ceil(clean.length / 3)
    );
    const at = t;
    const hold = units * msPerUnit * 0.55 + 50;
    t += units * msPerUnit + 28;
    return { word, at, hold, strength: wordStrength(word) };
  });
}

/**
 * Speak with male voice preference + word pulses for lip sync.
 * Options: onStart, onWord(strength, word), onEnd
 */
export function speak(text, { onStart, onWord, onEnd } = {}) {
  if (!window.speechSynthesis) {
    onEnd?.();
    return null;
  }

  window.speechSynthesis.cancel();

  const phrases = splitPhrases(text);
  let index = 0;
  let started = false;
  let cancelled = false;
  const timers = [];

  const clearTimers = () => {
    while (timers.length) {
      clearTimeout(timers.pop());
    }
  };

  const pulseWord = (strength, word) => {
    if (cancelled) return;
    onWord?.(strength, word);
  };

  const speakNext = () => {
    if (cancelled) return;
    clearTimers();
    if (index >= phrases.length) {
      onEnd?.();
      return;
    }

    const phrase = phrases[index++];
    const utterance = new SpeechSynthesisUtterance(phrase);
    // Pick per phrase — on iOS the voice list often only becomes available
    // after speech has been used once, so later phrases can upgrade
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || "en-US";

    const progress =
      phrases.length <= 1 ? 0.5 : (index - 1) / (phrases.length - 1);
    // Male register, slight variation so it is not monotone
    const rate = 0.92 + progress * 0.05 + (Math.random() * 0.04 - 0.02);
    utterance.rate = rate;
    utterance.pitch = 0.82 + Math.sin(progress * Math.PI) * 0.06 + (Math.random() * 0.04 - 0.02);
    utterance.volume = 1;

    const schedule = buildWordSchedule(phrase, rate);

    utterance.onstart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }

      // Timed word pulses — more reliable than onboundary alone
      for (const item of schedule) {
        timers.push(
          setTimeout(() => pulseWord(item.strength, item.word), item.at)
        );
      }
    };

    utterance.onboundary = (event) => {
      if (event.name !== "word") return;
      const slice = phrase.slice(event.charIndex);
      const word = (slice.match(/^\S+/) || [""])[0];
      // Nudge open if the engine reports a word (helps stay locked to audio)
      pulseWord(wordStrength(word), word);
    };

    utterance.onerror = () => {
      cancelled = true;
      clearTimers();
      onEnd?.();
    };

    utterance.onend = () => {
      if (cancelled) return;
      clearTimers();
      window.setTimeout(speakNext, 60);
    };

    window.speechSynthesis.speak(utterance);
  };

  if (!loadVoices().length) {
    timers.push(
      setTimeout(() => {
        if (!cancelled) speakNext();
      }, 120)
    );
  } else {
    speakNext();
  }

  return {
    stop() {
      cancelled = true;
      clearTimers();
      window.speechSynthesis.cancel();
    },
  };
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}

let speechUnlocked = false;

/**
 * Mobile browsers block speech synthesis until it is first used inside a
 * user gesture. Call this from a tap/click handler to unlock it.
 */
export function unlockSpeech() {
  if (speechUnlocked || !window.speechSynthesis) return;
  speechUnlocked = true;
  try {
    window.speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.rate = 2;
    // Priming also makes iOS populate its voice list for later speech
    u.onend = loadVoices;
    window.speechSynthesis.speak(u);
    loadVoices();
  } catch {
    // best effort — speech will still try on the next real utterance
  }
}

/**
 * Continuous "Goodbye user" as a single utterance (while the face dissolves).
 */
export function speakTunnelGoodbye({ onStart, onWord, onEnd } = {}) {
  if (!window.speechSynthesis) {
    onEnd?.();
    return null;
  }

  window.speechSynthesis.cancel();

  const voice = pickVoice();
  const utterance = new SpeechSynthesisUtterance("Goodbye user.");
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "en-US";
  utterance.rate = 0.94;
  utterance.pitch = 0.84;
  utterance.volume = 1;

  utterance.onstart = () => {
    onStart?.();
    onWord?.(0.7, "Goodbye");
  };

  utterance.onboundary = (event) => {
    if (event.name !== "word") return;
    const slice = "Goodbye user.".slice(event.charIndex);
    const word = (slice.match(/^\S+/) || [""])[0];
    onWord?.(wordStrength(word), word);
  };

  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);

  return {
    stop() {
      window.speechSynthesis.cancel();
    },
  };
}




