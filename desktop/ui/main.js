// Virtual VS desktop UI. Plain JS over the Rust commands in
// src-tauri/src/commands.rs - all audio state lives in the engine; this file
// only renders it and forwards user input.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog } = window.__TAURI__.dialog;

// Same palette as the mobile app's src/ui/trackColors.ts.
const TRACK_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFD166",
  "#A78BFA",
  "#60A5FA",
  "#F472B6",
  "#34D399",
  "#FB923C",
];
const FADER_MAX = 1.5;
const STATUS_POLL_MS = 50;

const $ = (id) => document.getElementById(id);

const state = {
  library: [],
  project: null,
  settings: null,
  status: null,
  devices: [],
  seeking: false,
};

// --- helpers -----------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node[key] = value;
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDb(gain) {
  if (gain <= 0.0001) return "-∞ dB";
  const db = 20 * Math.log10(gain);
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

function outputChannels() {
  return state.settings?.output?.channels ?? 2;
}

function targetToValue(targets) {
  if (!targets || targets.length === 0) return "off";
  const t = targets[0];
  return t.kind === "mono" ? `m:${t.channel}` : `s:${t.left}:${t.right}`;
}

function valueToTargets(value) {
  if (value === "off") return [];
  const [kind, a, b] = value.split(":");
  return kind === "m"
    ? [{ kind: "mono", channel: Number(a) }]
    : [{ kind: "stereo", left: Number(a), right: Number(b) }];
}

function describeTargets(targets) {
  if (!targets || targets.length === 0) return "Off";
  return targets
    .map((t) =>
      t.kind === "mono"
        ? `Out ${t.channel + 1}`
        : `Out ${t.left + 1}-${t.right + 1}`,
    )
    .join(" + ");
}

/** Options for every mono output and every adjacent stereo pair on the device. */
function fillOutputOptions(select, extraFirst) {
  select.replaceChildren();
  if (extraFirst)
    select.append(
      el("option", { value: extraFirst.value, text: extraFirst.label }),
    );
  select.append(el("option", { value: "off", text: "Off" }));
  const channels = outputChannels();
  const mono = el("optgroup", { label: "Mono" });
  for (let c = 0; c < channels; c++) {
    mono.append(el("option", { value: `m:${c}`, text: `Out ${c + 1}` }));
  }
  select.append(mono);
  if (channels >= 2) {
    const stereo = el("optgroup", { label: "Stereo" });
    for (let c = 0; c + 1 < channels; c += 2) {
      stereo.append(
        el("option", {
          value: `s:${c}:${c + 1}`,
          text: `Out ${c + 1}-${c + 2}`,
        }),
      );
    }
    select.append(stereo);
  }
}

function setSelectValue(select, value) {
  // A saved route can point at a channel the current device doesn't have;
  // show it rather than silently displaying something else.
  if (![...select.options].some((o) => o.value === value)) {
    select.append(
      el("option", { value, text: `${value} (not on this device)` }),
    );
  }
  select.value = value;
}

async function call(command, args) {
  try {
    return await invoke(command, args);
  } catch (error) {
    if (error !== "superseded") alert(String(error));
    throw error;
  }
}

// --- library -----------------------------------------------------------------

function renderLibrary() {
  const list = $("library-list");
  list.replaceChildren();
  $("library-empty").hidden = state.library.length > 0;

  state.library.forEach((entry, index) => {
    const active = state.project?.dir === entry.dir;
    const sub = entry.error
      ? "Missing or unreadable"
      : [
          entry.key,
          entry.bpm ? `${entry.bpm} bpm` : null,
          `${entry.trackCount} tracks`,
        ]
          .filter(Boolean)
          .join(" · ");
    const actions = el("div", { className: "row-actions" }, [
      el("button", {
        className: "icon-button small",
        title: "Move up",
        text: "▲",
        disabled: index === 0,
        onclick: (e) => {
          e.stopPropagation();
          moveLibraryEntry(entry.dir, index - 1);
        },
      }),
      el("button", {
        className: "icon-button small",
        title: "Move down",
        text: "▼",
        disabled: index === state.library.length - 1,
        onclick: (e) => {
          e.stopPropagation();
          moveLibraryEntry(entry.dir, index + 1);
        },
      }),
      el("button", {
        className: "icon-button small",
        title: "Remove from library (files are kept)",
        text: "✕",
        onclick: (e) => {
          e.stopPropagation();
          removeLibraryEntry(entry.dir);
        },
      }),
    ]);
    list.append(
      el(
        "li",
        {
          className: `library-item${active ? " active" : ""}${entry.error ? " broken" : ""}`,
          title: entry.error ?? entry.dir,
          onclick: () => !entry.error && loadProject(entry.dir),
        },
        [
          el("div", { className: "info" }, [
            el("div", {
              className: "title",
              text: entry.title ?? entry.dir.split(/[\\/]/).pop(),
            }),
            el("div", { className: "sub", text: sub }),
          ]),
          actions,
        ],
      ),
    );
  });
}

async function refreshLibrary() {
  state.library = await invoke("library_list");
  renderLibrary();
}

async function addProject() {
  const dir = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose a project folder",
  });
  if (!dir) return;
  state.library = await call("library_add", { dir });
  renderLibrary();
}

