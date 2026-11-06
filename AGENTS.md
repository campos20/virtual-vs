# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Stability over appearance

This app runs live, on stage, during a performance. A crash or audio glitch has
real consequences in a way a plain UI has none of - there is no "reload the
page" mid-song. Stability, correctness, and predictability always outrank
visual polish or how modern something looks.

Concretely:

- Prefer plain React Native core components (`View`, `Text`, `Pressable`,
  etc.) over third-party or platform-experimental UI libraries, especially
  ones wrapping newer/native-only platform APIs (e.g. iOS Liquid Glass).
  `expo-glass-effect` was tried for a "modern" visual pass and caused a
  hard-to-reproduce Android Fabric crash (`addViewAt: ... already has a
parent`) on the Player -> Library back transition, confirmed only after
  several rounds of investigation (see git history for the full trail).
  Fixing it took four changes together, not any single one in isolation:
  1. Dropped `expo-glass-effect`/`GlassView` entirely (reverted to plain
     `View` - it was never doing anything but rendering as one on Android
     anyway).
  2. Moved `VerticalFader`/`TransportBar`'s drag gestures off
     `react-native-gesture-handler`'s `GestureDetector`/`Gesture` API onto
     React Native's own built-in `PanResponder` (no extra native
     view/handler registration), and dropped `GestureHandlerRootView` from
     `_layout.tsx`. `react-native-gesture-handler`/`react-native-reanimated`
     stay in `package.json` only because `expo-router` requires them as
     peer dependencies internally - app code should not import from either
     directly.
  3. Replaced all three `FlatList` usages (Library's project list, the
     mixer's channel strips, the new-project file list) with plain
     `ScrollView` + `.map()` - none of these lists are ever long enough to
     need virtualization, and `VirtualizedList`'s internal cell-recycling
     schedules its own deferred, timer-based state updates.
  4. Set `_layout.tsx`'s `<Stack>` to `animation: 'none'` (removes the
     window where both screens' native view trees are present/rendering at
     once during an animated transition) and wrapped the app in
     `SafeAreaProvider` (react-native-safe-area-context requires it as an
     ancestor of any `SafeAreaView`; every screen was using `SafeAreaView`
     without one).
     Confirmed fixed by the user after 20+ consecutive Player <-> Library
     round trips with no repro (previously it reproduced within 3-6). If it
     ever resurfaces, re-read the git history around these four commits before
     reaching for a new theory - the working hypothesis was an accumulation
     across mount/unmount cycles (view tag numbers climbed each attempt: 126,
     1378, 1694) rather than a one-shot race, and step 4 is the most likely of
     the four to be load-bearing, but this was never isolated with a minimal
     repro.

  UPDATE - it did resurface, and the cause was finally isolated with a
  minimal repro. **Never give a `Pressable` that triggers navigation a
  function-as-child (`{({ pressed }) => ...}`).** Put press feedback in
  `Pressable`'s `style` callback instead and keep the children static.

  A function child re-creates the child `View`/`Text` elements on every
  press-state change. Releasing the button sets `pressed` back to `false`,
  so those children are re-created in the _same frame_ that the `onPress`
  handler's `router.back()` is tearing the screen's native views down, and
  Fabric tries to insert a `ReactTextView` that still belongs to the
  outgoing parent. Styling the `Pressable` itself only updates props on an
  already-mounted view, so the tree stays structurally constant.

  How it was isolated, if it ever comes back again:
  - Reproduced deterministically on round 1 - it does NOT need repeated
    mount/unmount cycles, and playback being active is irrelevant (the
    earlier "accumulation" theory and "stop the track before going back"
    hypothesis were both wrong).
  - Android's **hardware** back button never reproduced it (5/5 clean),
    while the on-screen back `Pressable` reproduced it immediately. That
    asymmetry is the tell: same navigation, same screens, only difference
    is the `Pressable` press-state re-render. Test both before blaming a
    screen or the navigator.
  - Note a redbox does NOT kill the process, so "is the pid still alive?"
    is not a valid health check - grep logcat for `already has a parent`.

- Before adding a new dependency (especially anything touching rendering,
  native views, audio, or navigation), weigh whether it's well-established
  and battle-tested for this use case, not just whether it looks nice or is
  convenient. When in doubt, ask rather than adding it.
- Don't add a runtime (non-dev) dependency speculatively "for later" - only
  add what's actually being wired up now. An installed-but-unused dependency
  still ships in the native build and adds untested surface area.
