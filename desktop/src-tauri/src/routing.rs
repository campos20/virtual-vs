//! Where each voice (stem or click) lands on the output device.
//!
//! Routing is per machine, not per project: the same song runs on different
//! interfaces (rehearsal room, stage, a friend's rig), so the project keeps
//! its portable `bus` intent (`main`/`cue`/`both`) and this machine's config
//! decides which physical outputs `main` and `cue` mean here. Individual
//! tracks can additionally be overridden per project, e.g. to send drums and
//! bass to their own console channels.

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
    fn fits(&self, channels: usize) -> bool {
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
    /// dropping duplicates and anything beyond `MAX_ROUTES`. A route to a
    /// channel the current device doesn't have is silently skipped rather
    /// than failing the whole load: the rest of the song must still play.
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

/// Mirrors the mobile app's headphone-splitter modes. `Split` uses this
/// machine's routing (by default cue on output 1, main on output 2, exactly
/// like the phone's hard L/R split). `Monitor` ignores routing and sends
/// everything to outputs 1-2 in stereo, for rehearsing on plain headphones.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MonitorMode {
    #[default]
    Split,
    Monitor,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingConfig {
    /// `None` means the default (output 1).
    #[serde(default)]
    pub cue: Option<Vec<OutputTarget>>,
    /// `None` means the default (output 2).
    #[serde(default)]
    pub main: Option<Vec<OutputTarget>>,
    /// `None` means "same as cue" - the click is cue-only on mobile too.
    #[serde(default)]
    pub click: Option<Vec<OutputTarget>>,
    /// project id -> track id -> targets. Replaces the track's bus routing.
    #[serde(default)]
    pub tracks: HashMap<String, HashMap<String, Vec<OutputTarget>>>,
}

fn default_cue() -> Vec<OutputTarget> {
    vec![OutputTarget::Mono { channel: 0 }]
}

fn default_main(channels: usize) -> Vec<OutputTarget> {
    // On a mono device there's nowhere else to go; doubling up on output 1 is
    // better than playing nothing.
    let channel = if channels >= 2 { 1 } else { 0 };
    vec![OutputTarget::Mono { channel }]
}

fn monitor_targets(channels: usize) -> Vec<OutputTarget> {
    if channels >= 2 {
        vec![OutputTarget::Stereo { left: 0, right: 1 }]
    } else {
        vec![OutputTarget::Mono { channel: 0 }]
    }
}

impl RoutingConfig {
    pub fn cue_targets(&self) -> Vec<OutputTarget> {
        self.cue.clone().unwrap_or_else(default_cue)
    }

    pub fn main_targets(&self, channels: usize) -> Vec<OutputTarget> {
        self.main.clone().unwrap_or_else(|| default_main(channels))
    }

    pub fn track_override(&self, project_id: &str, track_id: &str) -> Option<&Vec<OutputTarget>> {
        self.tracks.get(project_id)?.get(track_id)
    }

    pub fn set_track_override(
        &mut self,
        project_id: &str,
        track_id: &str,
        targets: Option<Vec<OutputTarget>>,
    ) {
        match targets {
            Some(targets) => {
                self.tracks
                    .entry(project_id.to_string())
                    .or_default()
                    .insert(track_id.to_string(), targets);
            }
            None => {
                if let Some(project) = self.tracks.get_mut(project_id) {
                    project.remove(track_id);
                    if project.is_empty() {
                        self.tracks.remove(project_id);
                    }
                }
            }
        }
    }

    pub fn resolve_track(
        &self,
        mode: MonitorMode,
        project_id: &str,
        track_id: &str,
        bus: Bus,
        channels: usize,
    ) -> RouteSet {
        if mode == MonitorMode::Monitor {
            return RouteSet::from_targets(&monitor_targets(channels), channels);
        }
        if let Some(targets) = self.track_override(project_id, track_id) {
            return RouteSet::from_targets(targets, channels);
        }
        let mut targets = Vec::new();
        if matches!(bus, Bus::Cue | Bus::Both) {
            targets.extend(self.cue_targets());
        }
        if matches!(bus, Bus::Main | Bus::Both) {
            targets.extend(self.main_targets(channels));
        }
        RouteSet::from_targets(&targets, channels)
    }

    pub fn resolve_click(&self, mode: MonitorMode, channels: usize) -> RouteSet {
        if mode == MonitorMode::Monitor {
            return RouteSet::from_targets(&monitor_targets(channels), channels);
        }
        let targets = self.click.clone().unwrap_or_else(|| self.cue_targets());
        RouteSet::from_targets(&targets, channels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mono(channel: u16) -> OutputTarget {
        OutputTarget::Mono { channel }
    }

    #[test]
    fn default_split_matches_the_phone_layout() {
        let cfg = RoutingConfig::default();
        let cue = cfg.resolve_track(MonitorMode::Split, "p", "t", Bus::Cue, 2);
        let main = cfg.resolve_track(MonitorMode::Split, "p", "t", Bus::Main, 2);
        let both = cfg.resolve_track(MonitorMode::Split, "p", "t", Bus::Both, 2);
        assert_eq!(cue.as_slice(), &[mono(0)]);
        assert_eq!(main.as_slice(), &[mono(1)]);
        assert_eq!(both.as_slice(), &[mono(0), mono(1)]);
        assert_eq!(
            cfg.resolve_click(MonitorMode::Split, 2).as_slice(),
            &[mono(0)]
        );
    }

    #[test]
    fn monitor_mode_ignores_routing() {
        let mut cfg = RoutingConfig::default();
        cfg.set_track_override("p", "t", Some(vec![mono(5)]));
        let routes = cfg.resolve_track(MonitorMode::Monitor, "p", "t", Bus::Cue, 8);
        assert_eq!(
            routes.as_slice(),
            &[OutputTarget::Stereo { left: 0, right: 1 }]
        );
    }

    #[test]
    fn track_override_wins_over_bus() {
        let mut cfg = RoutingConfig::default();
        cfg.set_track_override("p", "drums", Some(vec![mono(4)]));
        let routes = cfg.resolve_track(MonitorMode::Split, "p", "drums", Bus::Main, 8);
        assert_eq!(routes.as_slice(), &[mono(4)]);
        // A different project with the same track id is unaffected.
        let other = cfg.resolve_track(MonitorMode::Split, "q", "drums", Bus::Main, 8);
        assert_eq!(other.as_slice(), &[mono(1)]);
        cfg.set_track_override("p", "drums", None);
        assert!(cfg.tracks.is_empty());
    }

    #[test]
    fn drops_targets_the_device_does_not_have() {
        let set = RouteSet::from_targets(
            &[
                mono(1),
                mono(7),
                OutputTarget::Stereo { left: 2, right: 3 },
                mono(1),
            ],
            4,
        );
        assert_eq!(
            set.as_slice(),
            &[mono(1), OutputTarget::Stereo { left: 2, right: 3 }]
        );
    }

    #[test]
    fn mono_device_still_gets_main() {
        let cfg = RoutingConfig::default();
        let main = cfg.resolve_track(MonitorMode::Split, "p", "t", Bus::Main, 1);
        assert_eq!(main.as_slice(), &[mono(0)]);
    }
}
