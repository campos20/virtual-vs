import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { getDocumentAsync } from "expo-document-picker";
import { audioEngine } from "@/engine";
import {
  addStemsToProject,
  deleteProjectDirectory,
  getProjectSourceForEntry,
  moveStemInProject,
  patchProjectManifest,
  removeStemFromProject,
  renameStemInProject,
  updateProjectMetadata,
} from "@/storage";
import { nowPlayingStore } from "@/playback/nowPlayingStore";
import { createStore } from "@/store";
import { projectAdded, type LibraryProjectEntry } from "@/store/projectsSlice";
import { setlistAdded } from "@/store/setlistsSlice";
import { libraryOrderSet } from "@/store/settingsSlice";
import {
  trackEntityId,
  tracksInitializedForProject,
} from "@/store/tracksSlice";
import type { SetlistManifest } from "@/types/setlist";
import { renderWithStore } from "@/test-utils/renderWithStore";
import { ProjectScreen } from "./ProjectScreen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { projectId?: string; folderId?: string; autoPlay?: string } =
  {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

jest.mock("@/storage", () => ({
  ...jest.requireActual("@/storage"),
  updateProjectMetadata: jest.fn(),
  addStemsToProject: jest.fn(),
  removeStemFromProject: jest.fn(),
  renameStemInProject: jest.fn(),
  moveStemInProject: jest.fn(),
  deleteProjectDirectory: jest.fn(),
  getProjectSourceForEntry: jest.fn(),
  patchProjectManifest: jest.fn(),
}));

const patchManifestMock = patchProjectManifest as jest.Mock;

const pickerMock = getDocumentAsync as jest.Mock;

// usePlayhead's requestAnimationFrame loop ticks independently of React's act()
// batching, which trips act() warnings once it outlives the test that started
// it. No test here asserts on the live-ticking readout, so never schedule.
beforeEach(() => {
  jest.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(0);
  jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  // nowPlayingStore's whole point is skipping a reload when a project is
  // already current - which would silently leak across tests that reuse the
  // same project id (most of them use 'sync-test') unless reset here.
  nowPlayingStore.resetForTests();
  // Real behaviour by default; individual tests override it.
  (getProjectSourceForEntry as jest.Mock).mockImplementation(
    jest.requireActual("@/storage").getProjectSourceForEntry,
  );
  patchManifestMock.mockResolvedValue({});
});

function asset(name: string, uri: string) {
  return { name, uri, size: 1, mimeType: "audio/wav", lastModified: 0 };
}

const filesystemProject = {
  id: "my-song",
  title: "My Song",
  bpm: 100,
  key: "C",
  tracks: [
    {
      id: "bass",
      name: "Bass",
      file: "bass.wav",
      gain: 1,
      bus: "main" as const,
    },
    {
      id: "keys",
      name: "Keys",
      file: "keys.wav",
      gain: 1,
      bus: "main" as const,
    },
  ],
  sections: [],
  origin: "filesystem" as const,
  sourceDir: "file:///mock/document/projects/my-song",
};

/**
 * Three stems with one routed to cue and a bpm so there's a click - the shape
 * the bundled demo project provided before it was removed. Unlike
 * `filesystemProject` above, tests using this stub `getProjectSourceForEntry`,
 * so the load actually succeeds and the mixer renders.
 */
const threeStemProject: LibraryProjectEntry = {
  id: "sync-test",
  title: "Sync Test",
  bpm: 120,
  key: "A minor",
  tracks: [
    { id: "bass", name: "Bass", file: "bass.wav", gain: 0.85, bus: "main" },
    { id: "keys", name: "Keys", file: "keys.wav", gain: 0.85, bus: "main" },
    {
      id: "guide",
      name: "Guide Vocal",
      file: "guide.wav",
      gain: 0.9,
      bus: "cue",
    },
  ],
  sections: [],
  origin: "filesystem",
  sourceDir: "file:///mock/document/projects/sync-test",
};

function renderLoaded(manifest: LibraryProjectEntry = threeStemProject) {
  (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
    manifest,
    // The audio mock decodes any ref, so the stems never have to exist.
    resolveFile: () => 0,
  });
  mockParams = { projectId: threeStemProject.id };
  const store = createStore();
  store.dispatch(projectAdded(threeStemProject));
  return renderWithStore(<ProjectScreen />, store);
}

async function waitForMixer() {
  await waitFor(() =>
    expect(screen.getByTestId("mixer-menu-button")).toBeTruthy(),
  );
}

/** Makes the next Alert behave as if the user tapped the button labelled `label`. */
function answerAlertWith(label: string) {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === label)?.onPress?.();
    });
}

/** Volume/output/click controls live behind the hamburger drawer now - open it before touching them. */
function openMixer() {
  fireEvent.press(screen.getByTestId("mixer-menu-button"));
}

describe("ProjectScreen - playing", () => {
  it("loads a project and renders a channel strip per track", async () => {
    renderLoaded();
    await waitForMixer();

    expect(screen.getByText("Sync Test")).toBeTruthy();
    // The arrange view's track headers name each stem too, so "Keys" is already on screen.
    expect(screen.getByText("Keys")).toBeTruthy();

    openMixer();
    // Now it appears twice: once for its track header, once for its channel strip.
    expect(screen.getAllByText("Keys")).toHaveLength(2);
    expect(screen.getAllByText("Guide Vocal")).toHaveLength(2);
  });

  // Play/pause/stop/seek are exclusively the global NowPlayingBar's job now
  // (see NowPlayingBar.test.tsx) - this screen only loads a project in and
  // lets the shared engine transport drive its waveform.
  it("loads the project into the engine, ready to play", async () => {
    renderLoaded();
    await waitForMixer();

    expect(audioEngine.getManifestTrackIds().length).toBeGreaterThan(0);
    audioEngine.play();
    expect(audioEngine.getTransportState()).toBe("playing");
    audioEngine.stop();
  });

  it("toggling mute commits to the engine and the store", async () => {
    const { store } = renderLoaded();
    await waitForMixer();
    openMixer();

    fireEvent.press(screen.getByTestId("mute-button-bass"));

    expect(audioEngine.getTrackState("bass")?.muted).toBe(true);
    expect(
      store.getState().tracks.entities[trackEntityId("sync-test", "bass")]
        ?.muted,
    ).toBe(true);
  });

  // Guards the wiring a module-level `store.getState()` used to hide. Mute and
  // solo are the tell: AudioEngine's fallback for a track it wasn't given
  // state for hardcodes them off, so a screen that fails to pass the manifest
  // mix through would show a muted channel while playing it at full level.
  it("seeds the engine with the mix stored in the project manifest", async () => {
    renderLoaded({
      ...threeStemProject,
      tracks: threeStemProject.tracks.map((track) =>
        track.id === "bass"
          ? { ...track, gain: 0.25, bus: "both" as const, muted: true }
          : track.id === "keys"
            ? { ...track, soloed: true }
            : track,
      ),
    });
    await waitForMixer();

    expect(audioEngine.getTrackState("bass")?.muted).toBe(true);
    expect(audioEngine.getTrackState("bass")?.volume).toBeCloseTo(0.25, 5);
    expect(audioEngine.getTrackState("bass")?.bus).toBe("both");
    expect(audioEngine.getTrackState("keys")?.soloed).toBe(true);
  });

  // The core of the "now playing" feature: playback used to be tied to this
  // screen's mount lifecycle (stopped on Back/unmount/entering Edit) - it no
  // longer is. Only the mini-player, deleting the project, or the user
  // explicitly hitting stop/pause should ever stop the engine now.
  it("keeps playing across unmount, instead of stopping like it used to", async () => {
    const stopSpy = jest.spyOn(audioEngine, "stop");

    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    stopSpy.mockClear();

    unmount();

    expect(stopSpy).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe("playing");
    audioEngine.stop();
  });

  it("does not re-decode or restart playback when re-opening the same project", async () => {
    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    unmount();

    (getProjectSourceForEntry as jest.Mock).mockClear();
    renderLoaded();
    await waitForMixer();

    expect(getProjectSourceForEntry).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe("playing");
    audioEngine.stop();
  });

  // "Stop A, show B" - opening a *different* project is the one case that's
  // still supposed to interrupt whatever was playing (unlike Back/Edit/
  // re-opening the same project, which no longer do).
  it("opening a different project stops the previous one and replaces it", async () => {
    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    unmount();

    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();

    expect(audioEngine.getTransportState()).toBe("stopped");
    expect(screen.getByText("My Song")).toBeTruthy();
  });
});

