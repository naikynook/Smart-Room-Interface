/**
 * Continuous speech listening via the Web Speech API.
 *
 * Wake:     "hello smart room"
 * Sleep:    "goodbye smart room"
 * See:      "what do you see" / "what can you see"
 * Download: "download dataset"
 */
export function startVoiceWake({
  onWake,
  onSleep,
  onSee,
  onDownload,
  onStatus,
  isAwake,
} = {}) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    onStatus?.(
      "Voice not supported here — try Chrome. Click still toggles the face."
    );
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  const WAKE = /\bhello\s+smart\s+room\b/;
  const SLEEP = /\bgood\s*-?\s*bye\s+smart\s+room\b/;
  const SEE = /\bwhat\s+(do\s+you\s+see|can\s+you\s+see|are\s+you\s+seeing)\b/;
  const DOWNLOAD = /\bdownload\s+(the\s+)?dataset\b/;

  let lastCommand = "";
  let lastAt = 0;
  let shouldRun = true;

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function maybeFire(kind, fn) {
    const now = Date.now();
    if (kind === lastCommand && now - lastAt < 2800) return;
    lastCommand = kind;
    lastAt = now;
    fn?.();
  }

  recognition.onresult = (event) => {
    let chunk = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      chunk += event.results[i][0].transcript;
    }
    const text = normalize(chunk);
    if (!text) return;

    if (WAKE.test(text)) {
      maybeFire("wake", onWake);
      return;
    }
    if (SLEEP.test(text)) {
      maybeFire("sleep", onSleep);
      return;
    }

    // Vision / dataset commands — prefer when awake, but allow download anytime
    if (SEE.test(text)) {
      if (isAwake && !isAwake()) {
        onStatus?.('Say "hello smart room" first, then ask what I see.');
        return;
      }
      maybeFire("see", onSee);
      return;
    }
    if (DOWNLOAD.test(text)) {
      maybeFire("download", onDownload);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      shouldRun = false;
      onStatus?.(
        "Microphone blocked — allow mic access, or click to toggle the face."
      );
      return;
    }
    if (event.error === "network") {
      onStatus?.("Speech network error — check connection. Click still works.");
    }
  };

  recognition.onend = () => {
    if (!shouldRun) return;
    window.setTimeout(() => {
      if (!shouldRun) return;
      try {
        recognition.start();
      } catch {
        // Already started
      }
    }, 200);
  };

  try {
    recognition.start();
    onStatus?.('Listening… say "hello smart room"');
  } catch {
    onStatus?.("Could not start voice listening. Click still toggles the face.");
    return null;
  }

  return {
    pause() {
      shouldRun = false;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    },
    resume() {
      if (!shouldRun) {
        shouldRun = true;
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    },
    stop() {
      shouldRun = false;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    },
  };
}