- Test/dev-only tooling (Jest, Testing Library, etc.) doesn't ship in the
  built app and isn't a stability concern the same way - this principle is
  about runtime dependencies.
- `expo-sharing` is the one dependency added for backup/sharing, and it is
  deliberately the _only_ one. It opens the OS share sheet for a local file
  and does nothing else - no background work, no rendering, no native views.
  Everything else that feature needs was already in `expo-file-system`:
  `FileHandle.readBytes`/`writeBytes` for streaming, and the file picker for
  reading a bundle back. Notably there is **no zip library and no OAuth/HTTP
  client**: the `.vvs` container is written by hand (see
  `storage/bundleFormat.ts`) and Google Drive is reached through the share
  sheet rather than through an API the app would have to hold credentials
  for. Keep it that way unless there's a concrete reason not to - "upload
  automatically in the background" is the only thing the current design
  can't do, and it costs an OAuth client per build plus token refresh.

# Stems stay sample-locked

Every stem in a project (and the synthesized click) must start, stay, and
stop in perfect sample sync with every other stem, at all times, no
exceptions. This is not a "nice to have" - a band plays to these tracks live;
audible drift between stems is arguably worse than a crash, because a crash
is instantly obvious and drift might not be until the take is already
ruined. Treat any change to `AudioEngine.ts` scheduling with the same level
of care AGENTS.md asks for Fabric/navigation crashes above.

How this is guaranteed today:

- **One `AudioContext` for the whole app** (`AudioEngine`/`audioEngine`, a
  singleton). Every stem is a sibling node in the _same_ render graph, so
  there is no independent per-track clock that could drift over time -
  once two nodes are scheduled against the same context time, the audio
  hardware renders them from the same sample position onward. Drift between
  stems already loaded together is structurally impossible, not just
  unlikely, as long as they were started together in the first place.
- **`scheduleSources()` is the only place stems ever start**, and `play()`/
  the resume path/`seek()` all funnel through it. It computes exactly one
  `startAt` (context time) / `offsetSec` (position) pair and passes that
  _same_ pair to every stem's `.start()` call and to the click's - never a
  per-track value, never computed inside a per-track loop.
- **`stopSources()` stops every stem and the click at one shared explicit
  context time**, the same way. This used to call each node's `.stop()`
  with no argument, which independently means "stop as soon as possible"
  per node rather than guaranteeing they all land on the same sample -
  fixed to pass one shared `when` to every call. That `when` is
  `ctx.currentTime + STOP_LOOKAHEAD_SEC`, not bare `ctx.currentTime`: the
  clock keeps advancing while the loop runs, so an un-offset value can
  already be behind `currentTime` by the time a later call in the same loop
  reaches the audio thread - which falls back to the same "ASAP" behavior
  this exists to avoid, just for only _some_ of the nodes. See
  `AudioEngine.test.ts`'s "keeps every stem sample-locked" describe block,
  which asserts every `start`/`stop` call in a play/pause-resume/seek/stop
  cycle shares one identical, explicitly-passed time.
- **Volume/mute/solo/bus changes are pure gain automation**
  (`trackGain.gain.*` ramps) and never touch a `BufferSourceNode`'s
  scheduling at all, so they cannot desync anything by construction - see
  the "never re-schedules any stem for a volume/mute/solo change" test.
- **Adding/removing a stem always goes through `loadProject()`**, which
  fully stops and rebuilds the entire graph atomically. There is no
  "hot-swap" of a single stem while its siblings keep playing - that would
  be the easiest way to accidentally introduce an unsynced track.

Known, narrow, deliberately-not-"fixed" gaps:

- `loadProject()` picks one `longestTrackId` (first `Math.max` winner) and
  only that track's source gets an `onEnded` handler driving natural
  end-of-playback. If two stems are exactly tied for longest, the untracked
  one's tail could in theory still be rendering for a few samples after the
  transport flips to `'stopped'`. Sub-audio-block, inaudible in practice -
  not worth chasing without a concrete repro.
- Stems are trusted to already be time-aligned _in their source files_
  (same start offset, same lead-in silence). Nothing validates this at
  import (`addStemsToProject`/`copyStems`) - there's no way to infer
  "these should line up" from the audio alone. A misaligned stem will still
  play in perfect sample sync with the others; it'll just be synced to the
  wrong content. That's a content-authoring problem, not an engine one.
