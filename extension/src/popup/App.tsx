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

interface AudioDevice {
  deviceId: string;
  label: string;
}

type PickerMediaDevices = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

type ExtStatus = "idle" | "connected" | "capturing" | "disconnected" | "error";
const PICK_OUTPUT_OPTION_VALUE = "__pick_output_device__";

/* ═══════════════════════════════════════════
   SVG Icon Components
   ═══════════════════════════════════════════ */

const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const WaveformBars = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 32 20" fill="currentColor" className={`waveform-svg ${active ? "waveform-active" : ""}`}>
    <rect className="wf-bar" x="3" y="6" width="3" height="8" rx="1.5" />
    <rect className="wf-bar" x="8.5" y="3" width="3" height="14" rx="1.5" />
    <rect className="wf-bar" x="14" y="1" width="3" height="18" rx="1.5" />
    <rect className="wf-bar" x="19.5" y="4" width="3" height="12" rx="1.5" />
    <rect className="wf-bar" x="25" y="6.5" width="3" height="7" rx="1.5" />
  </svg>
);

const SwapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16l-4-4 4-4" />
    <path d="M17 8l4 4-4 4" />
    <path d="M3 12h18" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v14l11-7-11-7z" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const TranscriptIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

/* ═══════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════ */

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

  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");

  const [speechmaticsKey, setSpeechmaticsKey] = useState("");
  const [minimaxKey, setMinimaxKey] = useState("");
  const [minimaxGroupId, setMinimaxGroupId] = useState("");
  const [backendUrl, setBackendUrl] = useState("ws://localhost:8000");
  const canPickOutputDevice =
    typeof (navigator.mediaDevices as PickerMediaDevices).selectAudioOutput === "function";

  const [elapsed, setElapsed] = useState(0);
  const captureStartedAtRef = useRef<number | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const selectedDeviceRef = useRef("");

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
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  const applyOutputDevices = useCallback((devices: AudioDevice[]) => {
    setOutputDevices(devices);
    const selected = selectedDeviceRef.current;
    if (selected && devices.some((d) => d.deviceId === selected)) return;
    if (selected) return;
    const blackhole = devices.find((d) => d.label.toLowerCase().includes("blackhole"));
    if (!blackhole) return;
    selectedDeviceRef.current = blackhole.deviceId;
    setSelectedDevice(blackhole.deviceId);
    chrome.storage.sync.set({ outputDeviceId: blackhole.deviceId });
    chrome.runtime.sendMessage({
      type: "set-output-device",
      target: "background",
      deviceId: blackhole.deviceId,
    });
  }, []);

  const loadOutputDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const outputMap = new Map<string, AudioDevice>();
      for (const device of allDevices) {
        if (device.kind !== "audiooutput") continue;
        if (!device.deviceId || device.deviceId === "default") continue;
        if (outputMap.has(device.deviceId)) continue;
        outputMap.set(device.deviceId, {
          deviceId: device.deviceId,
          label: device.label || `Output ${device.deviceId.slice(0, 8)}`,
        });
      }
      applyOutputDevices(Array.from(outputMap.values()));
    } catch (err) {
      console.error("[Popup] Failed to enumerate output devices:", err);
    }
  }, [applyOutputDevices]);

  const pickOutputDevice = useCallback(async (): Promise<AudioDevice | null> => {
    const mediaDevices = navigator.mediaDevices as PickerMediaDevices;
    if (typeof mediaDevices.selectAudioOutput !== "function") return null;
    try {
      const picked = await mediaDevices.selectAudioOutput(
        selectedDeviceRef.current ? { deviceId: selectedDeviceRef.current } : undefined
      );
      return { deviceId: picked.deviceId, label: picked.label || "Selected output device" };
    } catch {
      return null;
    }
  }, []);

  const requestMicPermissionForLabels = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    chrome.storage.sync.get(
      ["sourceLang", "targetLang", "speechmaticsKey", "minimaxKey", "minimaxGroupId", "backendUrl", "outputDeviceId"],
      (data) => {
        if (data.sourceLang) setSourceLang(data.sourceLang);
        if (data.targetLang) setTargetLang(data.targetLang);
        if (data.speechmaticsKey) setSpeechmaticsKey(data.speechmaticsKey);
        if (data.minimaxKey) setMinimaxKey(data.minimaxKey);
        if (data.minimaxGroupId) setMinimaxGroupId(data.minimaxGroupId);
        if (data.backendUrl) setBackendUrl(data.backendUrl);
        if (data.outputDeviceId) {
          selectedDeviceRef.current = data.outputDeviceId;
          setSelectedDevice(data.outputDeviceId);
        }
        void loadOutputDevices();
      }
    );
    chrome.runtime.sendMessage({ type: "get-state", target: "background" }, (res) => {
      if (res) {
        if (res.captureStartedAt) {
          captureStartedAtRef.current = res.captureStartedAt;
        }
        setIsCapturing(res.isCapturing);
        setStatus(res.isCapturing ? "capturing" : "idle");
      }
    });
  }, [loadOutputDevices]);

  const refreshDevices = async () => {
    await loadOutputDevices();
    if (canPickOutputDevice) {
      const picked = await pickOutputDevice();
      if (!picked) return;
      selectedDeviceRef.current = picked.deviceId;
      setSelectedDevice(picked.deviceId);
      chrome.storage.sync.set({ outputDeviceId: picked.deviceId });
      chrome.runtime.sendMessage({
        type: "set-output-device",
        target: "background",
        deviceId: picked.deviceId,
      });
      await loadOutputDevices();
      return;
    }
    const granted = await requestMicPermissionForLabels();
    await loadOutputDevices();
    if (!granted) {
      setErrorMsg("Use System Default and set macOS output to BlackHole 2ch.");
      setStatus("error");
      setTimeout(() => setErrorMsg(""), 7000);
    }
  };

  const handleDeviceChange = async (deviceId: string) => {
    if (deviceId === PICK_OUTPUT_OPTION_VALUE) {
      await refreshDevices();
      return;
    }
    setSelectedDevice(deviceId);
    chrome.storage.sync.set({ outputDeviceId: deviceId });
    chrome.runtime.sendMessage({
      type: "set-output-device",
      target: "background",
      deviceId,
    });
  };

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
            setCurrentOriginal((prev) => (prev + " " + message.text).trim());
          } else {
            setCurrentOriginal(message.text);
          }
          break;
        case "translated-text":
          setCurrentTranslated(message.text);
          setTranscripts((prev) => [
            ...prev,
            { original: currentOriginal, translated: message.text, timestamp: Date.now() },
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

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcripts, currentOriginal, currentTranslated]);

  const handleToggle = useCallback(async () => {
    if (isCapturing) {
      chrome.runtime.sendMessage({ type: "stop-capture", target: "background" });
    } else {
      setErrorMsg("");
      captureStartedAtRef.current = Date.now();
      setIsCapturing(true);
      setStatus("capturing");
      if (selectedDevice) {
        chrome.runtime.sendMessage({
          type: "set-output-device",
          target: "background",
          deviceId: selectedDevice,
        });
      }
      chrome.runtime.sendMessage({
        type: "start-capture",
        target: "background",
        sourceLang,
        targetLang,
      });
    }
  }, [isCapturing, sourceLang, targetLang, selectedDevice]);

  const handleSwap = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    chrome.storage.sync.set({ sourceLang: targetLang, targetLang: sourceLang });
  };

  const handleSaveSettings = () => {
    chrome.storage.sync.set({
      sourceLang,
      targetLang,
      speechmaticsKey,
      minimaxKey,
      minimaxGroupId,
      backendUrl,
      outputDeviceId: selectedDevice,
    });
    setShowSettings(false);
  };

  const getStatusText = (): string => {
    switch (status) {
      case "idle": return "Ready";
      case "connected": return "Connected";
      case "capturing": return "Translating live";
      case "disconnected": return "Disconnected";
      case "error": return errorMsg || "Error";
      default: return "Ready";
    }
  };

  const getSelectedDeviceLabel = (): string => {
    const device = outputDevices.find((d) => d.deviceId === selectedDevice);
    return device?.label || "Default";
  };

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-logo">
          <GlobeIcon />
        </div>
        <div className="header-text">
          <div className="header-title">Interpreter</div>
          <div className="header-subtitle">Live Translation</div>
        </div>
        {isCapturing && (
          <span className="header-timer">{formatDuration(elapsed)}</span>
        )}
        <div className={`header-waveform ${isCapturing ? "active" : ""}`}>
          <WaveformBars active={isCapturing} />
        </div>
      </div>

      {/* Status */}
      <div className="status-bar">
        <span className={`status-dot ${status}`} />
        <span>{getStatusText()}</span>
      </div>

      <div className="content">
        {/* Languages */}
        <div>
          <div className="section-label">Languages</div>
          <div className="lang-section" style={{ marginTop: 6 }}>
            <div className="lang-group">
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

            <button className="lang-swap" onClick={handleSwap} disabled={isCapturing} title="Swap languages">
              <SwapIcon />
            </button>

            <div className="lang-group">
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
        </div>

        {/* Output Device */}
        <div className="output-section">
          <div className="output-header">
            <span className="section-label">
              <SpeakerIcon />
              Output
            </span>
            <button className="refresh-btn" onClick={refreshDevices} title="Refresh devices">
              <RefreshIcon />
            </button>
          </div>
          <select
            className="output-select"
            value={selectedDevice}
            onChange={(e) => void handleDeviceChange(e.target.value)}
            disabled={isCapturing}
          >
            <option value="">System Default</option>
            {canPickOutputDevice && (
              <option value={PICK_OUTPUT_OPTION_VALUE}>Choose Output Device…</option>
            )}
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          {selectedDevice && getSelectedDeviceLabel().toLowerCase().includes("blackhole") && (
            <div className="device-hint success">BlackHole selected — set Meet mic to BlackHole too</div>
          )}
          {!selectedDevice && outputDevices.length > 0 && (
            <div className="device-hint warning">Select BlackHole to route audio into a call</div>
          )}
        </div>

        {/* Action */}
        <button
          className={`action-btn ${isCapturing ? "stop" : "start"}`}
          onClick={handleToggle}
        >
          <span className="btn-content">
            {isCapturing ? <StopIcon /> : <PlayIcon />}
            {isCapturing ? "Stop Translation" : "Start Translation"}
          </span>
        </button>

        {/* Transcript */}
        <div className="transcript-section">
          <span className="section-label">
            <TranscriptIcon />
            Live Transcript
          </span>
          <div className="transcript-box" ref={transcriptRef}>
            {transcripts.length === 0 && !currentOriginal && (
              <div className="transcript-empty">
                <WaveformBars active={false} />
                <div>Translations will appear here</div>
              </div>
            )}
            {transcripts.map((t, i) => (
              <div key={i} className="transcript-entry">
                <div className="transcript-original">{t.original}</div>
                <div className="transcript-translated">{t.translated}</div>
              </div>
            ))}
            {currentOriginal && (
              <div className="transcript-entry">
                <div className="transcript-original">{currentOriginal}</div>
                {currentTranslated && (
                  <div className="transcript-translated">{currentTranslated}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="divider" />

        {/* Settings Toggle */}
        <button
          className={`settings-toggle ${showSettings ? "open" : ""}`}
          onClick={() => setShowSettings(!showSettings)}
        >
          <GearIcon />
          {showSettings ? "Hide Settings" : "Settings"}
        </button>

        {/* Settings Panel */}
        {showSettings && (
          <div className="settings-panel">
            <div className="settings-group">
              <label>Speechmatics API Key</label>
              <input
                className="settings-input"
                type="password"
                placeholder="Enter key..."
                value={speechmaticsKey}
                onChange={(e) => setSpeechmaticsKey(e.target.value)}
              />
            </div>
            <div className="settings-group">
              <label>MiniMax API Key</label>
              <input
                className="settings-input"
                type="password"
                placeholder="Enter key..."
                value={minimaxKey}
                onChange={(e) => setMinimaxKey(e.target.value)}
              />
            </div>
            <div className="settings-group">
              <label>MiniMax Group ID</label>
              <input
                className="settings-input"
                type="text"
                placeholder="Optional"
                value={minimaxGroupId}
                onChange={(e) => setMinimaxGroupId(e.target.value)}
              />
            </div>
            <div className="settings-group">
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
      <div className="footer">Speechmatics + MiniMax</div>
    </div>
  );
}
