import { useState, useEffect, useRef } from "react";
import { SUPPORTED_LANGUAGES, type ServerJsonMessage } from "@interpreter/shared";
import { createAudioCapture, type AudioCaptureHandle } from "../entrypoints/meet.content/audio-capture";
import { createAudioPlayback, type AudioPlaybackHandle } from "../entrypoints/meet.content/audio-playback";
import { createWsClient, type WsClientHandle } from "../entrypoints/meet.content/ws-client";
import { LanguageSelector } from "./LanguageSelector";
import { TranscriptPanel, type TranscriptLine } from "./TranscriptPanel";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const WS_URL = "ws://localhost:8080";

export function Overlay() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [listenLang, setListenLang] = useState("en");
  const [spokenLang, setSpokenLang] = useState("en");
  const [meetVolume, setMeetVolume] = useState(0.3);
  const [sessionCode, setSessionCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [participantId, setParticipantId] = useState("");
  const [transcripts, setTranscripts] = useState<TranscriptLine[]>([]);
  const [speakers, setSpeakers] = useState<Array<{ id: string; name: string; spokenLanguage: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WsClientHandle | null>(null);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const playbackRef = useRef<AudioPlaybackHandle | null>(null);

  useEffect(() => {
    const ws = createWsClient();
    wsRef.current = ws;

    ws.onStatusChange = setStatus;

    ws.onJsonMessage = (msg: ServerJsonMessage) => {
      switch (msg.type) {
        case "joined":
          setJoined(true);
          setParticipantId(msg.participantId);
          setSpeakers(msg.participants);
          setError(null);
          break;
        case "error":
          setError((msg as any).message);
          setTimeout(() => setError(null), 5000);
          break;
        case "participantJoined":
          setSpeakers((prev) => [...prev, msg.participant]);
          break;
        case "participantLeft":
          setSpeakers((prev) => prev.filter((p) => p.id !== msg.participantId));
          break;
        case "transcript":
          setTranscripts((prev) => [
            ...prev.slice(-100),
            {
              id: `${msg.speakerId}-${Date.now()}`,
              speakerName: msg.speakerName,
              translated: msg.translated,
              original: msg.original,
              isFinal: msg.isFinal,
            },
          ]);
          break;
      }
    };

    ws.onAudioMessage = (_speakerId, pcm) => {
      playbackRef.current?.enqueue(pcm);
    };

    ws.connect(WS_URL);

    const playback = createAudioPlayback();
    playback.init();
    playbackRef.current = playback;

    return () => {
      ws.disconnect();
      captureRef.current?.stop();
      playback.destroy();
    };
  }, []);

  useEffect(() => {
    playbackRef.current?.setMeetVolume(meetVolume);
  }, [meetVolume]);

  const handleJoin = async () => {
    if (!sessionCode.trim()) return;

    const capture = createAudioCapture();
    captureRef.current = capture;
    await capture.start();

    wsRef.current?.sendJson({
      type: "join",
      sessionCode,
      participantName: "Me",
      spokenLanguage: spokenLang,
      listenLanguage: listenLang,
    });

    capture.onChunk = (pcm) => {
      if (participantId) {
        wsRef.current?.sendAudio(participantId, pcm);
      }
    };
  };

  const handleLeave = () => {
    wsRef.current?.sendJson({ type: "leave" });
    captureRef.current?.stop();
    captureRef.current = null;
    setJoined(false);
    setTranscripts([]);
    setSpeakers([]);
  };

  const handleListenLangChange = (code: string) => {
    setListenLang(code);
    wsRef.current?.sendJson({
      type: "updateSettings",
      listenLanguage: code,
    });
  };

  const statusColor = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-500 animate-pulse",
    disconnected: "bg-red-500",
  }[status];

  const langLabel = SUPPORTED_LANGUAGES.find((l) => l.code === listenLang)?.code.toUpperCase() ?? "EN";

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-24 right-6 z-[9999] flex h-10 items-center gap-2 rounded-full bg-slate-900/90 px-4 shadow-lg backdrop-blur-xl transition-all hover:bg-slate-800/90"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#818CF8" strokeWidth="2" />
          <path d="M8 12h8M12 8v8" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-xs font-medium text-slate-200">{langLabel}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-6 z-[9999] flex w-80 flex-col overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/85 shadow-2xl backdrop-blur-xl animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">Interpreter</span>
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 11h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-500/20 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col gap-3 p-4">
        {!joined ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                Session Code
              </label>
              <input
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-primary-light"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LanguageSelector
                label="I Speak"
                value={spokenLang}
                onChange={setSpokenLang}
              />
              <LanguageSelector
                label="I Hear"
                value={listenLang}
                onChange={setListenLang}
              />
            </div>
            <button
              onClick={handleJoin}
              disabled={status !== "connected" || !sessionCode}
              className="w-full rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-40"
            >
              Join Session
            </button>
          </div>
        ) : (
          <>
            {/* Speakers */}
            <div className="space-y-1.5">
              {speakers
                .filter((s) => s.id !== participantId)
                .map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-medium text-slate-300">
                      {s.name[0]}
                    </div>
                    <span className="flex-1 text-xs text-slate-300">{s.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {s.spokenLanguage.toUpperCase()}
                    </span>
                  </div>
                ))}
            </div>

            {/* Transcript */}
            <TranscriptPanel lines={transcripts} />

            {/* Controls */}
            <div className="flex items-center gap-3 border-t border-slate-700/50 pt-3">
              <LanguageSelector
                label="Hear"
                value={listenLang}
                onChange={handleListenLangChange}
                compact
              />
              <div className="flex flex-1 items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M11 5L6 9H2v6h4l5 4V5z"
                    stroke="#94A3B8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={meetVolume}
                  onChange={(e) => setMeetVolume(Number(e.target.value))}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-brand-accent"
                />
              </div>
              <button
                onClick={handleLeave}
                className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                Leave
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
