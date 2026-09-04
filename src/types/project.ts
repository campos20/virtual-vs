export type Bus = 'main' | 'cue' | 'both';

export interface TrackManifest {
  id: string;
  name: string;
  /** Filename relative to the project's folder (or a require() asset key for bundled projects). */
  file: string;
  /** Committed linear gain (0-1+) applied before mute/solo. */
  gain: number;
  bus: Bus;
  /** Committed mixer state, so a soundchecked mix survives closing the app. */
  muted?: boolean;
  soloed?: boolean;
}

export interface SectionManifest {
  id: string;
  name: string;
  startSec: number;
}

export interface LyricsSyncPoint {
  /** Index into `lyrics.split('\n')`. */
  lineIndex: number;
  /** Playhead position, in seconds, this line was tapped at. */
  timeSec: number;
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
  /** Whether the generated click is audible. Per-project, like the rest of the mix. */
  clickEnabled?: boolean;
  tracks: TrackManifest[];
  sections: SectionManifest[];
  pad?: PadManifest;
  /** Optional full lyrics text, shown in the auto-scrolling lyrics view. Absent/empty means the project has no lyrics yet. */
  lyrics?: string;
  /**
   * Sparse tap-to-correct timing points, at most one per line index - see
   * LyricsView. Cleared whenever `lyrics` text is re-saved, since line
   * indices may no longer line up with the new text.
   */
  lyricsSyncPoints?: LyricsSyncPoint[];
}
