/**
 * Top-of-app banner for everything that can silently go wrong on stage:
 * the audio device failing, the engine not answering, the engine playing a
 * song the UI lost track of, a failed engine command, tracks routed to
 * outputs the device doesn't have - plus the offer to switch to a newly
 * connected interface. Most severe first; one at a time.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import { audioEngine } from "../engine/AudioEngine";
import { engineStatus, type EngineStatusDto } from "../engine/status";
import { api, onDeviceChanged, onDevicesChanged, type DeviceInfo } from "./api";
import { confirmDeviceSwitch } from "./AudioSettings";
import { useDesktopStrings } from "./strings";

type Tone = "error" | "warning" | "info";

interface Banner {
  tone: Tone;
  text: string;
  action?: { label: string; run: () => void };
  dismiss?: () => void;
}

/** How often the banner re-checks "engine unresponsive" without a status. */
const WATCHDOG_MS = 500;

export function StatusBanner() {
  const s = useDesktopStrings();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [status, setStatus] = useState<EngineStatusDto | null>(null);
  const [unresponsive, setUnresponsive] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [offered, setOffered] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    const stopStatus = engineStatus.subscribe(({ status: next }) =>
      setStatus(next),
    );
    const stopErrors = engineStatus.subscribeErrors(() =>
      setCommandError(engineStatus.getCommandError()),
    );
    const watchdog = setInterval(
      () => setUnresponsive(engineStatus.isUnresponsive()),
      WATCHDOG_MS,
    );
    const unlisten = [
      onDevicesChanged(({ devices, added }) => {
        const current = engineStatus.getLatest()?.output?.id;
        // Offer the interface with the most outputs - the one meant for the
        // stage, not a pair of headphones that just connected.
        const candidates = devices
          .filter((d) => added.includes(d.id) && d.id !== current)
          .sort((a, b) => b.maxChannels - a.maxChannels);
        if (candidates.length > 0) setOffered(candidates[0]);
      }),
      // An offered interface the engine reconnected to on its own.
      onDeviceChanged((settings) => {
        setOffered((o) => (o && o.id === settings.output?.id ? null : o));
      }),
    ];
    return () => {
      stopStatus();
      stopErrors();
      clearInterval(watchdog);
      for (const p of unlisten) p.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const orphan =
    status !== null &&
    status.transport === "playing" &&
    status.projectId !== null &&
    status.projectId !== audioEngine.getLoadedProjectId() &&
    !audioEngine.hasPendingCommands();

  let banner: Banner | null = null;
  if (status?.deviceError) {
    banner = { tone: "error", text: s.deviceProblem(status.deviceError) };
  } else if (unresponsive) {
    banner = { tone: "error", text: s.engineUnresponsive };
  } else if (orphan) {
    banner = {
      tone: "warning",
      text: s.orphanPlayback,
      action: { label: s.stop, run: () => audioEngine.forceStopEngine() },
    };
  } else if (commandError) {
    banner = {
      tone: "error",
      text: s.commandFailed(commandError),
      dismiss: () => engineStatus.clearCommandError(),
    };
  } else if (status && status.routingWarnings.length > 0) {
    banner = {
      tone: "warning",
      text: s.silentTracks(status.routingWarnings.join(", ")),
    };
  } else if (offered) {
    const device = offered;
    banner = {
      tone: "info",
      text: s.newInterface(device.name, device.maxChannels),
      action: {
        label: s.useIt,
        run: async () => {
          setOffered(null);
          if (!(await confirmDeviceSwitch(s.switchWhilePlaying))) return;
          const settings = await api.getSettings();
          await api
            .selectDevice(device.id, settings.bufferFrames)
            .catch(() => {});
        },
      },
      dismiss: () => setOffered(null),
    };
  }

  if (!banner) return null;
  const toneStyle =
    banner.tone === "error"
      ? styles.error
      : banner.tone === "warning"
        ? styles.warning
        : styles.info;
  const textStyle =
    banner.tone === "warning" ? styles.darkText : styles.lightText;

  return (
    <View style={[styles.banner, toneStyle]} accessibilityRole="alert">
      <Text style={[styles.text, textStyle]}>{banner.text}</Text>
      {banner.action ? (
        <Pressable
          onPress={banner.action.run}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, textStyle]}>
            {banner.action.label}
          </Text>
        </Pressable>
      ) : null}
      {banner.dismiss ? (
        <Pressable
          onPress={banner.dismiss}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, textStyle]}>{s.dismiss}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingVertical: 10,
      paddingHorizontal: spacing.lg,
    },
    error: { backgroundColor: colors.danger },
    warning: { backgroundColor: "#ffd60a" },
    info: { backgroundColor: colors.accent },
    text: { fontWeight: "700", flexShrink: 1, textAlign: "center" },
    lightText: { color: "#fff" },
    darkText: { color: "#000" },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(0,0,0,0.25)",
      backgroundColor: "rgba(255,255,255,0.2)",
    },
    buttonText: { fontWeight: "700" },
    pressed: { opacity: 0.6 },
  });
}
