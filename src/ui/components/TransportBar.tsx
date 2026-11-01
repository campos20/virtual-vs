import { useTranslation } from "@/i18n";
import {
  lcd,
  monoFont,
  radii,
  useThemeColors,
  type ThemeColors,
} from "@/ui/theme";
import { formatBarsBeats, formatTime } from "@/ui/transportFormat";
import { useCallback, useMemo, useRef } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

interface TransportBarProps {
  isPlaying: boolean;
  playheadSec: number;
  durationSec: number;
  /** Shows a bar.beat counter and the tempo when set - same grid as the click. */
  bpm?: number;
  /** The song's key, shown beside the tempo. */
  songKey?: string;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
}

/**
 * A DAW-style control bar: a timeline to scrub, square stop/play buttons,
 * and an LCD counter. The scrub timeline and the LCD are fixed dark
 * surfaces in both themes (see `lcd` in theme.ts) - anything drawn on them
 * uses `lcd.*`, never the theme's text/accent colors, which are tuned for a
 * light surface in light mode and went near-invisible here before.
 *
 * Every control keeps static children: press feedback goes through `style`
 * only, and the play/pause icon swap is driven by `isPlaying`, never by
 * press state (see AGENTS.md on function-as-child Pressables).
 */
export function TransportBar({
  isPlaying,
  playheadSec,
  durationSec,
  bpm,
  songKey,
  onPlayPause,
  onStop,
  onSeek,
}: TransportBarProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const widthRef = useRef(0);

  function handleLayout(event: LayoutChangeEvent) {
    widthRef.current = event.nativeEvent.layout.width;
  }

  const seekFromLocationX = useCallback(
    (x: number) => {
      const width = widthRef.current;
      if (width <= 0 || durationSec <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / width));
      onSeek(ratio * durationSec);
    },
    [durationSec, onSeek],
  );

  /* eslint-disable react-hooks/refs -- these callbacks run on later native
     touch events, never during render, so reading widthRef (via
     seekFromLocationX) is safe here. */
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) =>
      seekFromLocationX(event.nativeEvent.locationX),
    onPanResponderMove: (event) =>
      seekFromLocationX(event.nativeEvent.locationX),
  });
  /* eslint-enable react-hooks/refs */

  const progressPercent =
    `${Math.max(0, Math.min(1, playheadSec / Math.max(durationSec, 1))) * 100}%` as const;
  const tempo = bpm !== undefined && bpm > 0 ? bpm : null;

  return (
    <View style={styles.container}>
      {/* The touch area is taller than the line drawn inside it, and every
          child ignores touches, so `locationX` is always measured against
          this full-width view - never against the head or the fill. */}
      <View
        style={styles.scrubHitArea}
        onLayout={handleLayout}
        testID="scrub-track"
        {...panResponder.panHandlers}
      >
        <View style={styles.scrubTrack} pointerEvents="none">
          <View style={[styles.scrubFill, { width: progressPercent }]} />
        </View>
        <View
          style={[styles.scrubHead, { left: progressPercent }]}
          pointerEvents="none"
        />
      </View>

      <View style={styles.row}>
        <Pressable
          onPress={onStop}
          style={({ pressed }) => [
            styles.transportButton,
            pressed && styles.pressed,
          ]}
          hitSlop={6}
          testID="stop-button"
          accessibilityLabel={t.transport.stop}
        >
          <View style={styles.stopIcon} />
        </Pressable>

        <Pressable
          onPress={onPlayPause}
          style={({ pressed }) => [
            styles.transportButton,
            isPlaying && styles.playButtonActive,
            pressed && styles.pressed,
          ]}
          hitSlop={6}
          testID="play-pause-button"
          accessibilityLabel={isPlaying ? t.transport.pause : t.transport.play}
        >
          {isPlaying ? (
            <View style={styles.pauseIcon} testID="pause-icon">
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playTriangle} testID="play-icon" />
          )}
        </Pressable>

        <View style={styles.lcd}>
          <View style={styles.lcdCell}>
            <Text style={styles.lcdMain} numberOfLines={1}>
              {formatTime(playheadSec)}
            </Text>
            <Text style={styles.lcdSub} numberOfLines={1}>
              / {formatTime(durationSec)}
            </Text>
          </View>
          {tempo !== null && (
            <>
              <View style={styles.lcdDivider} />
              <View style={styles.lcdCell}>
                <Text style={styles.lcdMain} numberOfLines={1}>
                  {formatBarsBeats(playheadSec, tempo)}
                </Text>
                <Text style={styles.lcdSub} numberOfLines={1}>
                  {t.transport.bar}
                </Text>
              </View>
            </>
          )}
          <View style={styles.lcdDivider} />
          <View style={[styles.lcdCell, styles.lcdCellInfo]}>
            <Text style={styles.lcdInfo} numberOfLines={1}>
              {tempo !== null ? `${tempo} ${t.transport.bpm}` : "—"}
            </Text>
            <Text style={styles.lcdSub} numberOfLines={1}>
              {songKey || "—"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      paddingTop: 4,
      paddingBottom: 12,
      paddingHorizontal: 12,
      gap: 8,
    },
    scrubHitArea: {
      height: 24,
      justifyContent: "center",
    },
    scrubTrack: {
      height: 6,
      borderRadius: 1,
      backgroundColor: lcd.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: lcd.border,
      overflow: "hidden",
    },
    scrubFill: {
      height: "100%",
      backgroundColor: lcd.accent,
    },
    scrubHead: {
      position: "absolute",
      top: 2,
      bottom: 2,
      width: 3,
      marginLeft: -1.5,
      borderRadius: 1,
      backgroundColor: "#ffffff",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.6)",
    },
    row: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: 6,
    },
    transportButton: {
      width: 52,
      minHeight: 52,
      borderRadius: radii.md,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderTopColor: colors.bevelLight,
      borderBottomColor: colors.bevelDark,
    },
    playButtonActive: {
      backgroundColor: colors.play,
      borderColor: colors.play,
    },
    pressed: {
      opacity: 0.7,
    },
    stopIcon: {
      width: 16,
      height: 16,
      borderRadius: 1,
      backgroundColor: colors.textPrimary,
    },
    playTriangle: {
      width: 0,
      height: 0,
      marginLeft: 4,
      borderTopWidth: 10,
      borderBottomWidth: 10,
      borderLeftWidth: 16,
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
      borderLeftColor: colors.play,
    },
    pauseIcon: {
      flexDirection: "row",
      gap: 5,
    },
    pauseBar: {
      width: 5,
      height: 18,
      borderRadius: 1,
      // Dark in dark mode on bright green, light in light mode on deep green.
      backgroundColor: colors.background,
    },
    lcd: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: lcd.background,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: lcd.border,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    lcdCell: {
      justifyContent: "center",
    },
    lcdCellInfo: {
      flex: 1,
      alignItems: "flex-end",
    },
    lcdDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: lcd.textFaint,
      marginHorizontal: 10,
    },
    lcdMain: {
      color: lcd.text,
      fontFamily: monoFont,
      fontVariant: ["tabular-nums"],
      fontSize: 18,
      fontWeight: "600",
    },
    lcdSub: {
      color: lcd.textDim,
      fontFamily: monoFont,
      fontVariant: ["tabular-nums"],
      fontSize: 10,
      marginTop: 1,
    },
    lcdInfo: {
      color: lcd.text,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "600",
    },
  });
}