describe("ProjectScreen - markers", () => {
  function openMarkers() {
    fireEvent.press(screen.getByTestId("markers-menu-button"));
  }

  it("adds a marker at the current position from a preset chip", async () => {
    renderLoaded();
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId("marker-preset-presetChorus"));
    fireEvent.press(screen.getByTestId("add-marker-button"));

    // The row is numbered ("1. Chorus"), distinct from the preset chip's plain "Chorus".
    expect(screen.getByText("1. Chorus")).toBeTruthy();
    const [sourceDir, changes] = patchManifestMock.mock.calls.at(-1)!;
    expect(sourceDir).toBe(threeStemProject.sourceDir);
    expect(changes.sections).toEqual([
      expect.objectContaining({ name: "Chorus", startSec: expect.any(Number) }),
    ]);
  });

  it("does not add a marker with an empty name", async () => {
    renderLoaded();
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId("add-marker-button"));

    expect(patchManifestMock).not.toHaveBeenCalled();
  });

  it("jumps to a marker and closes the drawer", async () => {
    const seekSpy = jest.spyOn(audioEngine, "seek");
    renderLoaded({
      ...threeStemProject,
      sections: [{ id: "chorus", name: "Chorus", startSec: 42 }],
    });
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId("jump-marker-chorus"));

    expect(seekSpy).toHaveBeenCalledWith(42);
    expect(screen.queryByTestId("close-markers-button")).toBeNull();
  });

  it("removes a marker", async () => {
    renderLoaded({
      ...threeStemProject,
      sections: [{ id: "chorus", name: "Chorus", startSec: 42 }],
    });
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId("remove-marker-chorus"));

    expect(screen.queryByTestId("jump-marker-chorus")).toBeNull();
    const [sourceDir, changes] = patchManifestMock.mock.calls.at(-1)!;
    expect(sourceDir).toBe(threeStemProject.sourceDir);
    expect(changes.sections).toEqual([]);
  });
});

