export type Bus = 'main' | 'cue' | 'both';

export interface TrackManifest {
  id: string;
  name: string;
  /** Filename relative to the project's folder (or a require() asset key for bundled projects). */
  file: string;
  /** Default linear gain (0-1+) applied before mute/solo. */
  gain: number;
  bus: Bus;
}

export interface SectionManifest {
  name: string;
  startSec: number;
}

export interface PadManifest {
  file: string;
  loop: boolean;
  bus: Bus;
}

export interface ProjectManifest {
  id: string;
  title: string;
  /**
   * Optional. Without a bpm there is no tempo to generate a metronome from,
   * so the engine renders no click for the project at all (see AudioEngine).
   */
  bpm?: number;
  key: string;
  tracks: TrackManifest[];
  sections: SectionManifest[];
  pad?: PadManifest;
}
