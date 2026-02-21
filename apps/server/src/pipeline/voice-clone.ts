/**
 * Voice cloning via MiniMax Voice Clone API.
 * 
 * Flow:
 * 1. Upload source audio → get file_id
 * 2. Call clone endpoint with file_id → get voice_id
 * 3. Store voice_id in Convex for the user
 * 
 * Cloned voices expire after 7 days of inactivity.
 */

const MINIMAX_UPLOAD_URL = "https://api.minimax.chat/v1/files/upload";
const MINIMAX_CLONE_URL = "https://api.minimax.chat/v1/voice/clone";

interface CloneResult {
  voiceId: string;
  status: "pending" | "ready";
}

/**
 * Uploads an audio sample and creates a cloned voice.
 */
export async function cloneVoice(
  audioBuffer: ArrayBuffer,
  fileName: string,
): Promise<CloneResult | null> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn("[voice-clone] MINIMAX_API_KEY not set");
    return null;
  }

  try {
    // Step 1: Upload the audio file
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer]), fileName);
    formData.append("purpose", "voice_clone");

    const uploadRes = await fetch(MINIMAX_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      console.error("[voice-clone] upload failed:", uploadRes.status);
      return null;
    }

    const uploadData = await uploadRes.json() as { file?: { file_id?: string } };
    const fileId = uploadData.file?.file_id;
    if (!fileId) {
      console.error("[voice-clone] no file_id in upload response");
      return null;
    }

    // Step 2: Clone the voice
    const cloneRes = await fetch(MINIMAX_CLONE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        file_id: fileId,
      }),
    });

    if (!cloneRes.ok) {
      console.error("[voice-clone] clone failed:", cloneRes.status);
      return null;
    }

    const cloneData = await cloneRes.json() as { voice_id?: string };
    const voiceId = cloneData.voice_id;
    if (!voiceId) {
      console.error("[voice-clone] no voice_id in clone response");
      return null;
    }

    console.log(`[voice-clone] created voice ${voiceId}`);

    return {
      voiceId,
      status: "ready",
    };
  } catch (err) {
    console.error("[voice-clone] error:", err);
    return null;
  }
}
