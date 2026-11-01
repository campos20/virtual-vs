//! The UI's API. Every command is a thin layer over `Engine`/`AppConfig`;
//! nothing here touches audio directly.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::config::AppConfig;
use crate::engine::device::{self, ActiveOutput, DeviceInfo};
use crate::engine::{self, Engine, EngineStatus, LoadedProject, TrackState};
use crate::project::{self, MixPatch, SectionManifest};
use crate::routing::{MonitorMode, OutputTarget, RoutingConfig};

pub struct AppState {
    pub engine: Mutex<Engine>,
    pub config: Mutex<AppConfig>,
    pub config_path: PathBuf,
    /// Bumped by every `load_project`; a decode that finishes after a newer
    /// load started is discarded instead of replacing the newer song.
    pub load_generation: AtomicU64,
}

/// A panic elsewhere must not leave the engine unusable mid-show; the state
/// behind a poisoned lock is still consistent for our purposes.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    fn update_config(&self, change: impl FnOnce(&mut AppConfig)) -> Result<AppConfig, String> {
        let mut config = lock(&self.config);
        change(&mut config);
        config.save(&self.config_path)?;
        Ok(config.clone())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    device_id: Option<String>,
    buffer_frames: Option<u32>,
    monitor_mode: MonitorMode,
    /// Raw config: `None` entries mean "default".
    routing: RoutingConfig,
    /// What cue/main/click resolve to on the current device.
    cue: Vec<OutputTarget>,
    main: Vec<OutputTarget>,
    click: Vec<OutputTarget>,
    output: Option<ActiveOutput>,
}

