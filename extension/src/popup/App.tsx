import { useState, useEffect, useCallback, useRef } from "react";
import { LANGUAGES } from "../utils/languages";

interface TranscriptEntry {
  original: string;
  translated: string;
  timestamp: number;
}

type ExtStatus = "idle" | "connected" | "capturing" | "disconnected" | "error";
type TTSProvider = "minimax" | "speechmatics";

export default function App() {
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("es");
  const [status, setStatus] = useState<ExtStatus>("idle");
  const [isCapturing, setIsCapturing] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [currentOriginal, setCurrentOriginal] = useState("");
  const [currentTranslated, setCurrentTranslated] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Settings
  const [speechmaticsKey, setSpeechmaticsKey] = useState("");
  const [minimaxKey, setMinimaxKey] = useState("");
  const [minimaxGroupId, setMinimaxGroupId] = useState("");
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>("minimax");
  const [backendUrl, setBackendUrl] = useState("ws://localhost:8000");

  const transcriptRef = useRef<HTMLDivElement>(null);

  // Load saved settings
  useEffect(() => {
    chrome.storage.sync.get(
      [
        "sourceLang",
        "targetLang",
        "speechmaticsKey",
        "minimaxKey",
        "minimaxGroupId",
        "backendUrl",
        "ttsProvider",
      ],
      (data) => {
        if (data.sourceLang) setSourceLang(data.sourceLang);
        if (data.targetLang) setTargetLang(data.targetLang);
        if (data.speechmaticsKey) setSpeechmaticsKey(data.speechmaticsKey);
        if (data.minimaxKey) setMinimaxKey(data.minimaxKey);
        if (data.minimaxGroupId) setMinimaxGroupId(data.minimaxGroupId);
        if (data.backendUrl) setBackendUrl(data.backendUrl);
        if (data.ttsProvider === "speechmatics" || data.ttsProvider === "minimax") {
          setTtsProvider(data.ttsProvider);
        }
      }
    );

    // Force system-default routing mode (no per-device selection/detection in popup).
    chrome.runtime.sendMessage({
      type: "set-output-device",
      target: "background",
      deviceId: "",
    });

    // Get current state from background
    chrome.runtime.sendMessage({ type: "get-state", target: "background" }, (res) => {
      if (res) {
        setIsCapturing(res.isCapturing);
        setStatus(res.isCapturing ? "capturing" : "idle");
        if (res.ttsProvider === "speechmatics" || res.ttsProvider === "minimax") {
          setTtsProvider(res.ttsProvider);
        }
      }
    });

  }, []);

  // Listen for messages from background
  useEffect(() => {
    const listener = (message: any) => {
      if (message.target !== "popup") return;

      switch (message.type) {
        case "status":
          setStatus(message.status);
          if (message.status === "idle") setIsCapturing(false);
          if (message.status === "capturing") setIsCapturing(true);
          break;
        case "transcript":
          if (message.isFinal) {
            setCurrentOriginal((prev) => {
              const full = prev + " " + message.text;
              return full.trim();
            });
          } else {
            setCurrentOriginal(message.text);
          }
          break;
        case "translated-text":
          setCurrentTranslated(message.text);
          // Add to transcript history
          setTranscripts((prev) => [
            ...prev,
            {
              original: currentOriginal,
              translated: message.text,
              timestamp: Date.now(),
            },
          ]);
          setCurrentOriginal("");
          setCurrentTranslated("");
          break;
        case "translated-text-partial":
          setCurrentTranslated(message.text);
          break;
        case "error":
          setErrorMsg(message.message);
          setStatus("error");
          setTimeout(() => setErrorMsg(""), 5000);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [currentOriginal]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcripts, currentOriginal, currentTranslated]);

  // Start / Stop
  const handleToggle = useCallback(async () => {
    if (isCapturing) {
      chrome.runtime.sendMessage({
        type: "stop-capture",
        target: "background",
      });
    } else {
      setErrorMsg("");
      // Force system-default routing mode before starting.
      chrome.runtime.sendMessage({
        type: "set-output-device",
        target: "background",
        deviceId: "",
      });
      chrome.runtime.sendMessage({
        type: "start-capture",
        target: "background",
        sourceLang,
        targetLang,
        ttsProvider,
      });
    }
  }, [isCapturing, sourceLang, targetLang, ttsProvider]);

  // Swap languages
  const handleSwap = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    chrome.storage.sync.set({ sourceLang: targetLang, targetLang: sourceLang });
  };

  // Save settings
  const handleSaveSettings = () => {
    chrome.storage.sync.set({
      sourceLang,
      targetLang,
      speechmaticsKey,
      minimaxKey,
      minimaxGroupId,
      ttsProvider,
      backendUrl,
    });
    setShowSettings(false);
  };

  const getStatusText = (): string => {
    switch (status) {
      case "idle": return "Ready";
      case "connected": return "Connected to backend";
      case "capturing": return "Translating live…";
      case "disconnected": return "Disconnected";
      case "error": return errorMsg || "Error";
      default: return "Ready";
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <span className="header-icon">🌐</span>
        <div>
          <div className="header-title">Interpreter</div>
          <div className="header-subtitle">Live Translation</div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span className={`status-dot ${status}`} />
        <span>{getStatusText()}</span>
      </div>

      <div className="content">
        {/* Language Selector */}
        <div className="lang-section">
          <div className="lang-group">
            <span className="lang-label">From</span>
            <select
              className="lang-select"
              value={sourceLang}
              onChange={(e) => {
                setSourceLang(e.target.value);
                chrome.storage.sync.set({ sourceLang: e.target.value });
              }}
              disabled={isCapturing}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>

          <button className="lang-swap" onClick={handleSwap} disabled={isCapturing} title="Swap">
            ⇄
          </button>

          <div className="lang-group">
            <span className="lang-label">To</span>
            <select
              className="lang-select"
              value={targetLang}
              onChange={(e) => {
                setTargetLang(e.target.value);
                chrome.storage.sync.set({ targetLang: e.target.value });
              }}
              disabled={isCapturing}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Audio Output Device */}
        <div className="output-device-section">
          <div className="output-device-header">
            <span className="output-device-label">🔊 Translation Output</span>
          </div>
          <div className="output-routing-note" aria-live="polite">
            System Default (fixed)
          </div>
          <div className="device-hint warning">
            Set macOS output to BlackHole 2ch, then set Meet microphone to BlackHole 2ch.
          </div>
          <div className="device-hint warning">
            Popup device detection/selection is disabled because Chrome blocks it in this context.
          </div>
        </div>

        {/* Start/Stop Button */}
        <button
          className={`action-btn ${isCapturing ? "stop" : "start"}`}
          onClick={handleToggle}
        >
          {isCapturing ? "⏹  Stop Translation" : "▶  Start Translation"}
        </button>

        {/* Transcript */}
        <div className="transcript-section">
          <span className="transcript-label">Live Transcript</span>
          <div className="transcript-box" ref={transcriptRef}>
            {transcripts.length === 0 && !currentOriginal && (
              <div className="transcript-empty">
                Translations will appear here…
              </div>
            )}
            {transcripts.map((t, i) => (
              <div key={i} style={{ marginBottom: "8px" }}>
                <div className="transcript-original">{t.original}</div>
                <div className="transcript-translated">{t.translated}</div>
              </div>
            ))}
            {currentOriginal && (
              <div>
                <div className="transcript-original">{currentOriginal}</div>
                {currentTranslated && (
                  <div className="transcript-translated">{currentTranslated}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Settings Toggle */}
        <button
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙ {showSettings ? "Hide" : "Show"} Settings
        </button>

        {/* Settings Panel */}
        {showSettings && (
          <div className="settings-panel">
            <div className="settings-input-group">
              <label>TTS Provider</label>
              <select
                className="lang-select"
                value={ttsProvider}
                onChange={(e) => setTtsProvider(e.target.value as TTSProvider)}
                disabled={isCapturing}
              >
                <option value="minimax">MiniMax</option>
                <option value="speechmatics">Speechmatics</option>
              </select>
            </div>
            <div className="settings-input-group">
              <label>Speechmatics API Key</label>
              <input
                className="settings-input"
                type="password"
                placeholder="Enter key..."
                value={speechmaticsKey}
                onChange={(e) => setSpeechmaticsKey(e.target.value)}
              />
            </div>
            <div className="settings-input-group">
              <label>MiniMax API Key</label>
              <input
                className="settings-input"
                type="password"
                placeholder="Enter key..."
                value={minimaxKey}
                onChange={(e) => setMinimaxKey(e.target.value)}
              />
            </div>
            <div className="settings-input-group">
              <label>MiniMax Group ID</label>
              <input
                className="settings-input"
                type="text"
                placeholder="Enter group ID..."
                value={minimaxGroupId}
                onChange={(e) => setMinimaxGroupId(e.target.value)}
              />
            </div>
            <div className="settings-input-group">
              <label>Backend URL</label>
              <input
                className="settings-input"
                type="text"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
              />
            </div>
            <button className="settings-save" onClick={handleSaveSettings}>
              Save Settings
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        Powered by Speechmatics + MiniMax
      </div>
    </div>
  );
}
