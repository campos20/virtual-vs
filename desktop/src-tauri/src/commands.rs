//! The webview's API. The UI is the mobile app (rendered with
//! react-native-web); `desktop/web/engine/AudioEngine.ts` maps the mobile
//! `AudioEngine` onto these commands, and the desktop-only screens use the
//! device and routing ones.
//!
//! Every command is `async`, so it runs on Tauri's worker pool rather than
//! the main thread: a panic there fails that one call instead of taking the
//! app - and whatever is playing - down.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::AppConfig;
use crate::engine::decode;
use crate::engine::device::{self, ActiveOutput, DeviceInfo};
use crate::engine::mixer::StemAudio;
use crate::engine::{Engine, EngineStatus, LoadedProject, ProjectStem, TrackState};
use crate::project::Bus;
use crate::routing::{MonitorMode, OutputTarget, ResolvedRoute, RouteScope};

/// Waveform resolution sent with each decoded stem. The UI draws at most a
/// few thousand bars per song, so this is plenty and stays small (a
/// 6-minute stem is ~36k floats).
const PEAKS_PER_SECOND: u32 = 100;

struct CachedStem {
    path: PathBuf,
    sample_rate: u32,
    audio: Arc<StemAudio>,
}

pub struct AppState {
    pub engine: Mutex<Engine>,
    pub config: Mutex<AppConfig>,
    pub config_path: PathBuf,
    /// Stems decoded by `audio_decode`, waiting for `engine_load`.
    decoded: Mutex<HashMap<u64, CachedStem>>,
    next_buffer_id: AtomicU64,
}

impl AppState {
    pub fn new(engine: Engine, config: AppConfig, config_path: PathBuf) -> Self {
        AppState {
            engine: Mutex::new(engine),
            config: Mutex::new(config),
            config_path,
            decoded: Mutex::new(HashMap::new()),
            next_buffer_id: AtomicU64::new(1),
        }
    }

    fn update_config(&self, change: impl FnOnce(&mut AppConfig)) -> Result<AppConfig, String> {
        let mut config = lock(&self.config);
        change(&mut config);
        config.save(&self.config_path)?;
        Ok(config.clone())
    }
}

/// A panic elsewhere must not leave the engine unusable mid-show; the state
/// behind a poisoned lock is still consistent for our purposes.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}

// --- DTOs --------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    device_id: Option<String>,
    buffer_frames: Option<u32>,
    output: Option<ActiveOutput>,
    /// One label per output of the open device ("" when unnamed).
    output_names: Vec<String>,
}

fn settings_dto(config: &AppConfig, output: Option<ActiveOutput>) -> SettingsDto {
    let output_names = match &output {
        Some(out) => {
            let mut names = config
                .output_names
                .get(&out.id)
                .cloned()
                .unwrap_or_default();
            names.resize(out.channels as usize, String::new());
            names
        }
        None => Vec::new(),
    };
    SettingsDto {
        device_id: config.device_id.clone(),
        buffer_frames: config.buffer_frames,
        output,
        output_names,
    }
}

