# Setlist mode (not implemented)

This folder is a placeholder for the multi-song setlist controller described
in AGENTS.md. The data model already exists and is persisted
(`src/types/setlist.ts`, `src/store/setlistsSlice.ts`), but nothing in this
folder runs yet.

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
- Wire a Setlist screen into `src/app/` once the controller exists (list of
  setlists -> song queue view, reusing `PlayerScreen`'s track rows).
