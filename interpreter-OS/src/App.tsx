import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import "./App.css";

type CaptureTarget = {
  id: string;
  kind: "system" | "application";
  name: string;
  detail: string;
  pid?: number | null;
  bundleId?: string | null;
};

type StatusPayload = {
  stage: string;
  message: string;
};

type TranscriptPayload = {
  transcript: string;
  translation: string;
  finalSegment: boolean;
  detectedLanguage?: string | null;
  latencyMs?: number | null;
  receivedAt: number;
};

type AudioLevelPayload = {
  rms: number;
  peak: number;
};

type TtsPayload = {
  audioBase64: string;
  mimeType: string;
};

type AudioFormatPayload = {
  sampleRate: number;
  channelCount: number;
  bitsPerChannel: number;
  floatFormat: boolean;
};

type TranscriptCard = TranscriptPayload & {
  id: string;
};

const LANGUAGE_OPTIONS = [
  ["auto", "Auto detect"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["zh", "Chinese (Mandarin)"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["ru", "Russian"],
  ["nl", "Dutch"],
  ["sv", "Swedish"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
] as const;

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

const TranscriptIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ═══════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════ */

function App() {
  const [targets, setTargets] = useState<CaptureTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [status, setStatus] = useState<StatusPayload>({
    stage: "idle",
    message: "Pick a source and start a translation session.",
  });
  const [entries, setEntries] = useState<TranscriptCard[]>([]);
  const [partial, setPartial] = useState<TranscriptPayload | null>(null);
  const [selectedTarget, setSelectedTarget] = useState("system::default");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [relayUrl, setRelayUrl] = useState(
    import.meta.env.VITE_RELAY_BASE_URL ?? "http://127.0.0.1:8787",
  );
  const [voiceId, setVoiceId] = useState("");
  const [ttsProvider, setTtsProvider] = useState("smallest");
  const [sttProvider, setSttProvider] = useState("smallest");
  const [speakTranslation, setSpeakTranslation] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<AudioLevelPayload>({ rms: 0, peak: 0 });
  const [audioFormat, setAudioFormat] = useState<AudioFormatPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [muteSystemAudio, setMuteSystemAudio] = useState(false);
  const mutedOutputRef = useRef(false);
  const audioQueueRef = useRef(Promise.resolve());
  const ttsAbortRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const gearIconRef = useRef<SVGSVGElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);

  const avgLatency = useMemo(() => {
    const values = entries
      .map((entry) => entry.latencyMs)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  }, [entries]);

  // GSAP: Animate settings panel collapse/expand
  useLayoutEffect(() => {
    const wrapper = settingsPanelRef.current;
    if (!wrapper) return;
    if (showSettings) {
      // Expand
      gsap.set(wrapper, { display: "block", overflow: "hidden" });
      gsap.fromTo(wrapper,
        { height: 0, opacity: 0 },
        { height: "auto", opacity: 1, duration: 0.35, ease: "power3.out",
          onComplete: () => {
            gsap.set(wrapper, { overflow: "auto" });
          } },
      );
      const panel = wrapper.querySelector(".settings-panel");
      if (panel) {
        gsap.fromTo(
          panel.children,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power2.out", delay: 0.08 },
        );
      }
    } else {
      // Collapse
      gsap.to(wrapper, {
        height: 0, opacity: 0, duration: 0.25, ease: "power2.in",
        onComplete: () => {
          gsap.set(wrapper, { display: "none" });
        },
      });
    }
  }, [showSettings]);

  // GSAP: Pulse start/stop button on state change
  useEffect(() => {
    if (startBtnRef.current) {
      gsap.fromTo(
        startBtnRef.current,
        { scale: 0.95 },
        { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.5)" },
      );
    }
  }, [isRunning]);

  // GSAP: Animate new transcript entries
  const prevEntryCountRef = useRef(0);
  useEffect(() => {
    if (entries.length > prevEntryCountRef.current && transcriptRef.current) {
      const lastEntry = transcriptRef.current.querySelector(".transcript-entry:last-child");
      if (lastEntry) {
        gsap.fromTo(
          lastEntry,
          { opacity: 0, x: -12 },
          { opacity: 1, x: 0, duration: 0.35, ease: "power2.out" },
        );
      }
    }
    prevEntryCountRef.current = entries.length;
  }, [entries.length]);

  const getStatusText = (): string => {
    switch (status.stage) {
      case "idle": return "Ready";
      case "connecting": return "Connecting...";
      case "connected": return "Connected";
      case "capturing": return "Translating live";
      case "stopped": return "Stopped";
      case "error": return status.message || "Error";
      default: return status.message || status.stage;
    }
  };

  const statusClass = useMemo(() => {
    const s = status.stage;
    if (s === "capturing") return "capturing";
    if (s === "connected" || s === "relay_ready") return "connected";
    if (s === "error") return "error";
    if (s === "stopped") return "stopped";
    return "idle";
  }, [status.stage]);

  const restoreMutedAudio = useCallback(async () => {
    if (!mutedOutputRef.current) return;

    try {
      await invoke("unmute_restore_device");
    } catch (error) {
      console.error("Failed to restore original output device", error);
    } finally {
      mutedOutputRef.current = false;
    }
  }, []);

  async function loadTargets() {
    setTargetsLoading(true);
    setErrorMessage(null);
    try {
      const nextTargets = await invoke<CaptureTarget[]>("list_capture_targets");
      setTargets(nextTargets);
      if (!nextTargets.some((target) => target.id === selectedTarget)) {
        setSelectedTarget(nextTargets[0]?.id ?? "system::default");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatus({ stage: "error", message });
    } finally {
      setTargetsLoading(false);
    }
  }

  async function queueTtsClip(payload: TtsPayload) {
    if (!payload.audioBase64) return;

    audioQueueRef.current = audioQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (ttsAbortRef.current) return; // Session ended, skip queued clips
        try {
          await invoke("play_tts_to_real_device", {
            audioBase64: payload.audioBase64,
            mimeType: payload.mimeType || "audio/wav",
          });
        } catch (e) {
          console.error("TTS playback error:", e);
        }
      });
  }

  async function startSession() {
    setErrorMessage(null);
    setEntries([]);
    setPartial(null);
    ttsAbortRef.current = false;
    audioQueueRef.current = Promise.resolve();
    setLevels({ rms: 0, peak: 0 });
    setAudioFormat(null);

    // Mute via BlackHole if the toggle is on
    if (muteSystemAudio) {
      try {
        const success = await invoke<boolean>("mute_via_blackhole");
        if (success) {
          mutedOutputRef.current = true;
        } else {
          console.warn("BlackHole not found — original audio won't be muted");
        }
      } catch (e) {
        console.error("Failed to mute via BlackHole", e);
      }
    }

    try {
      await invoke("start_translation_session", {
        request: {
          relayUrl,
          targetId: selectedTarget,
          sourceLanguage,
          targetLanguage,
          speakTranslation,
          voiceId: voiceId.trim() || null,
          ttsProvider,
          sttProvider,
        },
      });
      setSessionStartedAt(Date.now());
      setElapsedMs(0);
      setIsRunning(true);
    } catch (error) {
      await restoreMutedAudio();
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatus({ stage: "error", message });
    }
  }

  async function stopSession() {
    // Abort any queued/pending TTS clips immediately
    ttsAbortRef.current = true;
    audioQueueRef.current = Promise.resolve();

    try {
      await invoke("stop_translation_session");
    } finally {
      await restoreMutedAudio();
      setIsRunning(false);
      setSessionStartedAt(null);
      setElapsedMs(0);
      setPartial(null);
      setLevels({ rms: 0, peak: 0 });
      setStatus({ stage: "stopped", message: "Session stopped." });
    }
  }

  const handleSwap = useCallback(() => {
    if (sourceLanguage === "auto") return;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  }, [sourceLanguage, targetLanguage]);

  useEffect(() => {
    void loadTargets();
  }, []);

  useEffect(() => {
    if (!isRunning || sessionStartedAt === null) return;
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - sessionStartedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRunning, sessionStartedAt]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [entries, partial]);

  useEffect(() => () => {
    void restoreMutedAudio();
  }, [restoreMutedAudio]);

  useEffect(() => {
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];

    const attach = async () => {
      unlisteners.push(
        await listen<StatusPayload>("session-status", ({ payload }) => {
          if (!mounted) return;
          setStatus(payload);
          if (payload.stage === "relay_closed" || payload.stage === "stopped") {
            void restoreMutedAudio();
            setIsRunning(false);
            setSessionStartedAt(null);
          }
        }),
      );

      unlisteners.push(
        await listen<TranscriptPayload>("session-transcript", ({ payload }) => {
          if (!mounted) return;

          startTransition(() => {
            if (payload.finalSegment) {
              setEntries((current) => [
                ...current,
                {
                  ...payload,
                  id: `${payload.receivedAt}-${current.length}`,
                },
              ].slice(-50));
              setPartial(null);
              return;
            }

            setPartial((current) => {
              if (
                current?.transcript === payload.transcript &&
                current?.translation === payload.translation &&
                current?.finalSegment === payload.finalSegment
              ) {
                return current;
              }

              return payload;
            });
          });
        }),
      );

      unlisteners.push(
        await listen<AudioLevelPayload>("session-level", ({ payload }) => {
          if (mounted) setLevels(payload);
        }),
      );

      unlisteners.push(
        await listen<AudioFormatPayload>("session-audio-format", ({ payload }) => {
          if (mounted) setAudioFormat(payload);
        }),
      );

      unlisteners.push(
        await listen<TtsPayload>("session-tts", ({ payload }) => {
          if (mounted) void queueTtsClip(payload);
        }),
      );
    };

    void attach();

    return () => {
      mounted = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [restoreMutedAudio]);

  return (
    <main className="shell">
      <section className="widget">
        {/* Header */}
        <header className="topbar">
          <div className="header-logo">
            <GlobeIcon />
          </div>
          <div className="header-info">
            <h1>Interpreter OS</h1>
            <p className="eyebrow">System Audio Translation</p>
          </div>
          {isRunning && (
            <span className="header-timer">{formatDuration(elapsedMs)}</span>
          )}
          <div className={`header-waveform ${isRunning ? "active" : ""}`}>
            <WaveformBars active={isRunning} />
          </div>
        </header>

        {/* Status bar */}
        <div className="status-bar">
          <span className={`status-dot ${statusClass}`} />
          <span>{getStatusText()}</span>
        </div>

        {/* Content */}
        <div className="content">
          {/* Capture Target */}
          <div className="capture-section">
            <div className="capture-header">
              <span className="section-label">
                <MicIcon />
                Capture Target
              </span>
              <button
                className="refresh-btn"
                type="button"
                onClick={() => void loadTargets()}
                disabled={targetsLoading || isRunning}
                title="Refresh targets"
              >
                <RefreshIcon />
              </button>
            </div>
            <select
              className="capture-select"
              value={selectedTarget}
              disabled={targetsLoading || targets.length === 0 || isRunning}
              onChange={(event) => setSelectedTarget(event.currentTarget.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
            <div className="capture-hint">
              {targets.find((target) => target.id === selectedTarget)?.detail ??
                "Select Entire System to mirror any audible app."}
            </div>
          </div>

          {/* Languages */}
          <div>
            <div className="section-label">Languages</div>
            <div className="lang-section">
              <div className="lang-group">
                <select
                  className="lang-select"
                  value={sourceLanguage}
                  disabled={isRunning}
                  onChange={(event) => setSourceLanguage(event.currentTarget.value)}
                >
                  {LANGUAGE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <button
                className="lang-swap"
                onClick={handleSwap}
                disabled={isRunning || sourceLanguage === "auto"}
                title="Swap languages"
              >
                <SwapIcon />
              </button>

              <div className="lang-group">
                <select
                  className="lang-select"
                  value={targetLanguage}
                  disabled={isRunning}
                  onChange={(event) => setTargetLanguage(event.currentTarget.value)}
                >
                  {LANGUAGE_OPTIONS.filter(([value]) => value !== "auto").map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Audio meter */}
          <div className="meter">
            <div className="meter-label">
              <span>Audio</span>
              <span>{Math.round(levels.peak * 100)}%</span>
            </div>
            <div className="meter-track">
              <div className="meter-fill meter-rms" style={{ width: `${Math.max(4, levels.rms * 100)}%` }} />
              <div className="meter-fill meter-peak" style={{ width: `${Math.max(6, levels.peak * 100)}%` }} />
            </div>
          </div>

          {/* Action Button */}
          <button
            className={`action-btn ${isRunning ? "stop" : "start"}`}
            type="button"
            ref={startBtnRef}
            disabled={(!isRunning && (targetsLoading || !relayUrl))}
            onClick={() => isRunning ? void stopSession() : void startSession()}
          >
            <span className="btn-content">
              {isRunning ? <StopIcon /> : <PlayIcon />}
              {isRunning ? "Stop Translation" : "Start Translation"}
            </span>
          </button>

          {/* Stats */}
          <div className="stats">
            <article>
              <strong>{formatDuration(elapsedMs)}</strong>
              <span>Runtime</span>
            </article>
            <article>
              <strong>{avgLatency ? `${avgLatency}ms` : "--"}</strong>
              <span>Latency</span>
            </article>
            <article>
              <strong>{audioFormat ? `${audioFormat.sampleRate / 1000}k` : "--"}</strong>
              <span>{audioFormat ? `${audioFormat.channelCount}ch` : "Format"}</span>
            </article>
          </div>

          {/* Error */}
          {errorMessage && <div className="error-banner">{errorMessage}</div>}

          {/* Transcript - hidden when settings open */}
          {!showSettings && <div className="transcript-section">
            <div className="transcript-header">
              <span className="section-label">
                <TranscriptIcon />
                Live Transcript
              </span>
              <span className="mode-label">
                {speakTranslation ? "Caption + voice" : "Caption only"}
              </span>
            </div>
            <div className="transcript-box" ref={transcriptRef}>
              {entries.length === 0 && !partial ? (
                <div className="transcript-empty">
                  <WaveformBars active={false} />
                  <div>Translations will appear here</div>
                </div>
              ) : (
                entries.map((entry) => (
                  <div className="transcript-entry" key={entry.id}>
                    <div className="transcript-meta">
                      <span>{entry.detectedLanguage || "auto"}</span>
                      <span>{entry.latencyMs ? `${entry.latencyMs}ms` : "live"}</span>
                    </div>
                    <div className="transcript-original">{entry.transcript}</div>
                    <div className="transcript-translated">{entry.translation}</div>
                  </div>
                ))
              )}
              {partial && (
                <div className="transcript-entry partial">
                  <div className="transcript-original">{partial.transcript || "Listening..."}</div>
                  <div className="transcript-translated">{partial.translation || "..."}</div>
                </div>
              )}
            </div>
          </div>}

          <div className="divider" />

          {/* Settings Toggle */}
          <button
            className={`settings-toggle ${showSettings ? "open" : ""}`}
            onClick={() => {
              const next = !showSettings;
              setShowSettings(next);
              if (gearIconRef.current) {
                gsap.to(gearIconRef.current, {
                  rotation: next ? 90 : 0,
                  duration: 0.4,
                  ease: "back.out(1.7)",
                });
              }
            }}
            type="button"
          >
            <svg ref={gearIconRef} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {showSettings ? "Hide Settings" : "Settings"}
          </button>

          {/* Settings Panel — always rendered, animated with GSAP */}
          <div ref={settingsPanelRef} style={{ overflow: "hidden", height: 0, opacity: 0, display: "none" }}>
            <div className="settings-panel">
              <div className="settings-group">
                <label>Relay URL</label>
                <input
                  className="settings-input"
                  value={relayUrl}
                  disabled={isRunning}
                  onChange={(event) => setRelayUrl(event.currentTarget.value)}
                  placeholder="http://127.0.0.1:8787"
                />
              </div>
              <div className="settings-group">
                <label>Voice ID (optional)</label>
                <input
                  className="settings-input"
                  value={voiceId}
                  disabled={isRunning}
                  onChange={(event) => setVoiceId(event.currentTarget.value)}
                  placeholder="Leave blank for default"
                />
              </div>
              <div className="settings-group">
                <label>TTS Provider</label>
                <select
                  className="lang-select"
                  value={ttsProvider}
                  disabled={isRunning}
                  onChange={(event) => setTtsProvider(event.currentTarget.value)}
                >
                  <option value="smallest">Smallest AI (Lightning)</option>
                  <option value="elevenlabs">ElevenLabs (Flash v2.5)</option>
                </select>
              </div>
              <div className="settings-group">
                <label>STT Provider</label>
                <select
                  className="lang-select"
                  value={sttProvider}
                  disabled={isRunning}
                  onChange={(event) => setSttProvider(event.currentTarget.value)}
                >
                  <option value="smallest">Smallest AI (Pulse)</option>
                  <option value="elevenlabs">ElevenLabs (Scribe v2)</option>
                </select>
              </div>
              <label className="toggle-row">
                <input
                  checked={speakTranslation}
                  type="checkbox"
                  disabled={isRunning}
                  onChange={(event) => setSpeakTranslation(event.currentTarget.checked)}
                />
                <span>Play translated voice</span>
              </label>
              <label className="toggle-row">
                <input
                  checked={muteSystemAudio}
                  type="checkbox"
                  disabled={isRunning}
                  onChange={(event) => setMuteSystemAudio(event.currentTarget.checked)}
                />
                <span>Mute original audio</span>
              </label>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="footer">Smallest AI + Jade</div>
      </section>
    </main>
  );
}

export default App;
