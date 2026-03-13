mod capture;
mod models;
mod relay;

use std::sync::Mutex;

use capture::ManagedCapture;
use models::{CaptureTarget, StartSessionRequest, StatusPayload};
use tauri::{AppHandle, Emitter, State};
use tokio::{sync::{mpsc, watch}, task::JoinHandle};

struct RunningSession {
    capture: ManagedCapture,
    relay_task: JoinHandle<()>,
    stop_tx: watch::Sender<bool>,
}

impl RunningSession {
    fn stop(self) {
        let _ = self.stop_tx.send(true);
        self.capture.stop();
        drop(self.relay_task);
    }
}

#[derive(Default)]
struct SessionState {
    current: Mutex<Option<RunningSession>>,
}

fn emit_status(app: &AppHandle, stage: &str, message: impl Into<String>) {
    let payload = StatusPayload {
        stage: stage.to_string(),
        message: message.into(),
    };
    let _ = app.emit("session-status", payload);
}

#[tauri::command]
fn list_capture_targets() -> Result<Vec<CaptureTarget>, String> {
    capture::list_capture_targets()
}

#[tauri::command]
async fn start_translation_session(
    app: AppHandle,
    state: State<'_, SessionState>,
    request: StartSessionRequest,
) -> Result<(), String> {
    {
        let mut guard = state.current.lock().map_err(|error| error.to_string())?;
        if let Some(existing) = guard.take() {
            existing.stop();
        }
    }

    emit_status(
        &app,
        "preparing",
        "Preparing macOS audio capture. If this is the first run, macOS may ask for Screen & System Audio Recording permission.",
    );

    let (audio_tx, audio_rx) = mpsc::channel(48);
    let (stop_tx, stop_rx) = watch::channel(false);

    let capture = capture::start_capture(&request.target_id, audio_tx, app.clone())?;
    let relay_task = relay::spawn_relay_task(app.clone(), request, audio_rx, stop_rx);

    let mut guard = state.current.lock().map_err(|error| error.to_string())?;
    *guard = Some(RunningSession {
        capture,
        relay_task,
        stop_tx,
    });

    emit_status(&app, "capturing", "Capturing app audio and sending it to the relay.");

    Ok(())
}

#[tauri::command]
fn stop_translation_session(
    app: AppHandle,
    state: State<'_, SessionState>,
) -> Result<(), String> {
    let mut guard = state.current.lock().map_err(|error| error.to_string())?;
    if let Some(existing) = guard.take() {
        existing.stop();
    }

    emit_status(&app, "stopped", "Session stopped.");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionState::default())
        .invoke_handler(tauri::generate_handler![
            list_capture_targets,
            start_translation_session,
            stop_translation_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
