import {
  AudioContext,
  AudioManager,
  type AudioBuffer,
  type AudioBufferSourceNode,
  type GainNode,
  type StereoPannerNode,
} from 'react-native-audio-api';
import type { Bus } from '@/types/project';
import type { DecodedProject } from '@/storage/types';
import { generateClickBuffer } from './clickTrack';
import type { EngineTransportState, MonitorMode, TrackRuntimeState } from './types';

const LOOKAHEAD_SEC = 0.15;
/** Ramp time for volume/mute/solo changes, short enough to feel instant but long enough to avoid zipper clicks. */
const GAIN_RAMP_SEC = 0.015;

interface BusNodes {
  /** Sums every track routed to this bus. */
  gain: GainNode;
  /** Hard-panned in "split" mode (cue left / main right); centered in "monitor" mode. */
  panner: StereoPannerNode;
}

interface TrackNodes {
  buffer: AudioBuffer;
  /** Per-track volume/mute/solo gain (the "trackGain" in the signal graph). */
  gain: GainNode;
  /** Re-created on every play/resume/seek since buffer sources are one-shot. */
  source: AudioBufferSourceNode | null;
}

/**
 * The whole app shares one AudioEngine / one AudioContext, so every stem is
 * scheduled off the same sample clock. Signal graph per stem:
 *   BufferSource -> trackGain -> {cue and/or main bus gain} -> bus panner -> destination
 * There's no ChannelMergerNode in this library's Web Audio surface, so the
 * hard cue(L)/main(R) split is done with a StereoPannerNode per bus instead
 * (pan -1 / +1); "monitor" mode centers both panners so cue+main sum to both
 * output channels for rehearsal on normal headphones.
 */
export class AudioEngine {
  private readonly ctx: AudioContext;
  private readonly cueBus: BusNodes;
  private readonly mainBus: BusNodes;
  private monitorMode: MonitorMode = 'split';
  private clickEnabled = true;

  private manifestTrackIds: string[] = [];
  private tracks = new Map<string, TrackNodes>();
  private trackState = new Map<string, TrackRuntimeState>();
  /** The track whose buffer is longest - the one we listen to for "playback finished naturally". */
  private longestTrackId: string | null = null;

  private clickBuffer: AudioBuffer | null = null;
  private clickGain: GainNode | null = null;
  private clickSource: AudioBufferSourceNode | null = null;

  private transportState: EngineTransportState = 'stopped';
  private scheduledAtContextTime = 0;
  private playheadOffsetSec = 0;
  private pausedAtSec = 0;
  private transportListeners = new Set<(state: EngineTransportState) => void>();

  constructor() {
    this.ctx = new AudioContext();
    this.cueBus = this.createBus();
    this.mainBus = this.createBus();
    this.applyMonitorMode();
  }

  /** Activates the iOS/Android audio session for background playback. Call once at app startup. */
  async prepare(): Promise<void> {
    AudioManager.setAudioSessionOptions({ iosCategory: 'playback' });
    await AudioManager.setAudioSessionActivity(true);
  }

  get context(): AudioContext {
    return this.ctx;
  }

  private createBus(): BusNodes {
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    gain.connect(panner);
    panner.connect(this.ctx.destination);
    return { gain, panner };
  }

  private applyMonitorMode(): void {
    const [cuePan, mainPan] = this.monitorMode === 'split' ? [-1, 1] : [0, 0];
    this.cueBus.panner.pan.value = cuePan;
    this.mainBus.panner.pan.value = mainPan;
  }

  setMonitorMode(mode: MonitorMode): void {
    this.monitorMode = mode;
    this.applyMonitorMode();
  }

  getMonitorMode(): MonitorMode {
    return this.monitorMode;
  }

  /** Mutes/unmutes the synthesized click without affecting any track's volume. */
  setClickEnabled(enabled: boolean): void {
    this.clickEnabled = enabled;
    this.applyClickGain();
  }

  getClickEnabled(): boolean {
    return this.clickEnabled;
  }

  /**
   * Whether the loaded project has a click at all. Projects without a bpm
   * have no tempo to synthesize one from, so there is nothing to toggle.
   */
  hasClick(): boolean {
    return this.clickBuffer !== null;
  }

