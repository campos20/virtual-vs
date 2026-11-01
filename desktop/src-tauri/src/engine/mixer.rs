//! The real-time half of the engine. `Mixer::process` runs on the audio
//! device's callback thread, so nothing in here may allocate, free, lock or do
//! I/O: a stall here is an audible dropout on stage. Commands arrive through a
//! lock-free queue, status goes out through atomics, and anything that needs
//! freeing (a replaced project) is handed back to the control thread.
//!
//! Stems stay sample-locked by construction (see AGENTS.md "Stems stay
//! sample-locked"): there is exactly one playhead, `Mixer::position`, and every
//! voice - each stem and the click - reads frame `position + i` inside the same
//! callback. There is no per-voice start time or clock that could drift, and
//! no partial graph patching: a project's voices are only ever swapped as a
//! whole `Program`.

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use crate::routing::{OutputTarget, RouteSet};

/// Ramp time for volume/mute/solo changes - same as the mobile engine.
pub const GAIN_RAMP_SEC: f32 = 0.015;
/// Fade applied by pause/stop/seek/resume so the transport never cuts a
/// waveform mid-cycle (an audible pop through a PA). Short enough to feel
/// instant.
pub const DECLICK_SEC: f32 = 0.005;
/// Commands applied per callback at most, so a flood of fader moves can't
/// starve the audio itself.
const MAX_COMMANDS_PER_CALLBACK: usize = 256;

/// A decoded stem: interleaved stereo `f32` at the output device's rate.
pub struct StemAudio {
    samples: Vec<f32>,
}

impl StemAudio {
    pub fn from_interleaved_stereo(samples: Vec<f32>) -> Self {
        debug_assert!(samples.len().is_multiple_of(2));
        StemAudio { samples }
    }

    pub fn frames(&self) -> usize {
        self.samples.len() / 2
    }

    pub fn interleaved(&self) -> &[f32] {
        &self.samples
    }

    #[cfg(test)]
    pub fn samples(&self) -> &[f32] {
        &self.samples
    }
}

/// Linear per-sample gain ramp.
#[derive(Clone, Copy, Debug)]
struct Ramp {
    current: f32,
    target: f32,
    step: f32,
    remaining: u32,
}

impl Ramp {
    fn new(value: f32) -> Self {
        Ramp {
            current: value,
            target: value,
            step: 0.0,
            remaining: 0,
        }
    }

    fn set_target(&mut self, target: f32, frames: u32) {
        self.target = target;
        if frames == 0 || self.current == target {
            self.current = target;
            self.remaining = 0;
        } else {
            self.step = (target - self.current) / frames as f32;
            self.remaining = frames;
        }
    }

    #[inline]
    fn next(&mut self) -> f32 {
        if self.remaining > 0 {
            self.remaining -= 1;
            self.current = if self.remaining == 0 {
                self.target
            } else {
                self.current + self.step
            };
        }
        self.current
    }

    fn skip(&mut self, frames: usize) {
        if self.remaining == 0 {
            return;
        }
        if frames as u32 >= self.remaining {
            self.current = self.target;
            self.remaining = 0;
        } else {
            self.remaining -= frames as u32;
            self.current += self.step * frames as f32;
        }
    }

    fn settled_at(&self, value: f32) -> bool {
        self.remaining == 0 && self.current == value
    }
}

pub struct Voice {
    audio: Arc<StemAudio>,
    gain: Ramp,
    routes: RouteSet,
}

impl Voice {
    pub fn new(audio: Arc<StemAudio>, gain: f32, routes: RouteSet) -> Self {
        Voice {
            audio,
            gain: Ramp::new(gain),
            routes,
        }
    }

    fn render(&mut self, out: &mut [f32], channels: usize, start: u64, frames: usize) {
        let total = self.audio.frames() as u64;
        let available = if start >= total {
            0
        } else {
            (total - start).min(frames as u64) as usize
        };
        if available == 0 || self.routes.is_empty() || self.gain.settled_at(0.0) {
            self.gain.skip(frames);
            return;
        }

        let begin = start as usize * 2;
        let src = &self.audio.samples[begin..begin + available * 2];
        let routes = self.routes.as_slice();
        for frame in 0..available {
            let g = self.gain.next();
            let left = src[frame * 2] * g;
            let right = src[frame * 2 + 1] * g;
            let base = frame * channels;
            for route in routes {
                match *route {
                    OutputTarget::Mono { channel } => {
                        out[base + channel as usize] += 0.5 * (left + right);
                    }
                    OutputTarget::Stereo { left: l, right: r } => {
                        out[base + l as usize] += left;
                        out[base + r as usize] += right;
                    }
                }
            }
        }
        self.gain.skip(frames - available);
    }
}

