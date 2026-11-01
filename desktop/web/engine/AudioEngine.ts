/**
 * Desktop version of `src/engine/AudioEngine.ts` (swapped in by
 * metro.config.js for the web/desktop build). Same public API, so the mobile
 * screens and stores run unchanged, but nothing here plays audio: every call
 * becomes a command for the Rust engine (desktop/src-tauri/src/engine),
 * which keeps all stems on one playhead.
 *
 * Two rules keep the UI and the engine from disagreeing:
 *
 * - Commands go to Rust strictly in order, through one serial queue - a
 *   `play()` right after `loadProject()` can never overtake the load.
 * - The UI updates its transport state immediately (like the mobile engine
 *   does) and only adopts the engine's polled state when that poll was taken
 *   after every command was applied (`pendingCommands === 0` and requested
 *   after the last command finished). A stale poll can therefore never flip
 *   the UI back, or fake a natural end of the song.
 *
 * The playhead shown is the engine's position interpolated between polls -
 * a display estimate only; it never drives the audio.
 */
import type { DecodedProject } from "@/storage/types";
import type {
  EngineTransportState,
  MonitorMode,
  TrackRuntimeState,
} from "@/engine/types";
import type { Bus } from "@/types/project";
import { invoke } from "../tauri";
import {
  AudioContext,
  type AudioBuffer as DesktopAudioBuffer,
} from "../shims/react-native-audio-api";
import { engineStatus, type StatusSample } from "./status";

export class AudioEngine {
  private readonly ctx = new AudioContext();
  private monitorMode: MonitorMode = "split";
  private clickEnabled = true;
  private hasClickTrack = false;

  private manifestTrackIds: string[] = [];
  private trackState = new Map<string, TrackRuntimeState>();
  private loadedProjectId: string | null = null;
  private durationSec = 0;

  private transportState: EngineTransportState = "stopped";
  private positionSec = 0;
  private positionAt = performance.now();
  private transportListeners = new Set<(state: EngineTransportState) => void>();

  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private lastCommandDoneAt = 0;

  constructor() {
    engineStatus.subscribe(this.syncFromEngine);
  }

  /** Starts status polling. Mobile uses this to open its audio session. */
  async prepare(): Promise<void> {
    engineStatus.start();
  }

  get context(): AudioContext {
    return this.ctx;
  }

  /** The song this UI believes the engine has loaded. */
  getLoadedProjectId(): string | null {
    return this.loadedProjectId;
  }

  /** Commands still on their way to the engine. */
  hasPendingCommands(): boolean {
    return this.queued > 0;
  }

  private enqueue(command: string, args?: Record<string, unknown>): void {
    this.queued += 1;
    const run = () => invoke(command, args);
    this.queue = this.queue
      .then(run, run)
      .then(
        () => engineStatus.clearCommandError(),
        (error: unknown) => engineStatus.reportCommandError(command, error),
      )
      .finally(() => {
        this.queued -= 1;
        this.lastCommandDoneAt = performance.now();
      });
  }

  private syncFromEngine = ({ status, requestedAt }: StatusSample): void => {
    // Only trust a poll that already reflects every command we sent.
    if (
      this.queued > 0 ||
      status.pendingCommands > 0 ||
      requestedAt < this.lastCommandDoneAt
    ) {
      return;
    }
    // The engine is playing something this UI didn't load (e.g. after the
    // window reloaded) - the desktop banner offers to stop it; don't adopt it.
    if (status.projectId !== this.loadedProjectId) return;

    const previous = this.transportState;
    this.transportState = status.transport;
    this.positionSec = status.positionSec;
    this.positionAt = performance.now();
    if (status.durationSec > 0) this.durationSec = status.durationSec;
    if (previous !== status.transport) this.notify();
  };

  private notify(): void {
    for (const listener of this.transportListeners) {
      listener(this.transportState);
    }
  }

  private setLocalTransport(
    state: EngineTransportState,
    positionSec: number,
  ): void {
    const changed = state !== this.transportState;
    this.transportState = state;
    this.positionSec = positionSec;
    this.positionAt = performance.now();
    if (changed) this.notify();
  }

  setMonitorMode(mode: MonitorMode): void {
    this.monitorMode = mode;
    this.enqueue("set_monitor_mode", { mode });
  }

  getMonitorMode(): MonitorMode {
    return this.monitorMode;
  }

