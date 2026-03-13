use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTarget {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub detail: String,
    pub pid: Option<i32>,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionRequest {
    pub relay_url: String,
    pub target_id: String,
    pub source_language: String,
    pub target_language: String,
    pub speak_translation: bool,
    pub voice_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPayload {
    pub transcript: String,
    pub translation: String,
    pub final_segment: bool,
    pub detected_language: Option<String>,
    pub latency_ms: Option<u64>,
    pub received_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevelPayload {
    pub rms: f32,
    pub peak: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsPayload {
    pub audio_base64: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RelayMessage {
    Status { stage: String, message: String },
    Transcript {
        transcript: String,
        translation: String,
        final_segment: bool,
        detected_language: Option<String>,
        latency_ms: Option<u64>,
        received_at: u64,
    },
    Tts {
        audio_base64: String,
        mime_type: String,
    },
    Error { message: String },
}