/// Everything one loaded project needs on the audio thread.
pub struct Program {
    pub voices: Vec<Voice>,
    /// Natural end of playback: the longest voice's length.
    pub length_frames: u64,
}

pub enum Command {
    Load(Box<Program>),
    Play,
    Pause,
    Stop,
    Seek(u64),
    SetGain { voice: usize, gain: f32 },
    SetRoutes { voice: usize, routes: RouteSet },
}

/// Sent back to the control thread to be dropped there (freeing a project's
/// sample memory is far too slow for the audio callback).
pub enum Garbage {
    Program(Box<Program>),
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportState {
    Stopped = 0,
    Playing = 1,
    Paused = 2,
}

impl TransportState {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => TransportState::Playing,
            2 => TransportState::Paused,
            _ => TransportState::Stopped,
        }
    }
}

/// Written by the audio thread, read by the control thread.
#[derive(Default)]
pub struct SharedStatus {
    position: AtomicU64,
    transport: AtomicU8,
    /// Incremented each time playback reaches the end on its own.
    natural_ends: AtomicU64,
    /// Incremented each callback - lets the control side detect a dead stream.
    callbacks: AtomicU64,
    /// Incremented each time a `Load` takes effect, so the control side knows
    /// which program the published position belongs to.
    loads: AtomicU64,
    /// Commands taken off the queue so far. Compared with the number sent,
    /// it tells the UI whether the published state already reflects every
    /// command it issued (see `Engine::status`).
    applied: AtomicU64,
}

