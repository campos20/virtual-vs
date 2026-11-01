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

/** Listens for the desktop app's keyboard shortcuts, app-wide. */
export function DesktopKeyboardShortcuts(): null {
  return null;
}

/** "Keyboard shortcuts" list on the Settings screen. */
export function DesktopShortcutsSettings(): null {
  return null;
}

/**
 * What the song screen offers to keyboard shortcuts on desktop. Each one
 * goes through the screen's own handler, so it gets the same guards as the
 * button it stands in for (e.g. previous/next song stays locked while
 * playing).
 */
export interface SongScreenShortcuts {
  toggleMixer: () => void;
  toggleLyrics: () => void;
  toggleClick: () => void;
  previousSong: () => void;
  nextSong: () => void;
}

/** Registers the song screen's shortcut actions while it's mounted. Does nothing on the phone. */
export function useSongScreenShortcuts(_actions: SongScreenShortcuts): void {}