describe("ProjectScreen - quick switch between songs in a folder", () => {
  function song(id: string, title: string): LibraryProjectEntry {
    return {
      id,
      title,
      key: "",
      tracks: [
        { id: "bass", name: "Bass", file: "bass.wav", gain: 0.85, bus: "main" },
      ],
      sections: [],
      origin: "filesystem",
      sourceDir: `file:///mock/document/projects/${id}`,
    };
  }

  function folder(id: string, songs: string[]): SetlistManifest {
    return { id, name: id, songs, advance: "manual", padBetween: false };
  }

  /** Loads `projectId` (opened, per `folderId`, from inside that folder) with `songs` filed in it, in that order. */
  function renderInFolder(
    projectId: string,
    songs: LibraryProjectEntry[],
    folderId = "sunday",
  ) {
    const current = songs.find((entry) => entry.id === projectId)!;
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: current,
      resolveFile: () => 0,
    });
    mockParams = { projectId, folderId };
    const store = createStore();
    for (const entry of songs) store.dispatch(projectAdded(entry));
    store.dispatch(
      setlistAdded(
        folder(
          folderId,
          songs.map((entry) => entry.id),
        ),
      ),
    );
    return renderWithStore(<ProjectScreen />, store);
  }

  function openSongList() {
    fireEvent.press(screen.getByTestId("song-list-menu-button"));
  }

  it("lists the Library's top-level songs for a song opened outside any folder", async () => {
    renderLoaded();
    await waitForMixer();

    openSongList();

    expect(screen.getByTestId("song-list-row-sync-test")).toBeTruthy();
  });

  // Hidden by default - picking any song from the list, which works even
  // mid-song, takes a deliberate "open the list, then tap a song" pair of taps.
  it("keeps the song list hidden until its button is pressed", async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("a", songs);
    await waitForMixer();

    expect(screen.queryByTestId("song-list-row-b")).toBeNull();

    openSongList();

    expect(screen.getByTestId("song-list-row-b")).toBeTruthy();
  });

  it("lists every song in the folder, in its own order", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("a", songs);
    await waitForMixer();

    openSongList();

    // "Song A" is also the header title (this is the song currently open),
    // so these are found within their own drawer row rather than by text.
    expect(
      within(screen.getByTestId("song-list-row-a")).getByText("Song A"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("song-list-row-b")).getByText("Song B"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("song-list-row-c")).getByText("Song C"),
    ).toBeTruthy();
  });

  it("jumps to whichever song in the list is tapped, carrying the folder id along", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("a", songs);
    await waitForMixer();

    openSongList();
    fireEvent.press(screen.getByTestId("song-list-row-c"));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "c", folderId: "sunday" },
    });
  });

  // Regression test: the folder-remembering effect used to run synchronously
  // on mount, racing ahead of nowPlayingStore.openProject()'s async decode.
  // On a genuinely fresh load (this project wasn't already current), that
  // race lost every time - setFolderContext() no-op'd against the previous
  // project, and since none of the effect's deps change once the load later
  // resolves, the folder was never recorded at all, breaking NowPlayingBar's
  // ability to carry it forward later.
  it("remembers the folder on nowPlayingStore even for a fresh (not already-current) load", async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("a", songs);
    await waitForMixer();

    expect(nowPlayingStore.getSnapshot().folderId).toBe("sunday");
  });

  // The old song's own teardown otherwise only happens once the next one
  // finishes decoding - real, sometimes multi-second work - which would
  // leave it audibly playing in the meantime. Switching must cut it
  // immediately instead of overlapping with whatever loads next.
  it("stops the currently playing song immediately when switching to another", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("a", songs);
    await waitForMixer();
    audioEngine.play();

    openSongList();
    fireEvent.press(screen.getByTestId("song-list-row-c"));

    expect(audioEngine.getTransportState()).toBe("stopped");
  });

  it("just closes the list, without navigating, when the currently open song is tapped", async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("a", songs);
    await waitForMixer();

    openSongList();
    fireEvent.press(screen.getByTestId("song-list-row-a"));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("song-list-row-b")).toBeNull();
  });

  it('disables "Play next" on the last song in the folder - it does not wrap', async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("b", songs);
    await waitForMixer();

    openSongList();

    expect(
      screen.getByTestId("play-next-song-button").props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it('jumps to the next song and closes the list when "Play next" is pressed, marked to autoplay', async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("a", songs);
    await waitForMixer();

    openSongList();
    fireEvent.press(screen.getByTestId("play-next-song-button"));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "b", folderId: "sunday", autoPlay: "1" },
    });
    expect(screen.queryByTestId("song-list-row-c")).toBeNull();
  });

  it("shows where the song sits in its list", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("b", songs);
    await waitForMixer();

    expect(screen.getByTestId("song-position")).toHaveTextContent(
      "2 of 3 · sunday",
    );
  });

  it("steps to the next and previous song in one tap, left stopped and keeping the folder", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("b", songs);
    await waitForMixer();

    fireEvent.press(screen.getByTestId("next-song-button"));
    expect(mockReplace).toHaveBeenLastCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "c", folderId: "sunday" },
    });

    fireEvent.press(screen.getByTestId("previous-song-button"));
    expect(mockReplace).toHaveBeenLastCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "a", folderId: "sunday" },
    });
  });

  it("disables previous on the first song and next on the last - nothing wraps", async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("a", songs);
    await waitForMixer();

    expect(
      screen.getByTestId("previous-song-button").props.accessibilityState
        .disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("next-song-button").props.accessibilityState.disabled,
    ).toBe(false);
  });

  // One tap beside the title is easy to hit by accident; mid-song that
  // would cut the band off. The two-tap Songs list still works while playing.
  it("locks previous/next while the transport is playing", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    renderInFolder("b", songs);
    await waitForMixer();
    act(() => audioEngine.play());

    await waitFor(() =>
      expect(
        screen.getByTestId("next-song-button").props.accessibilityState
          .disabled,
      ).toBe(true),
    );
    fireEvent.press(screen.getByTestId("next-song-button"));
    fireEvent.press(screen.getByTestId("previous-song-button"));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe("playing");
    act(() => audioEngine.stop());
  });

  it("allows stepping from a paused song", async () => {
    const songs = [song("a", "Song A"), song("b", "Song B")];
    renderInFolder("a", songs);
    await waitForMixer();
    act(() => {
      audioEngine.play();
      audioEngine.pause();
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("next-song-button").props.accessibilityState
          .disabled,
      ).toBe(false),
    );
    fireEvent.press(screen.getByTestId("next-song-button"));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "b", folderId: "sunday" },
    });
  });

  it("steps through the Library's top-level songs, in its order, outside any folder", async () => {
    const songs = [
      song("a", "Song A"),
      song("b", "Song B"),
      song("c", "Song C"),
    ];
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: songs[1],
      resolveFile: () => 0,
    });
    mockParams = { projectId: "b" };
    const store = createStore();
    for (const entry of songs) store.dispatch(projectAdded(entry));
    store.dispatch(libraryOrderSet(["project:c", "project:b", "project:a"]));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();

    fireEvent.press(screen.getByTestId("next-song-button"));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/project/[projectId]",
      params: { projectId: "a" },
    });
  });

  // The button's whole point: unlike every other way to land on a song
  // (Library, a plain row tap in this same list), this one carries straight
  // on playing instead of loading and stopping.
  it("actually starts playback once a song opened this way finishes loading", async () => {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: threeStemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: threeStemProject.id, autoPlay: "1" };
    const store = createStore();
    store.dispatch(projectAdded(threeStemProject));
    renderWithStore(<ProjectScreen />, store);

    await waitForMixer();

    await waitFor(() =>
      expect(audioEngine.getTransportState()).toBe("playing"),
    );
  });
});

