/**
 * Plays dubbed audio chunks received from the server.
 * Manages a queue for gap-free playback and controls Meet's native volume.
 */

const PLAYBACK_SAMPLE_RATE = 24000;

export interface AudioPlaybackHandle {
  init(): void;
  enqueue(pcm: ArrayBuffer): void;
  setMeetVolume(volume: number): void;
  destroy(): void;
}

export function createAudioPlayback(): AudioPlaybackHandle {
  let audioCtx: AudioContext | null = null;
  let nextStartTime = 0;

  return {
    init() {
      audioCtx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
      nextStartTime = 0;
    },

    enqueue(pcm: ArrayBuffer) {
      if (!audioCtx) return;

      const int16 = new Int16Array(pcm);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x7fff;
      }

      const buffer = audioCtx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      if (nextStartTime < now) {
        nextStartTime = now;
      }
      source.start(nextStartTime);
      nextStartTime += buffer.duration;
    },

    setMeetVolume(volume: number) {
      const clamped = Math.max(0, Math.min(1, volume));
      const videos = document.querySelectorAll("video");
      videos.forEach((v) => {
        v.volume = clamped;
      });
    },

    destroy() {
      audioCtx?.close();
      audioCtx = null;
    },
  };
}
