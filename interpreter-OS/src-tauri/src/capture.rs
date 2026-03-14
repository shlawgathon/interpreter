use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use screencapturekit::{
    cm::CMSampleBuffer,
    prelude::*,
    stream::configuration::audio::{AudioChannelCount, AudioSampleRate},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::models::{AudioLevelPayload, CaptureTarget};

const DEFAULT_DISPLAY_ID: &str = "system::default";
const METER_EMIT_INTERVAL_MS: u64 = 120;
const TARGET_SAMPLE_RATE: AudioSampleRate = AudioSampleRate::Rate48000;

pub struct ManagedCapture {
    stream: SCStream,
}

impl ManagedCapture {
    pub fn stop(self) {
        let _ = self.stream.stop_capture();
    }
}

struct AudioOutputHandler {
    app: AppHandle,
    chunk_tx: mpsc::Sender<Vec<u8>>,
    last_meter_emit_ms: AtomicU64,
    saw_audio: AtomicBool,
}

impl AudioOutputHandler {
    fn new(app: AppHandle, chunk_tx: mpsc::Sender<Vec<u8>>) -> Self {
        Self {
            app,
            chunk_tx,
            last_meter_emit_ms: AtomicU64::new(0),
            saw_audio: AtomicBool::new(false),
        }
    }
}

impl SCStreamOutputTrait for AudioOutputHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Audio {
            return;
        }

        if let Some(pcm) = sample_buffer_to_pcm16(&sample) {
            if !self.saw_audio.swap(true, Ordering::Relaxed) {
                if let Some(description) = sample.format_description() {
                    let _ = self.app.emit(
                        "session-audio-format",
                        crate::models::AudioFormatPayload {
                            sample_rate: description.audio_sample_rate().unwrap_or(0.0) as u32,
                            channel_count: description.audio_channel_count().unwrap_or(0),
                            bits_per_channel: description.audio_bits_per_channel().unwrap_or(0),
                            float_format: description.audio_is_float(),
                        },
                    );
                }
                let _ = self.app.emit(
                    "session-status",
                    crate::models::StatusPayload {
                        stage: "audio_detected".to_string(),
                        message: "Audio detected locally. Streaming to relay.".to_string(),
                    },
                );
            }
            maybe_emit_levels(&self.app, &self.last_meter_emit_ms, &pcm);
            let _ = self.chunk_tx.try_send(pcm);
        }
    }
}

pub fn list_capture_targets() -> Result<Vec<CaptureTarget>, String> {
    let content = SCShareableContent::get()
        .map_err(|error| format!("Unable to inspect macOS shareable content: {error}"))?;

    let mut targets = vec![CaptureTarget {
        id: DEFAULT_DISPLAY_ID.to_string(),
        kind: "system".to_string(),
        name: "Entire System".to_string(),
        detail: "Captures system audio from the primary display and excludes this app to avoid echo.".to_string(),
        pid: None,
        bundle_id: None,
    }];

    let mut applications = content
        .applications()
        .into_iter()
        .filter(|application| !application.application_name().trim().is_empty())
        .map(|application| CaptureTarget {
            id: format!("app::{}", application.process_id()),
            kind: "application".to_string(),
            name: application.application_name(),
            detail: match application.bundle_identifier() {
                bundle if bundle.is_empty() => format!("PID {}", application.process_id()),
                bundle => format!("{bundle} · PID {}", application.process_id()),
            },
            pid: Some(application.process_id()),
            bundle_id: {
                let bundle = application.bundle_identifier();
                if bundle.is_empty() {
                    None
                } else {
                    Some(bundle)
                }
            },
        })
        .collect::<Vec<_>>();

    applications.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    targets.extend(applications);

    Ok(targets)
}

