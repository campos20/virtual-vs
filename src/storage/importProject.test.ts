import type { ProjectManifest } from "@/types/project";
import {
  moveStemInProject,
  patchProjectManifest,
  removeStemFromProject,
  renameStemInProject,
  updateProjectMetadata,
} from "./importProject";

/**
 * An in-memory stand-in for the parts of expo-file-system these functions
 * touch. Reading a file's JSON takes its snapshot immediately but resolves a
 * few macrotask hops later, so two edits started back to back really do both
 * read the same manifest if nothing serializes them - the race the manifest
 * lock exists for.
 * Names are prefixed with "mock" so babel-plugin-jest-hoist lets the factory
 * close over them.
 */
const mockFiles = new Map<string, string>();
let mockReadDelayTicks = 3;
let mockFailNextRead = false;

jest.mock("expo-file-system", () => {
  const join = (parent: { uri: string } | string, name?: string) => {
    const base = typeof parent === "string" ? parent : parent.uri;
    return name === undefined ? base : `${base.replace(/\/+$/, "")}/${name}`;
  };
  return {
    Directory: class {
      uri: string;
      constructor(uri: string) {
        this.uri = uri;
      }
    },
    File: class {
      uri: string;
      constructor(parent: { uri: string } | string, name?: string) {
        this.uri = join(parent, name);
      }
      get exists() {
        return mockFiles.has(this.uri);
      }
      async json() {
        // Snapshot first, then wait: the read has happened, but the caller
        // only gets it later - the window in which another edit can save.
        const content = mockFiles.get(this.uri);
        const fail = mockFailNextRead;
        mockFailNextRead = false;
        for (let i = 0; i < mockReadDelayTicks; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (fail) throw new Error("unreadable");
        if (content === undefined) throw new Error(`missing ${this.uri}`);
        return JSON.parse(content);
      }
      write(content: string) {
        mockFiles.set(this.uri, content);
      }
      delete() {
        mockFiles.delete(this.uri);
      }
    },
  };
});

// Only `projectDirectory` (for creating drafts) uses this - not under test.
jest.mock("./paths", () => ({ projectDirectory: jest.fn() }));

const DIR = "file:///mock/projects/song";
const MANIFEST = `${DIR}/manifest.json`;

function track(id: string) {
  return {
    id,
    name: id.toUpperCase(),
    file: `${id}.wav`,
    gain: 1,
    bus: "main" as const,
  };
}

function seed(manifest: Partial<ProjectManifest> = {}) {
  mockFiles.clear();
  const full: ProjectManifest = {
    id: "song",
    title: "Song",
    key: "",
    tracks: [track("a"), track("b"), track("c")],
    sections: [],
    ...manifest,
  };
  mockFiles.set(MANIFEST, JSON.stringify(full));
  for (const t of full.tracks) mockFiles.set(`${DIR}/${t.file}`, "audio");
}

function onDisk(): ProjectManifest {
  return JSON.parse(mockFiles.get(MANIFEST)!);
}

beforeEach(() => {
  mockReadDelayTicks = 3;
  mockFailNextRead = false;
  seed();
});

describe("moveStemInProject", () => {
  it("swaps a stem with its neighbour, keeping everything else", async () => {
    const updated = await moveStemInProject(DIR, "b", "up");

    expect(updated.tracks.map((t) => t.id)).toEqual(["b", "a", "c"]);
    expect(onDisk().tracks).toEqual([track("b"), track("a"), track("c")]);
  });

  it("leaves the manifest untouched past either end or for an unknown stem", async () => {
    const before = mockFiles.get(MANIFEST);

    await moveStemInProject(DIR, "a", "up");
    await moveStemInProject(DIR, "c", "down");
    await moveStemInProject(DIR, "nope", "up");

    expect(mockFiles.get(MANIFEST)).toBe(before);
  });
});

describe("manifest edits to one project run one at a time", () => {
  // The reviewed scenario: a rename still saving when a removal is
  // confirmed. Unserialized, the rename's stale write would put the removed
  // track back while its audio file is already gone, and the song would fail
  // to load.
  it("never resurrects a removed track from a rename that was in flight", async () => {
    await Promise.all([
      renameStemInProject(DIR, "a", "Renamed"),
      removeStemFromProject(DIR, "b"),
    ]);

    const manifest = onDisk();
    expect(manifest.tracks.map((t) => t.id)).toEqual(["a", "c"]);
    expect(manifest.tracks[0].name).toBe("Renamed");
    expect(mockFiles.has(`${DIR}/b.wav`)).toBe(false);
  });

  it("keeps every change when renames, moves and mixer saves land together", async () => {
    await Promise.all([
      renameStemInProject(DIR, "a", "Renamed"),
      moveStemInProject(DIR, "c", "up"),
      patchProjectManifest(DIR, { clickEnabled: false }),
      moveStemInProject(DIR, "c", "up"),
      updateProjectMetadata(DIR, { title: "New title", key: "A" }),
    ]);

    const manifest = onDisk();
    expect(manifest.tracks.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(manifest.tracks.find((t) => t.id === "a")?.name).toBe("Renamed");
    expect(manifest.clickEnabled).toBe(false);
    expect(manifest.title).toBe("New title");
  });

  it("treats a trailing slash on the folder as the same project", async () => {
    await Promise.all([
      renameStemInProject(DIR, "a", "Renamed"),
      moveStemInProject(`${DIR}/`, "c", "up"),
    ]);

    const manifest = onDisk();
    expect(manifest.tracks.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(manifest.tracks[0].name).toBe("Renamed");
  });

  it("doesn't let one failed edit block the ones queued after it", async () => {
    mockFailNextRead = true;
    const failing = renameStemInProject(DIR, "a", "Renamed");
    const queued = patchProjectManifest(DIR, { clickEnabled: false });

    await expect(failing).rejects.toThrow("unreadable");
    await queued;
    expect(onDisk().clickEnabled).toBe(false);
    expect(onDisk().tracks[0].name).toBe("A");
  });
});