fn current_settings(state: &AppState) -> SettingsDto {
    let output = lock(&state.engine).output_info().cloned();
    settings_dto(&lock(&state.config), output)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedDto {
    buffer_id: u64,
    sample_rate: u32,
    frames: u64,
    duration_sec: f64,
    peaks_per_second: u32,
    peaks: Vec<f32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTrack {
    id: String,
    name: String,
    bus: Bus,
    buffer_id: u64,
    volume: f32,
    muted: bool,
    soloed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    project_id: String,
    bpm: Option<f64>,
    click_enabled: bool,
    tracks: Vec<LoadTrack>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDto {
    duration_sec: f64,
    has_click: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingTrackDto {
    id: String,
    name: String,
    route: ResolvedRoute,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingDto {
    channels: u16,
    output_names: Vec<String>,
    project_id: Option<String>,
    tracks: Vec<RoutingTrackDto>,
    click: Option<ResolvedRoute>,
}

fn routing_dto(state: &AppState) -> RoutingDto {
    let config = lock(&state.config).clone();
    let engine = lock(&state.engine);
    let output = engine.output_info().cloned();
    let channels = output.as_ref().map_or(2, |o| o.channels);
    let settings = settings_dto(&config, output);
    let project = engine.project();
    RoutingDto {
        channels,
        output_names: settings.output_names,
        project_id: project.map(|p| p.project_id.clone()),
        tracks: project
            .map(|p| {
                p.tracks
                    .iter()
                    .map(|t| RoutingTrackDto {
                        id: t.id.clone(),
                        name: t.name.clone(),
                        route: config.routing.track_route(
                            &p.project_id,
                            &t.id,
                            &t.name,
                            t.bus,
                            channels as usize,
                        ),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        click: project
            .filter(|p| p.has_click())
            .map(|_| config.routing.click_route()),
    }
}

// --- Shared operations (also used by the device watcher in lib.rs) -----------

/// Opens a device. If its sample rate differs from the loaded song's, every
/// stem is re-decoded together at the new rate before the song is installed
/// again - never a mix of rates, which would drift. Blocking. Emits
/// `device-changed`.
pub fn open_device_blocking(
    app: &AppHandle,
    device_id: Option<String>,
    buffer_frames: Option<u32>,
) -> Result<SettingsDto, String> {
    let state = app.state::<AppState>();
    let needs_redecode = lock(&state.engine).open_device(device_id, buffer_frames)?;
    let mut result = Ok(());
    if needs_redecode {
        let project = lock(&state.engine).take_project();
        let rate = lock(&state.engine).sample_rate();
        if let (Some(project), Some(rate)) = (project, rate) {
            result = project
                .redecoded(rate)
                .and_then(|p| lock(&state.engine).install_project(p))
                .map_err(|e| format!("The song could not be prepared for this device: {e}"));
        }
    }
    let settings = current_settings(&state);
    let _ = app.emit("device-changed", settings.clone());
    result.map(|_| settings)
}

// --- Audio -------------------------------------------------------------------

/// Decodes one stem at the device's current rate and keeps it until
/// `engine_load` installs it. Returns what the UI needs without the audio
/// itself: duration and a waveform envelope.
#[tauri::command]
pub async fn audio_decode(state: State<'_, AppState>, path: String) -> Result<DecodedDto, String> {
    let rate = lock(&state.engine)
        .sample_rate()
        .ok_or("No audio output is open")?;
    let file = PathBuf::from(&path);
    let decode_path = file.clone();
    let audio = blocking(move || decode::decode_stem(&decode_path, rate)).await?;
    let dto = DecodedDto {
        buffer_id: state.next_buffer_id.fetch_add(1, Ordering::Relaxed),
        sample_rate: rate,
        frames: audio.frames() as u64,
        duration_sec: audio.frames() as f64 / rate as f64,
        peaks_per_second: PEAKS_PER_SECOND,
        peaks: decode::peaks(&audio, rate, PEAKS_PER_SECOND),
    };
    lock(&state.decoded).insert(
        dto.buffer_id,
        CachedStem {
            path: file,
            sample_rate: rate,
            audio: Arc::new(audio),
        },
    );
    Ok(dto)
}

/// Installs a song from stems decoded by `audio_decode`. Whatever was
/// playing fades out and the whole song is replaced at once. Stems decoded
/// at another rate (the device changed mid-load) are decoded again so every
/// stem shares the device's rate.
#[tauri::command]
pub async fn engine_load(
    state: State<'_, AppState>,
    request: LoadRequest,
) -> Result<LoadedDto, String> {
    let rate = lock(&state.engine)
        .sample_rate()
        .ok_or("No audio output is open")?;

    let mut sources = Vec::with_capacity(request.tracks.len());
    {
        let mut cache = lock(&state.decoded);
        for track in &request.tracks {
            let cached = cache.remove(&track.buffer_id).ok_or_else(|| {
                format!(
                    "{}: the decoded audio is gone; load the song again",
                    track.name
                )
            })?;
            sources.push(cached);
        }
        // Anything decoded before this load's stems belongs to a load that
        // was superseded and will never be installed - free it.
        if let Some(oldest) = request.tracks.iter().map(|t| t.buffer_id).min() {
            cache.retain(|id, _| *id > oldest);
        }
    }

    let tracks: Vec<TrackState> = request
        .tracks
        .iter()
        .map(|t| TrackState {
            id: t.id.clone(),
            name: t.name.clone(),
            bus: t.bus,
            volume: t.volume,
            muted: t.muted,
            soloed: t.soloed,
        })
        .collect();
    let project_id = request.project_id.clone();
    let bpm = request.bpm;
    let click_enabled = request.click_enabled;

    let project = blocking(move || {
        let mut stems = Vec::with_capacity(sources.len());
        for (cached, track) in sources.into_iter().zip(&tracks) {
            let audio = if cached.sample_rate == rate {
                cached.audio
            } else {
                Arc::new(
                    decode::decode_stem(&cached.path, rate)
                        .map_err(|e| format!("{}: {e}", track.name))?,
                )
            };
            stems.push(ProjectStem {
                path: cached.path,
                audio,
            });
        }
        LoadedProject::assemble(project_id, bpm, click_enabled, tracks, stems, rate)
    })
    .await?;

    let dto = LoadedDto {
        duration_sec: project.duration_sec(),
        has_click: project.has_click(),
    };
    lock(&state.engine).install_project(project)?;
    Ok(dto)
}

#[tauri::command]
pub async fn engine_unload(state: State<'_, AppState>) -> Result<(), String> {
    drop(lock(&state.engine).take_project());
    Ok(())
}

#[tauri::command]
pub async fn play(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state.engine).play();
    Ok(())
}

#[tauri::command]
pub async fn pause(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state.engine).pause();
    Ok(())
}

#[tauri::command]
pub async fn stop(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state.engine).stop();
    Ok(())
}

#[tauri::command]
pub async fn seek(state: State<'_, AppState>, sec: f64) -> Result<(), String> {
    lock(&state.engine).seek(sec);
    Ok(())
}

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    Ok(lock(&state.engine).status())
}

#[tauri::command]
pub async fn set_track_volume(
    state: State<'_, AppState>,
    track_id: String,
    volume: f32,
) -> Result<(), String> {
    lock(&state.engine).set_track_volume(&track_id, volume);
    Ok(())
}

#[tauri::command]
pub async fn set_track_muted(
    state: State<'_, AppState>,
    track_id: String,
    muted: bool,
) -> Result<(), String> {
    lock(&state.engine).set_track_muted(&track_id, muted);
    Ok(())
}

#[tauri::command]
pub async fn set_track_soloed(
    state: State<'_, AppState>,
    track_id: String,
    soloed: bool,
) -> Result<(), String> {
    lock(&state.engine).set_track_soloed(&track_id, soloed);
    Ok(())
}

#[tauri::command]
pub async fn set_track_bus(
    state: State<'_, AppState>,
    track_id: String,
    bus: Bus,
) -> Result<(), String> {
    lock(&state.engine).set_track_bus(&track_id, bus);
    Ok(())
}

#[tauri::command]
pub async fn set_click_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    lock(&state.engine).set_click_enabled(enabled);
    Ok(())
}

/// Mirrors the mobile split/monitor switch. The mobile store owns the value
/// (and re-sends it on every load), so it isn't persisted here.
#[tauri::command]
pub async fn set_monitor_mode(state: State<'_, AppState>, mode: MonitorMode) -> Result<(), String> {
    lock(&state.engine).set_monitor_mode(mode);
    Ok(())
}

// --- Devices -----------------------------------------------------------------

#[tauri::command]
pub async fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    blocking(|| Ok(device::list_output_devices())).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsDto, String> {
    Ok(current_settings(&state))
}

#[tauri::command]
pub async fn select_device(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: Option<String>,
    buffer_frames: Option<u32>,
) -> Result<SettingsDto, String> {
    state.update_config(|c| {
        c.device_id = device_id.clone();
        c.buffer_frames = buffer_frames;
    })?;
    lock(&state.engine).set_preferred_device(device_id.clone(), buffer_frames);
    blocking(move || open_device_blocking(&app, device_id, buffer_frames)).await
}

#[tauri::command]
pub async fn set_output_name(
    state: State<'_, AppState>,
    channel: usize,
    name: String,
) -> Result<SettingsDto, String> {
    let output = lock(&state.engine).output_info().cloned();
    let device_id = output.as_ref().ok_or("No audio output is open")?.id.clone();
    let config = state.update_config(|c| c.set_output_name(&device_id, channel, name))?;
    Ok(settings_dto(&config, output))
}

// --- Routing -----------------------------------------------------------------

#[tauri::command]
pub async fn get_routing(state: State<'_, AppState>) -> Result<RoutingDto, String> {
    Ok(routing_dto(&state))
}

/// Routes a track of the loaded song. `scope` decides whether the route is
/// for every song with a track of this name or pinned to this song;
/// `targets: None` clears it at that scope.
#[tauri::command]
pub async fn set_track_routing(
    state: State<'_, AppState>,
    track_id: String,
    scope: RouteScope,
    targets: Option<Vec<OutputTarget>>,
) -> Result<RoutingDto, String> {
    let (project_id, track_name) = {
        let engine = lock(&state.engine);
        let project = engine.project().ok_or("No song loaded")?;
        let track = project
            .tracks
            .iter()
            .find(|t| t.id == track_id)
            .ok_or("Unknown track")?;
        (project.project_id.clone(), track.name.clone())
    };
    let config = state.update_config(|c| {
        c.routing
            .set_track_route(scope, &project_id, &track_id, &track_name, targets)
    })?;
    lock(&state.engine).set_routing(config.routing);
    Ok(routing_dto(&state))
}

#[tauri::command]
pub async fn set_click_routing(
    state: State<'_, AppState>,
    targets: Option<Vec<OutputTarget>>,
) -> Result<RoutingDto, String> {
    let config = state.update_config(|c| c.routing.click = targets)?;
    lock(&state.engine).set_routing(config.routing);
    Ok(routing_dto(&state))
}

// --- Diagnostics -------------------------------------------------------------

/// Webview errors and warnings land in the app's log (stderr), so a problem
/// in the UI layer can be diagnosed after a show.
#[tauri::command]
pub async fn log_from_webview(level: String, message: String) -> Result<(), String> {
    eprintln!("[webview {level}] {message}");
    Ok(())
}

// --- Self-test -----------------------------------------------------------------

pub fn selftest_requested() -> bool {
    std::env::var("VVS_SELFTEST").is_ok_and(|v| v == "1")
}

/// The throwaway directory a self-test run uses instead of the user's data.
pub fn selftest_dir() -> PathBuf {
    std::env::temp_dir().join(format!("vvs-selftest-{}", std::process::id()))
}

#[tauri::command]
pub async fn selftest_mode() -> Result<bool, String> {
    Ok(selftest_requested())
}

/// Ends a self-test run: prints the result and exits with 0 (pass) or 1.
#[tauri::command]
pub async fn selftest_finish(app: AppHandle, passed: bool, summary: String) -> Result<(), String> {
    if !selftest_requested() {
        return Err("Not in self-test mode".to_string());
    }
    eprintln!(
        "[selftest] {} - {summary}",
        if passed { "PASSED" } else { "FAILED" }
    );
    let _ = std::fs::remove_dir_all(selftest_dir());
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}