fn settings_dto(config: &AppConfig, output: Option<ActiveOutput>) -> SettingsDto {
    let channels = output.as_ref().map_or(2, |o| o.channels as usize);
    let routing = &config.routing;
    SettingsDto {
        device_id: config.device_id.clone(),
        buffer_frames: config.buffer_frames,
        monitor_mode: config.monitor_mode,
        cue: routing.cue_targets(),
        main: routing.main_targets(channels),
        click: routing
            .click
            .clone()
            .unwrap_or_else(|| routing.cue_targets()),
        routing: routing.clone(),
        output,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    #[serde(flatten)]
    state: TrackState,
    /// This machine's per-track routing, if any (otherwise the bus decides).
    routing_override: Option<Vec<OutputTarget>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    dir: String,
    id: String,
    title: String,
    bpm: Option<f64>,
    key: String,
    sections: Vec<SectionManifest>,
    lyrics: Option<String>,
    duration_sec: f64,
    has_click: bool,
    click_enabled: bool,
    tracks: Vec<TrackDto>,
}

fn project_dto(project: &LoadedProject, routing: &RoutingConfig) -> ProjectDto {
    let m = &project.manifest;
    ProjectDto {
        dir: project.dir.to_string_lossy().into_owned(),
        id: m.id.clone(),
        title: m.title.clone(),
        bpm: m.bpm,
        key: m.key.clone(),
        sections: m.sections.clone(),
        lyrics: m.lyrics.clone(),
        duration_sec: project.duration_sec(),
        has_click: project.has_click(),
        click_enabled: project.click_enabled,
        tracks: project
            .tracks
            .iter()
            .map(|t| TrackDto {
                state: t.clone(),
                routing_override: routing.track_override(&m.id, &t.id).cloned(),
            })
            .collect(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntryDto {
    dir: String,
    id: Option<String>,
    title: Option<String>,
    bpm: Option<f64>,
    key: Option<String>,
    track_count: usize,
    /// Set when the folder is gone or its manifest can't be read - shown in
    /// the Library rather than silently dropping the song from the list.
    error: Option<String>,
}

fn library_entry(dir: &str) -> LibraryEntryDto {
    match project::read_manifest(Path::new(dir)) {
        Ok(m) => LibraryEntryDto {
            dir: dir.to_string(),
            id: Some(m.id),
            title: Some(m.title),
            bpm: m.bpm,
            key: Some(m.key),
            track_count: m.tracks.len(),
            error: None,
        },
        Err(e) => LibraryEntryDto {
            dir: dir.to_string(),
            id: None,
            title: None,
            bpm: None,
            key: None,
            track_count: 0,
            error: Some(e),
        },
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProgress {
    current: usize,
    total: usize,
    name: String,
}

// --- Devices & settings ------------------------------------------------------

#[tauri::command]
pub fn list_devices() -> Vec<DeviceInfo> {
    device::list_output_devices()
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> SettingsDto {
    let output = lock(&state.engine).output_info().cloned();
    settings_dto(&lock(&state.config), output)
}

#[tauri::command]
pub async fn select_device(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: Option<String>,
    buffer_frames: Option<u32>,
) -> Result<SettingsDto, String> {
    let needs_reload = lock(&state.engine).open_device(device_id.clone(), buffer_frames)?;
    let config = state.update_config(|c| {
        c.device_id = device_id;
        c.buffer_frames = buffer_frames;
    })?;
    if needs_reload {
        let dir = lock(&state.engine).project().map(|p| p.dir.clone());
        if let Some(dir) = dir {
            load_project(app, state.clone(), dir.to_string_lossy().into_owned()).await?;
        }
    }
    let output = lock(&state.engine).output_info().cloned();
    Ok(settings_dto(&config, output))
}

#[tauri::command]
pub fn set_monitor_mode(state: State<AppState>, mode: MonitorMode) -> Result<SettingsDto, String> {
    let config = state.update_config(|c| c.monitor_mode = mode)?;
    let mut engine = lock(&state.engine);
    engine.set_monitor_mode(mode);
    Ok(settings_dto(&config, engine.output_info().cloned()))
}

/// `bus` is `"cue"`, `"main"` or `"click"`; `targets: None` restores the default.
#[tauri::command]
pub fn set_bus_routing(
    state: State<AppState>,
    bus: String,
    targets: Option<Vec<OutputTarget>>,
) -> Result<SettingsDto, String> {
    let config = state.update_config(|c| match bus.as_str() {
        "cue" => c.routing.cue = targets,
        "main" => c.routing.main = targets,
        "click" => c.routing.click = targets,
        _ => {}
    })?;
    let mut engine = lock(&state.engine);
    engine.set_routing(config.routing.clone());
    Ok(settings_dto(&config, engine.output_info().cloned()))
}

#[tauri::command]
pub fn set_track_routing(
    state: State<AppState>,
    project_id: String,
    track_id: String,
    targets: Option<Vec<OutputTarget>>,
) -> Result<(), String> {
    let config = state.update_config(|c| {
        c.routing
            .set_track_override(&project_id, &track_id, targets)
    })?;
    lock(&state.engine).set_routing(config.routing);
    Ok(())
}

// --- Library -----------------------------------------------------------------

#[tauri::command]
pub fn library_list(state: State<AppState>) -> Vec<LibraryEntryDto> {
    let dirs = lock(&state.config).library.clone();
    dirs.iter().map(|d| library_entry(d)).collect()
}

#[tauri::command]
pub fn library_add(state: State<AppState>, dir: String) -> Result<Vec<LibraryEntryDto>, String> {
    // Validate before adding, so a folder without a manifest is rejected
    // with a clear message instead of sitting in the list as an error.
    project::read_manifest(Path::new(&dir))?;
    let config = state.update_config(|c| {
        if !c.library.contains(&dir) {
            c.library.push(dir.clone());
        }
    })?;
    Ok(config.library.iter().map(|d| library_entry(d)).collect())
}

#[tauri::command]
pub fn library_remove(state: State<AppState>, dir: String) -> Result<Vec<LibraryEntryDto>, String> {
    let config = state.update_config(|c| c.library.retain(|d| d != &dir))?;
    Ok(config.library.iter().map(|d| library_entry(d)).collect())
}

#[tauri::command]
pub fn library_move(
    state: State<AppState>,
    dir: String,
    to_index: usize,
) -> Result<Vec<LibraryEntryDto>, String> {
    let config = state.update_config(|c| {
        if let Some(from) = c.library.iter().position(|d| d == &dir) {
            let entry = c.library.remove(from);
            let to = to_index.min(c.library.len());
            c.library.insert(to, entry);
        }
    })?;
    Ok(config.library.iter().map(|d| library_entry(d)).collect())
}

// --- Project & transport -----------------------------------------------------

#[tauri::command]
pub async fn load_project(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
) -> Result<ProjectDto, String> {
    let generation = state.load_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let path = PathBuf::from(&dir);
    let manifest = project::read_manifest(&path)?;
    let rate = lock(&state.engine)
        .sample_rate()
        .ok_or("No audio output is open")?;

    let progress_app = app.clone();
    let decoded = tauri::async_runtime::spawn_blocking(move || {
        engine::decode_project(&path, manifest, rate, &|current, total, name| {
            let _ = progress_app.emit(
                "load-progress",
                LoadProgress {
                    current,
                    total,
                    name: name.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("Loading failed: {e}"))??;

    if state.load_generation.load(Ordering::Acquire) != generation {
        return Err("superseded".to_string());
    }
    let routing = lock(&state.config).routing.clone();
    let mut engine = lock(&state.engine);
    engine.install_project(decoded)?;
    Ok(project_dto(
        engine.project().expect("just installed"),
        &routing,
    ))
}

#[tauri::command]
pub fn play(state: State<AppState>) {
    lock(&state.engine).play();
}

#[tauri::command]
pub fn pause(state: State<AppState>) {
    lock(&state.engine).pause();
}

#[tauri::command]
pub fn stop(state: State<AppState>) {
    lock(&state.engine).stop();
}

#[tauri::command]
pub fn seek(state: State<AppState>, sec: f64) {
    lock(&state.engine).seek(sec);
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> EngineStatus {
    lock(&state.engine).status()
}

/// Writes the current mix into the project's manifest, like the mobile app.
fn persist_mix(engine: &Engine) -> Result<(), String> {
    let Some(project) = engine.project() else {
        return Ok(());
    };
    let tracks: Vec<(String, f32, bool, bool)> = project
        .tracks
        .iter()
        .map(|t| (t.id.clone(), t.volume, t.muted, t.soloed))
        .collect();
    project::write_mix(
        &project.dir,
        &MixPatch {
            tracks: &tracks,
            click_enabled: Some(project.click_enabled),
        },
    )
}

/// Called continuously while a fader moves (`commit: false`) and once on
/// release (`commit: true`), which is when it's written to disk.
#[tauri::command]
pub fn set_track_volume(
    state: State<AppState>,
    track_id: String,
    volume: f32,
    commit: bool,
) -> Result<(), String> {
    let mut engine = lock(&state.engine);
    engine.set_track_volume(&track_id, volume);
    if commit {
        persist_mix(&engine)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn set_track_muted(
    state: State<AppState>,
    track_id: String,
    muted: bool,
) -> Result<(), String> {
    let mut engine = lock(&state.engine);
    engine.set_track_muted(&track_id, muted);
    persist_mix(&engine)
}

#[tauri::command]
pub fn set_track_soloed(
    state: State<AppState>,
    track_id: String,
    soloed: bool,
) -> Result<(), String> {
    let mut engine = lock(&state.engine);
    engine.set_track_soloed(&track_id, soloed);
    persist_mix(&engine)
}

#[tauri::command]
pub fn set_click_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let mut engine = lock(&state.engine);
    engine.set_click_enabled(enabled);
    persist_mix(&engine)
}
