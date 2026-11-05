/**
 * Keyboard shortcuts for the desktop app (see shortcuts.ts for the keys and
 * the DAW conventions they follow), plus the two places users can see them:
 * an overlay opened with "?" from anywhere, and a section on Settings.
 *
 * Transport and marker keys work wherever a song is loaded, Library
 * included - like the mini-player, they act on whatever is playing. The
 * song screen's own keys (mixer, lyrics, click, previous/next song) call
 * that screen's handlers through `useSongScreenShortcuts`, so they get the
 * same guards as the buttons they stand in for.
 *
 * Stage-safety rules for the listener:
 * - Never while typing: a text field keeps every key.
 * - Never with Cmd/Ctrl: those are the system's and the webview's.
 * - A held key fires once. Auto-repeat would turn holding an arrow into a
 *   burst of seeks, and holding Space into play/pause/play.
 * - A key that acts is swallowed (keydown and its keyup), so Space can't
 *   also press whatever button still has focus from the last click. A key
 *   that doesn't act - no song loaded - passes through untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { nowPlayingStore } from "@/playback/nowPlayingStore";
import type { SongScreenShortcuts } from "@/platform/desktop";
import {
  monoFont,
  radii,
  spacing,
  useThemeColors,
  type ThemeColors,
} from "@/ui/theme";
import { audioEngine } from "../engine/AudioEngine";
import {
  barStepTarget,
  markerIndexTarget,
  markerStepTarget,
  matchShortcut,
  shortcutListing,
  type ShortcutGroup,
  type ShortcutMatch,
} from "./shortcuts";
import { useDesktopStrings } from "./strings";

/**
 * The song screen currently mounted, if any. A ref rather than a copy, so
 * a key always reaches the screen's latest handlers. When one song screen
 * replaces another, the outgoing one only clears this if it's still its
 * own - the incoming screen may already have registered.
 */
let songScreen: { current: SongScreenShortcuts } | null = null;

export function useSongScreenShortcuts(actions: SongScreenShortcuts): void {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });
  useEffect(() => {
    songScreen = ref;
    return () => {
      if (songScreen === ref) songScreen = null;
    };
  }, []);
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}

function isTyping(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Carries out a shortcut. Returns whether it applied, which decides whether
 * the key is swallowed. Every seek goes through `audioEngine.seek()`, which
 * reschedules the whole song together, so a jump can't desync the stems.
 */
function runShortcut(match: ShortcutMatch, toggleHelp: () => void): boolean {
  if (match.id === "help") {
    toggleHelp();
    return true;
  }

  const { manifest, durationSec } = nowPlayingStore.getSnapshot();
  if (!manifest) return false;
  const playhead = audioEngine.getPlayhead();
  const seekTo = (sec: number | null) => {
    if (sec !== null) audioEngine.seek(sec);
    return true;
  };

  switch (match.id) {
    case "playPause":
      if (audioEngine.getTransportState() === "playing") audioEngine.pause();
      // Refused while a song loads - see nowPlayingStore.canStartPlayback.
      else if (nowPlayingStore.canStartPlayback()) audioEngine.play();
      return true;
    case "stop":
      audioEngine.stop();
      return true;
    case "toStart":
      return seekTo(0);
    case "barBack":
      return seekTo(barStepTarget(playhead, durationSec, manifest.bpm, -1));
    case "barForward":
      return seekTo(barStepTarget(playhead, durationSec, manifest.bpm, 1));
    case "fourBarsBack":
      return seekTo(barStepTarget(playhead, durationSec, manifest.bpm, -4));
    case "fourBarsForward":
      return seekTo(barStepTarget(playhead, durationSec, manifest.bpm, 4));
    case "previousMarker":
      return seekTo(markerStepTarget(playhead, manifest.sections, -1));
    case "nextMarker":
      return seekTo(markerStepTarget(playhead, manifest.sections, 1));
    case "marker":
      return seekTo(markerIndexTarget(manifest.sections, match.markerIndex!));
  }

  const screen = songScreen?.current;
  if (!screen) return false;
  switch (match.id) {
    case "toggleMixer":
      screen.toggleMixer();
      break;
    case "toggleLyrics":
      screen.toggleLyrics();
      break;
    case "toggleClick":
      screen.toggleClick();
      break;
    case "previousSong":
      screen.previousSong();
      break;
    case "nextSong":
      screen.nextSong();
      break;
  }
  return true;
}

/** Rendered once, app-wide (see `_layout.tsx`): the key listener and the "?" overlay. */
export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  useEffect(() => {
    helpOpenRef.current = helpOpen;
  }, [helpOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const swallowed = new Set<string>();
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && helpOpenRef.current) {
        swallow(event);
        setHelpOpen(false);
        return;
      }
      if (isTyping()) return;
      const match = matchShortcut(event);
      if (!match) return;
      if (event.repeat) {
        if (swallowed.has(event.key)) swallow(event);
        return;
      }
      if (runShortcut(match, () => setHelpOpen((open) => !open))) {
        swallowed.add(event.key);
        swallow(event);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (swallowed.delete(event.key)) swallow(event);
    };

    // Capture phase, so this runs before a focused button's own key
    // handling and can stop it.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  return (
    <ShortcutsOverlay visible={helpOpen} onClose={() => setHelpOpen(false)} />
  );
}

