mod commands;
pub mod config;
pub mod engine;
pub mod project;
pub mod routing;

use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use commands::{lock, AppState};
use config::AppConfig;
use engine::device::{self, DeviceInfo};
use engine::Engine;

const HOUSEKEEPING_TICK: Duration = Duration::from_millis(250);
/// How often the device list is rescanned. Cheap, but no need to hammer the
/// OS audio APIs.
const DEVICE_SCAN_EVERY: u32 = 8; // ticks -> 2 s
/// After a failed reconnect, wait this long before trying again, so a device
/// that is present but refusing to open doesn't cause constant reopening.
const RECONNECT_BACKOFF: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevicesChanged {
    devices: Vec<DeviceInfo>,
    /// Ids that appeared since the last scan - the UI offers to switch to a
    /// newly connected interface.
    added: Vec<String>,
}

/// Runs for the app's lifetime: frees replaced projects off the audio thread,
/// notices interfaces being plugged/unplugged, and reconnects the preferred
/// device when it's safe to (see `Engine::reconnect_target`).
fn housekeeping(app: AppHandle) {
    let mut tick: u32 = 0;
    let mut known: Option<Vec<String>> = None;
    let mut last_failed: Option<Instant> = None;
    loop {
        std::thread::sleep(HOUSEKEEPING_TICK);
        tick = tick.wrapping_add(1);
        let state = app.state::<AppState>();
        lock(&state.engine).collect_garbage();
        if !tick.is_multiple_of(DEVICE_SCAN_EVERY) {
            continue;
        }

        // Enumerate without holding the engine lock.
        let devices = device::list_output_devices();
        let mut ids: Vec<String> = devices.iter().map(|d| d.id.clone()).collect();
        ids.sort();
        if known.as_ref() != Some(&ids) {
            // The first scan only establishes what's there - nothing is "new".
            let added = match &known {
                Some(previous) => ids
                    .iter()
                    .filter(|id| !previous.contains(id))
                    .cloned()
                    .collect(),
                None => Vec::new(),
            };
            known = Some(ids);
            let _ = app.emit(
                "devices-changed",
                DevicesChanged {
                    devices: devices.clone(),
                    added,
                },
            );
        }

        if last_failed.is_some_and(|t| t.elapsed() < RECONNECT_BACKOFF) {
            continue;
        }
        let Some((preferred, buffer)) = lock(&state.engine).reconnect_target() else {
            continue;
        };
        let available = match &preferred {
            Some(id) => devices.iter().any(|d| &d.id == id),
            None => devices.iter().any(|d| d.is_default),
        };
        if !available {
            continue;
        }
        if commands::open_device_blocking(&app, preferred, buffer).is_err() {
            last_failed = Some(Instant::now());
            // Never leave the app without any output: go back to the default.
            let _ = commands::open_device_blocking(&app, None, buffer);
        } else {
            last_failed = None;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let config_path = config::config_path(config_dir);
            let config = AppConfig::load(&config_path);

            let mut engine = Engine::new(config.monitor_mode, config.routing.clone());
            engine.set_preferred_device(config.device_id.clone(), config.buffer_frames);
            // A saved interface that isn't plugged in falls back to the system
            // default, so the app always comes up with sound if it can. The
            // housekeeping thread switches back once the interface appears.
            if engine
                .open_device(config.device_id.clone(), config.buffer_frames)
                .is_err()
            {
                let _ = engine.open_device(None, config.buffer_frames);
            }

            app.manage(AppState {
                engine: Mutex::new(engine),
                config: Mutex::new(config),
                config_path,
                load_generation: AtomicU64::new(0),
            });

            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("vvs-housekeeping".into())
                .spawn(move || housekeeping(handle))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::get_settings,
            commands::select_device,
            commands::set_monitor_mode,
            commands::set_output_name,
            commands::set_track_routing,
            commands::set_click_routing,
            commands::library_list,
            commands::library_add,
            commands::library_remove,
            commands::library_move,
            commands::load_project,
            commands::get_project,
            commands::play,
            commands::pause,
            commands::stop,
            commands::seek,
            commands::get_status,
            commands::set_track_volume,
            commands::set_track_muted,
            commands::set_track_soloed,
            commands::set_click_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Virtual VS");
}
