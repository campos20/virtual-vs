import { audioEngine } from "@/engine";
import { decodeProjectAudio, getProjectSourceForEntry } from "@/storage";
import type { LibraryProjectEntry } from "@/store/projectsSlice";
import { nowPlayingStore } from "./nowPlayingStore";

jest.mock("@/storage", () => ({
  ...jest.requireActual("@/storage"),
  getProjectSourceForEntry: jest.fn(),
  decodeProjectAudio: jest.fn(),
}));

const getSourceMock = getProjectSourceForEntry as jest.Mock;
const decodeMock = decodeProjectAudio as jest.Mock;

const ENGINE_OPTIONS = { monitorMode: "split" as const, clickEnabled: true };

function entry(
  id: string,
  overrides: Partial<LibraryProjectEntry> = {},
): LibraryProjectEntry {
  return {
    id,
    title: id,
    key: "",
    tracks: [{ id: "a", name: "A", file: "a.wav", gain: 1, bus: "main" }],
    sections: [],
    origin: "filesystem",
    sourceDir: `file:///mock/${id}`,
    ...overrides,
  };
}

// jest.spyOn on an already-spied method returns the same spy instead of
// re-wrapping it, so a spy left over from a previous test would otherwise
// carry that test's call history into this one - restore real
// implementations between tests instead of only clearing call history.
afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  nowPlayingStore.resetForTests();
  getSourceMock.mockImplementation(async (e: LibraryProjectEntry) => ({
    manifest: e,
    resolveFile: () => 0,
  }));
  decodeMock.mockImplementation(async (_ctx, source) => ({
    manifest: source.manifest,
    trackBuffers: {},
  }));
});