pub fn start_capture(
    target_id: &str,
    chunk_tx: mpsc::Sender<Vec<u8>>,
    app: AppHandle,
) -> Result<ManagedCapture, String> {
    let content = SCShareableContent::get().map_err(permission_wrapped_error)?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| "No shareable display was found on this Mac.".to_string())?;

    let filter = if target_id == DEFAULT_DISPLAY_ID {
        SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build()
    } else if let Some(pid) = target_id.strip_prefix("app::") {
        let pid = pid
            .parse::<i32>()
            .map_err(|_| format!("Invalid application target id: {target_id}"))?;

        let target_app = content
            .applications()
            .into_iter()
            .find(|application| application.process_id() == pid)
            .ok_or_else(|| {
                "That app is no longer running. Refresh the list and choose it again.".to_string()
            })?;

        SCContentFilter::create()
            .with_display(&display)
            .with_including_applications(&[&target_app], &[])
            .build()
    } else {
        return Err(format!("Unsupported target id: {target_id}"));
    };

    let config = SCStreamConfiguration::new()
        .with_width(64)
        .with_height(64)
        .with_captures_audio(true)
        .with_sample_rate(TARGET_SAMPLE_RATE)
        .with_channel_count(AudioChannelCount::Mono)
        .with_excludes_current_process_audio(true);

    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(
        AudioOutputHandler::new(app, chunk_tx),
        SCStreamOutputType::Audio,
    );
    stream.start_capture().map_err(permission_wrapped_error)?;

    Ok(ManagedCapture { stream })
}

fn permission_wrapped_error(error: impl std::fmt::Display) -> String {
    format!(
        "{error}. On macOS you need Screen & System Audio Recording permission for the app in System Settings > Privacy & Security."
    )
}

fn maybe_emit_levels(app: &AppHandle, last_emit_ms: &AtomicU64, pcm: &[u8]) {
    let now_ms = unix_ms();
    let previous = last_emit_ms.load(Ordering::Relaxed);
    if now_ms.saturating_sub(previous) < METER_EMIT_INTERVAL_MS {
        return;
    }

    last_emit_ms.store(now_ms, Ordering::Relaxed);

    let mut sample_count = 0f32;
    let mut power_sum = 0f32;
    let mut peak = 0f32;

    for chunk in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32;
        power_sum += sample * sample;
        peak = peak.max(sample.abs());
        sample_count += 1.0;
    }

    let rms = if sample_count > 0.0 {
        (power_sum / sample_count).sqrt()
    } else {
        0.0
    };

    let payload = AudioLevelPayload { rms, peak };
    let _ = app.emit("session-level", payload);
}

fn sample_buffer_to_pcm16(sample: &CMSampleBuffer) -> Option<Vec<u8>> {
    let description = sample.format_description()?;
    let bits_per_channel = description.audio_bits_per_channel()?;
    let is_float = description.audio_is_float();
    let channel_count = description.audio_channel_count().unwrap_or(1).max(1) as usize;
    let audio_buffers = sample.audio_buffer_list()?;

    let mono_samples = if audio_buffers.num_buffers() > 1 {
        let per_channel = audio_buffers
            .iter()
            .map(|buffer| decode_pcm_samples(buffer.data(), is_float, bits_per_channel))
            .collect::<Option<Vec<Vec<i16>>>>()?;
        let sample_len = per_channel.iter().map(Vec::len).min().unwrap_or(0);
        let mut downmixed = Vec::with_capacity(sample_len);

        for sample_index in 0..sample_len {
            let total = per_channel
                .iter()
                .map(|channel| channel[sample_index] as i32)
                .sum::<i32>();
            downmixed.push((total / per_channel.len() as i32) as i16);
        }

        downmixed
    } else {
        let interleaved = decode_pcm_samples(audio_buffers.get(0)?.data(), is_float, bits_per_channel)?;
        if channel_count <= 1 {
            interleaved
        } else {
            let mut downmixed = Vec::with_capacity(interleaved.len() / channel_count);
            for frame in interleaved.chunks_exact(channel_count) {
                let total = frame.iter().map(|sample| *sample as i32).sum::<i32>();
                downmixed.push((total / channel_count as i32) as i16);
            }
            downmixed
        }
    };

    let mut pcm = Vec::with_capacity(mono_samples.len() * 2);
    for sample in mono_samples {
        pcm.extend_from_slice(&sample.to_le_bytes());
    }

    Some(pcm)
}

fn decode_pcm_samples(data: &[u8], is_float: bool, bits_per_channel: u32) -> Option<Vec<i16>> {
    match (is_float, bits_per_channel) {
        (true, 32) => Some(
            data.chunks_exact(4)
                .map(|frame| {
                    let float_sample =
                        f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]])
                            .clamp(-1.0, 1.0);
                    (float_sample * i16::MAX as f32) as i16
                })
                .collect(),
        ),
        (false, 16) => Some(
            data.chunks_exact(2)
                .map(|frame| i16::from_le_bytes([frame[0], frame[1]]))
                .collect(),
        ),
        _ => None,
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
