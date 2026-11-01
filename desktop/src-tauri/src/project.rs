//! The project folder format shared with the mobile app: a directory holding
//! `manifest.json` plus the stem files it references. Mirrors
//! `src/types/project.ts` - keep the two in step.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MANIFEST_FILE: &str = "manifest.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Bus {
    Main,
    Cue,
    Both,
}

fn default_gain() -> f32 {
    1.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackManifest {
    pub id: String,
    pub name: String,
    pub file: String,
    #[serde(default = "default_gain")]
    pub gain: f32,
    pub bus: Bus,
    #[serde(default)]
    pub muted: Option<bool>,
    #[serde(default)]
    pub soloed: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionManifest {
    /// Older manifests have no section ids; see `normalize_sections`.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub start_sec: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSyncPoint {
    pub line_index: u32,
    pub time_sec: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub bpm: Option<f64>,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub click_enabled: Option<bool>,
    pub tracks: Vec<TrackManifest>,
    #[serde(default)]
    pub sections: Vec<SectionManifest>,
    #[serde(default)]
    pub lyrics: Option<String>,
    #[serde(default)]
    pub lyrics_sync_points: Option<Vec<LyricsSyncPoint>>,
}

impl ProjectManifest {
    pub fn track_path(&self, dir: &Path, track: &TrackManifest) -> PathBuf {
        dir.join(&track.file)
    }
}

/// Sections without an id get a positional one in memory only. Unlike the
/// mobile loader this never writes the backfill to disk: the desktop app
/// doesn't edit markers yet, so a stable-per-session id is enough to key the
/// UI and leaves the file untouched for the phone to normalize.
fn normalize_sections(manifest: &mut ProjectManifest) {
    for (index, section) in manifest.sections.iter_mut().enumerate() {
        if section.id.is_empty() {
            section.id = format!("legacy-{index}");
        }
    }
}

pub fn read_manifest(dir: &Path) -> Result<ProjectManifest, String> {
    let path = dir.join(MANIFEST_FILE);
    let text =
        fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let mut manifest: ProjectManifest = serde_json::from_str(&text)
        .map_err(|e| format!("{} is not a valid project manifest: {e}", path.display()))?;
    normalize_sections(&mut manifest);
    Ok(manifest)
}

/// The mixer state the desktop app commits back into the project, the same
/// keys the mobile app writes so a soundchecked mix travels with the song.
pub struct MixPatch<'a> {
    pub tracks: &'a [(String, f32, bool, bool)],
    pub click_enabled: Option<bool>,
}

/// Rewrites only the mix-related keys of `manifest.json`, through
/// `serde_json::Value` rather than the typed struct, so any field this app
/// doesn't know about (written by a newer mobile version) survives untouched.
/// Written to a temporary file and renamed into place, so a crash mid-write
/// can't leave a truncated manifest behind.
pub fn write_mix(dir: &Path, patch: &MixPatch) -> Result<(), String> {
    let path = dir.join(MANIFEST_FILE);
    let text =
        fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let mut root: Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid manifest: {e}"))?;

    if let Some(tracks) = root.get_mut("tracks").and_then(Value::as_array_mut) {
        for track in tracks.iter_mut() {
            let Some(id) = track.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some((_, gain, muted, soloed)) =
                patch.tracks.iter().find(|(track_id, ..)| track_id == id)
            else {
                continue;
            };
            let (gain, muted, soloed) = (*gain, *muted, *soloed);
            if let Some(obj) = track.as_object_mut() {
                obj.insert("gain".into(), Value::from(gain as f64));
                obj.insert("muted".into(), Value::from(muted));
                obj.insert("soloed".into(), Value::from(soloed));
            }
        }
    }
    if let (Some(enabled), Some(obj)) = (patch.click_enabled, root.as_object_mut()) {
        obj.insert("clickEnabled".into(), Value::from(enabled));
    }

    let serialized =
        serde_json::to_string_pretty(&root).map_err(|e| format!("Serialize failed: {e}"))?;
    write_atomic(&path, serialized.as_bytes())
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not replace {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(manifest: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vvs-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(MANIFEST_FILE), manifest).unwrap();
        dir
    }

    const MANIFEST: &str = r#"{
        "id": "p1", "title": "Song", "bpm": 120, "key": "E",
        "futureField": {"keep": true},
        "tracks": [
            {"id": "a", "name": "Drums", "file": "drums.wav", "gain": 1, "bus": "main", "extra": 1},
            {"id": "b", "name": "Click", "file": "click.wav", "gain": 0.8, "bus": "cue"}
        ],
        "sections": [{"name": "Intro", "startSec": 0}, {"id": "s2", "name": "Verse", "startSec": 12.5}]
    }"#;

    #[test]
    fn reads_mobile_manifest_and_backfills_section_ids_in_memory() {
        let dir = temp_project(MANIFEST);
        let manifest = read_manifest(&dir).unwrap();
        assert_eq!(manifest.tracks.len(), 2);
        assert_eq!(manifest.tracks[1].bus, Bus::Cue);
        assert_eq!(manifest.sections[0].id, "legacy-0");
        assert_eq!(manifest.sections[1].id, "s2");
        // Reading must not modify the file.
        assert_eq!(
            fs::read_to_string(dir.join(MANIFEST_FILE)).unwrap(),
            MANIFEST
        );
    }

    #[test]
    fn write_mix_preserves_unknown_fields() {
        let dir = temp_project(MANIFEST);
        let tracks = vec![("a".to_string(), 0.5, true, false)];
        write_mix(
            &dir,
            &MixPatch {
                tracks: &tracks,
                click_enabled: Some(false),
            },
        )
        .unwrap();
        let root: Value =
            serde_json::from_str(&fs::read_to_string(dir.join(MANIFEST_FILE)).unwrap()).unwrap();
        assert_eq!(root["futureField"]["keep"], true);
        assert_eq!(root["tracks"][0]["extra"], 1);
        assert_eq!(root["tracks"][0]["gain"], 0.5);
        assert_eq!(root["tracks"][0]["muted"], true);
        assert_eq!(root["tracks"][1]["gain"], 0.8);
        assert_eq!(root["clickEnabled"], false);
    }
}
