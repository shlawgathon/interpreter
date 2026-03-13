import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
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

type TranscriptCard = TranscriptPayload & {
  id: string;
};

const LANGUAGE_OPTIONS = [
  ["auto", "Auto detect"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["hi", "Hindi"],
  ["pt", "Portuguese"],
  ["zh", "Mandarin"],
] as const;

function App() {
  const [targets, setTargets] = useState<CaptureTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [status, setStatus] = useState<StatusPayload>({
    stage: "idle",
    message: "Pick a source and start a translation run.",
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
  const [speakTranslation, setSpeakTranslation] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<AudioLevelPayload>({ rms: 0, peak: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const audioQueueRef = useRef(Promise.resolve());

  const avgLatency = useMemo(() => {
    const values = entries
      .map((entry) => entry.latencyMs)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) {
      return null;
    }

    return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
  }, [entries]);

  const runtimeLabel = useMemo(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [elapsedMs]);

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
      setStatus({
        stage: "error",
        message,
      });
    } finally {
      setTargetsLoading(false);
    }
  }

  async function queueTtsClip(payload: TtsPayload) {
    if (!payload.audioBase64) {
      return;
    }

    audioQueueRef.current = audioQueueRef.current.then(async () => {
      const binary = atob(payload.audioBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: payload.mimeType || "audio/wav" });
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.volume = 0.95;

      try {
        await audio.play();
        await new Promise<void>((resolve) => {
          const finalize = () => {
            audio.removeEventListener("ended", finalize);
            audio.removeEventListener("error", finalize);
            URL.revokeObjectURL(objectUrl);
            resolve();
          };

          audio.addEventListener("ended", finalize);
          audio.addEventListener("error", finalize);
        });
      } catch {
        URL.revokeObjectURL(objectUrl);
      }
    });
  }

  async function startSession() {
    setErrorMessage(null);
    setEntries([]);
    setPartial(null);
    setLevels({ rms: 0, peak: 0 });

    try {
      await invoke("start_translation_session", {
        request: {
          relayUrl,
          targetId: selectedTarget,
          sourceLanguage,
          targetLanguage,
          speakTranslation,
          voiceId: voiceId.trim() || null,
        },
      });

      setSessionStartedAt(Date.now());
      setElapsedMs(0);
      setIsRunning(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatus({
        stage: "error",
        message,
      });
    }
  }

  async function stopSession() {
    try {
      await invoke("stop_translation_session");
    } finally {
      setIsRunning(false);
      setSessionStartedAt(null);
      setElapsedMs(0);
      setPartial(null);
      setLevels({ rms: 0, peak: 0 });
      setStatus({
        stage: "stopped",
        message: "Session stopped.",
      });
    }
  }

  useEffect(() => {
    void loadTargets();
  }, []);

  useEffect(() => {
    if (!isRunning || sessionStartedAt === null) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - sessionStartedAt);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning, sessionStartedAt]);

  useEffect(() => {
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];

    const attach = async () => {
      unlisteners.push(
        await listen<StatusPayload>("session-status", ({ payload }) => {
          if (!mounted) {
            return;
          }

          setStatus(payload);
          if (payload.stage === "error" || payload.stage === "stopped") {
            setIsRunning(false);
            setSessionStartedAt(null);
          }
        }),
      );

      unlisteners.push(
        await listen<TranscriptPayload>("session-transcript", ({ payload }) => {
          if (!mounted) {
            return;
          }

          if (payload.finalSegment) {
            setEntries((current) => [
              {
                ...payload,
                id: `${payload.receivedAt}-${current.length}`,
              },
              ...current,
            ].slice(0, 10));
            setPartial(null);
          } else {
            setPartial(payload);
          }
        }),
      );

      unlisteners.push(
        await listen<AudioLevelPayload>("session-level", ({ payload }) => {
          if (mounted) {
            setLevels(payload);
          }
        }),
      );

      unlisteners.push(
        await listen<TtsPayload>("session-tts", ({ payload }) => {
          if (mounted) {
            void queueTtsClip(payload);
          }
        }),
      );
    };

    void attach();

    return () => {
      mounted = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  return (
    <main className="shell">
      <section className="widget">
        <header className="topbar" data-tauri-drag-region>
          <div>
            <p className="eyebrow">Interpreter OS</p>
            <h1>Live app audio translator</h1>
          </div>
          <div className={`status-pill status-${status.stage}`}>
            <span className="status-dot" />
            {status.stage}
          </div>
        </header>

        <section className="hero">
          <p className="status-line">{status.message}</p>
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
        </section>

        <section className="grid">
          <label className="field">
            <span>Capture target</span>
            <div className="inline-field">
              <select
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
              <button className="ghost-button" type="button" onClick={() => void loadTargets()} disabled={targetsLoading || isRunning}>
                Refresh
              </button>
            </div>
            <small>
              {targets.find((target) => target.id === selectedTarget)?.detail ??
                "Select Entire System to mirror any audible app."}
            </small>
          </label>

          <div className="split">
            <label className="field">
              <span>Source</span>
              <select value={sourceLanguage} disabled={isRunning} onChange={(event) => setSourceLanguage(event.currentTarget.value)}>
                {LANGUAGE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Translate to</span>
              <select value={targetLanguage} disabled={isRunning} onChange={(event) => setTargetLanguage(event.currentTarget.value)}>
                {LANGUAGE_OPTIONS.filter(([value]) => value !== "auto").map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Relay URL</span>
            <input
              value={relayUrl}
              disabled={isRunning}
              onChange={(event) => setRelayUrl(event.currentTarget.value)}
              placeholder="http://127.0.0.1:8787"
            />
            <small>Point this at your local Bun relay or the deployed Jade Hosting URL.</small>
          </label>

          <div className="split align-end">
            <label className="field">
              <span>Smallest voice</span>
              <input
                value={voiceId}
                disabled={isRunning}
                onChange={(event) => setVoiceId(event.currentTarget.value)}
                placeholder="Leave blank for relay default"
              />
            </label>

            <label className="toggle">
              <input
                checked={speakTranslation}
                type="checkbox"
                disabled={isRunning}
                onChange={(event) => setSpeakTranslation(event.currentTarget.checked)}
              />
              <span>Play translated voice</span>
            </label>
          </div>
        </section>

        <section className="cta-row">
          <button
            className="primary-button"
            type="button"
            disabled={isRunning || targetsLoading || !relayUrl}
            onClick={() => void startSession()}
          >
            Start demo
          </button>
          <button className="secondary-button" type="button" disabled={!isRunning} onClick={() => void stopSession()}>
            Stop
          </button>
        </section>

        <section className="stats">
          <article>
            <strong>{runtimeLabel}</strong>
            <span>Runtime</span>
          </article>
          <article>
            <strong>{avgLatency ? `${avgLatency}ms` : "--"}</strong>
            <span>Relay latency</span>
          </article>
          <article>
            <strong>{targetsLoading ? "..." : targets.length}</strong>
            <span>Sources</span>
          </article>
        </section>

        {errorMessage ? <section className="error-banner">{errorMessage}</section> : null}

        <section className="transcript-stack">
          <div className="transcript-header">
            <h2>Live captions</h2>
            <span>{speakTranslation ? "Caption + voice mode" : "Caption-only mode"}</span>
          </div>

          {partial ? (
            <article className="transcript-card partial-card">
              <p className="caption-label">Streaming</p>
              <p>{partial.transcript || "Listening..."}</p>
              <strong>{partial.translation || "Waiting for translation..."}</strong>
            </article>
          ) : null}

          {entries.length === 0 ? (
            <article className="empty-state">
              <p>Nothing translated yet.</p>
              <small>
                On first run, macOS may show the Screen &amp; System Audio Recording permission prompt. Keep the widget visible and start playback in the target app.
              </small>
            </article>
          ) : (
            entries.map((entry) => (
              <article className="transcript-card" key={entry.id}>
                <div className="card-meta">
                  <span>{entry.detectedLanguage || "detected automatically"}</span>
                  <span>{entry.latencyMs ? `${entry.latencyMs}ms` : "live"}</span>
                </div>
                <p>{entry.transcript}</p>
                <strong>{entry.translation}</strong>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
