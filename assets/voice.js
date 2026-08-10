/**
 * Voice intent via Web Speech API.
 */
const LuminaVoice = (() => {
  let recog = null;
  let listening = false;

  function supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function start({ onResult, onError, onEnd }) {
    if (!supported()) {
      onError?.("Speech recognition not supported in this browser");
      return false;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new Ctor();
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    listening = true;
    recog.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript || "";
      onResult?.(text);
    };
    recog.onerror = (e) => onError?.(e.error || "voice error");
    recog.onend = () => {
      listening = false;
      onEnd?.();
    };
    recog.start();
    return true;
  }

  function stop() {
    try {
      recog?.stop();
    } catch (_) {}
    listening = false;
  }

  function isListening() {
    return listening;
  }

  return { supported, start, stop, isListening };
})();
