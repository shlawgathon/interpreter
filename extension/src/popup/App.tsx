import { useState, useEffect, useCallback, useRef } from "react";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
import { LANGUAGES } from "../utils/languages";

interface TranscriptEntry {
  original: string;
  translated: string;
  timestamp: number;
}

type ExtStatus = "idle" | "connected" | "capturing" | "disconnected" | "error";
type TTSProvider = "minimax" | "speechmatics";

function IconGlobe({ className = "icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 12h18M12 3c2.8 2.5 4.2 5.5 4.2 9s-1.4 6.5-4.2 9M12 3C9.2 5.5 7.8 8.5 7.8 12s1.4 6.5 4.2 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconVolume({ className = "icon icon-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5zM17 9a4 4 0 010 6M19 7a7 7 0 010 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlay({ className = "icon icon-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6l10 6-10 6V6z" fill="currentColor" />
    </svg>
  );
}

function IconStop({ className = "icon icon-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" fill="currentColor" />
    </svg>
  );
}

function IconSettings({ className = "icon icon-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.8V6M12 18V20.2M3.8 12H6M18 12h2.2M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M6.3 17.7l1.6-1.6M16.1 7.9l1.6-1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconSwap({ className = "icon icon-sm" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h11M16 4l3 3-3 3M16 17H5M8 14l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>("speechmatics");
  const [backendUrl, setBackendUrl] = useState("ws://localhost:8000");

  const [elapsed, setElapsed] = useState(0);
  const captureStartedAtRef = useRef<number | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const currentOriginalRef = useRef("");

  // Duration timer — driven by background's captureStartedAt
  useEffect(() => {
    if (!isCapturing || !captureStartedAtRef.current) {
      setElapsed(0);
      return;
    }
    // compute immediately so we don't wait 1s on popup reopen
    setElapsed(Math.floor((Date.now() - captureStartedAtRef.current) / 1000));
    const id = setInterval(() => {
      if (captureStartedAtRef.current) {
        setElapsed(Math.floor((Date.now() - captureStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isCapturing]);

  useEffect(() => {
    currentOriginalRef.current = currentOriginal;
  }, [currentOriginal]);

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
        if (res.captureStartedAt) {
          captureStartedAtRef.current = res.captureStartedAt;
        }
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
          if (message.status === "capturing") setIsCapturing(true);
          if (message.status === "idle" || message.status === "disconnected" || message.status === "error") {
            setIsCapturing(false);
          }
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
              original: currentOriginalRef.current,
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
          setIsCapturing(false);
          setTimeout(() => setErrorMsg(""), 5000);
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcripts, currentOriginal, currentTranslated]);

  // Start / Stop
  const handleToggle = useCallback(async () => {
    if (isCapturing) {
      setIsCapturing(false);
      setStatus("idle");
      chrome.runtime.sendMessage({
        type: "stop-capture",
        target: "background",
      });
    } else {
      setErrorMsg("");
      captureStartedAtRef.current = Date.now();
      setIsCapturing(true);
      setStatus("capturing");
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
        <span className="header-icon"><IconGlobe /></span>
        <div>
          <div className="header-title">Interpreter</div>
          <div className="header-subtitle">Live Translation</div>
        </div>
        {isCapturing && (
          <span className="header-timer">{formatDuration(elapsed)}</span>
        )}
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
            <IconSwap />
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
            <span className="output-device-label"><IconVolume /> Translation Output</span>
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
          <span className="action-btn-inner">
            {isCapturing ? <IconStop /> : <IconPlay />}
            <span>{isCapturing ? "Stop Translation" : "Start Translation"}</span>
          </span>
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
          <IconSettings />
          <span>{showSettings ? "Hide" : "Show"} Settings</span>
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
