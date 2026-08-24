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
  so those children are re-created in the *same frame* that the `onPress`
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
  deliberately the *only* one. It opens the OS share sheet for a local file
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
  singleton). Every stem is a sibling node in the *same* render graph, so
  there is no independent per-track clock that could drift over time -
  once two nodes are scheduled against the same context time, the audio
  hardware renders them from the same sample position onward. Drift between
  stems already loaded together is structurally impossible, not just
  unlikely, as long as they were started together in the first place.
- **`scheduleSources()` is the only place stems ever start**, and `play()`/
  the resume path/`seek()` all funnel through it. It computes exactly one
  `startAt` (context time) / `offsetSec` (position) pair and passes that
  *same* pair to every stem's `.start()` call and to the click's - never a
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
  this exists to avoid, just for only *some* of the nodes. See
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
- Stems are trusted to already be time-aligned *in their source files*
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
- Never introduce a second `AudioContext`/engine instance (e.g. one per
  track). The single shared context is *the* invariant that makes drift
  structurally impossible in the first place.
- A stem being added, removed, or replaced must always go through a full
  `loadProject()` rebuild, never a partial graph patch while the transport
  is playing.
- Run (and extend) `AudioEngine.test.ts`'s "keeps every stem sample-locked"
  suite whenever touching `scheduleSources`/`stopSources`/`play`/`pause`/
  `seek`.