describe("ProjectScreen - lyrics", () => {
  function toggleLyrics() {
    fireEvent.press(screen.getByTestId("lyrics-toggle-button"));
  }

  function showWaveform() {
    fireEvent.press(screen.getByTestId("waveform-view-button"));
  }

  it("swaps the waveform for the lyrics view and back", async () => {
    renderLoaded();
    await waitForMixer();

    expect(screen.getByText("Bass")).toBeTruthy();
    expect(screen.queryByTestId("edit-lyrics-button")).toBeNull();

    toggleLyrics();

    expect(screen.queryByText("Bass")).toBeNull();
    expect(screen.getByTestId("edit-lyrics-button")).toBeTruthy();

    showWaveform();

    expect(screen.getByText("Bass")).toBeTruthy();
    expect(screen.queryByTestId("edit-lyrics-button")).toBeNull();
  });

  // The two are a segmented pair now, not one toggle - pressing the button
  // for the view already showing must be a no-op, not flip back out of it.
  it("does nothing when the already-active view button is pressed again", async () => {
    renderLoaded();
    await waitForMixer();

    showWaveform();
    expect(screen.getByText("Bass")).toBeTruthy();

    toggleLyrics();
    toggleLyrics();
    expect(screen.getByTestId("edit-lyrics-button")).toBeTruthy();
  });

  // Global rather than per-screen-mount state: a performer switching songs
  // mid-set shouldn't have to re-toggle back into the lyrics view every
  // time, so this simulates "switch songs" as unmounting and remounting
  // ProjectScreen against the same store with a different project, the way
  // navigating Library -> a different song's ProjectScreen actually works.
  it("keeps showing the lyrics view after switching to a different project", async () => {
    const secondProject: LibraryProjectEntry = {
      ...threeStemProject,
      id: "song-two",
      title: "Song Two",
      sourceDir: "file:///mock/document/projects/song-two",
    };
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: threeStemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: threeStemProject.id };
    const store = createStore();
    store.dispatch(projectAdded(threeStemProject));
    store.dispatch(projectAdded(secondProject));
    const { unmount } = renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    toggleLyrics();
    expect(screen.getByTestId("edit-lyrics-button")).toBeTruthy();
    unmount();

    mockParams = { projectId: secondProject.id };
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: secondProject,
      resolveFile: () => 0,
    });
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();

    expect(screen.getByTestId("edit-lyrics-button")).toBeTruthy();
  });

  it("hides the song's list position while viewing lyrics", async () => {
    renderLoaded();
    await waitForMixer();
    expect(screen.getByTestId("song-position")).toBeTruthy();

    toggleLyrics();

    expect(screen.queryByTestId("song-position")).toBeNull();
  });

  // The header shrinks around the title while viewing lyrics (padding, the
  // list position hidden), but the title itself must not be part of that -
  // it answers the same "which song is this" question in both views, and
  // silently rendering it smaller there previously read as inconsistent.
  it("keeps the title the same size in both waveform and lyrics view", async () => {
    renderLoaded();
    await waitForMixer();
    const waveformTitleSize =
      screen.getByText("Sync Test").props.style.fontSize;

    toggleLyrics();

    const lyricsTitleSize = screen.getByText("Sync Test").props.style.fontSize;
    expect(lyricsTitleSize).toBe(waveformTitleSize);
  });

  it("saves lyrics entered through the drawer", async () => {
    renderLoaded();
    await waitForMixer();
    toggleLyrics();

    fireEvent.press(screen.getByTestId("add-lyrics-button"));
    fireEvent.changeText(
      screen.getByTestId("lyrics-input"),
      "Line one\nLine two",
    );
    fireEvent.press(screen.getByTestId("save-lyrics-button"));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyrics: "Line one\nLine two",
      lyricsSyncPoints: [],
    });
    expect(screen.getByText("Line one")).toBeTruthy();
  });

  it("tapping a line persists a sync point at the precise playhead", async () => {
    renderLoaded({ ...threeStemProject, lyrics: "Line one\nLine two" });
    await waitForMixer();
    toggleLyrics();

    fireEvent.press(screen.getByTestId("lyrics-line-1"));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [{ lineIndex: 1, timeSec: expect.any(Number) }],
    });
  });

  it("badges the Sync button, and the drawer lists, removes and clears sync points", async () => {
    renderLoaded({
      ...threeStemProject,
      lyrics: "Line one\nLine two",
      lyricsSyncPoints: [
        { lineIndex: 0, timeSec: 1 },
        { lineIndex: 1, timeSec: 5 },
      ],
    });
    await waitForMixer();
    toggleLyrics();
    expect(screen.getByTestId("lyrics-sync-badge")).toBeTruthy();

    fireEvent.press(screen.getByTestId("open-lyrics-sync-button"));
    expect(screen.getByTestId("remove-sync-0")).toBeTruthy();
    expect(screen.getByTestId("remove-sync-1")).toBeTruthy();

    fireEvent.press(screen.getByTestId("remove-sync-0"));
    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [{ lineIndex: 1, timeSec: 5 }],
    });

    fireEvent.press(screen.getByTestId("clear-all-sync-button"));
    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [],
    });
    expect(screen.queryByTestId("lyrics-sync-badge")).toBeNull();
  });

  // Neither lyrics text nor a line tap ever touches the audio graph, so
  // unlike bpm/key edits (gated via transportIsRunning()), both should work
  // mid-song - same reasoning as markers ("still allows renaming a stem
  // while playing" above).
  it("does not block lyrics editing or line-tapping while the transport is playing", async () => {
    renderLoaded({ ...threeStemProject, lyrics: "Line one\nLine two" });
    await waitForMixer();
    toggleLyrics();
    audioEngine.play();

    fireEvent.press(screen.getByTestId("lyrics-line-0"));
    fireEvent.press(screen.getByTestId("edit-lyrics-button"));
    fireEvent.changeText(screen.getByTestId("lyrics-input"), "Edited live");
    fireEvent.press(screen.getByTestId("save-lyrics-button"));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [{ lineIndex: 0, timeSec: expect.any(Number) }],
    });
    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyrics: "Edited live",
      lyricsSyncPoints: [],
    });
    expect(audioEngine.getTransportState()).toBe("playing");
    audioEngine.stop();
  });

  it("toggles all-caps and persists it globally, not on the project", async () => {
    renderLoaded({ ...threeStemProject, lyrics: "Line one" });
    await waitForMixer();
    toggleLyrics();

    fireEvent.press(screen.getByTestId("lyrics-allcaps-toggle"));

    // A settings write, never a project manifest write.
    expect(patchManifestMock).not.toHaveBeenCalled();
  });
});

