// Virtual VS desktop UI. Plain JS over the Rust commands in
// src-tauri/src/commands.rs - all audio state lives in the engine; this file
// only renders it and forwards user input.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog, ask, message } = window.__TAURI__.dialog;

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
const CLICK_COLOR = "#9b9b9d";
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
  /** Row key -> "mono" | "stereo", for rows whose mode was switched by hand. */
  rowModes: {},
  pendingDevice: null,
};

// --- helpers -----------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") node.style.cssText = value;
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

function outputLabel(channel) {
  const name = state.settings?.outputNames?.[channel];
  return name ? `${channel + 1} ${name}` : `Out ${channel + 1}`;
}

function describeTargets(targets) {
  if (!targets || targets.length === 0) return "Off";
  const outputs = targets.map((t) =>
    t.kind === "mono" ? `${t.channel + 1}` : `${t.left + 1}-${t.right + 1}`,
  );
  return `Out ${outputs.join(", ")}`;
}

function targetFits(t, channels) {
  return t.kind === "mono"
    ? t.channel < channels
    : t.left < channels && t.right < channels;
}

function sameTarget(a, b) {
  if (a.kind !== b.kind) return false;
  return a.kind === "mono"
    ? a.channel === b.channel
    : a.left === b.left && a.right === b.right;
}

async function showError(error) {
  if (error === "superseded") return;
  await message(String(error), { title: "Virtual VS", kind: "error" });
}

async function call(command, args) {
  try {
    return await invoke(command, args);
  } catch (error) {
    await showError(error);
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
    const action = (text, title, disabled, run) =>
      el("button", {
        className: "icon-button small",
        text,
        title,
        disabled,
        onclick: (e) => {
          e.stopPropagation();
          run();
        },
      });
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
          el("div", { className: "row-actions" }, [
            action("▲", "Move up", index === 0, () =>
              moveLibraryEntry(entry.dir, index - 1),
            ),
            action("▼", "Move down", index === state.library.length - 1, () =>
              moveLibraryEntry(entry.dir, index + 1),
            ),
            action("✕", "Remove from library (files are kept)", false, () =>
              removeLibraryEntry(entry.dir),
            ),
          ]),
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
    const ok = await ask("A song is playing. Stop it and load the new one?", {
      title: "Load song",
      kind: "warning",
    });
    if (!ok) return;
  }
  $("loading-text").textContent = "Loading…";
  $("loading").hidden = false;
  try {
    setProject(await call("load_project", { dir }));
    renderLibrary();
  } catch {
    // Reported by call().
  } finally {
    $("loading").hidden = true;
  }
}

function setProject(project) {
  state.project = project;
  renderProject();
  if (!$("routing").hidden) renderRouting();
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

function routeButton(route, rowKey) {
  const channels = outputChannels();
  const missing = route.targets.some((t) => !targetFits(t, channels));
  const pinned = route.source === "song" ? " · this song" : "";
  return el("button", {
    className: `route-button${missing ? " missing" : ""}`,
    text: describeTargets(route.targets) + pinned,
    title: missing
      ? "Routed to an output this device doesn't have"
      : "Open routing",
    onclick: () => openRouting(rowKey),
  });
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

    mixer.append(
      el("div", { className: "strip" }, [
        el("div", {
          className: "color",
          style: `background:${TRACK_COLORS[index % TRACK_COLORS.length]}`,
        }),
        el("div", { className: "name", text: track.name, title: track.name }),
        el("div", { className: "bus", text: track.bus }),
        db,
        fader,
        el("div", { className: "buttons" }, [mute, solo]),
        routeButton(track.route, `track:${track.id}`),
      ]),
    );
  });
}

// --- routing matrix ----------------------------------------------------------

/** Every routable voice of the loaded song: its tracks, then the click. */
function routingRows() {
  const p = state.project;
  if (!p) return [];
  const rows = p.tracks.map((track, index) => ({
    key: `track:${track.id}`,
    name: track.name,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    route: track.route,
    isClick: false,
    trackId: track.id,
  }));
  if (p.hasClick) {
    rows.push({
      key: "click",
      name: "Click",
      color: CLICK_COLOR,
      route: p.clickRoute,
      isClick: true,
    });
  }
  return rows;
}