async function removeLibraryEntry(dir) {
  state.library = await call("library_remove", { dir });
  renderLibrary();
}

async function moveLibraryEntry(dir, toIndex) {
  state.library = await call("library_move", { dir, toIndex });
  renderLibrary();
}

// --- project -----------------------------------------------------------------

async function loadProject(dir) {
  // Loading replaces the current song; never do it by accident mid-song.
  if (
    state.status?.transport === "playing" &&
    state.project &&
    state.project.dir !== dir
  ) {
    if (!confirm("A song is playing. Stop it and load the new one?")) return;
  }
  $("loading-text").textContent = "Loading…";
  $("loading").hidden = false;
  try {
    state.project = await call("load_project", { dir });
    renderProject();
    renderLibrary();
  } catch {
    // Reported by call().
  } finally {
    $("loading").hidden = true;
  }
}

function renderProject() {
  const p = state.project;
  $("song-title").textContent = p ? p.title : "No song loaded";
  $("song-meta").textContent = p
    ? [
        p.key && `Key ${p.key}`,
        p.bpm && `${p.bpm} bpm`,
        formatTime(p.durationSec),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  $("seek").max = p ? String(p.durationSec) : "0";
  $("time-duration").textContent = formatTime(p?.durationSec ?? 0);

  const clickToggle = $("click-toggle");
  clickToggle.hidden = !p?.hasClick;
  clickToggle.classList.toggle("on", !!p?.clickEnabled);

  renderMarkers();
  renderMixer();
}

function renderMarkers() {
  const p = state.project;
  const container = $("markers");
  const ticks = $("marker-ticks");
  container.replaceChildren();
  ticks.replaceChildren();
  if (!p) return;
  const sections = [...p.sections].sort((a, b) => a.startSec - b.startSec);
  for (const section of sections) {
    container.append(
      el(
        "button",
        {
          className: "marker",
          dataset: { start: String(section.startSec) },
          onclick: () => invoke("seek", { sec: section.startSec }),
        },
        [
          document.createTextNode(section.name),
          el("span", {
            className: "marker-time",
            text: formatTime(section.startSec),
          }),
        ],
      ),
    );
    if (p.durationSec > 0) {
      const tick = el("span");
      tick.style.left = `${(section.startSec / p.durationSec) * 100}%`;
      ticks.append(tick);
    }
  }
}

function highlightCurrentMarker(positionSec) {
  let current = null;
  for (const button of $("markers").children) {
    if (Number(button.dataset.start) <= positionSec + 0.05) current = button;
  }
  for (const button of $("markers").children) {
    button.classList.toggle("current", button === current);
  }
}

function renderMixer() {
  const mixer = $("mixer");
  mixer.replaceChildren();
  const p = state.project;
  if (!p) return;

  p.tracks.forEach((track, index) => {
    const db = el("div", { className: "db", text: formatDb(track.volume) });

    let pending = null;
    const fader = el("input", {
      className: "fader",
      type: "range",
      min: "0",
      max: String(FADER_MAX),
      step: "0.01",
      value: String(track.volume),
      title: "Double-click to reset to 0 dB",
    });
    // Live while dragging (coalesced to one call per frame), committed to the
    // manifest on release.
    fader.addEventListener("input", () => {
      track.volume = Number(fader.value);
      db.textContent = formatDb(track.volume);
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        invoke("set_track_volume", {
          trackId: track.id,
          volume: track.volume,
          commit: false,
        });
      });
    });
    fader.addEventListener("change", () => {
      call("set_track_volume", {
        trackId: track.id,
        volume: Number(fader.value),
        commit: true,
      });
    });
    fader.addEventListener("dblclick", () => {
      fader.value = "1";
      fader.dispatchEvent(new Event("input"));
      fader.dispatchEvent(new Event("change"));
    });

    const mute = el("button", {
      className: `toggle mute${track.muted ? " on" : ""}`,
      text: "M",
      title: "Mute",
      onclick: async () => {
        track.muted = !track.muted;
        mute.classList.toggle("on", track.muted);
        await call("set_track_muted", {
          trackId: track.id,
          muted: track.muted,
        });
      },
    });
    const solo = el("button", {
      className: `toggle solo${track.soloed ? " on" : ""}`,
      text: "S",
      title: "Solo",
      onclick: async () => {
        track.soloed = !track.soloed;
        solo.classList.toggle("on", track.soloed);
        await call("set_track_soloed", {
          trackId: track.id,
          soloed: track.soloed,
        });
      },
    });

    const route = el("select", {
      title: "Output for this track on this computer",
    });
    const busTargets = track.bus === "both" ? [] : state.settings?.[track.bus];
    // Kept short - strips are narrow. The bus name is shown above the fader.
    const busLabel =
      track.bus === "both"
        ? "Bus · cue+main"
        : `Bus · ${describeTargets(busTargets)}`;
    fillOutputOptions(route, { value: "bus", label: busLabel });
    setSelectValue(
      route,
      track.routingOverride ? targetToValue(track.routingOverride) : "bus",
    );
    route.addEventListener("change", async () => {
      const targets =
        route.value === "bus" ? null : valueToTargets(route.value);
      await call("set_track_routing", {
        projectId: p.id,
        trackId: track.id,
        targets,
      });
      track.routingOverride = targets;
    });

    mixer.append(
      el("div", { className: "strip" }, [
        el("div", {
          className: "color",
          style: `background:${TRACK_COLORS[index % 8]}`,
        }),
        el("div", { className: "name", text: track.name, title: track.name }),
        el("div", { className: "bus", text: track.bus }),
        db,
        fader,
        el("div", { className: "buttons" }, [mute, solo]),
        route,
      ]),
    );
  });
}