describe("ProjectScreen - editing in place", () => {
  function renderEditable() {
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    return renderWithStore(<ProjectScreen />, store);
  }

  // Editing the song is a song-level action, so it's in the header - not
  // hidden inside the mixer, where nobody would look for it.
  it("offers Edit in the header once loaded, and not again inside the mixer", async () => {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });

    renderEditable();
    await waitForMixer();
    expect(screen.getByTestId("edit-button")).toBeTruthy();

    openMixer();
    expect(screen.getAllByTestId("edit-button")).toHaveLength(1);

    fireEvent.press(screen.getByTestId("edit-button"));
    expect(screen.getByTestId("save-button")).toBeTruthy();
  });

  // A failed load (e.g. a corrupted stem) is exactly when the user needs to
  // get into the editor to fix it, so Edit can't be trapped behind a mixer
  // drawer that has nothing to show - it has to surface directly.
  it("offers Edit directly, without a mixer, when the project fails to load", async () => {
    renderEditable(); // the default mocked getProjectSourceForEntry fails for this fake sourceDir
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());

    expect(screen.getByText(filesystemProject.title)).toBeTruthy();
    expect(screen.queryByTestId("mixer-menu-button")).toBeNull();
  });

  // Entering Edit used to always stop audio first - it no longer does, so a
  // song keeps playing while its stems are being tidied up mid-set.
  it("swaps in the form without stopping playback when Edit is pressed", async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    const stopSpy = jest.spyOn(audioEngine, "stop");

    fireEvent.press(screen.getByTestId("edit-button"));

    expect(stopSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("title-input")).toBeTruthy();
    expect(screen.getByTestId("save-button")).toBeTruthy();
  });

  it("saves edited metadata and returns to the mixer", async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());

    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.changeText(screen.getByTestId("title-input"), "Renamed");
    fireEvent.press(screen.getByTestId("save-button"));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        expect.objectContaining({ title: "Renamed", bpm: 100 }),
      ),
    );
    await waitFor(() =>
      expect(store.getState().projects.entities["my-song"]?.title).toBe(
        "Renamed",
      ),
    );
    await waitFor(() => expect(screen.queryByTestId("title-input")).toBeNull());
  });

  it("clearing the tempo saves an undefined bpm, removing the click", async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());

    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.changeText(screen.getByTestId("bpm-input"), "");
    fireEvent.press(screen.getByTestId("save-button"));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        expect.objectContaining({ bpm: undefined }),
      ),
    );
  });

  // A cloud-picked file can take many seconds to copy, convert and decode.
  // Without this the screen just sat there blank, so the phase label is the
  // whole point of the feature - assert the user actually sees it.
  it("shows what the import is doing while it runs", async () => {
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
    });

    let finishImport: () => void = () => {};
    const importDone = new Promise<void>((resolve) => {
      finishImport = resolve;
    });
    (addStemsToProject as jest.Mock).mockImplementation(
      async (
        _dir: string,
        _files: unknown,
        _ctx: unknown,
        onProgress?: (u: unknown) => void,
      ) => {
        onProgress?.({ phase: "copying", name: "gtr.wav" });
        await importDone;
        return { ...filesystemProject, tracks: filesystemProject.tracks };
      },
    );

    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.press(screen.getByTestId("pick-files-button"));

    await waitFor(() =>
      expect(screen.getByTestId("import-status")).toBeTruthy(),
    );
    expect(screen.getByText("Copying gtr.wav…")).toBeTruthy();

    finishImport();
    await waitFor(() =>
      expect(screen.queryByText("Copying gtr.wav…")).toBeNull(),
    );
  });

  it("adds stems through to the project folder", async () => {
    (addStemsToProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: [
        ...filesystemProject.tracks,
        {
          id: "gtr",
          name: "Gtr",
          file: "gtr.wav",
          gain: 1,
          bus: "main" as const,
        },
      ],
    });
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.press(screen.getByTestId("pick-files-button"));

    await waitFor(() => expect(addStemsToProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        store.getState().projects.entities["my-song"]?.tracks,
      ).toHaveLength(3),
    );
  });

  it("removes a stem through to the project folder", async () => {
    (removeStemFromProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: filesystemProject.tracks.filter((t) => t.id !== "bass"),
    });

    answerAlertWith("Remove");
    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.press(screen.getByTestId("remove-stem-bass"));

    await waitFor(() =>
      expect(removeStemFromProject).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        "bass",
      ),
    );
    await waitFor(() =>
      expect(
        store.getState().projects.entities["my-song"]?.tracks,
      ).toHaveLength(1),
    );
  });

  it("renames a stem through to the project folder on blur, not on every keystroke", async () => {
    (renameStemInProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: filesystemProject.tracks.map((t) =>
        t.id === "bass" ? { ...t, name: "Low End" } : t,
      ),
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));

    const bassNameInput = screen.getByTestId("rename-stem-bass");
    fireEvent.changeText(bassNameInput, "Low End");
    expect(renameStemInProject).not.toHaveBeenCalled();

    // A single-line TextInput's default blurOnSubmit already blurs it on
    // submit, so only `onBlur` is wired - see StemNameField.
    fireEvent(bassNameInput, "blur");

    await waitFor(() =>
      expect(renameStemInProject).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        "bass",
        "Low End",
      ),
    );
    expect(renameStemInProject).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        store
          .getState()
          .projects.entities["my-song"]?.tracks.find((t) => t.id === "bass")
          ?.name,
      ).toBe("Low End"),
    );
  });

  describe("overlapping renames of one track", () => {
    /** Each rename call gets its own promise, settled by the test. */
    function controlledRenames() {
      const calls: {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }[] = [];
      (renameStemInProject as jest.Mock).mockImplementation(
        (_dir: string, stemId: string, name: string) =>
          new Promise((resolve, reject) => {
            calls.push({
              resolve: () =>
                resolve({
                  ...filesystemProject,
                  tracks: filesystemProject.tracks.map((t) =>
                    t.id === stemId ? { ...t, name } : t,
                  ),
                }),
              reject,
            });
          }),
      );
      return calls;
    }

    async function renameTwice() {
      renderEditable();
      await waitFor(() =>
        expect(screen.getByTestId("edit-button")).toBeTruthy(),
      );
      fireEvent.press(screen.getByTestId("edit-button"));
      const field = screen.getByTestId("rename-stem-bass");
      fireEvent.changeText(field, "First");
      fireEvent(field, "blur");
      fireEvent.changeText(field, "Second");
      fireEvent(field, "blur");
      await waitFor(() => expect(renameStemInProject).toHaveBeenCalledTimes(2));
      return field;
    }

    it("keeps the newer name when an older rename fails after it", async () => {
      const calls = controlledRenames();
      const field = await renameTwice();

      await act(async () => calls[0].reject(new Error("disk busy")));
      expect(field.props.value).toBe("Second");

      await act(async () => calls[1].resolve(undefined));
      expect(field.props.value).toBe("Second");
    });

    it("reverts to the last saved name, not the original, when the newer rename fails", async () => {
      const calls = controlledRenames();
      const field = await renameTwice();

      await act(async () => calls[0].resolve(undefined));
      await act(async () => calls[1].reject(new Error("disk busy")));

      expect(field.props.value).toBe("First");
    });

    it("doesn't throw away text typed since, when a rename fails", async () => {
      const calls = controlledRenames();
      renderEditable();
      await waitFor(() =>
        expect(screen.getByTestId("edit-button")).toBeTruthy(),
      );
      fireEvent.press(screen.getByTestId("edit-button"));
      const field = screen.getByTestId("rename-stem-bass");
      fireEvent.changeText(field, "First");
      fireEvent(field, "blur");
      await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());

      fireEvent.changeText(field, "Still typing");
      await act(async () => calls[0].reject(new Error("disk busy")));

      expect(field.props.value).toBe("Still typing");
    });
  });

  // The write can land after another song has loaded (it may queue behind
  // other manifest edits), and stem ids like "bass" repeat across songs.
  it("doesn't rename the same stem id in a song loaded while the rename saved", async () => {
    let finishRename: () => void = () => {};
    (renameStemInProject as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishRename = () =>
          resolve({
            ...filesystemProject,
            tracks: filesystemProject.tracks.map((t) =>
              t.id === "bass" ? { ...t, name: "Low End" } : t,
            ),
          });
      }),
    );
    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));

    const field = screen.getByTestId("rename-stem-bass");
    fireEvent.changeText(field, "Low End");
    fireEvent(field, "blur");
    await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());

    // Another song, with its own "bass" stem, becomes the loaded one.
    const otherSong = {
      ...threeStemProject,
      id: "other-song",
      sourceDir: "file:///mock/document/projects/other-song",
    };
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: otherSong,
      resolveFile: () => 0,
    });
    await act(async () => {
      await nowPlayingStore.openProject(otherSong, {
        monitorMode: "split",
        clickEnabled: true,
      });
    });

    await act(async () => finishRename());

    await waitFor(() =>
      expect(
        store
          .getState()
          .projects.entities["my-song"]?.tracks.find((t) => t.id === "bass")
          ?.name,
      ).toBe("Low End"),
    );
    const loaded = nowPlayingStore.getSnapshot();
    expect(loaded.projectId).toBe("other-song");
    expect(loaded.manifest?.tracks.find((t) => t.id === "bass")?.name).toBe(
      "Bass",
    );
    expect(loaded.waveformTracks.find((t) => t.id === "bass")?.name).toBe(
      "Bass",
    );
  });

  it("ignores an empty rename instead of blanking the stem name", async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));

    const bassNameInput = screen.getByTestId("rename-stem-bass");
    fireEvent.changeText(bassNameInput, "   ");
    fireEvent(bassNameInput, "blur");

    expect(renameStemInProject).not.toHaveBeenCalled();
    expect(bassNameInput.props.value).toBe("Bass");
  });

  // The field shows the new name immediately (so typing feels responsive),
  // but that's only a guess until the write actually persists - a failed
  // write must not leave the input drifted from what's really on disk.
  it("reverts the displayed name if the rename write fails", async () => {
    (renameStemInProject as jest.Mock).mockRejectedValue(
      new Error("disk full"),
    );

    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));

    const bassNameInput = screen.getByTestId("rename-stem-bass");
    fireEvent.changeText(bassNameInput, "Low End");
    fireEvent(bassNameInput, "blur");

    await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());
    await waitFor(() => expect(bassNameInput.props.value).toBe("Bass"));
    expect(screen.getByText("disk full")).toBeTruthy();
  });

  // Removing deletes the stem's audio file with no undo, and the ✕ sits right
  // next to the move arrows - so it must never happen on one tap.
  it("asks before removing a stem, and keeps it if dismissed", async () => {
    const alertSpy = answerAlertWith("Cancel");
    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.press(screen.getByTestId("remove-stem-bass"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Remove track?",
      expect.stringContaining("Bass"),
      expect.any(Array),
    );
    expect(removeStemFromProject).not.toHaveBeenCalled();
  });

  it("moves a stem through to the project folder and reorders the editor", async () => {
    const reversed = [...filesystemProject.tracks].reverse();
    (moveStemInProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: reversed,
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    fireEvent.press(screen.getByTestId("stem-keys-move-up"));

    await waitFor(() =>
      expect(moveStemInProject).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        "keys",
        "up",
      ),
    );
    await waitFor(() =>
      expect(
        store.getState().projects.entities["my-song"]?.tracks.map((t) => t.id),
      ).toEqual(["keys", "bass"]),
    );
    const lanes = within(screen.getByTestId("track-list"))
      .getAllByTestId(/^track-lane-/)
      .map((lane) => lane.props.testID);
    expect(lanes).toEqual(["track-lane-keys", "track-lane-bass"]);
  });

  it("can't move the first track up or the last track down", async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));

    fireEvent.press(screen.getByTestId("stem-bass-move-up"));
    fireEvent.press(screen.getByTestId("stem-keys-move-down"));

    expect(moveStemInProject).not.toHaveBeenCalled();
  });
});