function rowMode(row) {
  return (
    state.rowModes[row.key] ??
    (row.route.targets[0]?.kind === "stereo" ? "stereo" : "mono")
  );
}

/** Saves a row's route. Tracks keep their current scope; the click is global. */
async function saveRoute(row, targets, scope) {
  if (row.isClick) {
    const project = await call("set_click_routing", { targets });
    if (project) setProject(project);
    return;
  }
  const effectiveScope =
    scope ?? (row.route.source === "song" ? "thisSong" : "allSongs");
  setProject(
    await call("set_track_routing", {
      trackId: row.trackId,
      scope: effectiveScope,
      targets,
    }),
  );
}

function toggleCell(row, channel) {
  const channels = outputChannels();
  const targets = [...row.route.targets];
  let target;
  if (rowMode(row) === "stereo") {
    const left = channel - (channel % 2);
    if (left + 1 >= channels) return; // no pair for a trailing odd output
    target = { kind: "stereo", left, right: left + 1 };
  } else {
    target = { kind: "mono", channel };
  }
  const existing = targets.findIndex((t) => sameTarget(t, target));
  if (existing >= 0) targets.splice(existing, 1);
  else targets.push(target);
  return saveRoute(row, targets);
}

function switchMode(row, mode) {
  state.rowModes[row.key] = mode;
  const converted = [];
  for (const t of row.route.targets) {
    const next =
      mode === "stereo"
        ? t.kind === "mono"
          ? {
              kind: "stereo",
              left: t.channel - (t.channel % 2),
              right: t.channel - (t.channel % 2) + 1,
            }
          : t
        : t.kind === "stereo"
          ? { kind: "mono", channel: t.left }
          : t;
    if (!converted.some((c) => sameTarget(c, next))) converted.push(next);
  }
  return saveRoute(row, converted);
}

function cellLabel(row, channel) {
  for (const t of row.route.targets) {
    if (t.kind === "mono" && t.channel === channel) return "●";
    if (t.kind === "stereo" && t.left === channel) return "L";
    if (t.kind === "stereo" && t.right === channel) return "R";
  }
  return "";
}

function renderRouting(highlightKey) {
  const s = state.settings;
  const channels = outputChannels();
  $("routing-device").textContent = s?.output
    ? `${s.output.name} — ${channels} output${channels === 1 ? "" : "s"}`
    : "No audio output open";
  $("routing-monitor-note").hidden = s?.monitorMode !== "monitor";

  const table = $("matrix");
  table.replaceChildren();
  const rows = routingRows();
  if (rows.length === 0) {
    table.append(
      el("tr", {}, [
        el("td", {
          className: "track-cell",
          text: "Load a song to route its tracks.",
        }),
      ]),
    );
    $("routing-problems").replaceChildren();
    return;
  }

  const head = el("tr", {}, [
    el("th", { className: "track-cell", text: "Track" }),
  ]);
  for (let c = 0; c < channels; c++) {
    const name = s?.outputNames?.[c] ?? "";
    head.append(
      el("th", { className: "out-head", title: name || `Output ${c + 1}` }, [
        el("span", { className: "num", text: String(c + 1) }),
        el("span", { className: "label", text: name || " " }),
      ]),
    );
  }
  table.append(el("thead", {}, [head]));

  const body = el("tbody");
  const problems = [];
  for (const row of rows) {
    const mode = rowMode(row);
    const source = row.route.source;
    const controls = el("div", { className: "row-controls" }, [
      el("button", {
        className: `mini${mode === "mono" ? " on" : ""}`,
        text: "Mono",
        onclick: () => mode !== "mono" && switchMode(row, "mono"),
      }),
      el("button", {
        className: `mini${mode === "stereo" ? " on" : ""}`,
        text: "Stereo",
        disabled: channels < 2,
        onclick: () => mode !== "stereo" && switchMode(row, "stereo"),
      }),
      row.isClick
        ? null
        : el("button", {
            className: `mini${source === "song" ? " pinned" : ""}`,
            text: source === "song" ? "This song only" : "All songs",
            title:
              source === "song"
                ? "Pinned to this song. Click to use it for every song with this track name."
                : "Applies to every song with a track named like this. Click to pin to this song only.",
            onclick: () =>
              saveRoute(
                row,
                row.route.targets,
                source === "song" ? "allSongs" : "thisSong",
              ),
          }),
      el("button", {
        className: "mini",
        text: "Reset",
        title: row.isClick
          ? "Back to output 1"
          : "Back to the phone layout (cue → 1, main → 2)",
        disabled: source === "default",
        onclick: () => {
          delete state.rowModes[row.key];
          saveRoute(row, null, "allSongs");
        },
      }),
    ]);

    const tr = el(
      "tr",
      { className: row.key === highlightKey ? "highlight" : "" },
      [
        el("td", { className: "track-cell" }, [
          el("div", { className: "track-line" }, [
            el("span", { className: "dot", style: `background:${row.color}` }),
            el("span", { className: "track-name", text: row.name }),
            el("span", {
              className: "muted small",
              text: source === "default" ? "default" : "",
            }),
          ]),
          controls,
        ]),
      ],
    );
    for (let c = 0; c < channels; c++) {
      const label = cellLabel(row, c);
      tr.append(
        el("td", { className: "cell" }, [
          el("button", {
            className: label ? "on" : "",
            text: label,
            title: `${row.name} → ${outputLabel(c)}`,
            onclick: () => toggleCell(row, c),
          }),
        ]),
      );
    }
    body.append(tr);

    const missing = row.route.targets.filter((t) => !targetFits(t, channels));
    if (missing.length > 0) {
      problems.push(
        `${row.name} → ${describeTargets(missing)}: this device has only ${channels} outputs, so that part is silent.`,
      );
    }
    if (row.route.targets.length === 0) {
      problems.push(`${row.name} is routed nowhere (silent).`);
    }
  }
  table.append(body);

  $("routing-problems").replaceChildren(
    ...problems.map((text) => el("li", { text })),
  );
  if (highlightKey) {
    table.querySelector("tr.highlight")?.scrollIntoView({ block: "nearest" });
  }
}

