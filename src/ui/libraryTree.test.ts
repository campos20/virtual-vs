import type { LibraryProjectEntry } from "@/store/projectsSlice";
import type { SetlistManifest } from "@/types/setlist";
import {
  buildLibraryTree,
  folderKey,
  neighbouringSongs,
  resolveFolderSongs,
  resolveLibraryOrder,
  resolveSongSequence,
  songKey,
  type LibraryItem,
} from "./libraryTree";

function project(id: string): LibraryProjectEntry {
  return {
    id,
    title: id,
    key: "",
    tracks: [],
    sections: [],
    origin: "filesystem",
  };
}

function folder(id: string, songs: string[]): SetlistManifest {
  return { id, name: id, songs, advance: "manual", padBetween: false };
}

/** Readable shorthand for asserting on shape - `['folder:set(a,b)', 'project:c']`. */
function describeTree(items: LibraryItem[]): string[] {
  return items.map((item) =>
    item.kind === "folder"
      ? `${item.key}(${item.songs.map((song) => song.id).join(",")})`
      : item.key,
  );
}

describe("buildLibraryTree", () => {
  it("shows a song inside its folder rather than also at the top level", () => {
    const tree = buildLibraryTree(
      [project("a"), project("b")],
      [folder("set", ["a"])],
    );

    expect(describeTree(tree)).toEqual(["folder:set(a)", "project:b"]);
  });

  it("shows the same song in every folder that lists it", () => {
    const tree = buildLibraryTree(
      [project("a")],
      [folder("sunday", ["a"]), folder("wedding", ["a"])],
    );

    // The whole reason folders hold ids: one song, two sets, no copy of the
    // audio and no "which folder is it really in?".
    expect(describeTree(tree)).toEqual([
      "folder:sunday(a)",
      "folder:wedding(a)",
    ]);
  });

  it("keeps a folder's own song order rather than the library's", () => {
    const tree = buildLibraryTree(
      [project("a"), project("b")],
      [folder("set", ["b", "a"])],
    );

    expect(describeTree(tree)).toEqual(["folder:set(b,a)"]);
  });

  it("drops song ids that no longer resolve to a project", () => {
    // A project can be deleted from the project screen while folders still
    // point at it; a folder of ghost rows is worse than a shorter folder.
    const tree = buildLibraryTree(
      [project("a")],
      [folder("set", ["a", "deleted"])],
    );

    expect(describeTree(tree)).toEqual(["folder:set(a)"]);
  });

  it("puts folders before loose songs when nothing has been ordered yet", () => {
    // So a folder the user just created is on screen, not below a long list.
    const tree = buildLibraryTree(
      [project("a"), project("b")],
      [folder("set", [])],
    );

    expect(describeTree(tree)).toEqual([
      "folder:set()",
      "project:a",
      "project:b",
    ]);
  });

  it("interleaves folders and songs in the saved order", () => {
    const tree = buildLibraryTree(
      [project("a"), project("b")],
      [folder("set", [])],
      [songKey("a"), folderKey("set"), songKey("b")],
    );

    expect(describeTree(tree)).toEqual([
      "project:a",
      "folder:set()",
      "project:b",
    ]);
  });

  it("appends items the saved order predates instead of losing them", () => {
    const tree = buildLibraryTree(
      [project("a"), project("new")],
      [folder("set", [])],
      [songKey("a")],
    );

    expect(describeTree(tree)).toEqual([
      "project:a",
      "folder:set()",
      "project:new",
    ]);
  });

  it("ignores ordered keys whose item is gone", () => {
    const tree = buildLibraryTree(
      [project("a")],
      [],
      [folderKey("deleted"), songKey("a")],
    );

    expect(describeTree(tree)).toEqual(["project:a"]);
  });
});

describe("resolveFolderSongs", () => {
  it("resolves ids to projects in the folder's own order", () => {
    const result = resolveFolderSongs(folder("set", ["b", "a"]), [
      project("a"),
      project("b"),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("drops an id that no longer resolves to a project", () => {
    const result = resolveFolderSongs(folder("set", ["a", "deleted"]), [
      project("a"),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("resolveLibraryOrder", () => {
  it("prefers the folder-aware order", () => {
    expect(
      resolveLibraryOrder({
        libraryOrder: [folderKey("set")],
        projectOrder: ["a"],
      }),
    ).toEqual([folderKey("set")]);
  });

  it("migrates a pre-folders projectOrder so the dragged order survives an update", () => {
    expect(resolveLibraryOrder({ projectOrder: ["a", "b"] })).toEqual([
      songKey("a"),
      songKey("b"),
    ]);
  });

  it("returns nothing to order for a fresh install", () => {
    expect(resolveLibraryOrder({})).toEqual([]);
  });
});

describe("resolveSongSequence", () => {
  const projects = ["a", "b", "c", "d"].map(project);
  const set = folder("set", ["c", "a"]);

  it("follows the folder's own order when there is a folder", () => {
    expect(
      resolveSongSequence(set, projects, [set], []).map((p) => p.id),
    ).toEqual(["c", "a"]);
  });

  it("otherwise follows the Library's top-level songs, in its order, skipping filed ones", () => {
    const order = [songKey("d"), folderKey("set"), songKey("b")];
    expect(
      resolveSongSequence(undefined, projects, [set], order).map((p) => p.id),
    ).toEqual(["d", "b"]);
  });
});

describe("neighbouringSongs", () => {
  const songs = ["a", "b", "c"].map(project);

  it("finds the songs either side", () => {
    expect(neighbouringSongs(songs, "b")).toEqual({
      index: 1,
      previousId: "a",
      nextId: "c",
    });
  });

  it("does not wrap at either end", () => {
    expect(neighbouringSongs(songs, "a").previousId).toBeNull();
    expect(neighbouringSongs(songs, "c").nextId).toBeNull();
  });

  it("offers nothing for a song that is not in the list", () => {
    expect(neighbouringSongs(songs, "zzz")).toEqual({
      index: -1,
      previousId: null,
      nextId: null,
    });
  });
});
