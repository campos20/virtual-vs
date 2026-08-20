import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { audioEngine } from '@/engine';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import { usePlayhead } from '@/hooks/usePlayhead';
import { useTransportState } from '@/hooks/useTransportState';
import { useTranslation } from '@/i18n';
import type { ProjectManifest } from '@/types/project';
import { colors, elevation } from '@/ui/theme';
import { TransportBar } from './TransportBar';

/**
 * The single, persistent transport bar - rendered once in `_layout.tsx`,
 * above the navigator, so it survives every screen transition instead of
 * being tied to `ProjectScreen`'s mount lifecycle (see the "now playing"
 * plan).
 *
 * Split from the actual bar content on purpose: this outer component is
 * mounted for the app's entire lifetime, so if it called `usePlayhead()`/
 * `useTransportState()` directly, their requestAnimationFrame polling and
 * engine subscriptions would run continuously even on the (far more common)
 * screens where nothing is loaded and the bar renders nothing at all. Those
 * hooks live in `NowPlayingBarContent` instead, which only mounts once
 * there's actually something to show.
 */
export function NowPlayingBar() {
  const { projectId, manifest, durationSec } = useNowPlaying();

  if (!projectId || !manifest) return null;

  return <NowPlayingBarContent projectId={projectId} manifest={manifest} durationSec={durationSec} />;
}

interface NowPlayingBarContentProps {
  projectId: string;
  manifest: ProjectManifest;
  durationSec: number;
}

/**
 * Reuses `TransportBar` as-is rather than re-implementing the scrub/play/
 * pause/stop logic.
 *
 * `TransportBar`'s scrub track already claims the touch responder via its
 * own `PanResponder`, and its buttons are their own nested `Pressable`s, so
 * RN's touch responder system resolves those first - the outer
 * navigation `Pressable` here only fires for taps on the title/background.
 */
function NowPlayingBarContent({ projectId, manifest, durationSec }: NowPlayingBarContentProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { seconds: playheadSec } = usePlayhead();
  const transportState = useTransportState();

  function goToSong() {
    router.push({ pathname: '/project/[projectId]', params: { projectId } });
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <Pressable
        onPress={goToSong}
        testID="now-playing-bar"
        accessibilityLabel={t.nowPlaying.goToSong(manifest.title)}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
      >
        <View style={styles.titleRow}>
          <Text style={styles.eyebrow}>{t.nowPlaying.heading}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {manifest.title}
          </Text>
        </View>
        <TransportBar
          isPlaying={transportState === 'playing'}
          playheadSec={playheadSec}
          durationSec={durationSec}
          onPlayPause={() => (audioEngine.getTransportState() === 'playing' ? audioEngine.pause() : audioEngine.play())}
          onStop={() => audioEngine.stop()}
          onSeek={(seconds) => audioEngine.seek(seconds)}
        />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.panel,
  },
  bar: {
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...elevation,
  },
  pressed: {
    opacity: 0.9,
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
});