- `decodeAudioData` is trusted to resample every stem to the engine's
  `AudioContext` sample rate on decode (standard Web Audio API contract) -
  the app doesn't independently re-verify decoded buffers' sample rates,
  since doing so would just be re-asserting a guarantee the underlying
  library (`react-native-audio-api`) already owns.

Guardrails for touching `AudioEngine.ts`:

- Never call `.start()`/`.stop()` per-track with its own independently
  computed time - compute one time, pass it to every node.
- Never schedule or stop stems inside a loop that awaits anything per
  iteration - a JS-thread delay between iterations is exactly how
  inter-track timing skew would sneak in.
- Never assign `source.buffer` (or do any other slow work) between reading
  the shared start time and the last `.start()` call. react-native-audio-api
  deep-copies the samples on every buffer assignment, on the JS thread - tens
  of MB per long stem - and a source whose `start(when, offset)` arrives after
  `when` starts immediately from `offset`, permanently behind its siblings.
  Build every source first, then take `startAt` from the clock, then call
  `.start()` in a loop that does nothing else (`scheduleSources`/
  `primeSources`). This was a real desync on long stems, seen after switching
  songs back to back; see the "when assigning stem buffers is slow" tests.
- Never introduce a second `AudioContext`/engine instance (e.g. one per
  track). The single shared context is _the_ invariant that makes drift
  structurally impossible in the first place.
- A stem being added, removed, or replaced must always go through a full
  `loadProject()` rebuild, never a partial graph patch while the transport
  is playing.
- Run (and extend) `AudioEngine.test.ts`'s "keeps every stem sample-locked"
  suite whenever touching `scheduleSources`/`stopSources`/`play`/`pause`/
  `seek`.

# Editing a song (manifest writes, reloads, playback)

Editing runs while the app stays usable. The NowPlayingBar can start
playback while the editor is open, and edits keep running after the user
navigates away. These rules came out of the PR #16 review rounds. Keep them
when touching `ProjectScreen`'s edit handlers, `ProjectForm`,
`nowPlayingStore` or `storage/importProject.ts`.

- **Every manifest read-modify-write goes through `withManifestLock`**
  (`storage/importProject.ts`). That covers add, remove, rename, move, the
  metadata save and `patchProjectManifest` (mixer, click, markers, lyrics).
  Edits to one project then run one at a time. A new function that rewrites
  `manifest.json` must use it too, or a stale write can undo another edit,
  or restore a track whose file was already deleted.
- **Track order and names are display-only.** The engine keys stems by id,
  so a rename or move patches the loaded snapshot in place
  (`renameTrackLocal`/`reorderTracksLocal`) and never reloads. Both take the
  project id and are no-ops for any other loaded song, because stem ids
  repeat across songs. The exception is a move that brings a stem without a
  waveform into the first 16 lanes, which needs a reload.
- **A reload ends in `audioEngine.loadProject()`, which stops the
  transport.** So:
  - Any edit that ends in a reload (add, remove, metadata save, a
    reload-needing move) takes `nowPlayingStore.holdPlayback()` in the same
    synchronous step as its `transportIsRunning()` check, before any
    `await`. It releases the hold in `finally`, after its reload. Every
    control that starts playback checks `canStartPlayback()`: the
    NowPlayingBar's play button and the desktop Space shortcut. Pause, stop
    and seek are never locked.
  - A reload-needing move is refused while playing, before anything is
    saved. Don't defer a reload until playback stops: it would start right
    when the performer may press play again.
- **An edit's final reload must not replace a song the user chose since.**
  Edits take `nowPlayingStore.loadGeneration()` when they start and reload
  through `reloadUnlessSuperseded()`. Opening a song records the user's
  choice even when it's already loaded and no load runs. That is tracked
  apart from `requestId`, which only counts actual loads, so re-opening a
  song never cancels its own reload still in flight.
- **A load overtaken by a newer load of the same song resolves with that
  newer result** instead of rejecting (`loadFresh`/`latestLoad`). An edit's
  reload can overtake the song screen's own open of that song (the user
  re-opened it mid-edit), and a rejection there would leave the screen on a
  permanent "load failed". Overtaken by a different song, or by
  `closeIfCurrent`, it still rejects with `SupersededLoadError`.
