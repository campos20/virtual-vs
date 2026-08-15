import { AudioEngine } from './AudioEngine';
import type { DecodedProject } from '@/storage/types';
import type { ProjectManifest } from '@/types/project';

function manifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    id: 'p',
    title: 'P',
    key: '',
    tracks: [{ id: 'a', name: 'A', file: 'a.wav', gain: 1, bus: 'main' }],
    sections: [],
    ...overrides,
  };
}

function decoded(engine: AudioEngine, m: ProjectManifest): DecodedProject {
  // A short real buffer from the engine's own context, so durations behave.
  const buffer = engine.context.createBuffer(1, engine.context.sampleRate, engine.context.sampleRate);
  return { manifest: m, trackBuffers: { a: buffer } };
}

describe('AudioEngine click generation', () => {
  it('generates a click when the project has a bpm', () => {
    const engine = new AudioEngine();
    const m = manifest({ bpm: 120 });
    engine.loadProject(decoded(engine, m));

    expect(engine.hasClick()).toBe(true);
  });

  it('generates no click when the project has no bpm', () => {
    const engine = new AudioEngine();
    const m = manifest();
    engine.loadProject(decoded(engine, m));

    expect(engine.hasClick()).toBe(false);
  });

  it('generates no click for a non-positive bpm', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ bpm: 0 })));

    expect(engine.hasClick()).toBe(false);
  });

  it('still plays a project that has no click', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest()));

    engine.play();
    expect(engine.getTransportState()).toBe('playing');

    engine.stop();
    expect(engine.getTransportState()).toBe('stopped');
  });
});
