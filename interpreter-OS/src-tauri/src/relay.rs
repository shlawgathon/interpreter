use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{
    sync::{mpsc, watch},
    task::JoinHandle,
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use crate::models::{RelayMessage, StartSessionRequest, StatusPayload, TranscriptPayload, TtsPayload};

pub fn spawn_relay_task(
    app: AppHandle,
    request: StartSessionRequest,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
    mut stop_rx: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(error) = relay_loop(&app, &request, &mut audio_rx, &mut stop_rx).await {
            let payload = StatusPayload {
                stage: "error".to_string(),
                message: error,
            };
            let _ = app.emit("session-status", payload);
        }
    })
}

async fn relay_loop(
    app: &AppHandle,
    request: &StartSessionRequest,
    audio_rx: &mut mpsc::Receiver<Vec<u8>>,
    stop_rx: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let websocket_url = relay_websocket_url(&request.relay_url)?;

    let _ = app.emit(
        "session-status",
        StatusPayload {
            stage: "connecting".to_string(),
            message: format!("Connecting to relay at {}", request.relay_url),
        },
    );

    let (mut socket, _) = connect_async(websocket_url.as_str())
        .await
        .map_err(|error| format!("Relay connection failed: {error}"))?;

    let init_payload = json!({
        "type": "init",
        "sourceLanguage": request.source_language,
        "targetLanguage": request.target_language,
        "speakTranslation": request.speak_translation,
        "voiceId": request.voice_id,
    });

    socket
        .send(Message::Text(init_payload.to_string()))
        .await
        .map_err(|error| format!("Failed to initialize relay session: {error}"))?;

    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    let _ = socket.send(Message::Text(json!({ "type": "end" }).to_string())).await;
                    let _ = socket.close(None).await;
                    let _ = app.emit("session-status", StatusPayload {
                        stage: "stopped".to_string(),
                        message: "Session stopped.".to_string(),
                    });
                    break;
                }
            }
            next_chunk = audio_rx.recv() => {
                match next_chunk {
                    Some(chunk) => {
                        socket
                            .send(Message::Binary(chunk))
                            .await
                            .map_err(|error| format!("Failed sending audio to relay: {error}"))?;
                    }
                    None => break,
                }
            }
            next_message = socket.next() => {
                match next_message {
                    Some(Ok(Message::Text(text))) => {
                        handle_relay_message(app, &text)?;
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(format!("Relay socket error: {error}")),
                    None => break,
                }
            }
        }
    }

    Ok(())
}

fn handle_relay_message(app: &AppHandle, raw: &str) -> Result<(), String> {
    let message: RelayMessage =
        serde_json::from_str(raw).map_err(|error| format!("Invalid relay payload: {error}"))?;

    match message {
        RelayMessage::Status { stage, message } => {
            let _ = app.emit("session-status", StatusPayload { stage, message });
        }
        RelayMessage::Transcript {
            transcript,
            translation,
            final_segment,
            detected_language,
            latency_ms,
            received_at,
        } => {
            let payload = TranscriptPayload {
                transcript,
                translation,
                final_segment,
                detected_language,
                latency_ms,
                received_at,
            };
            let _ = app.emit("session-transcript", payload);
        }
        RelayMessage::Tts {
            audio_base64,
            mime_type,
        } => {
            let payload = TtsPayload {
                audio_base64,
                mime_type,
            };
            let _ = app.emit("session-tts", payload);
        }
        RelayMessage::Error { message } => {
            let _ = app.emit(
                "session-status",
                StatusPayload {
                    stage: "error".to_string(),
                    message,
                },
            );
        }
    }

    Ok(())
}

fn relay_websocket_url(relay_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(relay_url).map_err(|error| format!("Invalid relay URL: {error}"))?;

    match url.scheme() {
        "http" => url
            .set_scheme("ws")
            .map_err(|_| "Unable to convert relay URL to websocket".to_string())?,
        "https" => url
            .set_scheme("wss")
            .map_err(|_| "Unable to convert relay URL to websocket".to_string())?,
        "ws" | "wss" => {}
        _ => {
            return Err(
                "Relay URL must start with http://, https://, ws://, or wss://".to_string(),
            )
        }
    }

    url.set_path("/ws/session");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}
