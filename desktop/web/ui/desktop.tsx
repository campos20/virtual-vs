/**
 * Desktop version of `src/platform/desktop.tsx` (swapped in by
 * metro.config.js): fills the shared app's desktop-only slots.
 *
 * Also forwards webview errors to the app's log, so a UI problem during a
 * show can be diagnosed afterwards. A UI error never affects playback - the
 * audio runs in the Rust engine, outside the webview.
 */
import { invoke } from "../tauri";
import { engineStatus } from "../engine/status";
import { AudioSettings } from "./AudioSettings";
import { StatusBanner } from "./StatusBanner";

function forward(level: string, message: string): void {
  invoke("log_from_webview", { level, message }).catch(() => {});
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    forward("error", `${event.message} (${event.filename}:${event.lineno})`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    forward("error", `Unhandled rejection: ${String(event.reason)}`);
  });
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    forward("error", args.map(String).join(" "));
    originalError(...args);
  };
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    forward("warn", args.map(String).join(" "));
    originalWarn(...args);
  };
  // Poll from the start, so device problems show even before any song loads.
  engineStatus.start();
  // VVS_SELFTEST=1: run the end-to-end self-test once the app has mounted.
  invoke<boolean>("selftest_mode")
    .then((enabled) => {
      if (!enabled) return;
      setTimeout(() => {
        import("../selftest").then(({ runSelfTest }) => runSelfTest());
      }, 1500);
    })
    .catch(() => {});
}

export function DesktopStatusBanner() {
  return <StatusBanner />;
}

export function DesktopAudioSettings() {
  return <AudioSettings />;
}
