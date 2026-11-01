mod commands;
pub mod config;
pub mod engine;
mod fs;
pub mod project;
pub mod routing;

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use commands::{lock, AppState};
use config::AppConfig;
use engine::device::{self, DeviceInfo};
use engine::Engine;
use routing::MonitorMode;

const HOUSEKEEPING_TICK: Duration = Duration::from_millis(250);
/// How often the device list is rescanned. Cheap, but no need to hammer the
/// OS audio APIs.
const DEVICE_SCAN_EVERY: u32 = 8; // ticks -> 2 s
/// After a failed reconnect, wait this long before trying again, so a device
/// that is present but refusing to open doesn't cause constant reopening.
const RECONNECT_BACKOFF: Duration = Duration::from_secs(10);

/// Runs before any page script on every load. A window reload must always
/// land on the Library: reopening e.g. /project/<id> directly would mount
/// that screen before the library has loaded, and it would treat the
/// not-yet-known song as new (edit form with blank fields, which Save would
/// write back). On the phone you only ever arrive there from the Library.
const BOOT_SCRIPT: &str = r#"
if (window.location.pathname !== "/") {
  window.history.replaceState(null, "", "/");
}
"#;

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
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("vvs-boot")
                .js_init_script(BOOT_SCRIPT.to_string())
                .build(),
        )
        .register_uri_scheme_protocol("vvsfs", |_ctx, request| fs::handle(request))
        .setup(|app| {
            // VVS_SELFTEST=1 runs the end-to-end self-test (desktop/web/
            // selftest.ts) against a throwaway directory - never the user's
            // library or config.
            let selftest_dir = commands::selftest_requested().then(commands::selftest_dir);
            // The mobile app's files (songs, folders, settings) live here,
            // laid out exactly as on the phone.
            fs::init(match &selftest_dir {
                Some(dir) => fs::Roots {
                    document: dir.join("documents"),
                    cache: dir.join("cache"),
                },
                None => fs::Roots {
                    document: app.path().app_data_dir()?.join("documents"),
                    cache: app.path().app_cache_dir()?,
                },
            });
            let config_dir = match &selftest_dir {
                Some(dir) => dir.join("config"),
                None => app.path().app_config_dir()?,
            };
            let config_path = config::config_path(config_dir);
            let config = AppConfig::load(&config_path);

            let mut engine = Engine::new(MonitorMode::Split, config.routing.clone());
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

            app.manage(AppState::new(engine, config, config_path));

            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("vvs-housekeeping".into())
                .spawn(move || housekeeping(handle))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::audio_decode,
            commands::engine_load,
            commands::engine_unload,
            commands::play,
            commands::pause,
            commands::stop,
            commands::seek,
            commands::get_status,
            commands::set_track_volume,
            commands::set_track_muted,
            commands::set_track_soloed,
            commands::set_track_bus,
            commands::set_click_enabled,
            commands::set_monitor_mode,
            commands::list_devices,
            commands::get_settings,
            commands::select_device,
            commands::set_output_name,
            commands::get_routing,
            commands::set_track_routing,
            commands::set_click_routing,
            commands::log_from_webview,
            commands::selftest_mode,
            commands::selftest_finish,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Virtual VS");
}