function ShortcutsOverlay({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="shortcuts-overlay-backdrop"
      />
      <View style={styles.overlayCenter} pointerEvents="box-none">
        <View style={styles.overlayCard}>
          <View style={styles.overlayHeader}>
            <Text style={styles.overlayTitle}>{s.shortcutsTitle}</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              testID="shortcuts-overlay-close"
            >
              <Text style={styles.closeText}>{s.close}</Text>
            </Pressable>
          </View>
          <ScrollView>
            <ShortcutsList />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const GROUP_ORDER: ShortcutGroup[] = ["transport", "markers", "song", "help"];

/** The full list, grouped. Generated from shortcuts.ts, the same table the listener matches. */
function ShortcutsList() {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listing = useMemo(() => shortcutListing(isMac()), []);

  return (
    <View style={styles.list}>
      {GROUP_ORDER.map((group) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupTitle}>{s.shortcutGroups[group]}</Text>
          {listing
            .filter((item) => item.group === group)
            .map((item) => (
              <View key={item.id} style={styles.row}>
                <Text style={styles.description}>{s.shortcuts[item.id]}</Text>
                <View style={styles.keys}>
                  {item.keys.map((combo, comboIndex) => (
                    <View key={comboIndex} style={styles.combo}>
                      {comboIndex > 0 && <Text style={styles.or}>{s.or}</Text>}
                      {combo.map((part) => (
                        <Text key={part} style={styles.keycap}>
                          {part}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

/** Settings screen section: the same list, always one tap away. */
export function ShortcutsSettings() {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{s.shortcutsHeading}</Text>
      <Text style={styles.hint}>{s.shortcutsHint}</Text>
      <View style={styles.card}>
        <ShortcutsList />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: spacing.sm },
    heading: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 1,
    },
    hint: { color: colors.textSecondary, fontSize: 13 },
    card: {
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    list: { gap: spacing.md },
    group: { gap: 2 },
    groupTitle: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      paddingVertical: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: 5,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    description: { color: colors.textPrimary, fontSize: 14, flex: 1 },
    keys: { flexDirection: "row", alignItems: "center", gap: 6 },
    combo: { flexDirection: "row", alignItems: "center", gap: 4 },
    or: { color: colors.textTertiary, fontSize: 12 },
    keycap: {
      minWidth: 26,
      textAlign: "center",
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radii.sm,
      backgroundColor: colors.panelRaised,
      borderWidth: 1,
      borderColor: colors.border,
      borderBottomWidth: 2,
      color: colors.textPrimary,
      fontFamily: monoFont,
      fontSize: 12,
      fontWeight: "600",
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    overlayCenter: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    overlayCard: {
      width: "100%",
      maxWidth: 560,
      maxHeight: "90%",
      borderRadius: radii.xl,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    overlayHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    overlayTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: "700",
    },
    closeButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.md,
      backgroundColor: colors.surface,
    },
    closeText: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
    pressed: { opacity: 0.7 },
  });
}