impl SharedStatus {
    pub fn position(&self) -> u64 {
        self.position.load(Ordering::Acquire)
    }
    pub fn transport(&self) -> TransportState {
        TransportState::from_u8(self.transport.load(Ordering::Acquire))
    }
    #[cfg(test)]
    pub fn natural_ends(&self) -> u64 {
        self.natural_ends.load(Ordering::Acquire)
    }
    pub fn applied(&self) -> u64 {
        self.applied.load(Ordering::Acquire)
    }
    pub fn callbacks(&self) -> u64 {
        self.callbacks.load(Ordering::Relaxed)
    }
    #[cfg(test)]
    pub fn loads(&self) -> u64 {
        self.loads.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum AfterFade {
    /// Park at this position.
    Pause(u64),
    Stop,
    /// Jump here and keep playing (seek while playing, or play pressed
    /// during a fade-out).
    Play(u64),
    /// Swap in the pending program.
    Swap,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Stopped,
    Paused,
    Playing,
    FadingOut(AfterFade),
}

pub struct Mixer {
    channels: usize,
    declick_frames: u32,
    gain_ramp_frames: u32,
    program: Option<Box<Program>>,
    pending: Option<Box<Program>>,
    position: u64,
    phase: Phase,
    master: Ramp,
    commands: rtrb::Consumer<Command>,
    garbage: rtrb::Producer<Garbage>,
    status: Arc<SharedStatus>,
}

impl Mixer {
    pub fn new(
        channels: usize,
        sample_rate: u32,
        commands: rtrb::Consumer<Command>,
        garbage: rtrb::Producer<Garbage>,
        status: Arc<SharedStatus>,
    ) -> Self {
        Mixer {
            channels,
            declick_frames: (DECLICK_SEC * sample_rate as f32).round() as u32,
            gain_ramp_frames: (GAIN_RAMP_SEC * sample_rate as f32).round() as u32,
            program: None,
            pending: None,
            position: 0,
            phase: Phase::Stopped,
            master: Ramp::new(1.0),
            commands,
            garbage,
            status,
        }
    }

    fn length(&self) -> u64 {
        self.program.as_ref().map_or(0, |p| p.length_frames)
    }

    fn discard(&mut self, program: Box<Program>) {
        // If the queue is somehow full, dropping here is the lesser evil
        // compared to leaking a whole project's audio.
        if let Err(rtrb::PushError::Full(Garbage::Program(program))) =
            self.garbage.push(Garbage::Program(program))
        {
            drop(program);
        }
    }

    fn fade_out(&mut self, then: AfterFade) {
        self.master.set_target(0.0, self.declick_frames);
        self.phase = Phase::FadingOut(then);
    }

    fn start_playing(&mut self, from: u64) {
        self.position = from;
        self.phase = Phase::Playing;
        // Starting from the very top needs no fade - songs begin from silence
        // and a fade would soften a downbeat at frame 0. Anywhere else the
        // waveform is mid-cycle and needs one.
        if from == 0 {
            self.master = Ramp::new(1.0);
        } else {
            self.master = Ramp::new(0.0);
            self.master.set_target(1.0, self.declick_frames);
        }
    }

    fn swap_in_pending(&mut self) {
        if let Some(next) = self.pending.take() {
            if let Some(old) = self.program.replace(next) {
                self.discard(old);
            }
        }
        self.position = 0;
        self.phase = Phase::Stopped;
        self.master = Ramp::new(1.0);
        self.status.loads.fetch_add(1, Ordering::AcqRel);
    }

    fn apply(&mut self, command: Command) {
        match command {
            Command::Load(program) => {
                if let Some(previous) = self.pending.replace(program) {
                    self.discard(previous);
                }
                match self.phase {
                    Phase::Playing => self.fade_out(AfterFade::Swap),
                    Phase::FadingOut(_) => self.phase = Phase::FadingOut(AfterFade::Swap),
                    Phase::Stopped | Phase::Paused => self.swap_in_pending(),
                }
            }
            Command::Play => match self.phase {
                Phase::Stopped | Phase::Paused if self.length() > 0 => {
                    self.start_playing(self.position)
                }
                Phase::FadingOut(AfterFade::Pause(at)) => {
                    self.phase = Phase::FadingOut(AfterFade::Play(at))
                }
                Phase::FadingOut(AfterFade::Stop) => {
                    self.phase = Phase::FadingOut(AfterFade::Play(0))
                }
                _ => {}
            },
            Command::Pause => match self.phase {
                Phase::Playing => self.fade_out(AfterFade::Pause(self.position)),
                Phase::FadingOut(AfterFade::Play(at)) => {
                    self.phase = Phase::FadingOut(AfterFade::Pause(at))
                }
                _ => {}
            },
            Command::Stop => match self.phase {
                Phase::Playing => self.fade_out(AfterFade::Stop),
                Phase::FadingOut(AfterFade::Pause(_) | AfterFade::Play(_)) => {
                    self.phase = Phase::FadingOut(AfterFade::Stop)
                }
                Phase::Paused => {
                    self.position = 0;
                    self.phase = Phase::Stopped;
                }
                _ => {}
            },
            Command::Seek(to) => {
                let to = to.min(self.length());
                match self.phase {
                    Phase::Playing => self.fade_out(AfterFade::Play(to)),
                    Phase::FadingOut(AfterFade::Play(_)) => {
                        self.phase = Phase::FadingOut(AfterFade::Play(to))
                    }
                    Phase::FadingOut(AfterFade::Pause(_) | AfterFade::Stop) => {
                        self.phase = Phase::FadingOut(AfterFade::Pause(to))
                    }
                    Phase::FadingOut(AfterFade::Swap) => {}
                    Phase::Stopped | Phase::Paused => {
                        if self.length() > 0 {
                            self.position = to;
                            self.phase = Phase::Paused;
                        }
                    }
                }
            }
            Command::SetGain { voice, gain } => {
                let ramp = self.gain_ramp_frames;
                if let Some(v) = self.program.as_mut().and_then(|p| p.voices.get_mut(voice)) {
                    v.gain.set_target(gain, ramp);
                }
            }
            Command::SetRoutes { voice, routes } => {
                if let Some(v) = self.program.as_mut().and_then(|p| p.voices.get_mut(voice)) {
                    v.routes = routes;
                }
            }
        }
    }

    fn finish_fade(&mut self, then: AfterFade) {
        match then {
            AfterFade::Pause(at) => {
                self.position = at;
                self.phase = Phase::Paused;
                self.master = Ramp::new(1.0);
            }
            AfterFade::Stop => {
                self.position = 0;
                self.phase = Phase::Stopped;
                self.master = Ramp::new(1.0);
            }
            AfterFade::Play(at) => self.start_playing(at),
            AfterFade::Swap => self.swap_in_pending(),
        }
    }

    fn publish(&self) {
        let (position, transport) = match self.phase {
            Phase::Stopped => (0, TransportState::Stopped),
            Phase::Paused => (self.position, TransportState::Paused),
            Phase::Playing => (self.position, TransportState::Playing),
            // Report where the transport is going, not the few ms of fade:
            // the UI should react to the button press immediately.
            Phase::FadingOut(AfterFade::Pause(at)) => (at, TransportState::Paused),
            Phase::FadingOut(AfterFade::Play(at)) => (at, TransportState::Playing),
            Phase::FadingOut(AfterFade::Stop | AfterFade::Swap) => (0, TransportState::Stopped),
        };
        self.status.position.store(position, Ordering::Release);
        self.status
            .transport
            .store(transport as u8, Ordering::Release);
    }

    /// Fills one interleaved output block of `out.len() / channels` frames.
    pub fn process(&mut self, out: &mut [f32]) {
        self.status.callbacks.fetch_add(1, Ordering::Relaxed);
        let mut applied = 0;
        for _ in 0..MAX_COMMANDS_PER_CALLBACK {
            match self.commands.pop() {
                Ok(command) => {
                    self.apply(command);
                    applied += 1;
                }
                Err(_) => break,
            }
        }
        self.render(out);
        self.publish();
        // Counted only after the resulting state is published, so "every
        // command applied" never pairs with a stale transport/position.
        if applied > 0 {
            self.status.applied.fetch_add(applied, Ordering::AcqRel);
        }
    }

    fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let channels = self.channels;
        let frames = out.len() / channels;
        let audible = matches!(self.phase, Phase::Playing | Phase::FadingOut(_));
        let Some(program) = self.program.as_mut().filter(|_| audible) else {
            if let Phase::FadingOut(then) = self.phase {
                // Nothing loaded to fade - resolve right away.
                self.finish_fade(then);
            }
            return;
        };

        let start = self.position;
        for voice in program.voices.iter_mut() {
            voice.render(out, channels, start, frames);
        }

        let fading = matches!(self.phase, Phase::FadingOut(_));
        let mut faded_at = None;
        for frame in 0..frames {
            let g = self.master.next();
            if g != 1.0 {
                for sample in &mut out[frame * channels..(frame + 1) * channels] {
                    *sample *= g;
                }
            }
            if fading && self.master.settled_at(0.0) {
                faded_at = Some(frame + 1);
                break;
            }
        }

        // Hard ceiling: summing many stems can exceed full scale, and integer
        // output formats would wrap around instead of clipping.
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }

        match (faded_at, self.phase) {
            (Some(frame), Phase::FadingOut(then)) => {
                out[frame * channels..].fill(0.0);
                self.finish_fade(then);
            }
            _ => {
                self.position += frames as u64;
                if self.phase == Phase::Playing && self.position >= self.length() {
                    self.position = 0;
                    self.phase = Phase::Stopped;
                    self.status.natural_ends.fetch_add(1, Ordering::AcqRel);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 1000; // 5 declick frames, 15 gain-ramp frames

    struct Harness {
        mixer: Mixer,
        tx: rtrb::Producer<Command>,
        garbage: rtrb::Consumer<Garbage>,
        status: Arc<SharedStatus>,
        channels: usize,
    }

    impl Harness {
        fn new(channels: usize) -> Self {
            let (tx, rx) = rtrb::RingBuffer::new(64);
            let (gtx, garbage) = rtrb::RingBuffer::new(8);
            let status = Arc::new(SharedStatus::default());
            let mixer = Mixer::new(channels, RATE, rx, gtx, status.clone());
            Harness {
                mixer,
                tx,
                garbage,
                status,
                channels,
            }
        }

        fn send(&mut self, command: Command) {
            self.tx.push(command).ok().unwrap();
        }

        fn run(&mut self, frames: usize) -> Vec<f32> {
            let mut out = vec![0.0; frames * self.channels];
            self.mixer.process(&mut out);
            out
        }
    }

    /// A ramp 1, 2, 3, ... (scaled) on both channels, so output values
    /// identify exactly which source frame was played.
    fn ramp_stem(frames: usize, scale: f32) -> Arc<StemAudio> {
        let mut samples = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = (i + 1) as f32 * scale;
            samples.push(v);
            samples.push(v);
        }
        Arc::new(StemAudio::from_interleaved_stereo(samples))
    }

    fn mono(channel: u16) -> RouteSet {
        RouteSet::from_targets(&[OutputTarget::Mono { channel }], 8)
    }

    fn program(voices: Vec<Voice>) -> Box<Program> {
        let length_frames = voices
            .iter()
            .map(|v| v.audio.frames() as u64)
            .max()
            .unwrap_or(0);
        Box::new(Program {
            voices,
            length_frames,
        })
    }

    /// Two stems on separate outputs whose source frames must always match.
    fn two_stem_harness() -> Harness {
        let mut h = Harness::new(2);
        h.send(Command::Load(program(vec![
            Voice::new(ramp_stem(10_000, 1e-5), 1.0, mono(0)),
            Voice::new(ramp_stem(10_000, 2e-5), 1.0, mono(1)),
        ])));
        h
    }

    fn assert_locked(out: &[f32]) {
        for frame in out.chunks(2) {
            // Stem 2 is exactly 2x stem 1 at the same source frame, so any
            // offset between them shows up as a ratio other than 2.
            assert!(
                (frame[1] - 2.0 * frame[0]).abs() < 1e-6,
                "stems drifted: {frame:?}"
            );
        }
    }

    #[test]
    fn stems_stay_sample_locked_through_play_pause_seek_resume() {
        let mut h = two_stem_harness();
        h.send(Command::Play);
        assert_locked(&h.run(128));
        h.send(Command::Pause);
        assert_locked(&h.run(128));
        h.send(Command::Play);
        assert_locked(&h.run(128));
        h.send(Command::Seek(5000));
        assert_locked(&h.run(128));
        assert_locked(&h.run(128));
        h.send(Command::Stop);
        assert_locked(&h.run(128));
        h.send(Command::Play);
        assert_locked(&h.run(128));
    }

    #[test]
    fn plays_from_frame_zero_without_fade() {
        let mut h = two_stem_harness();
        h.send(Command::Play);
        let out = h.run(4);
        assert!((out[0] - 1e-5).abs() < 1e-9); // source frame 0 at full gain
        assert!((out[6] - 4e-5).abs() < 1e-9);
        assert_eq!(h.status.position(), 4);
        assert_eq!(h.status.transport(), TransportState::Playing);
    }

    #[test]
    fn pause_resumes_from_where_it_was_pressed() {
        let mut h = two_stem_harness();
        h.send(Command::Play);
        h.run(100);
        h.send(Command::Pause);
        assert_eq!(h.status.transport(), TransportState::Playing);
        let out = h.run(100);
        // Fade-out reaches zero on its 5th frame, then silence.
        assert!(out[2 * 3] > 0.0);
        assert!(out[2 * 4..].iter().all(|s| *s == 0.0));
        assert_eq!(h.status.transport(), TransportState::Paused);
        assert_eq!(h.status.position(), 100);
        let silent = h.run(50);
        assert!(silent.iter().all(|s| *s == 0.0));
        h.send(Command::Play);
        let out = h.run(10);
        // Fades back in from source frame 100 (first fade step is 0.2).
        assert!((out[0] - 0.2 * 101e-5).abs() < 1e-9);
        assert!((out[2 * 9] - 110e-5).abs() < 1e-9);
    }

    #[test]
    fn seek_while_playing_jumps_and_keeps_playing() {
        let mut h = two_stem_harness();
        h.send(Command::Play);
        h.run(100);
        h.send(Command::Seek(3000));
        assert_eq!(h.run(64).len(), 128);
        assert_eq!(h.status.transport(), TransportState::Playing);
        let out = h.run(10);
        // The rest of the fade block is silent; playback resumes at the
        // next block exactly from 3000, fading in.
        assert_eq!(h.status.position(), 3010);
        assert!((out[0] - 0.2 * 3001e-5).abs() < 1e-9, "{}", out[0]);
        assert!((out[2 * 9] - 3010e-5).abs() < 1e-9);
    }

    #[test]
    fn seek_while_stopped_parks_paused() {
        let mut h = two_stem_harness();
        h.send(Command::Seek(1234));
        h.run(8);
        assert_eq!(h.status.transport(), TransportState::Paused);
        assert_eq!(h.status.position(), 1234);
        h.send(Command::Stop);
        h.run(8);
        assert_eq!(h.status.transport(), TransportState::Stopped);
        assert_eq!(h.status.position(), 0);
    }

    #[test]
    fn natural_end_stops_and_rewinds() {
        let mut h = Harness::new(2);
        h.send(Command::Load(program(vec![
            Voice::new(ramp_stem(100, 1e-3), 1.0, mono(0)),
            Voice::new(ramp_stem(150, 1e-3), 1.0, mono(1)),
        ])));
        h.send(Command::Play);
        h.run(128);
        assert_eq!(h.status.transport(), TransportState::Playing);
        let out = h.run(128);
        // The longer stem is still rendering past the shorter one's end.
        assert!(out[2 * 21 + 1] > 0.0);
        assert!(out[2 * 22 + 1] == 0.0);
        assert_eq!(h.status.transport(), TransportState::Stopped);
        assert_eq!(h.status.position(), 0);
        assert_eq!(h.status.natural_ends(), 1);
    }

    #[test]
    fn gain_changes_ramp_and_never_move_the_playhead() {
        let mut h = Harness::new(2);
        let flat = Arc::new(StemAudio::from_interleaved_stereo(vec![0.5; 20_000]));
        h.send(Command::Load(program(vec![Voice::new(flat, 1.0, mono(0))])));
        h.send(Command::Play);
        h.run(10);
        h.send(Command::SetGain {
            voice: 0,
            gain: 0.0,
        });
        let out = h.run(20);
        assert!(out[0] < 0.5 && out[0] > 0.0);
        assert_eq!(out[2 * 14], 0.0); // 15-frame ramp
        assert_eq!(h.status.position(), 30);
    }

    #[test]
    fn routes_mono_sum_and_stereo_pairs() {
        let mut h = Harness::new(4);
        let stem = Arc::new(StemAudio::from_interleaved_stereo([0.2, 0.4].repeat(100)));
        let routes = RouteSet::from_targets(
            &[
                OutputTarget::Mono { channel: 0 },
                OutputTarget::Stereo { left: 2, right: 3 },
            ],
            4,
        );
        h.send(Command::Load(program(vec![Voice::new(stem, 1.0, routes)])));
        h.send(Command::Play);
        let out = h.run(1);
        assert!((out[0] - 0.3).abs() < 1e-6);
        assert_eq!(out[1], 0.0);
        assert!((out[2] - 0.2).abs() < 1e-6);
        assert!((out[3] - 0.4).abs() < 1e-6);
    }

    #[test]
    fn loading_while_playing_fades_then_swaps_and_returns_old_program() {
        let mut h = two_stem_harness();
        h.send(Command::Play);
        h.run(100);
        h.send(Command::Load(program(vec![Voice::new(
            ramp_stem(50, 1e-3),
            1.0,
            mono(0),
        )])));
        h.run(64);
        assert_eq!(h.status.transport(), TransportState::Stopped);
        assert_eq!(h.status.loads(), 2);
        assert!(matches!(h.garbage.pop(), Ok(Garbage::Program(_))));
        h.send(Command::Play);
        let out = h.run(2);
        assert!((out[0] - 1e-3).abs() < 1e-9);
    }

    #[test]
    fn applied_count_only_moves_with_published_state() {
        let mut h = two_stem_harness();
        h.run(8);
        assert_eq!(h.status.applied(), 1); // the Load
        h.send(Command::Play);
        h.send(Command::SetGain {
            voice: 0,
            gain: 0.5,
        });
        assert_eq!(h.status.applied(), 1);
        h.run(8);
        assert_eq!(h.status.applied(), 3);
        assert_eq!(h.status.transport(), TransportState::Playing);
    }

    #[test]
    fn output_is_clamped_to_full_scale() {
        let mut h = Harness::new(1);
        let loud = Arc::new(StemAudio::from_interleaved_stereo(vec![0.9; 200]));
        h.send(Command::Load(program(vec![
            Voice::new(loud.clone(), 1.0, mono(0)),
            Voice::new(loud, 1.0, mono(0)),
        ])));
        h.send(Command::Play);
        assert!(h.run(10).iter().all(|s| *s == 1.0));
    }
}
