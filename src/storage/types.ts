import type { AudioBuffer, BaseAudioContext } from 'react-native-audio-api';
import type { ProjectManifest } from '@/types/project';

/** Anything the engine's `context.decodeAudioData()` accepts. */
export type AudioFileRef = number | string;

/**
 * Where a project's manifest + stem files came from, and how to resolve a
 * manifest `file` field (track/pad) to something decodable. Filesystem
 * projects resolve to `file://` URIs. The abstraction survives the bundled
 * demo project it was written for, because it's also what would let a project
 * resolve its stems from somewhere else (an asset module id, a cache) without
 * the decoder knowing.
 */
export interface ProjectSource {
  manifest: ProjectManifest;
  resolveFile(file: string): AudioFileRef;
}

export interface DecodedProject {
  manifest: ProjectManifest;
  trackBuffers: Record<string, AudioBuffer>;
  padBuffer?: AudioBuffer;
}

export type { BaseAudioContext };
