mod commands;
pub mod config;
pub mod engine;
pub mod project;
pub mod routing;

use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

use commands::AppState;
use config::AppConfig;
use engine::Engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let config_path = config::config_path(config_dir);
            let config = AppConfig::load(&config_path);

            let mut engine = Engine::new(config.monitor_mode, config.routing.clone());
            // A saved device that's not plugged in falls back to the system
            // default, so the app always comes up with sound if it can. The
            // UI shows which device is actually open.
            if engine
                .open_device(config.device_id.clone(), config.buffer_frames)
                .is_err()
            {
                let _ = engine.open_device(None, None);
            }

            app.manage(AppState {
                engine: Mutex::new(engine),
                config: Mutex::new(config),
                config_path,
                load_generation: AtomicU64::new(0),
            });

            // Frees replaced projects off the audio thread.
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("vvs-housekeeping".into())
                .spawn(move || loop {
                    std::thread::sleep(Duration::from_millis(250));
                    let state = handle.state::<AppState>();
                    let mut engine = state.engine.lock().unwrap_or_else(|e| e.into_inner());
                    engine.collect_garbage();
                })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_devices,
            commands::get_settings,
            commands::select_device,
            commands::set_monitor_mode,
            commands::set_bus_routing,
            commands::set_track_routing,
            commands::library_list,
            commands::library_add,
            commands::library_remove,
            commands::library_move,
            commands::load_project,
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