// --- transport & status -------------------------------------------------------

function togglePlay() {
  if (!state.project) return;
  invoke(state.status?.transport === "playing" ? "pause" : "play");
}

function renderStatus(status) {
  state.status = status;
  const playing = status.transport === "playing";
  $("play").innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
  $("play").disabled = !state.project;
  $("stop").disabled = !state.project;

  if (!state.seeking) {
    $("seek").value = String(status.positionSec);
    $("time-position").textContent = formatTime(status.positionSec);
  }
  highlightCurrentMarker(status.positionSec);

  const banner = $("device-error");
  banner.hidden = !status.deviceError;
  banner.textContent = status.deviceError
    ? `Audio problem: ${status.deviceError} — open “Audio & routing” to pick a device.`
    : "";
}

async function pollStatus() {
  try {
    renderStatus(await invoke("get_status"));
  } finally {
    setTimeout(pollStatus, STATUS_POLL_MS);
  }
}

// --- settings ----------------------------------------------------------------

async function openSettings() {
  state.devices = await invoke("list_devices");
  state.settings = await invoke("get_settings");
  renderSettings();
  $("settings").hidden = false;
}

function renderSettings() {
  const s = state.settings;
  const deviceSelect = $("device-select");
  deviceSelect.replaceChildren(
    el("option", { value: "", text: "System default" }),
  );
  for (const d of state.devices) {
    deviceSelect.append(
      el("option", {
        value: d.id,
        text: `${d.name} — ${d.maxChannels} out @ ${d.defaultSampleRate} Hz`,
      }),
    );
  }
  setSelectValue(deviceSelect, s.deviceId ?? "");
  $("buffer-select").value = s.bufferFrames ? String(s.bufferFrames) : "";
  $("device-info").textContent = s.output
    ? `Open: ${s.output.name}, ${s.output.channels} outputs at ${s.output.sampleRate} Hz` +
      (s.output.bufferFrames ? `, ${s.output.bufferFrames}-frame buffer` : "")
    : "No output open.";

  for (const button of document.querySelectorAll(".segmented button")) {
    button.classList.toggle("on", button.dataset.mode === s.monitorMode);
  }
  for (const select of document.querySelectorAll("select[data-bus]")) {
    const bus = select.dataset.bus;
    const isDefault = s.routing[bus] == null;
    const defaultLabel =
      bus === "click"
        ? "Default (same as cue)"
        : `Default (${describeTargets(s[bus])})`;
    fillOutputOptions(select, { value: "default", label: defaultLabel });
    setSelectValue(
      select,
      isDefault ? "default" : targetToValue(s.routing[bus]),
    );
  }
}

