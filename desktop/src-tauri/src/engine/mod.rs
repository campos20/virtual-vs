//! The audio engine's control side: owns the output stream, the decoded
//! project and the mixer state (volume/mute/solo/routing), and turns every
//! change into a command for the real-time `Mixer`. Mirrors the mobile
//! `AudioEngine`'s behaviour, with routing to any device output added.

pub mod click;
pub mod decode;
pub mod device;
pub mod mixer;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::project::{Bus, ProjectManifest};
use crate::routing::{MonitorMode, RouteSet, RoutingConfig};
use device::{ActiveOutput, OutputStream};
use mixer::{Command, Garbage, Mixer, Program, SharedStatus, StemAudio, TransportState, Voice};

const COMMAND_QUEUE: usize = 1024;
const GARBAGE_QUEUE: usize = 64;
/// No audio callback for this long while the stream should be running means
/// the device has stopped pulling audio, even if the driver reported nothing.
const STALL_AFTER: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackState {
    pub id: String,
    pub name: String,
    pub bus: Bus,
    pub volume: f32,
    pub muted: bool,
    pub soloed: bool,
}

pub struct LoadedProject {
    pub dir: PathBuf,
    pub manifest: ProjectManifest,
    pub sample_rate: u32,
    stems: Vec<Arc<StemAudio>>,
    click: Option<Arc<StemAudio>>,
    pub tracks: Vec<TrackState>,
    pub click_enabled: bool,
    pub length_frames: u64,
}

impl LoadedProject {
    pub fn has_click(&self) -> bool {
        self.click.is_some()
    }

    pub fn duration_sec(&self) -> f64 {
        self.length_frames as f64 / self.sample_rate as f64
    }
}

/// Decodes every stem of a project at `sample_rate`, in parallel. Runs
/// without the engine lock held - playback of whatever is loaded keeps going.
pub fn decode_project(
    dir: &Path,
    manifest: ProjectManifest,
    sample_rate: u32,
    on_progress: &(dyn Fn(usize, usize, &str) + Sync),
) -> Result<LoadedProject, String> {
    let total = manifest.tracks.len();
    let done = AtomicUsize::new(0);
    on_progress(0, total, "");

    let results: Vec<Result<StemAudio, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = manifest
            .tracks
            .iter()
            .map(|track| {
                let path = manifest.track_path(dir, track);
                let done = &done;
                scope.spawn(move || {
                    let result = decode::decode_stem(&path, sample_rate)
                        .map_err(|e| format!("{}: {e}", track.name));
                    let current = done.fetch_add(1, Ordering::AcqRel) + 1;
                    on_progress(current, total, &track.name);
                    result
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err("Decoder crashed".to_string()))
            })
            .collect()
    });

    let stems = results
        .into_iter()
        .map(|r| r.map(Arc::new))
        .collect::<Result<Vec<_>, _>>()?;
    let length_frames = stems.iter().map(|s| s.frames() as u64).max().unwrap_or(0);

    // bpm is optional: without a tempo there's nothing to synthesize a click
    // from, so the project simply has none.
    let click = manifest.bpm.filter(|bpm| *bpm > 0.0).map(|bpm| {
        Arc::new(click::generate_click(
            bpm,
            length_frames as usize,
            sample_rate,
        ))
    });

    let tracks = manifest
        .tracks
        .iter()
        .map(|t| TrackState {
            id: t.id.clone(),
            name: t.name.clone(),
            bus: t.bus,
            volume: t.gain,
            muted: t.muted.unwrap_or(false),
            soloed: t.soloed.unwrap_or(false),
        })
        .collect();

    Ok(LoadedProject {
        dir: dir.to_path_buf(),
        click_enabled: manifest.click_enabled.unwrap_or(true),
        manifest,
        sample_rate,
        stems,
        click,
        tracks,
        length_frames,
    })
}

struct Output {
    stream: OutputStream,
    commands: rtrb::Producer<Command>,
    garbage: rtrb::Consumer<Garbage>,
    status: Arc<SharedStatus>,
    last_callbacks: u64,
    last_callback_seen: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Stopped,
    Playing,
    Paused,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub transport: Transport,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub output: Option<ActiveOutput>,
    /// Something is wrong with the audio device; the UI must make this loud.
    pub device_error: Option<String>,
    pub xruns: u64,
}

pub struct Engine {
    output: Option<Output>,
    project: Option<LoadedProject>,
    monitor_mode: MonitorMode,
    routing: RoutingConfig,
    open_error: Option<String>,
}

