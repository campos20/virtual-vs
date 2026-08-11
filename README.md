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

**VS** stands for _Virtual Sound_: the multitrack backing tracks a band plays
alongside live. It fills in the parts nobody on stage is playing - synths,
pads, backing vocals - so a small band can sound like its studio recordings.
The click is what holds it together: the band plays to the metronome so it
stays locked to whatever the VS is playing.

This app is a VS. Not a companion to one, not a way to prepare tracks for one

- the thing itself, running on a phone instead of the usual laptop + audio
  interface + DAW rig.

The name repeats itself: "Virtual VS" unpacks to "Virtual _Virtual Sound_".
That's known. VS stopped being read as an acronym a long time ago and works as
a term on its own, the way people say "ATM machine" or "PIN number".

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
`start()` at the _same_ future `context.currentTime` (a small lookahead),
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
mappings, and each track's _committed_ volume/mute/solo/bus routing
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
  "id": "…",
  "title": "…",
  "bpm": 120,
  "key": "…",
  "countInBars": 1,
  "tracks": [
    {
      "id": "…",
      "name": "…",
      "file": "…",
      "gain": 0.85,
      "bus": "main|cue|both",
    },
  ],
  "sections": [{ "name": "…", "startSec": 0 }],
  "pad": { "file": "…", "loop": true, "bus": "cue|main|both" }, // optional
}
```

```jsonc
// setlist.json
{
  "name": "…",
  "songs": ["projectId", "…"],
  "advance": "manual|auto",
  "padBetween": true,
}
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

## Building a release APK (Android)

There's no EAS Build config in this project (no `eas.json`) - releases are
built locally with the same native Android toolchain `expo run:android` uses
under the hood.

```bash
npx expo run:android --variant release
```

This prebuilds `android/` if it doesn't already exist (see [Running the
app](#running-the-app) - that folder is gitignored and regenerated on
demand, not committed), then builds and installs onto whatever
device/emulator you pick. The APK lands at
`android/app/build/outputs/apk/release/app-release.apk` either way - grab it
from there to hand out separately, or skip the install step entirely with
`cd android && ./gradlew assembleRelease`.

Release builds currently sign with the same debug keystore as debug builds
(`signingConfigs.debug` in `android/app/build.gradle`, stock from `expo
prebuild`) - fine for installing on your own devices, but **do not** ship
that APK to the Play Store. Generate a real release keystore first; see
[Signed APK (Android)](https://reactnative.dev/docs/signed-apk-android#generating-an-upload-key).

## Building for iOS

Same story - no EAS, no App Store Connect config here, just the local Xcode
toolchain `expo run:ios` drives:

```bash
npx expo run:ios --configuration Release --device
```

`--device` on its own prompts you to pick a connected/paired device; pass a
name to target one directly. This needs Xcode with an Apple ID signed in
(Xcode > Settings > Accounts) and that account set as the Team - with
"Automatically manage signing" checked - on the `virtualvs` target's Signing
& Capabilities tab, in `ios/virtualvs.xcworkspace` (also gitignored/
regenerated by prebuild, like `android/`).

There's no App Store distribution path here since this project has no paid
Apple Developer Program membership wired up - the section below covers
on-device installs, which work with a free Apple ID.

## Testing on a personal device

### Android

1. On the phone: Settings > About phone, tap "Build number" 7 times to
   unlock Developer options, then Settings > Developer options > enable USB
   debugging.
2. Plug in via USB (or `adb connect <ip>` over the same network) and accept
   the "Allow USB debugging?" prompt on the phone.
3. `npx expo run:android --device` - builds a debug dev-client and installs
   and launches it directly on the phone, same flow as targeting an
   emulator.
   - To install the release APK from above instead:
     `adb install -r android/app/build/outputs/apk/release/app-release.apk`.
     Android will prompt to allow installs from that source the first time.

### iOS

1. Cable-connect the iPhone/iPad to the Mac (or pair it wirelessly once via
   Xcode > Window > Devices and Simulators) and tap "Trust This Computer" on
   the device if prompted.
2. In Xcode, sign in with an Apple ID (Xcode > Settings > Accounts) and set
   that Team, as above, on the `virtualvs` target in
   `ios/virtualvs.xcworkspace`.
3. `npx expo run:ios --device` - builds and installs directly on the
   selected device.

A free Apple ID works, but the resulting build's provisioning profile
expires after 7 days, after which the app stops opening on the phone until
you rebuild and reinstall from Xcode/`expo run:ios` again. A paid Apple
Developer Program membership ($99/year) removes that limit. In case you want
to sponsor the project and help me get a paid membership, let me know.
I'll set up sponsorship via GitHub Sponsors later.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

Contributions are accepted under the [Developer Certificate of
Origin](https://developercertificate.org/) rather than a separate CLA - see
[CONTRIBUTING.md](./CONTRIBUTING.md).
