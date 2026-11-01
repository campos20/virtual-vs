/**
 * Desktop replacement for `react-native-audio-api`. Audio on desktop is
 * played by the Rust engine, never in the webview, so this only covers what
 * the shared code needs at runtime:
 *
 * - `AudioContext.decodeAudioData()` - decodes a stem in Rust (at the output
 *   device's rate) and returns a handle to it: duration and a waveform
 *   envelope, without moving the audio itself into the webview. The desktop
 *   `AudioEngine` (desktop/web/engine) installs those handles in the engine.
 * - `AudioManager` - mobile audio-session calls, which mean nothing here.
 *
 * Anything that would need the samples in JS (`getChannelData`, building
 * buffers) throws, so a path that relies on it fails loudly instead of
 * playing something wrong.
 */
import { invoke, uriToPath } from "../tauri";

interface DecodedDto {
  bufferId: number;
  sampleRate: number;
  frames: number;
  durationSec: number;
  peaksPerSecond: number;
  peaks: number[];
}

/** A stem decoded and held by the Rust engine. */
export class AudioBuffer {
  readonly numberOfChannels = 2;

  constructor(
    readonly bufferId: number,
    readonly sampleRate: number,
    readonly length: number,
    readonly duration: number,
    readonly peaksPerSecond: number,
    readonly peaks: Float32Array,
  ) {}

  getChannelData(_channel: number): Float32Array {
    throw new Error(
      "Decoded audio stays in the desktop engine; samples aren't available in the UI.",
    );
  }

  copyToChannel(): void {
    throw new Error("Desktop audio buffers are read-only.");
  }
}

export class BaseAudioContext {
  sampleRate = 48000;

  async decodeAudioData(
    input: string | number | ArrayBuffer,
  ): Promise<AudioBuffer> {
    if (typeof input !== "string") {
      throw new Error("The desktop build decodes audio files by path only.");
    }
    const dto = await invoke<DecodedDto>("audio_decode", {
      path: uriToPath(input),
    });
    this.sampleRate = dto.sampleRate;
    return new AudioBuffer(
      dto.bufferId,
      dto.sampleRate,
      dto.frames,
      dto.durationSec,
      dto.peaksPerSecond,
      Float32Array.from(dto.peaks),
    );
  }

  createBuffer(): AudioBuffer {
    throw new Error(
      "The desktop build does not build audio buffers in the UI.",
    );
  }
}

export class AudioContext extends BaseAudioContext {}

export const AudioManager = {
  setAudioSessionOptions(_options: unknown): void {},
  async setAudioSessionActivity(_active: boolean): Promise<boolean> {
    return true;
  },
};

// Type-only names some modules import; never instantiated on desktop.
export type AudioBufferSourceNode = never;
export type GainNode = never;
export type StereoPannerNode = never;