impl Engine {
    pub fn new(monitor_mode: MonitorMode, routing: RoutingConfig) -> Self {
        Engine {
            output: None,
            project: None,
            monitor_mode,
            routing,
            open_error: None,
        }
    }

    pub fn output_info(&self) -> Option<&ActiveOutput> {
        self.output.as_ref().map(|o| &o.stream.info)
    }

    pub fn sample_rate(&self) -> Option<u32> {
        self.output_info().map(|o| o.sample_rate)
    }

    fn channels(&self) -> usize {
        self.output_info().map_or(2, |o| o.channels as usize)
    }

    pub fn project(&self) -> Option<&LoadedProject> {
        self.project.as_ref()
    }

    /// Opens an output device, replacing the current one. Returns `true` if a
    /// loaded project has to be re-decoded because the sample rate changed.
    pub fn open_device(
        &mut self,
        device_id: Option<String>,
        buffer_frames: Option<u32>,
    ) -> Result<bool, String> {
        // Close first: some drivers refuse a second stream on the same device.
        self.output = None;
        let (commands, command_rx) = rtrb::RingBuffer::new(COMMAND_QUEUE);
        let (garbage_tx, garbage) = rtrb::RingBuffer::new(GARBAGE_QUEUE);
        let status = Arc::new(SharedStatus::default());
        let mixer_status = status.clone();
        let opened = device::open_output(device_id, buffer_frames, move |channels, rate| {
            Mixer::new(channels, rate, command_rx, garbage_tx, mixer_status)
        });
        let stream = match opened {
            Ok(stream) => stream,
            Err(e) => {
                self.open_error = Some(e.clone());
                return Err(e);
            }
        };
        self.open_error = None;
        let rate = stream.info.sample_rate;
        self.output = Some(Output {
            stream,
            commands,
            garbage,
            status,
            last_callbacks: 0,
            last_callback_seen: Instant::now(),
        });

        match self.project.as_ref().map(|p| p.sample_rate) {
            Some(project_rate) if project_rate == rate => {
                self.send_program();
                Ok(false)
            }
            Some(_) => Ok(true),
            None => Ok(false),
        }
    }

    fn send(&mut self, command: Command) {
        if let Some(output) = self.output.as_mut() {
            // The queue holds 1024 commands and the audio thread drains it
            // every few ms; a full queue means the stream is dead, which
            // `status()` reports.
            let _ = output.commands.push(command);
        }
    }

    fn effective_gains(&self, project: &LoadedProject) -> Vec<f32> {
        let any_soloed = project.tracks.iter().any(|t| t.soloed);
        project
            .tracks
            .iter()
            .map(|t| {
                if t.muted || (any_soloed && !t.soloed) {
                    0.0
                } else {
                    t.volume
                }
            })
            .collect()
    }

    fn resolve_routes(&self, project: &LoadedProject) -> Vec<RouteSet> {
        let channels = self.channels();
        let mut routes: Vec<RouteSet> = project
            .tracks
            .iter()
            .map(|t| {
                self.routing.resolve_track(
                    self.monitor_mode,
                    &project.manifest.id,
                    &t.id,
                    t.bus,
                    channels,
                )
            })
            .collect();
        if project.click.is_some() {
            routes.push(self.routing.resolve_click(self.monitor_mode, channels));
        }
        routes
    }

    fn click_gain(project: &LoadedProject) -> f32 {
        if project.click_enabled {
            1.0
        } else {
            0.0
        }
    }

    fn send_program(&mut self) {
        let Some(project) = self.project.as_ref() else {
            return;
        };
        let gains = self.effective_gains(project);
        let routes = self.resolve_routes(project);
        let mut voices: Vec<Voice> = project
            .stems
            .iter()
            .zip(gains)
            .zip(routes.iter())
            .map(|((stem, gain), routes)| Voice::new(stem.clone(), gain, *routes))
            .collect();
        if let (Some(click), Some(routes)) = (&project.click, routes.last()) {
            voices.push(Voice::new(
                click.clone(),
                Self::click_gain(project),
                *routes,
            ));
        }
        let program = Box::new(Program {
            voices,
            length_frames: project.length_frames,
        });
        self.send(Command::Load(program));
    }

    /// Installs a decoded project. Whatever was playing fades out and is
    /// replaced as a whole - stems are never swapped individually.
    pub fn install_project(&mut self, project: LoadedProject) -> Result<(), String> {
        if Some(project.sample_rate) != self.sample_rate() {
            return Err(
                "The audio device changed while the song was loading; load it again.".to_string(),
            );
        }
        self.project = Some(project);
        self.send_program();
        Ok(())
    }