describe("ProjectScreen - a brand-new (stemless) project", () => {
  const draft = {
    id: "untitled-abc",
    title: "Untitled",
    key: "",
    tracks: [],
    sections: [],
    origin: "filesystem" as const,
    sourceDir: "file:///mock/document/projects/untitled-abc",
  };

  function renderDraft() {
    mockParams = { projectId: draft.id };
    const store = createStore();
    store.dispatch(projectAdded(draft));
    return renderWithStore(<ProjectScreen />, store);
  }

  // "Creating a project" is just opening one that has no stems yet - there is
  // no separate new-project screen to land on.
  it("opens straight into the editor, not the mixer", () => {
    renderDraft();

    expect(screen.getByTestId("title-input")).toBeTruthy();
    expect(screen.getByTestId("save-button")).toBeTruthy();
    expect(screen.queryByTestId("mixer-menu-button")).toBeNull();
  });

  it("saves metadata on a stemless project without needing stems first", async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    renderDraft();

    fireEvent.changeText(screen.getByTestId("title-input"), "My New Song");
    fireEvent.press(screen.getByTestId("save-button"));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        draft.sourceDir,
        expect.objectContaining({ title: "My New Song", bpm: undefined }),
      ),
    );
  });

  // Otherwise every abandoned "+ New" would leave an empty project behind,
  // and there is no delete-project UI to clean it up with.
  it("discards the empty draft when backing out", async () => {
    const { store } = renderDraft();

    fireEvent.press(screen.getByTestId("back-button"));

    await waitFor(() =>
      expect(deleteProjectDirectory).toHaveBeenCalledWith(draft.sourceDir),
    );
    expect(store.getState().projects.entities[draft.id]).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it("keeps a project that already has stems when backing out", async () => {
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);

    fireEvent.press(screen.getByTestId("back-button"));

    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(store.getState().projects.entities["my-song"]).toBeTruthy();
  });
});

// AudioEngine.loadProject() opens with stop() + disposeTracks(), and every
// edit path ends in a reload() that calls it - so an edit mid-song cuts the
// song off and tears the graph down. On stage that is the worst possible
// failure, so nothing that rebuilds is reachable while the transport runs.
describe("ProjectScreen - locked while playing", () => {
  /** A project that both loads (so there's a mixer) and is editable (so Edit exists). */
  function renderEditing() {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    store.dispatch(
      tracksInitializedForProject({
        projectId: filesystemProject.id,
        tracks: filesystemProject.tracks,
      }),
    );
    return renderWithStore(<ProjectScreen />, store);
  }

  afterEach(() => {
    audioEngine.stop();
  });

  it("greys Edit out while the transport is running, saying why", async () => {
    renderEditing();
    await waitForMixer();
    act(() => audioEngine.play());

    const edit = screen.getByTestId("edit-button");
    expect(edit.props.accessibilityState).toMatchObject({ disabled: true });
    expect(edit.props.accessibilityHint).toBe("Stop playback to edit");

    fireEvent.press(edit);
    expect(screen.queryByTestId("save-button")).toBeNull();
  });

  it("offers Edit when the transport is stopped", async () => {
    renderEditing();
    await waitForMixer();

    const edit = screen.getByTestId("edit-button");
    expect(edit.props.accessibilityState).toMatchObject({ disabled: false });
  });

  // The buttons are hidden, but a stale tap or a race must not get through
  // either - these are guarded at the handler, which is what actually calls
  // reload().
  it("refuses to import, remove or save while playing, even if invoked directly", async () => {
    renderEditing();
    await waitForMixer();
    fireEvent.press(screen.getByTestId("edit-button"));

    audioEngine.play();
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
    });

    fireEvent.press(screen.getByTestId("pick-files-button"));
    fireEvent.press(screen.getByTestId("remove-stem-bass"));
    fireEvent.press(screen.getByTestId("save-button"));

    await waitFor(() =>
      expect(screen.getByText(/Stop playback first/)).toBeTruthy(),
    );
    expect(addStemsToProject).not.toHaveBeenCalled();
    expect(removeStemFromProject).not.toHaveBeenCalled();
    expect(updateProjectMetadata).not.toHaveBeenCalled();
    // The whole point: the song kept playing.
    expect(audioEngine.getTransportState()).toBe("playing");
  });

  // Renaming only rewrites a label and patches the snapshot - it never
  // reloads, so blocking it would be needless restriction mid-set.
  it("still allows renaming a stem while playing", async () => {
    (renameStemInProject as jest.Mock).mockResolvedValue(filesystemProject);
    renderEditing();
    await waitForMixer();
    fireEvent.press(screen.getByTestId("edit-button"));

    audioEngine.play();
    const field = screen.getByTestId("rename-stem-bass");
    fireEvent.changeText(field, "Low End");
    fireEvent(field, "blur");

    await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());
    expect(audioEngine.getTransportState()).toBe("playing");
  });
});

