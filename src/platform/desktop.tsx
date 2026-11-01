/**
 * Desktop-only UI slots. On iOS/Android these render nothing. The desktop
 * build (desktop/, rendered with react-native-web inside Tauri) swaps this
 * module for desktop/web/ui/desktop.tsx via metro.config.js, which fills
 * them with the audio-interface, routing and engine-status UI.
 */

/** Top-of-app banner for audio device problems and routing warnings. */
export function DesktopStatusBanner(): null {
  return null;
}

/** "Audio interface & routing" section on the Settings screen. */
export function DesktopAudioSettings(): null {
  return null;
}
