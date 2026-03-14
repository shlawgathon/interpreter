mod audio_device;
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

/// Stores the real output device ID so TTS can play through it while BlackHole is default.
#[derive(Default)]
struct AudioRoutingState {
    /// The real speakers device ID saved before switching to BlackHole
    saved_device_id: Mutex<Option<u32>>,
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

#[tauri::command]
fn get_system_volume() -> Result<u32, String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg("output volume of (get volume settings)")
        .output()
        .map_err(|e| format!("Failed to get volume: {e}"))?;
    let vol_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    vol_str.parse::<u32>().map_err(|e| format!("Failed to parse volume: {e}"))
}

#[tauri::command]
fn set_system_volume(volume: u32) -> Result<(), String> {
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(format!("set volume output volume {volume}"))
        .output()
        .map_err(|e| format!("Failed to set volume: {e}"))?;
    Ok(())
}

/// List audio output devices (speakers, headphones, BlackHole, etc.)
#[tauri::command]
fn list_audio_output_devices() -> Result<Vec<audio_device::AudioOutputDevice>, String> {
    audio_device::list_output_devices()
}

/// Switch system output to BlackHole (mute originals) and save the real device for TTS playback.
#[tauri::command]
fn mute_via_blackhole(
    routing: State<'_, AudioRoutingState>,
) -> Result<bool, String> {
    // Find BlackHole
    let blackhole = audio_device::find_device_by_name("BlackHole")?;
    let blackhole = match blackhole {
        Some(d) => d,
        None => return Ok(false), // BlackHole not installed
    };

    // Save current default output device
    let current = audio_device::get_default_output_device()?;
    if current == blackhole.id {
        // Already on BlackHole — save nothing, but still mark as muted
        let mut guard = routing.saved_device_id.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            // Try to find the real speakers
            if let Ok(Some(speakers)) = audio_device::find_device_by_name("MacBook Pro Speakers") {
                *guard = Some(speakers.id);
            }
        }
        return Ok(true);
    }

    // Save real device and switch to BlackHole
    {
        let mut guard = routing.saved_device_id.lock().map_err(|e| e.to_string())?;
        *guard = Some(current);
    }
    audio_device::set_default_output_device(blackhole.id)?;
    Ok(true)
}

/// Restore the original output device (undo BlackHole mute).
#[tauri::command]
fn unmute_restore_device(
    routing: State<'_, AudioRoutingState>,
) -> Result<(), String> {
    let mut guard = routing.saved_device_id.lock().map_err(|e| e.to_string())?;
    if let Some(saved_id) = guard.take() {
        audio_device::set_default_output_device(saved_id)?;
    }
    Ok(())
}

/// Play TTS audio (base64) directly to the real speakers via rodio.
/// When BlackHole muting is active, plays through the saved real device.
/// Otherwise plays through the system default output.
#[tauri::command]
async fn play_tts_to_real_device(
    routing: State<'_, AudioRoutingState>,
    audio_base64: String,
    _mime_type: String,
) -> Result<(), String> {
    let audio_bytes = base64_decode(&audio_base64)?;

    // Extract saved device name before spawning (State is not Send)
    let target_device_name: Option<String> = {
        let guard = routing.saved_device_id.lock().map_err(|e| e.to_string())?;
        if let Some(device_id) = *guard {
            audio_device::list_output_devices()
                .ok()
                .and_then(|all| all.into_iter().find(|d| d.id == device_id).map(|d| d.name))
        } else {
            None
        }
    };

    // Run blocking rodio playback on a dedicated thread
    tokio::task::spawn_blocking(move || play_audio_blocking(audio_bytes, target_device_name))
        .await
        .map_err(|e| format!("Audio task failed: {e}"))?
}

/// Blocking helper that plays audio bytes through rodio.
/// Wrapped in catch_unwind to prevent panics from crashing the app.
fn play_audio_blocking(audio_bytes: Vec<u8>, target_device_name: Option<String>) -> Result<(), String> {
    use rodio::DeviceSinkBuilder;
    use std::io::Cursor;

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), String> {
        // Try to find specific target device (for BlackHole routing)
        let cpal_device = target_device_name.and_then(|name| {
            use rodio::cpal::traits::{DeviceTrait, HostTrait};
            let host = rodio::cpal::default_host();
            host.output_devices().ok().and_then(|devices| {
                devices.into_iter().find(|d| {
                    d.name().map_or(false, |n| n.contains(&name) || name.contains(&n))
                })
            })
        });

        let mut handle = if let Some(device) = cpal_device {
            DeviceSinkBuilder::from_device(device)
                .map_err(|e| format!("Sink builder error: {e}"))?
                .open_stream()
                .map_err(|e| format!("Open stream error: {e}"))?
        } else {
            DeviceSinkBuilder::open_default_sink()
                .map_err(|e| format!("Default sink error: {e}"))?
        };

        handle.log_on_drop(false);
        let mixer = handle.mixer();
        let cursor = Cursor::new(audio_bytes);
        let player = rodio::stream::play(mixer, cursor)
            .map_err(|e| format!("Play error: {e}"))?;
        player.sleep_until_end();
        Ok(())
    }));

    match result {
        Ok(inner) => inner,
        Err(_) => Err("Audio playback panicked — device may be unavailable".to_string()),
    }
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    // Use a simple lookup table
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for byte in cleaned.bytes() {
        let val = if byte == b'=' {
            break;
        } else if let Some(pos) = table.iter().position(|&b| b == byte) {
            pos as u32
        } else {
            continue;
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(output)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SessionState::default())
        .manage(AudioRoutingState::default())
        .invoke_handler(tauri::generate_handler![
            list_capture_targets,
            start_translation_session,
            stop_translation_session,
            get_system_volume,
            set_system_volume,
            list_audio_output_devices,
            mute_via_blackhole,
            unmute_restore_device,
            play_tts_to_real_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