// Add, remove and save each check the transport, then wait (file picker,
// copying, a manifest write) before reloading. Play is held locked from that
// check until the reload ends, so a song can't be started in the wait and
// then cut off by the reload.
describe("ProjectScreen - play stays locked through an edit's whole reload", () => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function renderInEditMode() {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    fireEvent.press(screen.getByTestId("edit-button"));
    expect(nowPlayingStore.canStartPlayback()).toBe(true);
  }

  it("locks from Add Tracks through the picker, the copy and the reload", async () => {
    await renderInEditMode();
    const picker = deferred<unknown>();
    const copy = deferred<unknown>();
    pickerMock.mockReturnValue(picker.promise);
    (addStemsToProject as jest.Mock).mockReturnValue(copy.promise);

    fireEvent.press(screen.getByTestId("pick-files-button"));
    // While the file picker is open.
    expect(nowPlayingStore.canStartPlayback()).toBe(false);

    await act(async () => {
      picker.resolve({
        canceled: false,
        assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
      });
    });
    // While the stems are being copied in.
    await waitFor(() => expect(addStemsToProject).toHaveBeenCalled());
    expect(nowPlayingStore.canStartPlayback()).toBe(false);

    await act(async () => {
      copy.resolve(filesystemProject);
    });
    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });

  it("unlocks when the picker is cancelled", async () => {
    await renderInEditMode();
    pickerMock.mockResolvedValue({ canceled: true, assets: null });

    fireEvent.press(screen.getByTestId("pick-files-button"));

    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });

  it("unlocks when adding fails", async () => {
    await renderInEditMode();
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
    });
    (addStemsToProject as jest.Mock).mockRejectedValue(new Error("disk full"));

    fireEvent.press(screen.getByTestId("pick-files-button"));

    await waitFor(() => expect(screen.getByText("disk full")).toBeTruthy());
    expect(nowPlayingStore.canStartPlayback()).toBe(true);
  });

  it("locks while a removal saves and reloads", async () => {
    await renderInEditMode();
    answerAlertWith("Remove");
    const removal = deferred<unknown>();
    (removeStemFromProject as jest.Mock).mockReturnValue(removal.promise);

    fireEvent.press(screen.getByTestId("remove-stem-bass"));
    expect(nowPlayingStore.canStartPlayback()).toBe(false);

    await act(async () => {
      removal.resolve(filesystemProject);
    });
    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });

  it("locks while the song info saves and reloads", async () => {
    await renderInEditMode();
    const save = deferred<unknown>();
    (updateProjectMetadata as jest.Mock).mockReturnValue(save.promise);

    fireEvent.press(screen.getByTestId("save-button"));
    expect(nowPlayingStore.canStartPlayback()).toBe(false);

    await act(async () => {
      save.resolve(filesystemProject);
    });
    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });
});

// Edits keep running after the user navigates away, and only reload once
// their disk work is done. If another song was opened meanwhile, the late
// reload must not replace it.
describe("ProjectScreen - an edit finishing after another song was opened", () => {
  const otherSong: LibraryProjectEntry = {
    ...threeStemProject,
    id: "other-song",
    sourceDir: "file:///mock/document/projects/other-song",
  };

  async function renderInEditMode() {
    (getProjectSourceForEntry as jest.Mock).mockImplementation(
      async (e: LibraryProjectEntry) => ({ manifest: e, resolveFile: () => 0 }),
    );
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    const rendered = renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    fireEvent.press(screen.getByTestId("edit-button"));
    return rendered;
  }

  async function openOtherSong() {
    await act(async () => {
      await nowPlayingStore.openProject(otherSong, {
        monitorMode: "split",
        clickEnabled: true,
      });
    });
  }

  it("keeps the other song loaded when a stem import finishes late, but saves the import", async () => {
    const { store } = await renderInEditMode();
    let finishCopy: () => void = () => {};
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset("gtr.wav", "file:///tmp/gtr.wav")],
    });
    const withGuitar = {
      ...filesystemProject,
      tracks: [
        ...filesystemProject.tracks,
        {
          id: "gtr",
          name: "gtr",
          file: "gtr.wav",
          gain: 1,
          bus: "main" as const,
        },
      ],
    };
    (addStemsToProject as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishCopy = () => resolve(withGuitar);
      }),
    );

    fireEvent.press(screen.getByTestId("pick-files-button"));
    await waitFor(() => expect(addStemsToProject).toHaveBeenCalled());
    await openOtherSong();
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    await act(async () => finishCopy());

    await waitFor(() =>
      expect(
        store.getState().projects.entities["my-song"]?.tracks,
      ).toHaveLength(3),
    );
    expect(loadSpy).not.toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBe("other-song");
    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });

  it("keeps the other song loaded when a song info save finishes late", async () => {
    await renderInEditMode();
    let finishSave: () => void = () => {};
    (updateProjectMetadata as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishSave = () => resolve(filesystemProject);
      }),
    );

    fireEvent.press(screen.getByTestId("save-button"));
    await openOtherSong();
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    await act(async () => finishSave());

    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
    expect(loadSpy).not.toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBe("other-song");
  });
});