async function openRouting(highlightKey) {
  state.settings = await invoke("get_settings");
  renderRouting(highlightKey);
  $("routing").hidden = false;
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

  $("device-chip").textContent = status.output
    ? `${status.output.name} · ${status.output.channels} out`
    : "";

  const error = $("device-error");
  error.hidden = !status.deviceError;
  error.textContent = status.deviceError
    ? `Audio problem: ${status.deviceError}. It reconnects on its own when the device is back; or pick one in “Audio device”.`
    : "";

  const warning = $("routing-warning");
  const warned = status.routingWarnings ?? [];
  warning.hidden = warned.length === 0 || !!status.deviceError;
  warning.textContent = warned.length
    ? `Silent on this device (routed to outputs it doesn't have): ${warned.join(", ")}. Open Routing to fix.`
    : "";
}

async function pollStatus() {
  try {
    renderStatus(await invoke("get_status"));
  } finally {
    setTimeout(pollStatus, STATUS_POLL_MS);
  }
}

// --- audio device ------------------------------------------------------------

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
        text: `${d.name} — ${d.maxChannels} outputs @ ${d.defaultSampleRate} Hz`,
      }),
    );
  }
  if (
    s.deviceId &&
    ![...deviceSelect.options].some((o) => o.value === s.deviceId)
  ) {
    deviceSelect.append(
      el("option", { value: s.deviceId, text: "Saved device (not connected)" }),
    );
  }
  deviceSelect.value = s.deviceId ?? "";
  $("buffer-select").value = s.bufferFrames ? String(s.bufferFrames) : "";
  $("device-info").textContent = s.output
    ? `Open: ${s.output.name}, ${s.output.channels} outputs at ${s.output.sampleRate} Hz` +
      (s.output.bufferFrames ? `, ${s.output.bufferFrames}-frame buffer` : "")
    : "No output open.";

  for (const button of document.querySelectorAll(".segmented button")) {
    button.classList.toggle("on", button.dataset.mode === s.monitorMode);
  }

  const names = $("output-names");
  names.replaceChildren();
  (s.outputNames ?? []).forEach((name, channel) => {
    const input = el("input", {
      type: "text",
      value: name,
      placeholder: "Unnamed",
      maxLength: 40,
    });
    input.addEventListener("change", async () => {
      state.settings = await call("set_output_name", {
        channel,
        name: input.value,
      });
    });
    names.append(
      el("label", {}, [el("span", { text: `Out ${channel + 1}` }), input]),
    );
  });
}

