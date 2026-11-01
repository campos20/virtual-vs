/**
 * Settings screen section: pick the audio interface and buffer size, open
 * the routing matrix, and name the interface's outputs.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import { audioEngine } from "../engine/AudioEngine";
import { tauri } from "../tauri";
import {
  api,
  onDeviceChanged,
  onDevicesChanged,
  type DeviceInfo,
  type Settings,
} from "./api";
import { RoutingMatrix } from "./RoutingMatrix";
import { useDesktopStrings } from "./strings";

const BUFFER_SIZES = [null, 64, 128, 256, 512, 1024] as const;

/**
 * Switching devices closes the audio stream, which stops playback - never
 * let that happen mid-song without asking.
 */
export async function confirmDeviceSwitch(message: string): Promise<boolean> {
  if (audioEngine.getTransportState() !== "playing") return true;
  return tauri().dialog.ask(message, { kind: "warning" });
}

export function AudioSettings() {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getSettings(), api.listDevices()])
      .then(([nextSettings, nextDevices]) => {
        if (!alive) return;
        setSettings(nextSettings);
        setDevices(nextDevices);
      })
      .catch((e) => alive && setError(String(e)));
    const unlisten = [
      onDeviceChanged((next) => alive && setSettings(next)),
      onDevicesChanged((change) => alive && setDevices(change.devices)),
    ];
    return () => {
      alive = false;
      for (const p of unlisten) p.then((stop) => stop()).catch(() => {});
    };
  }, []);

  async function choose(deviceId: string | null, bufferFrames: number | null) {
    if (!(await confirmDeviceSwitch(s.switchWhilePlaying))) return;
    try {
      setSettings(await api.selectDevice(deviceId, bufferFrames));
      setError(null);
    } catch (e) {
      setError(String(e));
      setSettings(await api.getSettings());
    }
  }

  async function rename(channel: number, name: string) {
    try {
      setSettings(await api.setOutputName(channel, name));
    } catch (e) {
      setError(String(e));
    }
  }

  const output = settings?.output ?? null;
  const savedMissing =
    settings?.deviceId && !devices.some((d) => d.id === settings.deviceId);

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.heading}>{s.audioInterface}</Text>
        <Text style={styles.info}>
          {output
            ? s.open(output.name, output.channels, output.sampleRate)
            : s.noOutput}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.label}>{s.outputDevice}</Text>
          <DeviceRow
            label={s.systemDefault}
            selected={!settings?.deviceId}
            onPress={() => choose(null, settings?.bufferFrames ?? null)}
            styles={styles}
          />
          {devices.map((d) => (
            <DeviceRow
              key={d.id}
              label={`${d.name} — ${s.outputs(d.maxChannels)} · ${d.defaultSampleRate} Hz`}
              selected={settings?.deviceId === d.id}
              onPress={() => choose(d.id, settings?.bufferFrames ?? null)}
              styles={styles}
            />
          ))}
          {savedMissing ? (
            <DeviceRow
              label={`${settings?.deviceId} (${s.notConnected})`}
              selected
              onPress={() => {}}
              styles={styles}
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{s.bufferSize}</Text>
          <View style={styles.chips}>
            {BUFFER_SIZES.map((size) => {
              const on = (settings?.bufferFrames ?? null) === size;
              return (
                <Pressable
                  key={String(size)}
                  onPress={() =>
                    !on && choose(settings?.deviceId ?? null, size)
                  }
                  style={({ pressed }) => [
                    styles.chip,
                    on && styles.chipOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.chipText}>
                    {size === null ? s.driverDefault : s.frames(size)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={() => setRoutingOpen(true)}
          style={({ pressed }) => [
            styles.routingButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.routingTitle}>{s.openRouting}</Text>
          <Text style={styles.info}>{s.openRoutingHint}</Text>
        </Pressable>
      </View>

      {output ? (
        <View style={styles.section}>
          <Text style={styles.heading}>{s.outputNames}</Text>
          <Text style={styles.info}>{s.outputNamesHint}</Text>
          <View style={styles.names}>
            {(settings?.outputNames ?? []).map((name, channel) => (
              <View key={`${output.id}-${channel}`} style={styles.nameRow}>
                <Text style={styles.nameLabel}>{channel + 1}</Text>
                <NameInput
                  initial={name}
                  placeholder={s.unnamed}
                  placeholderColor={colors.textTertiary}
                  onCommit={(next) => rename(channel, next)}
                  style={styles.nameInput}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <RoutingMatrix
        visible={routingOpen}
        onClose={() => setRoutingOpen(false)}
      />
    </>
  );
}

/** Edits locally; saves once on blur/enter, and only if the name changed. */
function NameInput({
  initial,
  placeholder,
  placeholderColor,
  onCommit,
  style,
}: {
  initial: string;
  placeholder: string;
  placeholderColor: string;
  onCommit: (name: string) => void;
  style: object;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    if (value.trim() !== initial) onCommit(value);
  };
  return (
    <TextInput
      value={value}
      onChangeText={setValue}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder={placeholder}
      placeholderTextColor={placeholderColor}
      maxLength={40}
      style={style}
    />
  );
}

function DeviceRow({
  label,
  selected,
  onPress,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.deviceRow, pressed && styles.pressed]}
    >
      <Text style={styles.check}>{selected ? "✓" : ""}</Text>
      <Text style={[styles.deviceText, selected && styles.deviceSelected]}>
        {label}
      </Text>
    </Pressable>
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
    info: { color: colors.textSecondary, fontSize: 13 },
    error: { color: colors.danger, fontSize: 13 },
    card: {
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      gap: 2,
    },
    label: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "600",
      paddingVertical: 4,
    },
    deviceRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      gap: spacing.sm,
    },
    check: { width: 16, color: colors.accent, fontWeight: "800" },
    deviceText: { color: colors.textPrimary, fontSize: 15, flex: 1 },
    deviceSelected: { fontWeight: "700" },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      paddingVertical: 6,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.panelRaised,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textPrimary, fontSize: 13 },
    pressed: { opacity: 0.6 },
    routingButton: {
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      gap: 2,
    },
    routingTitle: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: "700",
    },
    names: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      width: 260,
    },
    nameLabel: { width: 24, color: colors.textSecondary, textAlign: "right" },
    nameInput: {
      flex: 1,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderRadius: radii.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
  });
}
