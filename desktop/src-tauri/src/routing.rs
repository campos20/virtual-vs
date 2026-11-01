//! Where each voice (stem or click) lands on the output device.
//!
//! Routing is per track and per machine: the same song runs on different
//! rigs, so it lives in this computer's config, not in the project. A route
//! is normally set by **track name** and applies to every song that has a
//! track with that name - route "Drums" to the FOH channels once, not once
//! per song in a 30-song set. A song can pin its own route for a track when
//! it needs to differ. Tracks with no route at all fall back to the phone's
//! layout (cue on output 1, main on output 2), so a fresh install still plays.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::project::Bus;

/// Upper bound on destinations per voice. Fixed so a route change can be sent
/// to the audio thread without allocating.
pub const MAX_ROUTES: usize = 8;

/// One destination on the output device. Channels are 0-based here and shown
/// 1-based in the UI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputTarget {
    /// Left and right summed at -6 dB into a single output - the usual way to
    /// feed a mono in-ear or console channel without clipping.
    Mono {
        channel: u16,
    },
    Stereo {
        left: u16,
        right: u16,
    },
}

impl OutputTarget {
    pub fn fits(&self, channels: usize) -> bool {
        match *self {
            OutputTarget::Mono { channel } => (channel as usize) < channels,
            OutputTarget::Stereo { left, right } => {
                (left as usize) < channels && (right as usize) < channels
            }
        }
    }
}

/// A voice's destinations, in a fixed-size array so it is `Copy` and can be
/// handed to the audio thread as-is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RouteSet {
    targets: [OutputTarget; MAX_ROUTES],
    len: u8,
}

impl RouteSet {
    pub const EMPTY: RouteSet = RouteSet {
        targets: [OutputTarget::Mono { channel: 0 }; MAX_ROUTES],
        len: 0,
    };

    /// Keeps only targets that exist on a device with `channels` outputs,
    /// dropping duplicates and anything beyond `MAX_ROUTES`. A route to an
    /// output the current device doesn't have is skipped (and reported by the
    /// engine) rather than failing the load: the rest of the song must play.
    pub fn from_targets(targets: &[OutputTarget], channels: usize) -> RouteSet {
        let mut set = RouteSet::EMPTY;
        for target in targets {
            if set.len as usize == MAX_ROUTES {
                break;
            }
            if !target.fits(channels) || set.as_slice().contains(target) {
                continue;
            }
            set.targets[set.len as usize] = *target;
            set.len += 1;
        }
        set
    }