  setClickEnabled(enabled: boolean): void {
    this.clickEnabled = enabled;
    this.enqueue("set_click_enabled", { enabled });
  }

  getClickEnabled(): boolean {
    return this.clickEnabled;
  }

  hasClick(): boolean {
    return this.hasClickTrack;
  }

  onTransportStateChange(
    listener: (state: EngineTransportState) => void,
  ): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  /**
   * Installs a decoded song. The stems were decoded in Rust by
   * `context.decodeAudioData()`; this sends their handles plus the mix
   * state, and the engine swaps the whole song in at once.
   */
  loadProject(
    decoded: DecodedProject,
    initialTrackStates?: Record<string, TrackRuntimeState>,
  ): void {
    const { manifest } = decoded;
    this.manifestTrackIds = manifest.tracks.map((t) => t.id);
    this.trackState.clear();
    let durationSec = 0;
    const tracks = manifest.tracks.map((track) => {
      const state: TrackRuntimeState = initialTrackStates?.[track.id] ?? {
        id: track.id,
        bus: track.bus,
        volume: track.gain,
        muted: false,
        soloed: false,
      };
      this.trackState.set(track.id, state);
      const buffer = decoded.trackBuffers[track.id] as unknown as
        DesktopAudioBuffer | undefined;
      if (!buffer) {
        throw new Error(`Track "${track.name}" has no decoded audio`);
      }
      durationSec = Math.max(durationSec, buffer.duration);
      return {
        id: track.id,
        name: track.name,
        bus: state.bus,
        bufferId: buffer.bufferId,
        volume: state.volume,
        muted: state.muted,
        soloed: state.soloed,
      };
    });

    const bpm = manifest.bpm;
    this.hasClickTrack = bpm !== undefined && bpm > 0;
    this.durationSec = durationSec;
    this.loadedProjectId = manifest.id;
    this.setLocalTransport("stopped", 0);
    this.enqueue("engine_load", {
      request: {
        projectId: manifest.id,
        bpm: bpm ?? null,
        clickEnabled: this.clickEnabled,
        tracks,
      },
    });
  }

  getManifestTrackIds(): string[] {
    return this.manifestTrackIds;
  }

  getTrackState(trackId: string): TrackRuntimeState | undefined {
    return this.trackState.get(trackId);
  }

  // --- Transport -----------------------------------------------------------

  play(): void {
    if (this.transportState === "playing" || this.trackState.size === 0) {
      return;
    }
    this.setLocalTransport("playing", this.positionSec);
    this.enqueue("play");
  }

  pause(): void {
    if (this.transportState !== "playing") return;
    this.setLocalTransport("paused", this.getPlayhead());
    this.enqueue("pause");
  }

  stop(): void {
    this.setLocalTransport("stopped", 0);
    this.enqueue("stop");
  }

  seek(toSec: number): void {
    if (this.trackState.size === 0) return;
    const clamped = Math.min(Math.max(0, toSec), this.durationSec);
    // Same as the engine: seeking while stopped parks the transport paused.
    this.setLocalTransport(
      this.transportState === "playing" ? "playing" : "paused",
      clamped,
    );
    this.enqueue("seek", { sec: clamped });
  }

  getTransportState(): EngineTransportState {
    return this.transportState;
  }

  getPlayhead(): number {
    if (this.transportState === "playing") {
      const elapsed = (performance.now() - this.positionAt) / 1000;
      return Math.min(this.positionSec + elapsed, this.durationSec);
    }
    if (this.transportState === "paused") return this.positionSec;
    return 0;
  }

  // --- Per-track controls --------------------------------------------------

  setTrackVolume(trackId: string, volume: number): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.volume = volume;
    this.enqueue("set_track_volume", { trackId, volume });
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.muted = muted;
    this.enqueue("set_track_muted", { trackId, muted });
  }

  setTrackSoloed(trackId: string, soloed: boolean): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.soloed = soloed;
    this.enqueue("set_track_soloed", { trackId, soloed });
  }

  setTrackBus(trackId: string, bus: Bus): void {
    const state = this.trackState.get(trackId);
    if (!state) return;
    state.bus = bus;
    this.enqueue("set_track_bus", { trackId, bus });
  }

  /** Stops whatever the engine plays, including a song this UI doesn't know. */
  forceStopEngine(): void {
    this.setLocalTransport("stopped", 0);
    this.enqueue("stop");
  }
}

/** One AudioEngine for the whole app, as on mobile. */
export const audioEngine = new AudioEngine();