// The arrange view only computes waveforms for its first 16 lanes, so in a
// song with more stems, moving one into those lanes needs a full reload -
// which rebuilds the audio graph and so can't happen mid-song.
describe("ProjectScreen - reordering past the waveform lanes", () => {
  const manyStems: LibraryProjectEntry = {
    id: "big-song",
    title: "Big Song",
    bpm: 100,
    key: "",
    tracks: Array.from({ length: 17 }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Track ${i + 1}`,
      file: `t${i + 1}.wav`,
      gain: 1,
      bus: "main" as const,
    })),
    sections: [],
    origin: "filesystem",
    sourceDir: "file:///mock/document/projects/big-song",
  };
  const ids = manyStems.tracks.map((t) => t.id);
  /** t17 swapped with t16 - the move that brings t17 into the lanes. */
  const t17Up = [...ids.slice(0, 15), "t17", "t16"];

  function manifestWithOrder(order: string[]) {
    return {
      ...manyStems,
      tracks: order.map((id) => manyStems.tracks.find((t) => t.id === id)!),
    };
  }

  async function renderInEditMode() {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: manyStems,
      resolveFile: () => 0,
    });
    mockParams = { projectId: "big-song" };
    const store = createStore();
    store.dispatch(projectAdded(manyStems));
    const rendered = renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    fireEvent.press(screen.getByTestId("edit-button"));
    return rendered;
  }

  afterEach(() => {
    audioEngine.stop();
  });

  it("refuses the move while playing, before saving anything", async () => {
    const { store } = await renderInEditMode();
    act(() => audioEngine.play());
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    fireEvent.press(screen.getByTestId("stem-t17-move-up"));

    expect(moveStemInProject).not.toHaveBeenCalled();
    expect(screen.getByText(/Stop playback first/)).toBeTruthy();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe("playing");
    expect(
      store.getState().projects.entities["big-song"]?.tracks.map((t) => t.id),
    ).toEqual(ids);
  });

  // Moves within the lanes are display-only, so they stay allowed mid-song.
  it("still allows moves inside the lanes while playing", async () => {
    (moveStemInProject as jest.Mock).mockResolvedValue(
      manifestWithOrder(["t2", "t1", ...ids.slice(2)]),
    );
    await renderInEditMode();
    act(() => audioEngine.play());

    fireEvent.press(screen.getByTestId("stem-t2-move-up"));

    await waitFor(() => expect(moveStemInProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        nowPlayingStore.getSnapshot().manifest?.tracks.map((t) => t.id),
      ).toEqual(["t2", "t1", ...ids.slice(2)]),
    );
    expect(audioEngine.getTransportState()).toBe("playing");
  });

  it("saves the move and reloads when stopped", async () => {
    (moveStemInProject as jest.Mock).mockResolvedValue(
      manifestWithOrder(t17Up),
    );
    await renderInEditMode();
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: manifestWithOrder(t17Up),
      resolveFile: () => 0,
    });
    const loadSpy = jest.spyOn(audioEngine, "loadProject");

    fireEvent.press(screen.getByTestId("stem-t17-move-up"));

    await waitFor(() => expect(loadSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        nowPlayingStore.getSnapshot().waveformTracks.map((w) => w.id),
      ).toContain("t17"),
    );
  });

  // Playback must not be able to start between the tap and the reload - the
  // reload replaces the engine's transport and would cut the song off.
  it("locks play from the tap until the reload is done", async () => {
    let finishSave: () => void = () => {};
    (moveStemInProject as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve(manifestWithOrder(t17Up));
        }),
    );
    await renderInEditMode();
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: manifestWithOrder(t17Up),
      resolveFile: () => 0,
    });

    fireEvent.press(screen.getByTestId("stem-t17-move-up"));
    expect(nowPlayingStore.canStartPlayback()).toBe(false);

    await waitFor(() => expect(moveStemInProject).toHaveBeenCalled());
    await act(async () => finishSave());
    await waitFor(() =>
      expect(
        nowPlayingStore.getSnapshot().waveformTracks.map((w) => w.id),
      ).toContain("t17"),
    );
    await waitFor(() => expect(nowPlayingStore.canStartPlayback()).toBe(true));
  });

  // Each move is computed from the order on screen, so overlapping moves
  // would each be computed from the same, soon-stale order.
  it("ignores further moves until the one saving has finished", async () => {
    let finishSave: () => void = () => {};
    (moveStemInProject as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve(manifestWithOrder(["t2", "t1", ...ids.slice(2)]));
        }),
    );
    await renderInEditMode();

    fireEvent.press(screen.getByTestId("stem-t2-move-up"));
    fireEvent.press(screen.getByTestId("stem-t2-move-up"));
    fireEvent.press(screen.getByTestId("stem-t17-move-up"));

    expect(moveStemInProject).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("stem-t5-move-up").props.accessibilityState,
    ).toMatchObject({ disabled: true });

    await act(async () => finishSave());
    await waitFor(() =>
      expect(
        screen.getByTestId("stem-t5-move-up").props.accessibilityState,
      ).toMatchObject({ disabled: false }),
    );
  });
});

describe("ProjectScreen - deleting", () => {
  async function renderEditableInEditMode() {
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    store.dispatch(
      tracksInitializedForProject({
        projectId: filesystemProject.id,
        tracks: filesystemProject.tracks,
      }),
    );
    const rendered = renderWithStore(<ProjectScreen />, store);
    // This fake sourceDir has no real manifest.json behind it, so the load
    // always fails - Edit has to stay reachable straight from the error
    // state (see ProjectScreen's error branch), not behind the mixer drawer.
    await waitFor(() => expect(screen.getByTestId("edit-button")).toBeTruthy());
    fireEvent.press(screen.getByTestId("edit-button"));
    return rendered;
  }

  /** Drives Alert.alert by invoking the button matching `label`. */
  // Deleting needs a folder to delete. Nothing produces a sourceDir-less
  // entry now that the bundled demo is gone, but the guard is still there and
  // a project the app can't locate must not offer to destroy it.
  it("is not offered for a project with no source directory", () => {
    mockParams = { projectId: "no-dir" };
    const store = createStore();
    store.dispatch(
      projectAdded({
        id: "no-dir",
        title: "No Directory",
        key: "",
        tracks: [],
        sections: [],
        origin: "filesystem",
      }),
    );
    renderWithStore(<ProjectScreen />, store);

    // A stemless project opens straight into the form - the only view that
    // ever offers delete.
    expect(screen.getByTestId("save-button")).toBeTruthy();
    expect(screen.queryByTestId("delete-project-button")).toBeNull();
  });

  // Deleting destroys the audio files, so it must never happen on one tap.
  it("asks before deleting anything", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId("delete-project-button"));

    expect(alertSpy).toHaveBeenCalled();
    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("deletes the folder, the entry and its mixer state once confirmed", async () => {
    answerAlertWith("Delete");
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId("delete-project-button"));

    expect(deleteProjectDirectory).toHaveBeenCalledWith(
      filesystemProject.sourceDir,
    );
    expect(store.getState().projects.entities["my-song"]).toBeUndefined();
    expect(
      store.getState().tracks.entities[trackEntityId("my-song", "bass")],
    ).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it("leaves everything alone when the confirmation is dismissed", async () => {
    answerAlertWith("Cancel");
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId("delete-project-button"));

    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(store.getState().projects.entities["my-song"]).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("keeps the project if deleting the folder fails", async () => {
    answerAlertWith("Delete");
    (deleteProjectDirectory as jest.Mock).mockImplementationOnce(() => {
      throw new Error("disk busy");
    });
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId("delete-project-button"));

    expect(store.getState().projects.entities["my-song"]).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByText("disk busy")).toBeTruthy();
  });

  // Unlike the fake-sourceDir cases above (which never actually load), this
  // one loads for real, so it's the one that exercises nowPlayingStore's
  // closeIfCurrent - deleting the project that's actually loaded/playing
  // must stop it, not leave it playing under a deleted project.
  it("stops the engine when deleting the project that is currently loaded and playing", async () => {
    answerAlertWith("Delete");
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: "my-song" };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    // Edit can't be opened mid-song any more (see "locked while playing"), so
    // open it first and start playback after - what's under test is that
    // deleting a *playing* project stops the engine, not how Edit was reached.
    fireEvent.press(screen.getByTestId("edit-button"));
    audioEngine.play();

    fireEvent.press(screen.getByTestId("delete-project-button"));

    expect(audioEngine.getTransportState()).toBe("stopped");
    expect(deleteProjectDirectory).toHaveBeenCalledWith(
      filesystemProject.sourceDir,
    );
  });
});