async function switchDevice(deviceId, bufferFrames) {
  if (state.status?.transport === "playing") {
    const ok = await ask(
      "Switching the audio device stops playback. Continue?",
      {
        title: "Audio device",
        kind: "warning",
      },
    );
    if (!ok) return false;
  }
  try {
    state.settings = await call("select_device", { deviceId, bufferFrames });
  } catch {
    state.settings = await invoke("get_settings");
  }
  return true;
}

async function applyDeviceFromSettings() {
  const bufferValue = $("buffer-select").value;
  await switchDevice(
    $("device-select").value || null,
    bufferValue ? Number(bufferValue) : null,
  );
  state.devices = await invoke("list_devices");
  renderSettings();
}

function showDeviceToast(device) {
  state.pendingDevice = device;
  $("device-toast-text").textContent =
    `Audio interface connected: ${device.name} (${device.maxChannels} outputs)`;
  $("device-toast").hidden = false;
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

  $("open-routing").addEventListener("click", () => openRouting());
  $("close-routing").addEventListener(
    "click",
    () => ($("routing").hidden = true),
  );
  $("open-settings").addEventListener("click", openSettings);
  $("close-settings").addEventListener("click", () => {
    $("settings").hidden = true;
    renderMixer(); // output names may have changed
  });
  $("device-select").addEventListener("change", applyDeviceFromSettings);
  $("buffer-select").addEventListener("change", applyDeviceFromSettings);
  for (const button of document.querySelectorAll(".segmented button")) {
    button.addEventListener("click", async () => {
      state.settings = await call("set_monitor_mode", {
        mode: button.dataset.mode,
      });
      renderSettings();
    });
  }

  $("device-toast-dismiss").addEventListener("click", () => {
    $("device-toast").hidden = true;
  });
  $("device-toast-use").addEventListener("click", async () => {
    const device = state.pendingDevice;
    $("device-toast").hidden = true;
    if (!device) return;
    await switchDevice(device.id, state.settings?.bufferFrames ?? null);
    renderMixer();
  });

  document.addEventListener("keydown", (event) => {
    // Sliders don't use Space, so it still toggles playback after touching a
    // fader; only text entry and open dropdowns keep it. preventDefault also
    // stops a focused button from treating the same Space as a click.
    const target = event.target;
    const typing =
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      (target.tagName === "INPUT" && target.type !== "range");
    const modalOpen = !$("settings").hidden || !$("routing").hidden;
    if (event.code === "Space" && !typing && !modalOpen) {
      event.preventDefault();
      togglePlay();
    }
    if (event.code === "Escape") {
      $("settings").hidden = true;
      $("routing").hidden = true;
    }
  });

  listen("load-progress", ({ payload }) => {
    if (payload.total > 0) {
      const name = payload.name ? ` — ${payload.name}` : "";
      $("loading-text").textContent =
        `Decoding ${payload.current}/${payload.total}${name}`;
    }
  });

  // The engine switched or reconnected a device (possibly on its own).
  listen("device-changed", async ({ payload }) => {
    state.settings = payload;
    // The interface that was just offered got reconnected automatically.
    if (state.pendingDevice?.id === payload.output?.id) {
      $("device-toast").hidden = true;
    }
    const project = await invoke("get_project");
    if (project) setProject(project);
    if (!$("settings").hidden) {
      state.devices = await invoke("list_devices");
      renderSettings();
    }
    if (!$("routing").hidden) renderRouting();
  });

  listen("project-reloaded", ({ payload }) => setProject(payload));

  listen("devices-changed", ({ payload }) => {
    state.devices = payload.devices;
    if (!$("settings").hidden) renderSettings();
    const current = state.settings?.output?.id;
    const added = payload.devices.filter(
      (d) => payload.added.includes(d.id) && d.id !== current,
    );
    // Offer the interface with the most outputs - that's the one meant for
    // the stage, not a pair of headphones that just connected.
    added.sort((a, b) => b.maxChannels - a.maxChannels);
    if (added.length > 0) showDeviceToast(added[0]);
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