describe("nowPlayingStore", () => {
  it("decodes and loads a project on first open", async () => {
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    const result = await nowPlayingStore.openProject(
      entry("a"),
      ENGINE_OPTIONS,
    );

    expect(loadSpy).toHaveBeenCalled();
    expect(result.manifest.id).toBe("a");
    expect(nowPlayingStore.getSnapshot().projectId).toBe("a");
  });

  it("is a no-op that leaves playback untouched when re-opening the same project", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    audioEngine.play();
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    expect(loadSpy).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe("playing");
    audioEngine.stop();
  });

  it("reload forces a fresh decode even for the already-current project", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    await nowPlayingStore.reload(entry("a"), ENGINE_OPTIONS);

    expect(loadSpy).toHaveBeenCalled();
  });

  it("setFolderContext records which folder the current project was opened from", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    nowPlayingStore.setFolderContext("a", "folder-1");

    expect(nowPlayingStore.getSnapshot().folderId).toBe("folder-1");
  });

  it("setFolderContext is a no-op when the given project isn't the one currently loaded", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    nowPlayingStore.setFolderContext("some-other-project", "folder-1");

    expect(nowPlayingStore.getSnapshot().folderId).toBeNull();
  });

  it("clears the remembered folder when a different project loads", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    nowPlayingStore.setFolderContext("a", "folder-1");

    await nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);

    expect(nowPlayingStore.getSnapshot().folderId).toBeNull();
  });

  it("does not clobber an already-loaded project when a different project fails to load", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    getSourceMock.mockRejectedValueOnce(new Error("missing manifest"));

    await expect(
      nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS),
    ).rejects.toThrow("missing manifest");

    expect(nowPlayingStore.getSnapshot().projectId).toBe("a");
  });

  it("never commits a slow, superseded load over a newer one", async () => {
    let resolveB!: () => void;
    decodeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = () => resolve({ manifest: entry("b"), trackBuffers: {} });
        }),
    );
    const openB = nowPlayingStore
      .openProject(entry("b"), ENGINE_OPTIONS)
      .catch((e) => e);

    // A second, later request for a different project completes first.
    await nowPlayingStore.openProject(entry("c"), ENGINE_OPTIONS);
    expect(nowPlayingStore.getSnapshot().projectId).toBe("c");

    resolveB();
    const resultB = await openB;
    expect(resultB).toBeInstanceOf(Error);
    expect(nowPlayingStore.getSnapshot().projectId).toBe("c");
  });

  it("closeIfCurrent stops and clears only when it matches the loaded project", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    audioEngine.play();
    const stopSpy = jest.spyOn(audioEngine, "stop");

    nowPlayingStore.closeIfCurrent("someone-else");
    expect(stopSpy).not.toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBe("a");

    nowPlayingStore.closeIfCurrent("a");
    expect(stopSpy).toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it("renameTrackLocal patches both the manifest and the waveform tracks", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    nowPlayingStore.renameTrackLocal("a", "a", "Renamed");

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.tracks.find((t) => t.id === "a")?.name).toBe(
      "Renamed",
    );
    expect(snapshot.waveformTracks.find((t) => t.id === "a")?.name).toBe(
      "Renamed",
    );
  });

  // A rename's write can land after the user has switched songs, and stem
  // ids are commonly shared between songs ("bass", "keys").
  it("renameTrackLocal leaves a different loaded song alone, even with the same stem id", async () => {
    await nowPlayingStore.openProject(entry("other-song"), ENGINE_OPTIONS);

    nowPlayingStore.renameTrackLocal("renamed-song", "a", "Renamed");

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.tracks.find((t) => t.id === "a")?.name).toBe("A");
    expect(snapshot.waveformTracks.find((t) => t.id === "a")?.name).toBe("A");
  });

  it("renameTrackLocal is a no-op when nothing is loaded", () => {
    expect(() =>
      nowPlayingStore.renameTrackLocal("a", "a", "Renamed"),
    ).not.toThrow();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  // Edits reload only once their disk work is done, which can be after the
  // user has gone back and opened a different song.
  // A song screen's open of A can be overtaken by an edit's reload of A
  // (the user re-opened A while the edit was still saving). The open asked
  // for A and the reload delivers A - it must not fail.
  // With progress reporting on, each phase label yields to the UI before
  // its synchronous work. A different song opened during one of those
  // yields must win: the stale load may neither install its graph in the
  // engine nor publish itself as loaded.
  describe("a different song opened during a progress yield", () => {
    function loadedIds(loadSpy: jest.SpyInstance) {
      return loadSpy.mock.calls.map(
        ([decoded]) => (decoded as { manifest: { id: string } }).manifest.id,
      );
    }

    it.each(["waveforms", "building"])(
      "never installs or publishes the stale song (opened at %s)",
      async (phase) => {
        const loadSpy = jest.spyOn(audioEngine, "loadProject");
        let openB: Promise<unknown> = Promise.resolve();
        const onProgress = jest.fn((update: { phase: string }) => {
          if (update.phase === phase) {
            openB = nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
          }
        });

        const openA = nowPlayingStore.openProject(
          entry("a"),
          ENGINE_OPTIONS,
          onProgress,
        );

        await expect(openA).rejects.toThrow("Superseded");
        await openB;
        expect(loadedIds(loadSpy)).toEqual(["b"]);
        expect(nowPlayingStore.getSnapshot().projectId).toBe("b");
      },
    );

    // The reviewed worst case: B fails to load. A must still not end up
    // loaded - the user chose B, not A.
    it("leaves the stale song unloaded even if the newer song fails", async () => {
      const loadSpy = jest.spyOn(audioEngine, "loadProject");
      let openB: Promise<unknown> = Promise.resolve();
      const onProgress = jest.fn((update: { phase: string }) => {
        if (update.phase === "building") {
          decodeMock.mockRejectedValueOnce(new Error("corrupt stem"));
          openB = nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
          // Handled below; marked handled now so it isn't reported early.
          openB.catch(() => {});
        }
      });

      const openA = nowPlayingStore.openProject(
        entry("a"),
        ENGINE_OPTIONS,
        onProgress,
      );

      await expect(openA).rejects.toThrow("Superseded");
      await expect(openB).rejects.toThrow("corrupt stem");
      expect(loadedIds(loadSpy)).toEqual([]);
      expect(nowPlayingStore.getSnapshot().projectId).not.toBe("a");
    });
  });

  // A is loaded and B's slower load is in flight; going back to A (e.g. from
  // the Now Playing bar) takes the fast path - no load runs - but it is still
  // the user's choice, so B must not then replace A.
  describe("going back to the loaded song while another song loads", () => {
    it("cancels the other song's load (back during decoding)", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      let finishB: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        finishB = resolve;
      });
      decodeMock.mockImplementationOnce(async (_ctx, source) => {
        await gate;
        return { manifest: source.manifest, trackBuffers: {} };
      });
      const loadSpy = jest.spyOn(audioEngine, "loadProject");
      const openB = nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);

      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      finishB();

      await expect(openB).rejects.toThrow("Superseded");
      expect(loadSpy).not.toHaveBeenCalled();
      expect(nowPlayingStore.getSnapshot().projectId).toBe("a");
    });

    it("cancels it at the final check too (back during a progress yield)", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const loadSpy = jest.spyOn(audioEngine, "loadProject");
      let backToA: Promise<unknown> = Promise.resolve();
      const onProgress = jest.fn((update: { phase: string }) => {
        if (update.phase === "building") {
          backToA = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
        }
      });

      const openB = nowPlayingStore.openProject(
        entry("b"),
        ENGINE_OPTIONS,
        onProgress,
      );

      await expect(openB).rejects.toThrow("Superseded");
      await backToA;
      expect(loadSpy).not.toHaveBeenCalled();
      expect(nowPlayingStore.getSnapshot().projectId).toBe("a");
    });
  });

  describe("a load overtaken by a newer load", () => {
    function gatedDecode() {
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      decodeMock.mockImplementationOnce(async (_ctx, source) => {
        await gate;
        return { manifest: source.manifest, trackBuffers: {} };
      });
      return () => open();
    }

    it("resolves with the newer load's result when it's the same song", async () => {
      const finishOpen = gatedDecode();
      const opening = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const edited = entry("a", { title: "Edited" });

      const reloaded = await nowPlayingStore.reload(edited, ENGINE_OPTIONS);
      finishOpen();

      await expect(opening).resolves.toEqual(reloaded);
      expect(nowPlayingStore.getSnapshot().manifest?.title).toBe("Edited");
    });

    it("still rejects when overtaken by a different song", async () => {
      const finishOpen = gatedDecode();
      const opening = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

      await nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
      finishOpen();

      await expect(opening).rejects.toThrow("Superseded");
      expect(nowPlayingStore.getSnapshot().projectId).toBe("b");
    });

    it("still rejects when the song was closed meanwhile", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const finishReload = gatedDecode();
      const reloading = nowPlayingStore.reload(entry("a"), ENGINE_OPTIONS);

      nowPlayingStore.closeIfCurrent("a");
      finishReload();

      await expect(reloading).rejects.toThrow("Superseded");
      expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
    });
  });

  describe("reloadUnlessSuperseded", () => {
    it("reloads when nothing else was requested since the edit began", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      const loadSpy = jest.spyOn(audioEngine, "loadProject");

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).not.toBeNull();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    // E.g. a brand-new song's first stems, added while another song was the
    // loaded one: the edited song becoming loaded is the point.
    it("loads the edited song even if a different one was loaded before the edit", async () => {
      await nowPlayingStore.openProject(entry("other"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();

      await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(nowPlayingStore.getSnapshot().projectId).toBe("a");
    });

    it("leaves a song opened since the edit began alone", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      await nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
      const loadSpy = jest.spyOn(audioEngine, "loadProject");

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).toBeNull();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(nowPlayingStore.getSnapshot().projectId).toBe("b");
    });

    // The reviewed case exactly: B still decoding when A's edit finishes.
    it("doesn't supersede a different song's load that is still in flight", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      let finishB: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        finishB = resolve;
      });
      decodeMock.mockImplementationOnce(async (_ctx, source) => {
        await gate;
        return { manifest: source.manifest, trackBuffers: {} };
      });
      const openB = nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );
      finishB();
      await openB;

      expect(result).toBeNull();
      expect(nowPlayingStore.getSnapshot().projectId).toBe("b");
    });

    // The reviewed case: B loaded, an edit of draft A starts, the user goes
    // back to B (already loaded, so no load runs), then A's edit finishes.
    it("counts opening the already-loaded song as choosing it", async () => {
      await nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      const loadSpy = jest.spyOn(audioEngine, "loadProject");
      await nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);
      expect(loadSpy).not.toHaveBeenCalled(); // still the fast path

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).toBeNull();
      expect(loadSpy).not.toHaveBeenCalled();
      expect(nowPlayingStore.getSnapshot().projectId).toBe("b");
    });

    it("still reloads after the user re-opens the song being edited", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).not.toBeNull();
    });

    // Recording that choice must not cancel anything: a reload of the song
    // still in flight carries an edit, and dropping it would lose the edit.
    it("re-opening a song doesn't supersede its own reload in flight", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      let finish: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      decodeMock.mockImplementationOnce(async (_ctx, source) => {
        await gate;
        return { manifest: source.manifest, trackBuffers: {} };
      });
      const reload = nowPlayingStore.reload(entry("a"), ENGINE_OPTIONS);

      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      finish();

      await expect(reload).resolves.toBeTruthy();
    });

    it("still reloads when the newer request was for the same song", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      await nowPlayingStore.reload(entry("a"), ENGINE_OPTIONS);

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).not.toBeNull();
    });

    it("skips after the edited song was closed (e.g. deleted)", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const generation = nowPlayingStore.loadGeneration();
      nowPlayingStore.closeIfCurrent("a");

      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry("a"),
        ENGINE_OPTIONS,
        generation,
      );

      expect(result).toBeNull();
      expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
    });
  });

  describe("canStartPlayback", () => {
    /** The next decode waits until `finish()`/`fail()`, even if called before decode starts. */
    function deferredDecode() {
      let open: () => void = () => {};
      let close: (error: Error) => void = () => {};
      const gate = new Promise<void>((resolve, reject) => {
        open = resolve;
        close = reject;
      });
      // Swallow the rejection until the decode awaits it.
      gate.catch(() => {});
      decodeMock.mockImplementationOnce(async (_ctx, source) => {
        await gate;
        return { manifest: source.manifest, trackBuffers: {} };
      });
      return {
        finish: () => open(),
        fail: () => close(new Error("corrupt stem")),
      };
    }

    it("is false for the whole of a load, and true again after", async () => {
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
      const decode = deferredDecode();

      const load = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      // Set before the first await - no gap after the caller's own checks.
      expect(nowPlayingStore.canStartPlayback()).toBe(false);
      expect(nowPlayingStore.getSnapshot().loading).toBe(true);

      decode.finish();
      await load;
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
    });

    it("unlocks after a failed load too", async () => {
      const decode = deferredDecode();
      const load = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

      decode.fail();
      await expect(load).rejects.toThrow("corrupt stem");
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
    });

    // A superseded load finishing first must not unlock while the newer one
    // is still decoding towards its own loadProject().
    it("stays locked until the newest of overlapping loads finishes", async () => {
      const first = deferredDecode();
      const second = deferredDecode();
      const older = nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      const newer = nowPlayingStore.openProject(entry("b"), ENGINE_OPTIONS);

      first.finish();
      await expect(older).rejects.toThrow("Superseded");
      expect(nowPlayingStore.canStartPlayback()).toBe(false);

      second.finish();
      await newer;
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
    });

    it("holdPlayback locks until released, counting overlapping holds", () => {
      const first = nowPlayingStore.holdPlayback();
      const second = nowPlayingStore.holdPlayback();
      expect(nowPlayingStore.canStartPlayback()).toBe(false);
      expect(nowPlayingStore.getSnapshot().loading).toBe(true);

      first();
      first(); // releasing twice must not release someone else's hold
      expect(nowPlayingStore.canStartPlayback()).toBe(false);

      second();
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
      expect(nowPlayingStore.getSnapshot().loading).toBe(false);
    });

    // An edit holds the lock across its own reload; the reload finishing
    // must not unlock while the edit still holds it.
    it("a load finishing doesn't release an edit's hold", async () => {
      const release = nowPlayingStore.holdPlayback();

      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      expect(nowPlayingStore.canStartPlayback()).toBe(false);

      release();
      expect(nowPlayingStore.canStartPlayback()).toBe(true);
    });

    it("never stops a song that is already playing", async () => {
      await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
      audioEngine.play();
      const decode = deferredDecode();
      const stopSpy = jest.spyOn(audioEngine, "stop");

      const reload = nowPlayingStore.reload(entry("a"), ENGINE_OPTIONS);
      expect(audioEngine.getTransportState()).toBe("playing");
      expect(stopSpy).not.toHaveBeenCalled();

      decode.finish();
      await reload;
      audioEngine.stop();
    });
  });

  describe("reorderTracksLocal", () => {
    const threeTracks = entry("a", {
      tracks: ["x", "y", "z"].map((id) => ({
        id,
        name: id.toUpperCase(),
        file: `${id}.wav`,
        gain: 1,
        bus: "main" as const,
      })),
    });

    it("reorders the manifest and the waveform lanes, recolouring lanes by position", async () => {
      await nowPlayingStore.openProject(threeTracks, ENGINE_OPTIONS);
      const before = nowPlayingStore.getSnapshot().waveformTracks;

      expect(nowPlayingStore.reorderTracksLocal("a", ["z", "x", "y"])).toBe(
        true,
      );

      const snapshot = nowPlayingStore.getSnapshot();
      expect(snapshot.manifest?.tracks.map((t) => t.id)).toEqual([
        "z",
        "x",
        "y",
      ]);
      expect(snapshot.waveformTracks.map((t) => t.id)).toEqual(["z", "x", "y"]);
      // Colours belong to positions, the same as on a fresh load.
      expect(snapshot.waveformTracks.map((t) => t.color)).toEqual(
        before.map((t) => t.color),
      );
      // The waveform itself travels with its track.
      expect(snapshot.waveformTracks[0].peaks).toBe(before[2].peaks);
    });

    // Order is display-only, so a move must never rebuild the graph or
    // interrupt a running transport.
    it("never touches the engine", async () => {
      await nowPlayingStore.openProject(threeTracks, ENGINE_OPTIONS);
      audioEngine.play();
      const loadSpy = jest.spyOn(audioEngine, "loadProject");
      const stopSpy = jest.spyOn(audioEngine, "stop");

      nowPlayingStore.reorderTracksLocal("a", ["y", "z", "x"]);

      expect(loadSpy).not.toHaveBeenCalled();
      expect(stopSpy).not.toHaveBeenCalled();
      expect(audioEngine.getTransportState()).toBe("playing");
      audioEngine.stop();
    });

    it("refuses an order that isn't exactly the loaded stems", async () => {
      await nowPlayingStore.openProject(threeTracks, ENGINE_OPTIONS);

      expect(nowPlayingStore.reorderTracksLocal("a", ["x", "y"])).toBe(false);
      expect(nowPlayingStore.reorderTracksLocal("a", ["x", "y", "nope"])).toBe(
        false,
      );
      expect(
        nowPlayingStore.getSnapshot().manifest?.tracks.map((t) => t.id),
      ).toEqual(["x", "y", "z"]);
    });

    it("says when a move would bring a stem without a waveform into view", async () => {
      const ids = Array.from({ length: 17 }, (_, i) => `s${i + 1}`);
      const many = entry("a", {
        tracks: ids.map((id) => ({
          id,
          name: id,
          file: `${id}.wav`,
          gain: 1,
          bus: "main" as const,
        })),
      });
      await nowPlayingStore.openProject(many, ENGINE_OPTIONS);
      const s17Up = [...ids.slice(0, 15), "s17", "s16"];
      const s2Up = ["s2", "s1", ...ids.slice(2)];

      expect(nowPlayingStore.needsReloadToReorder("a", s17Up)).toBe(true);
      expect(nowPlayingStore.needsReloadToReorder("a", s2Up)).toBe(false);
      // Only the loaded project can need it.
      expect(nowPlayingStore.needsReloadToReorder("b", s17Up)).toBe(false);
      // And the in-place patch agrees, refusing exactly the same move.
      expect(nowPlayingStore.reorderTracksLocal("a", s17Up)).toBe(false);
      expect(nowPlayingStore.reorderTracksLocal("a", s2Up)).toBe(true);
    });

    it("refuses when a different project is loaded, or none", async () => {
      expect(nowPlayingStore.reorderTracksLocal("a", ["x", "y", "z"])).toBe(
        false,
      );
      await nowPlayingStore.openProject(threeTracks, ENGINE_OPTIONS);
      expect(nowPlayingStore.reorderTracksLocal("b", ["z", "y", "x"])).toBe(
        false,
      );
    });
  });

  it("setSectionsLocal patches the manifest with the new marker list", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    nowPlayingStore.setSectionsLocal([
      { id: "chorus", name: "Chorus", startSec: 30 },
    ]);

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.sections).toEqual([
      { id: "chorus", name: "Chorus", startSec: 30 },
    ]);
  });

  it("setSectionsLocal is a no-op when nothing is loaded", () => {
    expect(() => nowPlayingStore.setSectionsLocal([])).not.toThrow();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it("setLyricsLocal patches the manifest with the new lyrics text and clears sync points", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    nowPlayingStore.setLyricsSyncLocal([{ lineIndex: 0, timeSec: 1 }]);

    nowPlayingStore.setLyricsLocal("New lyrics");

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.lyrics).toBe("New lyrics");
    expect(snapshot.manifest?.lyricsSyncPoints).toEqual([]);
  });

  it("setLyricsLocal is a no-op when nothing is loaded", () => {
    expect(() => nowPlayingStore.setLyricsLocal("x")).not.toThrow();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it("setLyricsSyncLocal patches the manifest with the new sync points", async () => {
    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);

    nowPlayingStore.setLyricsSyncLocal([{ lineIndex: 2, timeSec: 12.5 }]);

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.lyricsSyncPoints).toEqual([
      { lineIndex: 2, timeSec: 12.5 },
    ]);
  });

  it("setLyricsSyncLocal is a no-op when nothing is loaded", () => {
    expect(() => nowPlayingStore.setLyricsSyncLocal([])).not.toThrow();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it("notifies subscribers on commit", async () => {
    const listener = jest.fn();
    const unsubscribe = nowPlayingStore.subscribe(listener);

    await nowPlayingStore.openProject(entry("a"), ENGINE_OPTIONS);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    nowPlayingStore.closeIfCurrent("a");
    expect(listener).not.toHaveBeenCalled();
  });
});