async function applyDevice() {
  if (
    state.status?.transport === "playing" &&
    !confirm("Switching devices stops playback. Continue?")
  ) {
    renderSettings();
    return;
  }
  const deviceId = $("device-select").value || null;
  const bufferValue = $("buffer-select").value;
  try {
    state.settings = await call("select_device", {
      deviceId,
      bufferFrames: bufferValue ? Number(bufferValue) : null,
    });
  } catch {
    state.settings = await invoke("get_settings");
  }
  renderSettings();
  renderMixer();
}

// --- wiring ------------------------------------------------------------------

function wire() {
  $("add-project").addEventListener("click", addProject);
  $("play").addEventListener("click", togglePlay);
  $("stop").addEventListener("click", () => invoke("stop"));
  $("click-toggle").addEventListener("click", async () => {
    const p = state.project;
    if (!p) return;
    p.clickEnabled = !p.clickEnabled;
    $("click-toggle").classList.toggle("on", p.clickEnabled);
    await call("set_click_enabled", { enabled: p.clickEnabled });
  });

  const seek = $("seek");
  seek.addEventListener("input", () => {
    state.seeking = true;
    $("time-position").textContent = formatTime(Number(seek.value));
  });
  seek.addEventListener("change", async () => {
    await invoke("seek", { sec: Number(seek.value) });
    state.seeking = false;
  });

  $("open-settings").addEventListener("click", openSettings);
  $("close-settings").addEventListener(
    "click",
    () => ($("settings").hidden = true),
  );
  $("device-select").addEventListener("change", applyDevice);
  $("buffer-select").addEventListener("change", applyDevice);
  for (const button of document.querySelectorAll(".segmented button")) {
    button.addEventListener("click", async () => {
      state.settings = await call("set_monitor_mode", {
        mode: button.dataset.mode,
      });
      renderSettings();
      renderMixer();
    });
  }
  for (const select of document.querySelectorAll("select[data-bus]")) {
    select.addEventListener("change", async () => {
      const targets =
        select.value === "default" ? null : valueToTargets(select.value);
      state.settings = await call("set_bus_routing", {
        bus: select.dataset.bus,
        targets,
      });
      renderSettings();
      renderMixer();
    });
  }

  document.addEventListener("keydown", (event) => {
    // Sliders don't use Space, so it still toggles playback after touching a
    // fader; only text entry and open dropdowns keep it. preventDefault also
    // stops a focused button from treating the same Space as a click.
    const target = event.target;
    const typing =
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      (target.tagName === "INPUT" && target.type !== "range");
    if (event.code === "Space" && !typing && $("settings").hidden) {
      event.preventDefault();
      togglePlay();
    }
    if (event.code === "Escape") $("settings").hidden = true;
  });

  listen("load-progress", ({ payload }) => {
    if (payload.total > 0) {
      const name = payload.name ? ` — ${payload.name}` : "";
      $("loading-text").textContent =
        `Decoding ${payload.current}/${payload.total}${name}`;
    }
  });
}

async function init() {
  wire();
  state.settings = await invoke("get_settings");
  await refreshLibrary();
  renderProject();
  pollStatus();
}

init();