- **No `await` between a load's final "still current?" check and its
  commit** (`decodeAndLoad`). Every yield, including the progress-label
  yields from `report()`, comes before the last `requestId` check. After it,
  `audioEngine.loadProject()` and publishing the snapshot run synchronously.
  Otherwise a song the user opened during a yield could be overwritten by
  the stale one, in the engine or in the snapshot.
- **Moves run one at a time** (`moveInFlightRef`, arrows disabled), so each
  move is computed from the order the previous one saved.
- **A track name field only rolls back a failed rename if it's still the
  field's newest attempt**, and it rolls back to the last name that actually
  saved.

## Known open issues (pre-existing, not fixed yet)

Both were noticed while fixing PR #16 and are older than it. Neither has a
test yet.

1. **A finished load can replace a song the user went back to.** Song B is
   loaded, the user starts opening song C, goes back and re-opens B before C
   finishes decoding. `openProject(B)` takes the already-loaded fast path,
   which records the choice but deliberately doesn't supersede loads (see
   above), so C's load still completes and replaces B. B's screen then shows
   a load error. A fix has to cancel loads of _other_ projects without
   cancelling a reload of the same project, because that reload may carry an
   edit.
2. **Backing out of a new song mid-import probably deletes its folder.** This
   is from reading the code, not reproduced. `discardIfEmptyDraft()` deletes
   a filesystem project with no tracks when the user leaves it, and the Back
   button stays active during an import. During a brand-new song's first
   import, `entry.tracks` is still empty until the copy finishes, so Back
   mid-copy would delete the folder `addStemsToProject` is copying into,
   and drop the project from Redux. Likely fixes: don't discard while an
   edit is in flight, or disable Back during a draft's first import.

# Desktop app (`desktop/`)

The desktop build is this app, rendered with react-native-web inside a Tauri
2 window. Its audio runs in a Rust engine (`desktop/src-tauri/src/engine/`),
outside the webview. See `desktop/README.md` for the full picture. What matters
when working in `src/`:

- `metro.config.js` swaps a few modules **for web bundles only**:
  `expo-file-system`, `expo-document-picker`, `expo-sharing`,
  `react-native-audio-api`, plus `src/engine/AudioEngine.ts`,
  `src/engine/waveform.ts` and `src/platform/desktop.tsx`. Their desktop
  versions live in `desktop/web/`. Changing the public API of one of the
  swapped `src/` modules means updating its desktop version too. Code in
  `src/` that needs decoded samples in JS (`getChannelData`) won't work on
  desktop.
- Imports made **from** `desktop/web/` are never redirected (so the desktop
  waveform module can build on the mobile one). Inside `desktop/web/`, always
  import the desktop shims by relative path, never `expo-file-system` and the
  like by package name, or you get the real phone module.
- `src/platform/desktop.tsx` holds desktop-only UI slots that render nothing
  on the phone. Put desktop-only UI there, not in shared screens.
- `desktop/src-tauri/src/project.rs` mirrors `src/types/project.ts`; keep the
  two in step.

Everything above about stability and sample-locked stems applies there too,
with Rust equivalents:

- `Mixer::process` (`engine/mixer.rs`) runs on the audio device's thread. It
  must never allocate, free, lock, log or do I/O. Send state in through
  `Command` and status out through `SharedStatus` atomics. Anything that needs
  freeing goes back through the `Garbage` queue.
- There is one playhead (`Mixer::position`) and every voice reads from it in
  the same callback. Never give a voice its own start offset or clock, and
  never add or remove a single voice from a playing `Program`. Replace the
  whole program with `Command::Load`. Every stem in a program must be decoded
  at the device's rate (`LoadedProject::assemble`/`redecoded`).
- Volume, mute, solo, bus and routing changes are only gain ramps or route
  swaps, so they can never move the playhead.
- A mixer panic is caught in the audio callback (silence plus banner) rather
  than aborting. Keep release builds on `panic = "unwind"` so this works, and
  keep Tauri commands `async`, so they stay off the main thread.
- The desktop `AudioEngine` sends commands through one serial queue, and only
  adopts polled engine state once `pendingCommands === 0`. Don't bypass the
  queue, and don't treat a poll as authoritative while commands are in flight.
- After touching the engine or the desktop layer, run `npm test` and
  `npm run selftest` in `desktop/` (the self-test drives the real app end to
  end). Use `cargo run --example engine_smoke` to check on a real device.
- Rust crates follow the dependency rule above: well-established crates only,
  and only what is actually wired up.
