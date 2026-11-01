/**
 * Polls the Rust engine's status (transport, position, device health,
 * routing warnings) and fans it out to the desktop `AudioEngine` and the
 * desktop-only UI. Polling - not events - because the audio thread can't
 * emit events without risking a stall, and a missed event would leave the UI
 * wrong until the next one; a poll self-corrects within one interval.
 */
import { invoke } from "../tauri";

export interface ActiveOutput {
  id: string;
  name: string;
  channels: number;
  sampleRate: number;
  bufferFrames: number | null;
}

export interface EngineStatusDto {
  transport: "stopped" | "playing" | "paused";
  positionSec: number;
  durationSec: number;
  output: ActiveOutput | null;
  deviceError: string | null;
  xruns: number;
  routingWarnings: string[];
  projectId: string | null;
  pendingCommands: number;
}

export interface StatusSample {
  status: EngineStatusDto;
  /** performance.now() when the request was sent / answered. */
  requestedAt: number;
  receivedAt: number;
}

const POLL_MS = 33;
/** No answer for this long means the engine itself is unreachable. */
const UNRESPONSIVE_AFTER_MS = 2000;

type Listener = (sample: StatusSample) => void;

class EngineStatusStore {
  private latest: StatusSample | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  private lastAnswerAt = performance.now();
  /** Errors from commands the desktop AudioEngine sent (e.g. a failed load). */
  private commandError: string | null = null;
  private errorListeners = new Set<() => void>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.poll();
  }

  private poll = async (): Promise<void> => {
    const requestedAt = performance.now();
    try {
      const status = await invoke<EngineStatusDto>("get_status");
      const sample = { status, requestedAt, receivedAt: performance.now() };
      this.latest = sample;
      this.lastAnswerAt = sample.receivedAt;
      for (const listener of this.listeners) listener(sample);
    } catch {
      // Reported through isUnresponsive(); keep polling.
    } finally {
      setTimeout(this.poll, POLL_MS);
    }
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }

  getLatest(): EngineStatusDto | null {
    return this.latest?.status ?? null;
  }

  isUnresponsive(): boolean {
    return (
      this.started &&
      performance.now() - this.lastAnswerAt > UNRESPONSIVE_AFTER_MS
    );
  }

  reportCommandError(command: string, error: unknown): void {
    this.commandError = `${command}: ${String(error)}`;
    for (const listener of this.errorListeners) listener();
  }

  clearCommandError(): void {
    if (this.commandError === null) return;
    this.commandError = null;
    for (const listener of this.errorListeners) listener();
  }

  getCommandError(): string | null {
    return this.commandError;
  }

  subscribeErrors(listener: () => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
}

export const engineStatus = new EngineStatusStore();
