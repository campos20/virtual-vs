import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColors, type ThemeColors } from "@/ui/theme";

interface SongListIconProps {
  /** Overrides the default `colors.textPrimary` fill - needed when this icon sits on an active/accent-colored segment and would otherwise lose contrast. */
  color?: string;
}

/** Three bullet-and-line rows, like a track listing - see HamburgerIcon/MarkerIcon for the same convention (no icon font/library). Bulleted rather than HamburgerIcon's plain equal bars so the two read as different actions, not a width tweak of the same glyph. */
export function SongListIcon({ color }: SongListIconProps = {}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors, color), [colors, color]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.bullet} />
        <View style={styles.line} />
      </View>
      <View style={styles.row}>
        <View style={styles.bullet} />
        <View style={styles.line} />
      </View>
      <View style={styles.row}>
        <View style={styles.bullet} />
        <View style={styles.line} />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors, color?: string) {
  const fill = color ?? colors.textPrimary;
  return StyleSheet.create({
    container: {
      width: 18,
      height: 16,
      justifyContent: "space-between",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
    },
    bullet: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: fill,
    },
    line: {
      flex: 1,
      height: 2,
      borderRadius: 1,
      backgroundColor: fill,
    },
  });
}
