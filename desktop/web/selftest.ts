/**
 * End-to-end self-test of the desktop app, run inside the real app (webview
 * + vvsfs file layer + Rust engine + the actual audio device) when started
 * with VVS_SELFTEST=1:
 *
 *   VVS_SELFTEST=1 ./target/debug/virtual-vs-desktop
 *
 * It uses the mobile storage/playback modules directly - the same code the
 * screens call - in a throwaway data directory (see lib.rs), with silent
 * stems so nothing is heard. Prints PASS/FAIL per step to the app's log and
 * exits 0 or 1.
 */
// Imported directly: metro.config.js doesn't redirect imports made from
// desktop/web, and this must be the same file layer the app uses.
import { Directory, File, Paths } from "./shims/expo-file-system";
import {
  addStemsToProject,
  createDraftProject,
  createSetlist,
  deleteProjectDirectory,
  importBundle,
  listFilesystemProjects,
  listSetlists,
  patchProjectManifest,
  readProjectManifest,
  writeBundleToCache,
  writeSetlist,
} from "@/storage";
import { nowPlayingStore } from "@/playback/nowPlayingStore";
import type { LibraryProjectEntry } from "@/store/projectsSlice";
import type { ProjectManifest } from "@/types/project";
import { audioEngine } from "./engine/AudioEngine";
import { engineStatus } from "./engine/status";
import { api } from "./ui/api";
import { invoke } from "./tauri";

const STEM_SECONDS = 8;
const RATE = 44100;