    pub fn play(&mut self) {
        self.send(Command::Play);
    }

    pub fn pause(&mut self) {
        self.send(Command::Pause);
    }

    pub fn stop(&mut self) {
        self.send(Command::Stop);
    }

    pub fn seek(&mut self, sec: f64) {
        let Some(rate) = self.project.as_ref().map(|p| p.sample_rate) else {
            return;
        };
        let frame = (sec.max(0.0) * rate as f64).round() as u64;
        self.send(Command::Seek(frame));
    }

    fn push_gains(&mut self) {
        let Some(project) = self.project.as_ref() else {
            return;
        };
        let gains = self.effective_gains(project);
        for (voice, gain) in gains.into_iter().enumerate() {
            self.send(Command::SetGain { voice, gain });
        }
    }

    fn push_routes(&mut self) {
        let Some(project) = self.project.as_ref() else {
            return;
        };
        let routes = self.resolve_routes(project);
        for (voice, routes) in routes.into_iter().enumerate() {
            self.send(Command::SetRoutes { voice, routes });
        }
    }

    fn track_mut(&mut self, track_id: &str) -> Option<&mut TrackState> {
        self.project
            .as_mut()?
            .tracks
            .iter_mut()
            .find(|t| t.id == track_id)
    }

    pub fn set_track_volume(&mut self, track_id: &str, volume: f32) {
        if let Some(track) = self.track_mut(track_id) {
            track.volume = volume.clamp(0.0, 2.0);
            self.push_gains();
        }
    }

    pub fn set_track_muted(&mut self, track_id: &str, muted: bool) {
        if let Some(track) = self.track_mut(track_id) {
            track.muted = muted;
            self.push_gains();
        }
    }

    pub fn set_track_soloed(&mut self, track_id: &str, soloed: bool) {
        if let Some(track) = self.track_mut(track_id) {
            track.soloed = soloed;
            // Soloing changes every other track's effective mute too.
            self.push_gains();
        }
    }

    pub fn set_click_enabled(&mut self, enabled: bool) {
        let Some(project) = self.project.as_mut() else {
            return;
        };
        project.click_enabled = enabled;
        if project.click.is_some() {
            let voice = project.tracks.len();
            self.send(Command::SetGain {
                voice,
                gain: if enabled { 1.0 } else { 0.0 },
            });
        }
    }

    pub fn set_monitor_mode(&mut self, mode: MonitorMode) {
        self.monitor_mode = mode;
        self.push_routes();
    }

    pub fn set_routing(&mut self, routing: RoutingConfig) {
        self.routing = routing;
        self.push_routes();
    }

    /// Frees whatever the audio thread handed back. Call periodically.
    pub fn collect_garbage(&mut self) {
        if let Some(output) = self.output.as_mut() {
            while let Ok(Garbage::Program(program)) = output.garbage.pop() {
                drop(program);
            }
        }
    }

    pub fn status(&mut self) -> EngineStatus {
        let project_rate = self.project.as_ref().map(|p| p.sample_rate);
        let duration_sec = self.project.as_ref().map_or(0.0, |p| p.duration_sec());
        let Some(output) = self.output.as_mut() else {
            return EngineStatus {
                transport: Transport::Stopped,
                position_sec: 0.0,
                duration_sec,
                output: None,
                device_error: Some(
                    self.open_error
                        .clone()
                        .unwrap_or_else(|| "No audio output open".into()),
                ),
                xruns: 0,
            };
        };

        let callbacks = output.status.callbacks();
        if callbacks != output.last_callbacks {
            output.last_callbacks = callbacks;
            output.last_callback_seen = Instant::now();
        }
        let mut device_error = output
            .stream
            .health
            .fatal_error
            .lock()
            .ok()
            .and_then(|e| e.clone());
        if device_error.is_none() && output.last_callback_seen.elapsed() > STALL_AFTER {
            device_error = Some("The audio device stopped responding".to_string());
        }

        let transport = match output.status.transport() {
            TransportState::Stopped => Transport::Stopped,
            TransportState::Playing => Transport::Playing,
            TransportState::Paused => Transport::Paused,
        };
        let rate = project_rate.unwrap_or(output.stream.info.sample_rate) as f64;
        EngineStatus {
            transport,
            position_sec: output.status.position() as f64 / rate,
            duration_sec,
            output: Some(output.stream.info.clone()),
            device_error,
            xruns: output.stream.health.xruns.load(Ordering::Relaxed),
        }
    }
}
