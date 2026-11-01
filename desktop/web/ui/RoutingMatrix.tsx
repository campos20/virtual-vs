/**
 * The routing matrix: one row per track (and the click), one column per
 * output of the audio interface. Tap a cell to send that track there; a
 * track can go to several outputs, as mono outputs or stereo pairs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppSelector } from "@/store/hooks";
import { getTrackColor } from "@/ui/trackColors";
import { radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import {
  api,
  sameTarget,
  targetFits,
  type OutputTarget,
  type ResolvedRoute,
  type Routing,
} from "./api";
import { useDesktopStrings } from "./strings";

const ROW_HEIGHT = 64;
const CELL_WIDTH = 52;
const NAME_COLUMN_WIDTH = 300;

interface Row {
  key: string;
  name: string;
  color: string;
  route: ResolvedRoute;
  trackId: string | null; // null for the click
}

function rowMode(route: ResolvedRoute, override?: "mono" | "stereo") {
  return override ?? (route.targets[0]?.kind === "stereo" ? "stereo" : "mono");
}

function cellLabel(route: ResolvedRoute, channel: number): string {
  for (const t of route.targets) {
    if (t.kind === "mono" && t.channel === channel) return "●";
    if (t.kind === "stereo" && t.left === channel) return "L";
    if (t.kind === "stereo" && t.right === channel) return "R";
  }
  return "";
}

export function RoutingMatrix({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const monitorMode = useAppSelector((state) => state.settings.monitorMode);
  const [routing, setRouting] = useState<Routing | null>(null);
  const [modes, setModes] = useState<Record<string, "mono" | "stereo">>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    api
      .getRouting()
      .then((next) => {
        if (!alive) return;
        setRouting(next);
        setError(null);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [visible]);

  const rows: Row[] = useMemo(() => {
    if (!routing) return [];
    const list: Row[] = routing.tracks.map((track, index) => ({
      key: `track:${track.id}`,
      name: track.name,
      color: getTrackColor(index),
      route: track.route,
      trackId: track.id,
    }));
    if (routing.click) {
      list.push({
        key: "click",
        name: s.click,
        color: colors.textSecondary,
        route: routing.click,
        trackId: null,
      });
    }
    return list;
  }, [routing, s.click, colors.textSecondary]);

  const save = useCallback(
    async (
      row: Row,
      targets: OutputTarget[] | null,
      scope?: "allSongs" | "thisSong",
    ) => {
      try {
        const next =
          row.trackId === null
            ? await api.setClickRouting(targets)
            : await api.setTrackRouting(
                row.trackId,
                scope ??
                  (row.route.source === "song" ? "thisSong" : "allSongs"),
                targets,
              );
        setRouting(next);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const channels = routing?.channels ?? 0;

  function toggleCell(row: Row, channel: number) {
    let target: OutputTarget;
    if (rowMode(row.route, modes[row.key]) === "stereo") {
      const left = channel - (channel % 2);
      if (left + 1 >= channels) return; // trailing odd output has no pair
      target = { kind: "stereo", left, right: left + 1 };
    } else {
      target = { kind: "mono", channel };
    }
    const targets = [...row.route.targets];
    const existing = targets.findIndex((t) => sameTarget(t, target));
    if (existing >= 0) targets.splice(existing, 1);
    else targets.push(target);
    save(row, targets);
  }

  function switchMode(row: Row, mode: "mono" | "stereo") {
    setModes((m) => ({ ...m, [row.key]: mode }));
    const converted: OutputTarget[] = [];
    for (const t of row.route.targets) {
      let next: OutputTarget = t;
      if (mode === "stereo" && t.kind === "mono") {
        const left = t.channel - (t.channel % 2);
        next = { kind: "stereo", left, right: left + 1 };
      } else if (mode === "mono" && t.kind === "stereo") {
        next = { kind: "mono", channel: t.left };
      }
      if (!converted.some((c) => sameTarget(c, next))) converted.push(next);
    }
    save(row, converted);
  }

  const problems: string[] = [];
  for (const row of rows) {
    if (row.route.targets.some((t) => !targetFits(t, channels))) {
      problems.push(s.missingOutputs(row.name, channels));
    }
    if (row.route.targets.length === 0)
      problems.push(s.routedNowhere(row.name));
  }

  const columns = Array.from({ length: channels }, (_, c) => c);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>{s.routing}</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel={s.close}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {monitorMode === "monitor" ? (
            <Text style={styles.note}>{s.monitorNote}</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {rows.length === 0 ? (
            <Text style={styles.muted}>{s.loadSongFirst}</Text>
          ) : (
            <ScrollView style={styles.tableScroll}>
              <View style={styles.table}>
                <View style={{ width: NAME_COLUMN_WIDTH }}>
                  <View style={[styles.headerCell, styles.nameHeader]}>
                    <Text style={styles.headerText}>{s.track}</Text>
                  </View>
                  {rows.map((row) => {
                    const mode = rowMode(row.route, modes[row.key]);
                    const source = row.route.source;
                    return (
                      <View key={row.key} style={styles.nameCell}>
                        <View style={styles.nameLine}>
                          <View
                            style={[styles.dot, { backgroundColor: row.color }]}
                          />
                          <Text style={styles.trackName} numberOfLines={1}>
                            {row.name}
                          </Text>
                          <Text style={styles.muted}>
                            {source === "default" ? s.defaultRoute : ""}
                          </Text>
                        </View>
                        <View style={styles.controls}>
                          <Chip
                            label={s.mono}
                            on={mode === "mono"}
                            onPress={() =>
                              mode !== "mono" && switchMode(row, "mono")
                            }
                            styles={styles}
                          />
                          <Chip
                            label={s.stereo}
                            on={mode === "stereo"}
                            disabled={channels < 2}
                            onPress={() =>
                              mode !== "stereo" && switchMode(row, "stereo")
                            }
                            styles={styles}
                          />
                          {row.trackId !== null ? (
                            <Chip
                              label={
                                source === "song" ? s.thisSong : s.allSongs
                              }
                              pinned={source === "song"}
                              onPress={() =>
                                save(
                                  row,
                                  row.route.targets,
                                  source === "song" ? "allSongs" : "thisSong",
                                )
                              }
                              styles={styles}
                            />
                          ) : null}
                          <Chip
                            label={s.reset}
                            disabled={source === "default"}
                            onPress={() => {
                              setModes((m) => {
                                const next = { ...m };
                                delete next[row.key];
                                return next;
                              });
                              save(row, null, "allSongs");
                            }}
                            styles={styles}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>

                <ScrollView horizontal style={styles.grid}>
                  <View>
                    <View style={styles.row}>
                      {columns.map((c) => (
                        <View
                          key={c}
                          style={[styles.headerCell, styles.outHeader]}
                        >
                          <Text style={styles.headerText}>{c + 1}</Text>
                          <Text style={styles.outName} numberOfLines={1}>
                            {routing?.outputNames[c] || " "}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {rows.map((row) => (
                      <View key={row.key} style={styles.row}>
                        {columns.map((c) => {
                          const label = cellLabel(row.route, c);
                          return (
                            <Pressable
                              key={c}
                              accessibilityLabel={`${row.name} → ${c + 1}`}
                              onPress={() => toggleCell(row, c)}
                              style={({
                                pressed,
                                hovered,
                              }: {
                                pressed: boolean;
                                hovered?: boolean;
                              }) => [
                                styles.cell,
                                label ? styles.cellOn : null,
                                !label && (pressed || hovered)
                                  ? styles.cellHover
                                  : null,
                              ]}
                            >
                              <Text style={styles.cellText}>{label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </ScrollView>
          )}

          {problems.map((p) => (
            <Text key={p} style={styles.problem}>
              • {p}
            </Text>
          ))}
          <Text style={styles.help}>{s.routingHelp}</Text>
        </View>
      </View>
    </Modal>
  );
}

function Chip({
  label,
  on,
  pinned,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  on?: boolean;
  pinned?: boolean;
  disabled?: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        on && styles.chipOn,
        pinned && styles.chipPinned,
        disabled && styles.chipDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, pinned && styles.chipPinnedText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    panel: {
      width: "100%",
      maxWidth: 1200,
      maxHeight: "100%",
      backgroundColor: colors.panel,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: "800" },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    closeText: { color: colors.textPrimary, fontSize: 14 },
    pressed: { opacity: 0.6 },
    note: {
      color: colors.warning,
      borderWidth: 1,
      borderColor: colors.warning,
      borderRadius: radii.sm,
      padding: spacing.sm,
    },
    error: { color: colors.danger },
    muted: { color: colors.textSecondary, fontSize: 12 },
    tableScroll: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.md,
      flexGrow: 0,
    },
    table: { flexDirection: "row" },
    grid: { flex: 1 },
    row: { flexDirection: "row" },
    headerCell: {
      height: 44,
      justifyContent: "center",
      backgroundColor: colors.panelRaised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    nameHeader: { paddingHorizontal: spacing.md },
    outHeader: {
      width: CELL_WIDTH,
      alignItems: "center",
      borderLeftWidth: StyleSheet.hairlineWidth,
    },
    headerText: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
    outName: {
      color: colors.textSecondary,
      fontSize: 9,
      maxWidth: CELL_WIDTH - 4,
    },
    nameCell: {
      height: ROW_HEIGHT,
      paddingHorizontal: spacing.md,
      justifyContent: "center",
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    nameLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    trackName: { flex: 1, color: colors.textPrimary, fontWeight: "700" },
    controls: { flexDirection: "row", gap: 4 },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipPinned: { borderColor: colors.warning },
    chipDisabled: { opacity: 0.35 },
    chipText: { color: colors.textPrimary, fontSize: 11 },
    chipPinnedText: { color: colors.warning },
    cell: {
      width: CELL_WIDTH,
      height: ROW_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cellOn: { backgroundColor: colors.accent },
    cellHover: { backgroundColor: colors.panelRaised },
    cellText: { color: "#fff", fontWeight: "800" },
    problem: { color: colors.warning },
    help: { color: colors.textSecondary, fontSize: 12 },
  });
}
