# Virtual VS for desktop

The desktop build of Virtual VS: the same multitrack backing-track player, with
audio in Rust ([cpal](https://crates.io/crates/cpal)) inside a
[Tauri 2](https://tauri.app) shell, plus an output router so each track can go
to its own output on a multichannel interface.

It reads the **same project folders as the mobile app**: a folder with a
`manifest.json` and its stems. A soundchecked mix (volume, mute, solo, click)
is written back into the manifest using the same keys, so a song moves between
phone and computer unchanged.

## Running

Requires Rust (stable) and Node.

```sh
cd desktop
npm install          # Tauri CLI only (dev dependency)
npm run dev          # run the app
npm test             # Rust unit tests
npm run build        # .app / .dmg / installer
```

To check the engine on a real interface without the UI:

```sh
cd desktop/src-tauri
cargo run --example engine_smoke                         # synthesized song, default output
cargo run --example engine_smoke -- <project-folder> <device-id>
```

It lists every output device with its id, then plays, seeks, pauses, resumes
and stops while printing transport state, xruns and device errors.

## Layout

```
desktop/
  ui/                 plain HTML/CSS/JS front end (no build step, no deps)
  src-tauri/
    src/engine/
      mixer.rs        real-time mixer - runs on the audio thread
      device.rs       output device selection and the cpal stream
      decode.rs       decode (symphonia) -> fold to stereo -> resample (rubato)
      click.rs        synthesized metronome (port of engine/clickTrack.ts)
      mod.rs          control side: mute/solo, routing, transport, status
    src/routing.rs    output routing model
    src/project.rs    manifest format shared with the mobile app
    src/config.rs     per-machine settings
    src/commands.rs   the UI's API (Tauri commands)
```

## How the engine stays safe on stage

- **Stems are sample-locked by construction.** One audio callback mixes every
  stem and the click from a single playhead, so drift between stems is
  impossible. A project's voices are only ever replaced as a whole. These are
  the same invariants as the mobile engine (see the repo's `AGENTS.md`).
- **Nothing on the audio thread can block it.** `Mixer::process` doesn't
  allocate, lock or do I/O. Commands arrive through a lock-free queue, status
  goes out through atomics, and a replaced project is sent back to the control
  thread to be freed there.
- **No pops.** Pause, stop, seek and resume use a 5 ms fade. Gain changes use
  the same 15 ms ramp as mobile. The output is clamped to full scale.
- **Device problems are loud.** Driver errors and a stalled stream (no
  callbacks for 1.5 s) show a red banner. A saved device that's unplugged at
  startup falls back to the system default, so the app always comes up with
  sound if it can.
- **Loads can't collide.** Decoding runs off the audio thread while the current
  song keeps playing. If a second song is picked before the first finishes
  decoding, only the latest one is installed.
- **Project files are read-only except for the mix.** Only `gain`, `muted`,
  `soloed` and `clickEnabled` are written, through a JSON patch that keeps
  unknown fields, and an atomic rename so a crash can't truncate the manifest.

## Routing

Routing belongs to the computer, not the song, because the same song runs on
different rigs. It is saved in the app's config directory.

- **Buses.** Cue and Main each map to one output: a mono channel or a stereo
  pair. The defaults copy the phone's headphone split: cue on output 1, main on
  output 2. The click follows cue unless it has its own route.
- **Per-track overrides.** Any track can be sent to its own output (for
  example drums to output 5 for the FOH console), per project.
- **Monitor mode.** Sends everything to outputs 1-2 in stereo, for rehearsing
  on plain headphones, as on mobile.
- **Mono outputs** sum L+R at -6 dB.

## Status

This is the first stage: the engine, proven on hardware, plus a working UI.

Done:

- multitrack playback with sample-locked stems
- library of project folders
- markers, with a seek bar
- per-track volume, mute and solo
- click
- output device and buffer size selection
- bus and per-track routing
- monitor mode
- mix persisted to the manifest

Next:

- **Shared UI.** Render the mobile app's screens (react-native-web) in Tauri, so
  layout and features come straight from `src/` instead of the stand-in UI in
  `ui/`. That needs `.web.ts` versions of `src/engine` (calling these Tauri
  commands) and of `src/storage` (Tauri fs instead of `expo-file-system`).
- `.vvs` bundle import/export (reuse `src/storage/bundleFormat.ts`)
- Library folders/setlists, marker editing, lyrics view, waveforms
- MIDI footswitch (`midir`)
- Automatic recovery when an unplugged interface comes back
- Storing decoded stems as 16-bit to halve memory for very long sets