    pub fn as_slice(&self) -> &[OutputTarget] {
        &self.targets[..self.len as usize]
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Mirrors the mobile app's headphone-splitter modes. `Split` uses the
/// routing. `Monitor` ignores it and sends everything to outputs 1-2 in
/// stereo, for rehearsing on plain headphones.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorMode {
    #[default]
    Split,
    Monitor,
}

/// Where a track's route came from - shown in the routing matrix.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteSource {
    /// Pinned for this song only.
    Song,
    /// Set for every song with a track of this name.
    Name,
    /// Nothing set; following the track's bus like the phone does.
    Default,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteScope {
    AllSongs,
    ThisSong,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRoute {
    pub targets: Vec<OutputTarget>,
    pub source: RouteSource,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingConfig {
    /// Normalized track name -> targets, for every song.
    #[serde(default)]
    pub by_name: HashMap<String, Vec<OutputTarget>>,
    /// Project id -> track id -> targets, pinned for one song.
    #[serde(default)]
    pub tracks: HashMap<String, HashMap<String, Vec<OutputTarget>>>,
    /// The synthesized click. `None` means output 1, where the phone puts it.
    #[serde(default)]
    pub click: Option<Vec<OutputTarget>>,
}

/// "Drums", " drums " and "DRUMS" are the same track across songs.
pub fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// The phone's split: cue on output 1, main on output 2.
fn bus_default(bus: Bus, channels: usize) -> Vec<OutputTarget> {
    let cue = OutputTarget::Mono { channel: 0 };
    // On a mono device there's nowhere else to go; doubling up on output 1 is
    // better than playing nothing.
    let main = OutputTarget::Mono {
        channel: if channels >= 2 { 1 } else { 0 },
    };
    match bus {
        Bus::Cue => vec![cue],
        Bus::Main => vec![main],
        Bus::Both => vec![cue, main],
    }
}

fn monitor_targets(channels: usize) -> Vec<OutputTarget> {
    if channels >= 2 {
        vec![OutputTarget::Stereo { left: 0, right: 1 }]
    } else {
        vec![OutputTarget::Mono { channel: 0 }]
    }
}

impl RoutingConfig {
    /// The track's route in split mode, before checking it against the
    /// device - the UI shows routes to missing outputs as such.
    pub fn track_route(
        &self,
        project_id: &str,
        track_id: &str,
        track_name: &str,
        bus: Bus,
        channels: usize,
    ) -> ResolvedRoute {
        if let Some(targets) = self.tracks.get(project_id).and_then(|p| p.get(track_id)) {
            return ResolvedRoute {
                targets: targets.clone(),
                source: RouteSource::Song,
            };
        }
        if let Some(targets) = self.by_name.get(&name_key(track_name)) {
            return ResolvedRoute {
                targets: targets.clone(),
                source: RouteSource::Name,
            };
        }
        ResolvedRoute {
            targets: bus_default(bus, channels),
            source: RouteSource::Default,
        }
    }

    pub fn click_route(&self) -> ResolvedRoute {
        match &self.click {
            Some(targets) => ResolvedRoute {
                targets: targets.clone(),
                source: RouteSource::Name,
            },
            None => ResolvedRoute {
                targets: vec![OutputTarget::Mono { channel: 0 }],
                source: RouteSource::Default,
            },
        }
    }

    /// `targets: None` clears the route at that scope. Clearing "all songs"
    /// also clears this song's pin, so the track goes back to its default.
    pub fn set_track_route(
        &mut self,
        scope: RouteScope,
        project_id: &str,
        track_id: &str,
        track_name: &str,
        targets: Option<Vec<OutputTarget>>,
    ) {
        match scope {
            RouteScope::AllSongs => {
                self.remove_song_route(project_id, track_id);
                let key = name_key(track_name);
                match targets {
                    Some(targets) => {
                        self.by_name.insert(key, targets);
                    }
                    None => {
                        self.by_name.remove(&key);
                    }
                }
            }
            RouteScope::ThisSong => match targets {
                Some(targets) => {
                    self.tracks
                        .entry(project_id.to_string())
                        .or_default()
                        .insert(track_id.to_string(), targets);
                }
                None => self.remove_song_route(project_id, track_id),
            },
        }
    }

    fn remove_song_route(&mut self, project_id: &str, track_id: &str) {
        if let Some(project) = self.tracks.get_mut(project_id) {
            project.remove(track_id);
            if project.is_empty() {
                self.tracks.remove(project_id);
            }
        }
    }
}

/// What actually reaches the audio thread: the route in split mode, or
/// outputs 1-2 in monitor mode, limited to what the device has.
pub fn route_set(mode: MonitorMode, targets: &[OutputTarget], channels: usize) -> RouteSet {
    match mode {
        MonitorMode::Monitor => RouteSet::from_targets(&monitor_targets(channels), channels),
        MonitorMode::Split => RouteSet::from_targets(targets, channels),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mono(channel: u16) -> OutputTarget {
        OutputTarget::Mono { channel }
    }

    fn stereo(left: u16, right: u16) -> OutputTarget {
        OutputTarget::Stereo { left, right }
    }

    #[test]
    fn unrouted_tracks_follow_the_phone_layout() {
        let cfg = RoutingConfig::default();
        let route = |bus| cfg.track_route("p", "t", "Keys", bus, 2);
        assert_eq!(route(Bus::Cue).targets, vec![mono(0)]);
        assert_eq!(route(Bus::Main).targets, vec![mono(1)]);
        assert_eq!(route(Bus::Both).targets, vec![mono(0), mono(1)]);
        assert_eq!(route(Bus::Main).source, RouteSource::Default);
        assert_eq!(cfg.click_route().targets, vec![mono(0)]);
    }

    #[test]
    fn a_name_route_applies_to_every_song() {
        let mut cfg = RoutingConfig::default();
        cfg.set_track_route(
            RouteScope::AllSongs,
            "p1",
            "a",
            "Drums",
            Some(vec![stereo(2, 3)]),
        );
        let other_song = cfg.track_route("p2", "x", " drums ", Bus::Main, 8);
        assert_eq!(other_song.targets, vec![stereo(2, 3)]);
        assert_eq!(other_song.source, RouteSource::Name);
    }

    #[test]
    fn a_song_pin_wins_over_the_name_route_and_can_be_cleared() {
        let mut cfg = RoutingConfig::default();
        cfg.set_track_route(RouteScope::AllSongs, "p1", "a", "Bass", Some(vec![mono(4)]));
        cfg.set_track_route(
            RouteScope::ThisSong,
            "p1",
            "a",
            "Bass",
            Some(vec![mono(5), mono(6)]),
        );
        let pinned = cfg.track_route("p1", "a", "Bass", Bus::Main, 8);
        assert_eq!(pinned.targets, vec![mono(5), mono(6)]);
        assert_eq!(pinned.source, RouteSource::Song);
        assert_eq!(
            cfg.track_route("p2", "b", "Bass", Bus::Main, 8).targets,
            vec![mono(4)]
        );

        cfg.set_track_route(RouteScope::ThisSong, "p1", "a", "Bass", None);
        assert!(cfg.tracks.is_empty());
        assert_eq!(
            cfg.track_route("p1", "a", "Bass", Bus::Main, 8).targets,
            vec![mono(4)]
        );
    }

    #[test]
    fn clearing_all_songs_returns_to_default() {
        let mut cfg = RoutingConfig::default();
        cfg.set_track_route(RouteScope::AllSongs, "p", "a", "Guide", Some(vec![mono(7)]));
        cfg.set_track_route(RouteScope::ThisSong, "p", "a", "Guide", Some(vec![mono(3)]));
        cfg.set_track_route(RouteScope::AllSongs, "p", "a", "Guide", None);
        let route = cfg.track_route("p", "a", "Guide", Bus::Cue, 8);
        assert_eq!(route.source, RouteSource::Default);
        assert_eq!(route.targets, vec![mono(0)]);
    }

    #[test]
    fn monitor_mode_ignores_routing() {
        let set = route_set(MonitorMode::Monitor, &[mono(5)], 8);
        assert_eq!(set.as_slice(), &[stereo(0, 1)]);
    }

    #[test]
    fn drops_targets_the_device_does_not_have() {
        let set = RouteSet::from_targets(&[mono(1), mono(7), stereo(2, 3), mono(1)], 4);
        assert_eq!(set.as_slice(), &[mono(1), stereo(2, 3)]);
    }

    #[test]
    fn mono_device_still_plays_main() {
        let cfg = RoutingConfig::default();
        assert_eq!(
            cfg.track_route("p", "t", "x", Bus::Main, 1).targets,
            vec![mono(0)]
        );
    }
}
