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
  const trackBuffers: DecodedProject['trackBuffers'] = {};
  for (const t of m.tracks) {
    trackBuffers[t.id] = engine.context.createBuffer(1, engine.context.sampleRate, engine.context.sampleRate);
  }
  return { manifest: m, trackBuffers };
}

/**
 * Intercepts every `AudioBufferSourceNode` the engine creates from here on
 * and records the `when` argument passed to its `start`/`stop` - the mock
 * library's own `start`/`stop` are no-ops that don't record their args, so
 * this is the only way to see what the engine actually scheduled.
 */
function recordScheduling(engine: AudioEngine): {
  starts: (number | undefined)[];
  stops: (number | undefined)[];
} {
  const starts: (number | undefined)[] = [];
  const stops: (number | undefined)[] = [];
  const createBufferSource = engine.context.createBufferSource.bind(engine.context);
  jest.spyOn(engine.context, 'createBufferSource').mockImplementation(() => {
    const node = createBufferSource();
    // Recorded as-passed (not defaulted) - an omitted `when` means "stop/start
    // ASAP", indistinguishable across nodes and exactly the bug these tests
    // guard against, so it must show up as `undefined` here, not silently
    // become a fake shared value like 0.
    jest.spyOn(node, 'start').mockImplementation((when?: number) => starts.push(when));
    jest.spyOn(node, 'stop').mockImplementation((when?: number) => stops.push(when));
    return node;
  });
  return { starts, stops };
}

/** Every call scheduled an explicit, identical context time - never omitted, never merely coincidentally equal. */
function expectSampleLocked(scheduled: (number | undefined)[], expectedCount: number) {
  expect(scheduled).toHaveLength(expectedCount);
  expect(scheduled.every((w) => typeof w === 'number')).toBe(true);
  expect(new Set(scheduled).size).toBe(1);
}

const THREE_STEM_TRACKS = [
  { id: 'a', name: 'A', file: 'a.wav', gain: 1, bus: 'main' as const },
  { id: 'b', name: 'B', file: 'b.wav', gain: 1, bus: 'main' as const },
  { id: 'c', name: 'C', file: 'c.wav', gain: 1, bus: 'cue' as const },
];

// See AGENTS.md "Stems stay sample-locked" - every stem (and the click) must
// always be started/stopped/rescheduled together, off one shared context
// time, never independently. These tests exist so a future change that
// breaks that (e.g. scheduling stems in a loop with per-iteration timing)
// fails loudly here instead of surfacing as an audible drift on stage.
describe('AudioEngine keeps every stem sample-locked', () => {
  it('starts every stem and the click at the exact same context time', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ bpm: 120, tracks: THREE_STEM_TRACKS })));
    const { starts } = recordScheduling(engine);

    engine.play();

    expectSampleLocked(starts, 4); // 3 stems + the click
  });

  it('resumes every stem from the same offset, at the same new context time, after a pause', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ tracks: THREE_STEM_TRACKS })));
    engine.play();
    engine.pause();
    const { starts } = recordScheduling(engine);

    engine.play();

    expectSampleLocked(starts, 3);
  });

  it('reschedules every stem and the click to the same new position on seek', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ bpm: 120, tracks: THREE_STEM_TRACKS })));
    engine.play();
    const { starts } = recordScheduling(engine);

    engine.seek(10);

    expectSampleLocked(starts, 4);
  });

  it('stops every stem and the click at the exact same context time', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ bpm: 120, tracks: THREE_STEM_TRACKS })));
    // Spying wraps nodes as they're *created*, so this has to be in place
    // before play() creates the very nodes stop() will later act on.
    const { stops } = recordScheduling(engine);
    engine.play();

    engine.stop();

    expectSampleLocked(stops, 4);
    // Not just equal to each other, but strictly ahead of the clock at the
    // moment they were scheduled - `ctx.currentTime` on its own can already
    // be behind by the time a later call in the loop reaches the audio
    // thread, which silently falls back to "stop ASAP" per node instead of
    // the shared guaranteed instant this is supposed to be.
    expect(stops[0]).toBeGreaterThan(engine.context.currentTime);
  });

  it('primes every stem and the click once at load, before any real play()', () => {
    const engine = new AudioEngine();
    const { starts } = recordScheduling(engine); // wraps createBufferSource before loadProject primes

    engine.loadProject(decoded(engine, manifest({ bpm: 120, tracks: THREE_STEM_TRACKS })));

    // 3 stems + click, all scheduled - loadProject() must not leave any of
    // them for the user's first play() to discover cold.
    expectSampleLocked(starts, 4);
    // Priming must never flip the transport to 'playing' or notify listeners.
    expect(engine.getTransportState()).toBe('stopped');
  });

  it('never re-schedules any stem for a volume/mute/solo change - those are gain automation only', () => {
    const engine = new AudioEngine();
    engine.loadProject(decoded(engine, manifest({ tracks: THREE_STEM_TRACKS })));
    engine.play();
    const { starts, stops } = recordScheduling(engine);

    engine.setTrackVolume('a', 0.5);
    engine.setTrackMuted('b', true);
    engine.setTrackSoloed('c', true);

    expect(starts).toHaveLength(0);
    expect(stops).toHaveLength(0);
  });
});

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
