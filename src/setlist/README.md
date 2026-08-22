# Setlist mode (controller not implemented)

This folder is a placeholder for the multi-song setlist *controller*
described in AGENTS.md. Nothing in this folder runs yet.

The data model is no longer just persisted - it ships. A `SetlistManifest` is
what the Library shows as a **folder**: `src/storage/setlistLibrary.ts` reads
and writes one `Documents/setlists/<id>.json` per folder,
`src/store/persistFolders.ts` mutates them, and `src/ui/libraryTree.ts` turns
them plus the project list into the tree the Library renders. A folder holds
song *ids*, so a song can be in several folders and reorganising never moves
audio.

What that means for the controller: `songs` is already a real, user-curated,
ordered list by the time you get here, and `advance`/`padBetween` are the two
fields nothing reads yet. Building this feature is wiring up playback for a
folder the user already has - not introducing setlists.

## TODO when this gets built

- **`SetlistController`**: owns "current song index" + "advance mode"
  (`manual` | `auto`) for a `SetlistManifest`. On `manual`, exposes
  `next()`/`previous()` for a footswitch or UI button (see `src/control/`).
  On `auto`, advances when the current song's `AudioEngine` transport
  finishes (mirror the auto-stop check in `PlayerScreen`, but call `next()`
  instead of just stopping).
- **Preload-next**: while song N is playing, decode song N+1's stems in the
  background (`storage/decodeProjectAudio`) so switching songs has no gap.
  Needs a second, idle `AudioEngine`-style buffer cache - decoding is async
  and shouldn't block the current song's playback.
- **Pad crossfade**: `ProjectManifest.pad` (and `SetlistManifest.padBetween`)
  describe a bed/pad that should keep playing under song transitions. This
  needs its own persistent GainNode + BufferSource pair in the engine that
  outlives individual `loadProject()` calls, with a scheduled linear
  crossfade (`AudioParam.linearRampToValueAtTime`) between songs instead of
  a hard cut.
- Give a Library folder a "play this set" affordance once the controller
  exists. There is deliberately no separate Setlist screen to build: the
  folder tree in the Library *is* the setlist list, so this is a play button
  on `FolderRow` plus a queue view, not a new section of the app.