  private applyClickGain(): void {
    if (!this.clickGain) return;
    const target = this.clickEnabled ? 1 : 0;
    const now = this.ctx.currentTime;
    this.clickGain.gain.cancelScheduledValues(now);
    this.clickGain.gain.setValueAtTime(this.clickGain.gain.value, now);
    this.clickGain.gain.linearRampToValueAtTime(target, now + GAIN_RAMP_SEC);
  }

  /** Subscribe to transport state changes (including natural end-of-playback). Returns an unsubscribe function. */
  onTransportStateChange(listener: (state: EngineTransportState) => void): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  private setTransportState(next: EngineTransportState): void {
    this.transportState = next;
    for (const listener of this.transportListeners) listener(next);
  }

  /**
   * Builds the node graph for a freshly decoded project. `initialTrackStates`
   * seeds volume/mute/solo/bus from the store's committed state (falls back
   * to the manifest's defaults for a never-opened project).
   */
  loadProject(decoded: DecodedProject, initialTrackStates?: Record<string, TrackRuntimeState>): void {
    this.stop();
    this.disposeTracks();

    this.manifestTrackIds = decoded.manifest.tracks.map((t) => t.id);

    for (const trackManifest of decoded.manifest.tracks) {
      const buffer = decoded.trackBuffers[trackManifest.id];
      const gain = this.ctx.createGain();

      const state: TrackRuntimeState = initialTrackStates?.[trackManifest.id] ?? {
        id: trackManifest.id,
        bus: trackManifest.bus,
        volume: trackManifest.gain,
        muted: false,
        soloed: false,
      };

      this.tracks.set(trackManifest.id, { buffer, gain, source: null });
      this.trackState.set(trackManifest.id, state);
      this.connectTrackToBuses(trackManifest.id);
      this.applyEffectiveGain(trackManifest.id);
    }

    let maxDurationSec = 0;
    this.longestTrackId = null;
    for (const t of decoded.manifest.tracks) {
      const duration = decoded.trackBuffers[t.id]?.duration ?? 0;
      if (duration > maxDurationSec) {
        maxDurationSec = duration;
        this.longestTrackId = t.id;
      }
    }

    // bpm is optional: with no tempo there is nothing to synthesize a
    // metronome from, so the project simply has no click and the transport
    // schedules nothing for it.
    const bpm = decoded.manifest.bpm;
    if (bpm !== undefined && bpm > 0) {
      this.clickBuffer = generateClickBuffer(this.ctx, bpm, maxDurationSec);
      this.clickGain = this.ctx.createGain();
      this.clickGain.connect(this.cueBus.gain); // click is always cue-only
      this.clickGain.gain.value = this.clickEnabled ? 1 : 0;
    }

    this.playheadOffsetSec = 0;
    this.pausedAtSec = 0;
    this.setTransportState('stopped');
  }

  private disposeTracks(): void {
    for (const node of this.tracks.values()) {
      node.source?.stop();
      node.gain.disconnect();
    }
    this.tracks.clear();
    this.trackState.clear();
    this.clickSource?.stop();
    this.clickSource = null;
    this.clickGain?.disconnect();
    this.clickGain = null;
    this.clickBuffer = null;
  }

  getManifestTrackIds(): string[] {
    return this.manifestTrackIds;
  }

  getTrackState(trackId: string): TrackRuntimeState | undefined {
    return this.trackState.get(trackId);
  }

  // --- Transport -----------------------------------------------------------

  play(): void {
    if (this.transportState === 'playing' || this.tracks.size === 0) return;
    const offset = this.transportState === 'paused' ? this.pausedAtSec : this.playheadOffsetSec;
    this.scheduleSources(offset);
  }

  pause(): void {
    if (this.transportState !== 'playing') return;
    this.pausedAtSec = this.getPlayhead();
    this.stopSources();
    this.setTransportState('paused');
  }

  stop(): void {
    this.stopSources();
    this.playheadOffsetSec = 0;
    this.pausedAtSec = 0;
    this.setTransportState('stopped');
  }

