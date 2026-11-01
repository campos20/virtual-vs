# Virtual VS for desktop

The desktop build of Virtual VS is **the mobile app itself**, with the same
screens, features and project format, running in a desktop window. It adds the
one thing a computer can do that a phone can't: sending each stem to any
output of a multichannel audio interface.

- **UI:** the app in `src/`, rendered with react-native-web inside a
  [Tauri 2](https://tauri.app) window.
- **Audio:** a Rust engine ([cpal](https://crates.io/crates/cpal)) running on
  the audio device's own thread, outside the webview. If the UI freezes,
  errors or reloads, playback carries on.

## Running

Requires Rust (stable) and Node. Install the app's dependencies at the repo
root (`npm install`) and the Tauri CLI here:

```sh
cd desktop
npm install          # Tauri CLI only (dev dependency)
npm run dev          # Expo dev server + app window, with hot reload
npm test             # Rust unit tests
npm run selftest     # end-to-end self-test in the real app (see below)
npm run build        # release .app / .dmg / installer
```

`npm run dev` starts the Expo dev server for the web build (`desktop:serve`
in the root `package.json`). `npm run build` exports it (`desktop:export`,
into `dist/`) and packages it with the engine.

## How it fits together

```
src/                     the mobile app (unchanged screens, stores, storage)
src/platform/desktop.tsx desktop-only UI slots - render nothing on the phone
metro.config.js          for web bundles only, swaps phone-only modules:
                           expo-file-system      -> desktop/web/shims
                           expo-document-picker  -> desktop/web/shims
                           expo-sharing          -> desktop/web/shims
                           react-native-audio-api-> desktop/web/shims
                           src/engine/AudioEngine.ts, waveform.ts,
                           src/platform/desktop.tsx -> desktop/web/...
desktop/web/             the desktop versions of those modules
  engine/AudioEngine.ts  same API as mobile; every call -> Rust command
  shims/                 file system, file picker, "share" (Save as…), audio
  ui/                    audio-interface settings, routing matrix, banners
  selftest.ts            end-to-end self-test
desktop/src-tauri/       the Rust side
  src/engine/            mixer (audio thread), device, decode, click
  src/fs.rs              vvsfs:// protocol - synchronous file access
  src/routing.rs         per-track output routing
  src/commands.rs        the webview's API
```

The phone and desktop share every screen. A feature added in `src/` shows up
on desktop too, unless it touches one of the swapped modules.

**Files.** The mobile storage code expects a partly synchronous file API
(`file.exists`, `textSync()`). The desktop `expo-file-system` replacement
makes each call a synchronous request to the `vvsfs://` protocol, which reads
and writes the disk directly. There's no cache that could drift from what's
saved, and writes go through a temp file and a rename. Songs, folders and
settings sit in the app's data directory (on macOS,
`~/Library/Application Support/com.campos20.virtual-vs.desktop/documents/`),
laid out exactly as on the phone, so a `.vvs` bundle moves between the two.

**Audio.** `decodeAudioData()` decodes a stem in Rust at the output device's
rate and returns a handle: duration plus a waveform envelope, never the
samples themselves. `AudioEngine.loadProject()` then installs all the handles
at once.

## Keyboard shortcuts

The keys follow common DAW conventions (Logic, Pro Tools, Reaper,
MainStage). The same list is in the app: press **?** anywhere, or look under
**Settings → Keyboard shortcuts**.

| Key                  | What it does                                    |
| -------------------- | ----------------------------------------------- |
| Space                | Play / pause                                    |
| Return (Enter)       | Stop and return to the start                    |
| Home                 | Go to the start (keeps playing)                 |
| ← or `,`             | Back one bar (5 s without a tempo)              |
| → or `.`             | Forward one bar (5 s without a tempo)           |
| Shift + ← / →        | Back / forward four bars                        |
| Option (Alt) + ← / → | Previous / next marker                          |
| 1 – 9                | Jump to marker 1–9                              |
| ↑ / ↓                | Previous / next song (song screen, not playing) |
| X                    | Show / hide the mixer (song screen)             |
| L                    | Switch between tracks and lyrics (song screen)  |
| K                    | Click on / off (song screen)                    |
| ?                    | Show the list of shortcuts                      |

- Transport and marker keys work wherever a song is loaded, Library included.
  The others need the song screen.
- A bar step snaps to the click's bar lines (4/4 from the start of the song).
- Keys do nothing while you're typing in a text field, and anything held with
  Cmd/Ctrl is left to the system.
- A held key fires once, so holding an arrow can't fire a burst of seeks.
- Each key goes through the same handler as its button, with the same guards:
  previous/next song stays locked while playing, and every jump reschedules
  the whole song together, so the stems stay in sync.

The keys and the list both come from one table in
`desktop/web/ui/shortcuts.ts`, so they can't drift apart.

## Stage safety

- **Stems are sample-locked by construction.** One audio callback mixes every
  stem and the click from a single playhead. A song is only ever swapped in
  whole. Every stem must be decoded at the device's rate; when the device
  changes rate, the whole song is decoded again together.
- **Nothing can block the audio thread.** The mixer doesn't allocate, lock or
  do I/O. Commands arrive through a lock-free queue, and a replaced song is
  freed on another thread.
- **No crashes from a bug.**
  - A panic in the mixer is caught in the audio callback: the output goes
    silent, a red banner explains it, and reselecting the device starts a
    fresh mixer.
  - Release builds unwind instead of aborting, so that safety net works.
  - Commands run off the main thread, and the file protocol turns any failure
    into an error response.
- **The UI and the engine can't disagree unnoticed.**
  - Commands reach Rust strictly in order, so a `play()` can't overtake a
    load.
  - The UI only adopts polled engine state once the engine reports that every
    command has been applied, so a stale poll can never fake a pause or the
    end of a song.
  - A banner offers Stop if the engine is playing a song the UI doesn't know
    about (e.g. after a window reload). A reload always returns to the Library.
- **Device problems are loud.**
  - A red banner shows on driver errors, on a stalled stream (no callbacks for
    1.5 s) and when the engine stops answering.
  - The saved interface reconnects on its own when it comes back, but only
    while stopped, never under a playing song.
  - Newly plugged interfaces are offered with a "Use it" button.
- **No pops.** Pause, stop, seek and resume use a 5 ms fade, and gain changes
  use the mobile app's 15 ms ramp.

## Routing

Settings → Audio interface → **Routing** opens a matrix with one row per
track (plus the click) and one column per output of the interface. A track can
go to several outputs, as mono outputs (L+R at -6 dB) or stereo pairs.

- **Routes follow the track name across songs.** Route "Drums" once and every
  song with a Drums track uses it. "This song only" pins a route to one song.
- **Routing belongs to the computer**, not the song. It's stored in the app's
  config directory, along with output names per interface ("IEM drummer",
  "FOH bass").
- **Unrouted tracks follow the phone's layout**: cue on output 1, main on
  output 2. The phone's split/monitor switch works too: monitor sends
  everything to outputs 1-2 in stereo.
- **Routes to outputs the current device doesn't have** stay silent (never
  remapped elsewhere), and a yellow banner names the tracks this affects.

## Tests

- **`npm test`.** Rust unit tests: the mixer (sample lock through
  play/pause/seek/resume/stop, fades, natural end, routing, the
  applied-command counter), the file protocol, routing rules, decode and
  click.
- **`npm run selftest`.** Builds the app and runs `desktop/web/selftest.ts`
  inside it, against the real audio output, in a throwaway data directory,
  with silent stems. It covers:
  - creating a song and importing stems
  - markers, lyrics and folders
  - loading, play, seek, pause, resume, stop and natural end
  - routing
  - a `.vvs` export/import round trip

  It checks the engine's position and the UI playhead at each step, then
  exits 0 or 1.

- **On a real interface, without the UI.**
  `cargo run --example engine_smoke -- <project-folder> <device-id>` in
  `src-tauri/`.

## Not done yet

- **Windows and Linux are untested.** On Windows, cpal uses WASAPI, which may
  expose fewer channels than the interface's ASIO driver. ASIO needs the
  Steinberg SDK at build time.
- **Desktop-native UX.** Keyboard shortcuts (space for play/pause), wider
  layouts for big screens, and a routing button in the mixer drawer.
- **MIDI footswitch** (`midir`).
