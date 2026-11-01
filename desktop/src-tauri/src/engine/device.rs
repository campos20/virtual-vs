//! Output device handling. The cpal stream lives on its own thread for its
//! whole life - not every platform's stream type is `Send`, and keeping it
//! there means the rest of the app only ever holds plain handles.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, Device, ErrorKind, FromSample, SampleFormat, SizedSample, StreamConfig,
    SupportedBufferSize, SupportedStreamConfig, SupportedStreamConfigRange, I24,
};
use serde::Serialize;

use super::mixer::Mixer;

/// Largest block handed to the mixer at once. Device callbacks bigger than
/// this are processed in several chunks.
const SCRATCH_FRAMES: usize = 4096;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub max_channels: u16,
    pub default_sample_rate: u32,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveOutput {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub sample_rate: u32,
    /// `None` when the driver's default buffer size is in use.
    pub buffer_frames: Option<u32>,
}

fn device_name(device: &Device) -> String {
    device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| "Unknown device".to_string())
}

fn device_id(device: &Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn is_supported_format(format: SampleFormat) -> bool {
    matches!(
        format,
        SampleFormat::F32
            | SampleFormat::F64
            | SampleFormat::I16
            | SampleFormat::I24
            | SampleFormat::I32
            | SampleFormat::U16
    )
}

/// The widest config (most output channels) that runs at the device's
/// default rate, preferring f32. Opening every channel is what lets the
/// router reach all of an interface's outputs.
fn pick_config(device: &Device) -> Result<(SupportedStreamConfig, SupportedBufferSize), String> {
    let default = device
        .default_output_config()
        .map_err(|e| format!("Device has no output config: {e}"))?;
    let rate = default.sample_rate();
    let mut best: Option<SupportedStreamConfigRange> = None;
    if let Ok(ranges) = device.supported_output_configs() {
        for range in ranges {
            if !is_supported_format(range.sample_format())
                || range.min_sample_rate() > rate
                || range.max_sample_rate() < rate
            {
                continue;
            }
            let better = match &best {
                None => true,
                Some(b) => {
                    range.channels() > b.channels()
                        || (range.channels() == b.channels()
                            && range.sample_format() == SampleFormat::F32
                            && b.sample_format() != SampleFormat::F32)
                }
            };
            if better {
                best = Some(range);
            }
        }
    }
    let chosen = match best {
        Some(range) => range.with_sample_rate(rate),
        None => default,
    };
    let buffer = *chosen.buffer_size();
    Ok((chosen, buffer))
}

pub fn list_output_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    let default_id = host.default_output_device().as_ref().and_then(device_id);
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|device| {
            let id = device_id(&device)?;
            let (config, _) = pick_config(&device).ok()?;
            Some(DeviceInfo {
                is_default: default_id.as_deref() == Some(id.as_str()),
                name: device_name(&device),
                max_channels: config.channels(),
                default_sample_rate: config.sample_rate(),
                id,
            })
        })
        .collect()
}

fn find_device(id: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    if let Some(id) = id {
        let parsed: cpal::DeviceId = id.parse().map_err(|_| format!("Invalid device id {id}"))?;
        if let Some(device) = host.device_by_id(&parsed) {
            return Ok(device);
        }
        return Err(format!("Audio device {id} is not connected"));
    }
    host.default_output_device()
        .ok_or_else(|| "No output device available".to_string())
}

/// Problems reported by the driver while the stream runs.
#[derive(Default)]
pub struct StreamHealth {
    pub fatal_error: Mutex<Option<String>>,
    pub xruns: AtomicU64,
}

/// A running output stream. Dropping it stops the stream.
pub struct OutputStream {
    pub info: ActiveOutput,
    pub health: Arc<StreamHealth>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for OutputStream {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn build_stream<T>(
    device: &Device,
    config: StreamConfig,
    mut mixer: Mixer,
    health: Arc<StreamHealth>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels as usize;
    let mut scratch = vec![0.0f32; SCRATCH_FRAMES * channels];
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                for chunk in data.chunks_mut(SCRATCH_FRAMES * channels) {
                    let buffer = &mut scratch[..chunk.len()];
                    mixer.process(buffer);
                    for (out, sample) in chunk.iter_mut().zip(buffer.iter()) {
                        *out = T::from_sample(*sample);
                    }
                }
            },
            move |err: cpal::Error| match err.kind() {
                ErrorKind::Xrun => {
                    health.xruns.fetch_add(1, Ordering::Relaxed);
                }
                // The OS rerouted a default-device stream; it keeps running.
                ErrorKind::DeviceChanged => {}
                _ => {
                    if let Ok(mut slot) = health.fatal_error.lock() {
                        slot.get_or_insert_with(|| err.to_string());
                    }
                }
            },
            None,
        )
        .map_err(|e| format!("Could not open audio output: {e}"))
}

/// Opens `device_id` (or the system default) with as many output channels as
/// it has. `make_mixer` receives the final channel count and sample rate.
pub fn open_output<F>(
    device_id: Option<String>,
    buffer_frames: Option<u32>,
    make_mixer: F,
) -> Result<OutputStream, String>
where
    F: FnOnce(usize, u32) -> Mixer + Send + 'static,
{
    let (ready_tx, ready_rx) = mpsc::channel::<Result<ActiveOutput, String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let health = Arc::new(StreamHealth::default());
    let thread_health = health.clone();

    let thread = std::thread::Builder::new()
        .name("vvs-audio-output".into())
        .spawn(move || {
            let opened = (|| {
                let device = find_device(device_id.as_deref())?;
                let (supported, buffer_range) = pick_config(&device)?;
                let mut config = supported.config();
                let buffer_frames = buffer_frames.filter(|frames| match buffer_range {
                    SupportedBufferSize::Range { min, max } => (min..=max).contains(frames),
                    SupportedBufferSize::Unknown => true,
                });
                if let Some(frames) = buffer_frames {
                    config.buffer_size = BufferSize::Fixed(frames);
                }
                let mixer = make_mixer(config.channels as usize, config.sample_rate);
                let h = thread_health;
                let stream = match supported.sample_format() {
                    SampleFormat::F32 => build_stream::<f32>(&device, config, mixer, h),
                    SampleFormat::F64 => build_stream::<f64>(&device, config, mixer, h),
                    SampleFormat::I16 => build_stream::<i16>(&device, config, mixer, h),
                    SampleFormat::I24 => build_stream::<I24>(&device, config, mixer, h),
                    SampleFormat::I32 => build_stream::<i32>(&device, config, mixer, h),
                    SampleFormat::U16 => build_stream::<u16>(&device, config, mixer, h),
                    other => Err(format!("Unsupported sample format {other}")),
                }?;
                stream
                    .play()
                    .map_err(|e| format!("Could not start audio output: {e}"))?;
                let info = ActiveOutput {
                    id: device_id_or_default(&device),
                    name: device_name(&device),
                    channels: config.channels,
                    sample_rate: config.sample_rate,
                    buffer_frames,
                };
                Ok((stream, info))
            })();
            match opened {
                Ok((stream, info)) => {
                    let _ = ready_tx.send(Ok(info));
                    // Park until the handle is dropped (sender closed).
                    let _ = stop_rx.recv();
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| format!("Could not start audio thread: {e}"))?;

    let info = ready_rx
        .recv()
        .map_err(|_| "Audio thread exited unexpectedly".to_string())??;
    Ok(OutputStream {
        info,
        health,
        stop: Some(stop_tx),
        thread: Some(thread),
    })
}

fn device_id_or_default(device: &Device) -> String {
    device_id(device).unwrap_or_default()
}
