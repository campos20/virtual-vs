/** Typed wrappers for the desktop-only Rust commands (devices, routing). */
import { invoke, listen } from "../tauri";
import type { ActiveOutput } from "../engine/status";

export type OutputTarget =
  | { kind: "mono"; channel: number }
  | { kind: "stereo"; left: number; right: number };

export interface ResolvedRoute {
  targets: OutputTarget[];
  source: "song" | "name" | "default";
}

export interface DeviceInfo {
  id: string;
  name: string;
  maxChannels: number;
  defaultSampleRate: number;
  isDefault: boolean;
}

export interface Settings {
  deviceId: string | null;
  bufferFrames: number | null;
  output: ActiveOutput | null;
  outputNames: string[];
}

export interface Routing {
  channels: number;
  outputNames: string[];
  projectId: string | null;
  tracks: { id: string; name: string; route: ResolvedRoute }[];
  click: ResolvedRoute | null;
}

export const api = {
  listDevices: () => invoke<DeviceInfo[]>("list_devices"),
  getSettings: () => invoke<Settings>("get_settings"),
  selectDevice: (deviceId: string | null, bufferFrames: number | null) =>
    invoke<Settings>("select_device", { deviceId, bufferFrames }),
  setOutputName: (channel: number, name: string) =>
    invoke<Settings>("set_output_name", { channel, name }),
  getRouting: () => invoke<Routing>("get_routing"),
  setTrackRouting: (
    trackId: string,
    scope: "allSongs" | "thisSong",
    targets: OutputTarget[] | null,
  ) => invoke<Routing>("set_track_routing", { trackId, scope, targets }),
  setClickRouting: (targets: OutputTarget[] | null) =>
    invoke<Routing>("set_click_routing", { targets }),
};

export function onDeviceChanged(handler: (settings: Settings) => void) {
  return listen<Settings>("device-changed", handler);
}

export function onDevicesChanged(
  handler: (change: { devices: DeviceInfo[]; added: string[] }) => void,
) {
  return listen<{ devices: DeviceInfo[]; added: string[] }>(
    "devices-changed",
    handler,
  );
}

export function targetFits(target: OutputTarget, channels: number): boolean {
  return target.kind === "mono"
    ? target.channel < channels
    : target.left < channels && target.right < channels;
}

export function sameTarget(a: OutputTarget, b: OutputTarget): boolean {
  if (a.kind === "mono" && b.kind === "mono") return a.channel === b.channel;
  if (a.kind === "stereo" && b.kind === "stereo") {
    return a.left === b.left && a.right === b.right;
  }
  return false;
}

export function describeTargets(targets: OutputTarget[]): string {
  if (targets.length === 0) return "—";
  return targets
    .map((t) =>
      t.kind === "mono" ? `${t.channel + 1}` : `${t.left + 1}-${t.right + 1}`,
    )
    .join(", ");
}
