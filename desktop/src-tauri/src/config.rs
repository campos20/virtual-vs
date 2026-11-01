//! Per-machine settings: which audio device, how its outputs are routed, and
//! the library of project folders. Lives in the OS app-config directory, not
//! in any project - it describes this rig, not a song.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::project::write_atomic;
use crate::routing::{MonitorMode, RoutingConfig};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// `None` follows the system default output.
    #[serde(default)]
    pub device_id: Option<String>,
    /// `None` uses the driver's default buffer size.
    #[serde(default)]
    pub buffer_frames: Option<u32>,
    #[serde(default)]
    pub monitor_mode: MonitorMode,
    #[serde(default)]
    pub routing: RoutingConfig,
    /// Project folders, in Library order.
    #[serde(default)]
    pub library: Vec<String>,
    /// Device id -> a label per output ("IEM Drummer", "FOH Bass"...), so the
    /// routing matrix speaks the stage's language. Empty strings mean unnamed.
    #[serde(default)]
    pub output_names: HashMap<String, Vec<String>>,
}

impl AppConfig {
    pub fn set_output_name(&mut self, device_id: &str, channel: usize, name: String) {
        let names = self.output_names.entry(device_id.to_string()).or_default();
        if names.len() <= channel {
            names.resize(channel + 1, String::new());
        }
        names[channel] = name.trim().to_string();
        while names.last().is_some_and(String::is_empty) {
            names.pop();
        }
        if names.is_empty() {
            self.output_names.remove(device_id);
        }
    }
}

impl AppConfig {
    /// A missing or unreadable config falls back to defaults rather than
    /// refusing to start - the app must always come up on stage. A corrupt
    /// file is kept aside so it isn't silently lost.
    pub fn load(path: &Path) -> AppConfig {
        let Ok(text) = fs::read_to_string(path) else {
            return AppConfig::default();
        };
        match serde_json::from_str(&text) {
            Ok(config) => config,
            Err(_) => {
                let _ = fs::rename(path, path.with_extension("json.corrupt"));
                AppConfig::default()
            }
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(path, text.as_bytes())
    }
}

pub fn config_path(config_dir: PathBuf) -> PathBuf {
    config_dir.join("config.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_survives_corruption() {
        let dir = std::env::temp_dir().join(format!("vvs-config-{}", std::process::id()));
        let path = config_path(dir.clone());
        let mut config = AppConfig::default();
        config.library.push("/songs/a".into());
        config.buffer_frames = Some(256);
        config.save(&path).unwrap();
        let loaded = AppConfig::load(&path);
        assert_eq!(loaded.library, vec!["/songs/a".to_string()]);
        assert_eq!(loaded.buffer_frames, Some(256));

        fs::write(&path, "{ not json").unwrap();
        let fallback = AppConfig::load(&path);
        assert!(fallback.library.is_empty());
        assert!(path.with_extension("json.corrupt").exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn output_names_are_trimmed_and_cleared() {
        let mut config = AppConfig::default();
        config.set_output_name("dev", 2, " FOH Drums ".into());
        assert_eq!(config.output_names["dev"], vec!["", "", "FOH Drums"]);
        config.set_output_name("dev", 2, "".into());
        assert!(config.output_names.is_empty());
    }
}
