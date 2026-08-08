# Virtual VS

An open-source multitrack backing-track player for live musicians - a phone
replacing the laptop + audio interface + DAW rig (a "VS"/Playback-style
setup). Load a project of audio stems and it plays them all sample-locked,
with per-stem volume/mute/solo/bus routing and a click. Everything is local;
there is no backend.

Built with [Expo](https://expo.dev) (SDK 57) and
[`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api),
Software Mansion's native Web Audio API implementation for React Native.

## The name

**VS** stands for *Virtual Sound*: the multitrack backing tracks sent to a
live sound system alongside the band. It fills in the parts nobody on stage
is playing - synths, pads, backing vocals - so a small band can sound like
its studio recordings, and it runs against a click so the musicians stay
locked to it.

So "Virtual VS" expands to "Virtual *Virtual Sound*", and yes, the *virtual*
is in there twice. That's deliberate. VS has long since stopped being read as
an acronym and works as a term in its own right, the same way people say "ATM
machine" or "PIN number" - and the extra *virtual* earns its place here,
because this project virtualizes the VS rig itself: the laptop, the
interface, and the DAW all collapse into the phone already in your pocket.

## Architecture

```
engine/     One shared AudioContext + transport + per-track/bus node graph
store/      Redux Toolkit - committed mixer state, library, setlists, settings
storage/    Loads a project's manifest.json and decodes its stems
ui/         Library and Player screens
setlist/    Stub - multi-song controller, preload-next, pad crossfade (TODO)
control/    Stub - BLE-MIDI footswitch (TODO)
```

### Audio engine (`engine/AudioEngine.ts`)

The whole app shares **one `AudioContext`** - one sample clock - held by a
single `AudioEngine` instance (`engine/index.ts`'s `audioEngine`). Sync
across stems comes from scheduling every track's `AudioBufferSourceNode` to
`start()` at the *same* future `context.currentTime` (a small lookahead),
not from any per-track timer.

Signal graph per stem:

```
BufferSource -> trackGain -> {cue and/or main bus gain} -> bus panner -> destination
```

There are two buses, `cue` and `main`; a track routes to one, the other, or
both. This library's Web Audio surface has no `ChannelMergerNode`, so the
hard cue(L)/main(R) split for a TRS Y-split cable is done with a
`StereoPannerNode` per bus instead (`pan = -1` / `pan = +1`) - "monitor"
mode centers both panners (`pan = 0`) so cue and main sum to both output
channels for rehearsing on normal headphones.

- **Volume** = the per-track `trackGain` node's gain.
- **Mute** = ramp that gain to 0; unmuting just re-reads the still-remembered
  committed volume, so there's no separate "last volume" bookkeeping.
- **Solo** = every non-soloed track is treated as effectively muted.
- **Click**: if a project has no click stem, one is rendered once as a full
  project-length `AudioBuffer` from `bpm` (`engine/clickTrack.ts`) and played
  back through the exact same scheduling path as any other stem, routed
  cue-only - so it's sample-locked by construction, with no separate
  per-beat scheduling logic to keep in sync.
- **Transport**: Web Audio buffer sources are one-shot and can't be
  restarted, so pause/resume works by stopping every source and recreating +
  rescheduling them at the correct offset. The playhead is computed as
  `context.currentTime - scheduledAtContextTime + playheadOffsetSec` and is
  **never stored in Redux** - see `hooks/usePlayhead.ts`, which polls the
  engine via `requestAnimationFrame` instead. Reaching the end of the
  longest stem is detected via that source's native `onEnded` event, not by
  polling the playhead against a duration in a React effect.

### State (`store/`)

Redux Toolkit slices, normalized with `createEntityAdapter` where the data
is a collection (projects, setlists, committed per-track mixer state, pedal
mappings). There's no backend, so no RTK Query.

What's **in** the store: the project library, setlists, app settings, pedal
mappings, and each track's *committed* volume/mute/solo/bus routing
(`tracksSlice.ts`, keyed by `${projectId}:${trackId}`).

What's **not** in the store: the live playhead (see above) and in-progress
fader drags. `ui/components/Fader.tsx` calls the engine directly on every
touch move and only dispatches to the store once, on release - dispatching
a fader's value on every frame would cause a re-render storm and bloat
devtools.

### Storage (`storage/`)

`ProjectSource` is a small abstraction over "where a project's manifest and
stems came from" - a bundled demo project resolves its stems to `require()`
asset module ids (`storage/demoProject.ts`); a filesystem project (imported
by the user - see the `storage/importProject.ts` stub) resolves them to
`file://` URIs via `expo-file-system`'s v57 `File`/`Directory` API. Either
way, `storage/projectLoader.ts`'s `decodeProjectAudio()` runs every stem
through the engine's `AudioContext.decodeAudioData()` once, up front.

### Data model

```jsonc
// manifest.json
{
  "id": "…", "title": "…", "bpm": 120, "key": "…", "countInBars": 1,
  "tracks": [{ "id": "…", "name": "…", "file": "…", "gain": 0.85, "bus": "main|cue|both" }],
  "sections": [{ "name": "…", "startSec": 0 }],
  "pad": { "file": "…", "loop": true, "bus": "cue|main|both" } // optional
}
```

```jsonc
// setlist.json
{ "name": "…", "songs": ["projectId", "…"], "advance": "manual|auto", "padBetween": true }
```

See `src/types/project.ts` and `src/types/setlist.ts`.

### What's stubbed

- **`setlist/`** - the multi-song controller, preload-next, and pad
  crossfade described in the spec aren't implemented. The data model and
  Redux slice already exist so the rest of the app has something stable to
  build against. See `src/setlist/README.md` for the concrete TODOs.
- **`control/`** - BLE-MIDI footswitch support. `react-native-ble-plx` is
  intentionally not installed yet; `src/control/README.md` has the exact
  install + Expo config-plugin steps, including the BLE-MIDI GATT
  service/characteristic UUIDs, so adding it later is a known quantity
  rather than a research project.
- **Zip project import/export** - `storage/importProject.ts` is a stub
  with the exact steps (pick a `.zip` via `expo-document-picker`, extract
  into the app's document directory, validate against `ProjectManifest`).

## Demo project

A bundled demo project (`assets/demo/`) ships with the app so there's
something to open on first launch without any file import: three
procedurally-generated test-tone WAV stems at different pitches (bass, keys,
and a guide vocal routed cue-only) plus a `manifest.json`, all pulsing on
the beat grid so sample-lock sync is audible. Regenerate them with:

```bash
node scripts/generate-demo-assets.js
```

(The stems themselves are checked in; you don't need to regenerate them to
run the app - this is only for tweaking the tones/tempo/duration.)

## Running the app

This needs an **Expo development build** - `react-native-audio-api` is a
native module, so **Expo Go will not work**. `npx expo start` on its own is
also not enough; build a dev client at least once per platform:

```bash
npm install

# iOS (needs Xcode + a simulator or a device)
npx expo run:ios

# Android (needs Android Studio + an emulator or a device)
npx expo run:android
```

After the first native build, `npx expo start` (or the `ios`/`android` npm
scripts) reconnects to the same dev client for fast JS-only reloads - you
only need to re-run `expo run:*` when native config (e.g. `app.json`
plugins) or a native dependency changes.

On launch, the Library screen seeds itself with the bundled demo project;
tap it to open the Player, hit Play, and all three stems (plus the
generated click, audible if you route a track to `cue` and are on a
split/monitor setup) should play back perfectly in sync. Try dragging a
fader, muting/soloing a track, changing its bus routing, and toggling
monitor/split.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

Contributions are accepted under the [Developer Certificate of
Origin](https://developercertificate.org/) rather than a separate CLA - see
[CONTRIBUTING.md](./CONTRIBUTING.md).