  seek(toSec: number): void {
    if (this.tracks.size === 0) return;
    const clamped = Math.max(0, toSec);
    const wasPlaying = this.transportState === 'playing';
    this.stopSources();
    if (wasPlaying) {
      this.scheduleSources(clamped);
    } else {
      this.pausedAtSec = clamped;
      this.playheadOffsetSec = clamped;
      this.setTransportState('paused');
    }
  }

  getTransportState(): EngineTransportState {
    return this.transportState;
  }

  /** Playhead in seconds, driven straight off the context clock (not the store - see AGENTS.md). */
  getPlayhead(): number {
    if (this.transportState === 'playing') {
      const elapsedSinceScheduled = Math.max(0, this.ctx.currentTime - this.scheduledAtContextTime);
      return this.playheadOffsetSec + elapsedSinceScheduled;
    }
    if (this.transportState === 'paused') return this.pausedAtSec;
    return 0;
  }

  private scheduleSources(offsetSec: number): void {
    const startAt = this.ctx.currentTime + LOOKAHEAD_SEC;

    for (const [trackId, node] of this.tracks) {
      const source = this.ctx.createBufferSource();
      source.buffer = node.buffer;
      source.connect(node.gain);
      if (trackId === this.longestTrackId) {
        source.onEnded = () => this.handlePlaybackEndedNaturally();
      }
      source.start(startAt, offsetSec);
      node.source = source;
    }

    if (this.clickBuffer && this.clickGain) {
      const clickSource = this.ctx.createBufferSource();
      clickSource.buffer = this.clickBuffer;
      clickSource.connect(this.clickGain);
      clickSource.start(startAt, offsetSec);
      this.clickSource = clickSource;
    }

    this.scheduledAtContextTime = startAt;
    this.playheadOffsetSec = offsetSec;
    this.setTransportState('playing');
  }

  private stopSources(): void {
    for (const node of this.tracks.values()) {
      node.source?.stop();
      node.source = null;
    }
    this.clickSource?.stop();
    this.clickSource = null;
  }

  /**
   * Fires when the longest track's source reaches its natural end (not from
   * a manual stop/pause/seek - those already flip `transportState` away
   * from 'playing' synchronously, before this async native event arrives).
   */
  private handlePlaybackEndedNaturally(): void {
    if (this.transportState !== 'playing') return;
    for (const node of this.tracks.values()) node.source = null;
    this.clickSource = null;
    this.playheadOffsetSec = 0;
    this.pausedAtSec = 0;
    this.setTransportState('stopped');
  }

  // --- Per-track controls ----------------------------------------------------

  setTrackVolume(trackId: string, volume: number): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.volume = volume;
    this.applyEffectiveGain(trackId);
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.muted = muted;
    // Restoring simply re-reads state.volume, so there's no separate "last volume" to track.
    this.applyEffectiveGain(trackId);
  }

  setTrackSoloed(trackId: string, soloed: boolean): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.soloed = soloed;
    // Soloing/un-soloing changes every other track's effective mute state too.
    for (const id of this.trackState.keys()) this.applyEffectiveGain(id);
  }

  setTrackBus(trackId: string, bus: Bus): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.bus = bus;
    this.connectTrackToBuses(trackId);
  }

  private connectTrackToBuses(trackId: string): void {
    const node = this.tracks.get(trackId);
    const state = this.trackState.get(trackId);
    if (!node || !state) return;
    node.gain.disconnect();
    if (state.bus === 'main' || state.bus === 'both') node.gain.connect(this.mainBus.gain);
    if (state.bus === 'cue' || state.bus === 'both') node.gain.connect(this.cueBus.gain);
  }

  private applyEffectiveGain(trackId: string): void {
    const node = this.tracks.get(trackId);
    const state = this.trackState.get(trackId);
    if (!node || !state) return;

    const anySoloed = Array.from(this.trackState.values()).some((t) => t.soloed);
    const effectivelyMuted = state.muted || (anySoloed && !state.soloed);
    const target = effectivelyMuted ? 0 : state.volume;

    const now = this.ctx.currentTime;
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setValueAtTime(node.gain.gain.value, now);
    node.gain.gain.linearRampToValueAtTime(target, now + GAIN_RAMP_SEC);
  }
}

/** One AudioEngine (and therefore one AudioContext / sample clock) for the whole app. */
export const audioEngine = new AudioEngine();
