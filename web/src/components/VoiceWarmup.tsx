import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Convert a webm audio blob to wav (PCM16, mono) using OfflineAudioContext.
 * MiniMax only accepts mp3, m4a, or wav.
 */
async function webmToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const sampleRate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  const pcm = rendered.getChannelData(0);
  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);

  // WAV header
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

const SAMPLE_TEXT =
  "The rainbow is a division of white light into many beautiful colors. These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end. People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow.";

const MIN_DURATION = 10; // seconds
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:8000";

export function VoiceWarmup() {
  const navigate = useNavigate();
  const profile = useQuery(api.userProfiles.getMyProfile);
  const updateVoiceProfile = useMutation(api.userProfiles.updateVoiceProfile);
  const setVoiceStatus = useMutation(api.userProfiles.setVoiceStatus);
  const generateUploadUrl = useMutation(api.userProfiles.generateUploadUrl);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "#1d1d1f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0071e3";
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  async function startRecording() {
    setError("");
    setSuccess("");
    setAudioBlob(null);
    setElapsed(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set canvas dimensions
      if (canvasRef.current) {
        canvasRef.current.width = canvasRef.current.offsetWidth * 2;
        canvasRef.current.height = canvasRef.current.offsetHeight * 2;
      }

      drawWaveform();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        // Stop waveform
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };

      mediaRecorder.start(250);
      setRecording(true);

      // Timer
      timerRef.current = window.setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setError("Microphone access denied. Please allow microphone access.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  }

  async function uploadRecording() {
    if (!audioBlob || !profile) return;
    setUploading(true);
    setError("");
    setSuccess("");

    try {
      await setVoiceStatus({ status: "processing" });

      // Step 1: Upload audio to Convex file storage
      const uploadUrl = await generateUploadUrl();
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": audioBlob.type },
        body: audioBlob,
      });
      const { storageId } = await uploadResult.json();

      // Step 2: Convert webm to wav (MiniMax only accepts mp3/m4a/wav)
      const wavBlob = await webmToWav(audioBlob);
      const wavArrayBuffer = await wavBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(wavArrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );

      const response = await fetch(`${SERVER_URL}/api/voice-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: profile.userId,
          audio: base64,
          format: "wav",
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();

      // Step 3: Store both MiniMax file_id and Convex storageId in the profile
      await updateVoiceProfile({
        voiceProfileId: data.voiceProfileId,
        voiceAudioStorageId: storageId,
        voiceProfileStatus: "ready",
      });

      setSuccess(
        `Voice profile created! ID: ${data.voiceProfileId}`,
      );
    } catch (err: any) {
      setError(err.message || "Failed to create voice profile");
      try {
        await setVoiceStatus({ status: "failed" });
      } catch {
        // ignore
      }
    } finally {
      setUploading(false);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  if (profile === undefined) {
    return <div className="loading">Loading...</div>;
  }

  if (profile === null) {
    return (
      <div className="card">
        <p>Please set up your profile first.</p>
        <button className="btn btn-primary" onClick={() => navigate("/")}>
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="card warmup-container">
      <button
        className="btn btn-link"
        onClick={() => navigate("/")}
        style={{ textAlign: "left", marginBottom: 16 }}
      >
        &larr; Back to Dashboard
      </button>

      <h1>Voice Warmup</h1>
      <p>
        Read the passage below clearly and steadily. Record for at least{" "}
        {MIN_DURATION} seconds.
      </p>

      <div
        style={{
          background: "#f5f5f7",
          borderRadius: 12,
          padding: 20,
          margin: "20px 0",
          textAlign: "left",
          lineHeight: 1.8,
          fontSize: 15,
          color: "#1d1d1f",
        }}
      >
        {SAMPLE_TEXT}
      </div>

      <div className="waveform-area">
        {recording ? (
          <canvas ref={canvasRef} />
        ) : (
          <div className="placeholder">
            {audioBlob ? "Recording complete" : "Press record to begin"}
          </div>
        )}
      </div>

      <div className={`timer ${recording ? "recording" : ""}`}>
        {formatTime(elapsed)}
      </div>

      {!audioBlob ? (
        <button
          className={`record-btn ${recording ? "recording" : ""}`}
          onClick={recording ? stopRecording : startRecording}
        >
          <div className="dot" />
        </button>
      ) : (
        <div className="actions">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setAudioBlob(null);
              setElapsed(0);
              setSuccess("");
              setError("");
            }}
          >
            Re-record
          </button>
          <button
            className="btn btn-primary"
            disabled={uploading || elapsed < MIN_DURATION}
            onClick={uploadRecording}
          >
            {uploading ? "Processing..." : "Create Voice Profile"}
          </button>
        </div>
      )}

      {elapsed > 0 && elapsed < MIN_DURATION && !audioBlob && (
        <p style={{ color: "#86868b", marginTop: 12, fontSize: 13 }}>
          Keep reading... {MIN_DURATION - elapsed}s remaining
        </p>
      )}

      {error && <p className="error-msg">{error}</p>}
      {success && (
        <div style={{ marginTop: 16 }}>
          <p className="success-msg">{success}</p>
          <p style={{ fontSize: 13, color: "#86868b", marginTop: 8 }}>
            Your voice profile is now stored. It will be used automatically
            during translation sessions.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => navigate("/")}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