function silentWav(seconds: number): Uint8Array {
  const frames = seconds * RATE;
  const dataBytes = frames * 4;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function asEntry(
  manifest: ProjectManifest,
  sourceDir: string,
): LibraryProjectEntry {
  return {
    ...manifest,
    origin: "filesystem",
    sourceDir,
  } as LibraryProjectEntry;
}

export async function runSelfTest(): Promise<void> {
  const results: string[] = [];
  let failures = 0;
  const log = (line: string) =>
    invoke("log_from_webview", { level: "selftest", message: line }).catch(
      () => {},
    );
  const check = (name: string, ok: boolean, detail = "") => {
    if (!ok) failures += 1;
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`;
    results.push(line);
    log(line);
  };

  try {
    // --- Song creation and stem import (storage layer over vvsfs) ---------
    const draft = await createDraftProject();
    check("create song", new Directory(draft.sourceDir!).exists);

    const stems = ["Drums.wav", "Guide.wav"].map((name) => {
      const file = new File(Paths.cache, name);
      file.write(silentWav(STEM_SECONDS));
      return {
        uri: file.uri,
        name,
        size: file.size ?? undefined,
        mimeType: "audio/wav",
        lastModified: Date.now(),
      };
    });
    let manifest = await addStemsToProject(
      draft.sourceDir!,
      stems,
      audioEngine.context as never,
    );
    check(
      "import stems",
      manifest.tracks.length === 2,
      manifest.tracks.map((t) => t.file).join(", "),
    );
    check(
      "stems copied into the song",
      manifest.tracks.every(
        (t) => new File(new Directory(draft.sourceDir!), t.file).exists,
      ),
    );

    // --- Markers, lyrics, bpm, folders --------------------------------------
    manifest = await patchProjectManifest(draft.sourceDir!, {
      title: "Selftest",
      bpm: 120,
      sections: [
        { id: "a", name: "Intro", startSec: 0 },
        { id: "b", name: "Verse", startSec: 4 },
      ],
      lyrics: "First line\nSecond line",
    });
    const reread = await readProjectManifest(
      new Directory(draft.sourceDir!) as never,
    );
    check(
      "markers saved",
      reread.sections.length === 2 && reread.sections[1].startSec === 4,
    );
    check("lyrics saved", reread.lyrics === "First line\nSecond line");

    const folder = createSetlist("Selftest folder");
    writeSetlist({ ...folder, songs: [manifest.id] });
    const folders = await listSetlists();
    check(
      "folder with song",
      folders.some((f) => f.id === folder.id && f.songs.includes(manifest.id)),
    );
    const library = await listFilesystemProjects();
    check(
      "song in library",
      library.some((p) => p.id === manifest.id),
    );

    // --- Loading into the engine --------------------------------------------
    const entry = asEntry(manifest, draft.sourceDir!);
    const loaded = await nowPlayingStore.openProject(entry, {
      monitorMode: "split",
      clickEnabled: true,
    });
    check(
      "load song",
      Math.abs(loaded.durationSec - STEM_SECONDS) < 0.05,
      `duration ${loaded.durationSec.toFixed(3)}s`,
    );
    const lanes = nowPlayingStore.getSnapshot().waveformTracks;
    check(
      "waveforms",
      lanes.length === 2 && lanes.every((l) => l.peaks.length > 0),
    );
    check("click present", audioEngine.hasClick());

    const transitions: string[] = [];
    const unsubscribe = audioEngine.onTransportStateChange((state) =>
      transitions.push(state),
    );

    // --- Transport ----------------------------------------------------------
    await wait(300);
    check(
      "engine has the song",
      engineStatus.getLatest()?.projectId === manifest.id,
    );

    audioEngine.play();
    await wait(1500);
    let status = engineStatus.getLatest();
    check(
      "plays",
      status?.transport === "playing" &&
        status.positionSec > 1.0 &&
        status.positionSec < 2.2,
      `engine at ${status?.positionSec.toFixed(3)}s`,
    );
    const drift = Math.abs(
      audioEngine.getPlayhead() - (status?.positionSec ?? 0),
    );
    check(
      "UI playhead follows the engine",
      drift < 0.15,
      `difference ${drift.toFixed(3)}s`,
    );

    audioEngine.setTrackVolume(manifest.tracks[0].id, 0.5);
    audioEngine.setTrackMuted(manifest.tracks[1].id, true);
    audioEngine.setTrackSoloed(manifest.tracks[0].id, true);
    audioEngine.setTrackSoloed(manifest.tracks[0].id, false);
    audioEngine.setTrackMuted(manifest.tracks[1].id, false);

    audioEngine.seek(5);
    await wait(400);
    status = engineStatus.getLatest();
    check(
      "seek while playing",
      status?.transport === "playing" &&
        status.positionSec >= 5 &&
        status.positionSec < 5.8,
      `engine at ${status?.positionSec.toFixed(3)}s`,
    );

    audioEngine.pause();
    await wait(300);
    status = engineStatus.getLatest();
    const pausedAt = status?.positionSec ?? -1;
    check(
      "pause",
      status?.transport === "paused",
      `at ${pausedAt.toFixed(3)}s`,
    );
    await wait(300);
    check("stays paused", engineStatus.getLatest()?.positionSec === pausedAt);

    audioEngine.play();
    await wait(300);
    status = engineStatus.getLatest();
    check(
      "resume",
      status?.transport === "playing" && status.positionSec > pausedAt,
    );

    audioEngine.stop();
    await wait(300);
    status = engineStatus.getLatest();
    check("stop", status?.transport === "stopped" && status.positionSec === 0);

    // --- Natural end ---------------------------------------------------------
    transitions.length = 0;
    audioEngine.seek(STEM_SECONDS - 0.5);
    audioEngine.play();
    await wait(1500);
    status = engineStatus.getLatest();
    check(
      "ends on its own",
      status?.transport === "stopped",
      `transitions: ${transitions.join(" -> ")}`,
    );
    check("UI saw the end", audioEngine.getTransportState() === "stopped");
    unsubscribe();

    // --- Routing --------------------------------------------------------------
    const routed = await api.setTrackRouting(
      manifest.tracks[0].id,
      "allSongs",
      [{ kind: "mono", channel: 0 }],
    );
    const drums = routed.tracks.find((t) => t.id === manifest.tracks[0].id);
    check(
      "route a track",
      drums?.route.source === "name" && drums.route.targets.length === 1,
    );
    const reset = await api.setTrackRouting(
      manifest.tracks[0].id,
      "allSongs",
      null,
    );
    check(
      "reset route",
      reset.tracks.find((t) => t.id === manifest.tracks[0].id)?.route.source ===
        "default",
    );

    // --- Bundle round trip (streams through file handles) --------------------
    const bundle = await writeBundleToCache(
      { projects: [entry], folders: [{ ...folder, songs: [manifest.id] }] },
      "selftest",
    );
    check(
      "export bundle",
      (bundle.size ?? 0) > 2 * silentWav(STEM_SECONDS).length,
    );
    nowPlayingStore.closeIfCurrent(manifest.id);
    deleteProjectDirectory(draft.sourceDir!);
    const imported = await importBundle(bundle);
    check(
      "import bundle",
      imported.projects.length === 1 && imported.projects[0].id === manifest.id,
    );
    const restored = await readProjectManifest(
      new Directory(imported.projects[0].sourceDir!) as never,
    );
    check(
      "bundle keeps markers, lyrics and stems",
      restored.sections.length === 2 &&
        restored.lyrics === "First line\nSecond line" &&
        restored.tracks.every(
          (t) =>
            new File(new Directory(imported.projects[0].sourceDir!), t.file)
              .size === silentWav(STEM_SECONDS).length,
        ),
    );

    check(
      "no engine command errors",
      engineStatus.getCommandError() === null,
      engineStatus.getCommandError() ?? "",
    );
  } catch (error) {
    check(
      "self-test ran to completion",
      false,
      String((error as Error)?.stack ?? error),
    );
  }

  const summary = `${results.length - failures}/${results.length} checks passed`;
  await invoke("selftest_finish", { passed: failures === 0, summary });
}
