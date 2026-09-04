import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from '@/i18n';
import type { LyricsSyncPoint } from '@/types/project';
import {
  activeLyricsLineIndex,
  buildLyricsScrollAnchors,
  clampLyricsFontSize,
  computeLyricsScrollY,
  LYRICS_FONT_SIZE_STEP_PT,
} from '@/ui/lyricsScroll';
import { radii, spacing, useThemeColors, type ThemeColors } from '@/ui/theme';

/** Bare 'monospace' only reliably resolves on Android - iOS needs a named font. */
const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const LINE_HEIGHT_RATIO = 1.5;

interface LyricsViewProps {
  lyrics: string;
  syncPoints: LyricsSyncPoint[];
  durationSec: number;
  playheadSec: number;
  fontSizePt: number;
  allCaps: boolean;
  onEdit: () => void;
  /** A non-blank line was tapped - the caller records `{ lineIndex, timeSec: playheadRef.current }`. */
  onTapLine: (lineIndex: number) => void;
  onFontSizeChange: (fontSizePt: number) => void;
  onAllCapsChange: (allCaps: boolean) => void;
  /** Opens the sync management drawer (review/remove individual or all tap-to-sync corrections). */
  onOpenSync: () => void;
}

/**
 * The auto-scrolling lyrics display. Scroll position is driven imperatively
 * off `playheadSec` via `ScrollView.scrollTo` - no gesture-handler/reanimated
 * involved (see AGENTS.md "Stability over appearance"), same convention as
 * StemWaveformLane. With zero tap-corrections it's plain duration-proportional
 * scroll; each line tap refines the interpolation around it (see
 * `@/ui/lyricsScroll`). `scrollEnabled` stays false throughout - tapping a
 * line is the only way a user influences this view; there's no manual
 * drag-scrolling, which would otherwise fight the imperative `scrollTo`
 * called on every playhead update.
 */
export function LyricsView({
  lyrics,
  syncPoints,
  durationSec,
  playheadSec,
  fontSizePt,
  allCaps,
  onEdit,
  onTapLine,
  onFontSizeChange,
  onAllCapsChange,
  onOpenSync,
}: LyricsViewProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // Each non-blank line's Y offset within the scrolled content, as measured
  // by its own onLayout - this is what lets a tapped line become a (time,
  // pixel) anchor. Guarded below so re-measuring the same value doesn't
  // trigger a state update loop.
  const [lineOffsets, setLineOffsets] = useState<Record<number, number>>({});

  const lines = useMemo(() => lyrics.split('\n'), [lyrics]);
  const isEmpty = lyrics.trim().length === 0;

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height);
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const handleLineLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y;
    setLineOffsets((prev) => (prev[index] === y ? prev : { ...prev, [index]: y }));
  }, []);

  const maxScrollY = Math.max(0, contentHeight - viewportHeight);
  const anchors = useMemo(
    () => buildLyricsScrollAnchors(syncPoints, lineOffsets, durationSec, maxScrollY),
    [syncPoints, lineOffsets, durationSec, maxScrollY]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: computeLyricsScrollY(playheadSec, anchors), animated: false });
  }, [playheadSec, anchors]);

  // Doubles as a karaoke-style "current line" indicator and as immediate
  // visual confirmation that a tap registered - no timer-based flash needed.
  const activeLine = useMemo(
    () => activeLyricsLineIndex(playheadSec, syncPoints),
    [playheadSec, syncPoints]
  );

  function handleFontDecrease() {
    onFontSizeChange(clampLyricsFontSize(fontSizePt - LYRICS_FONT_SIZE_STEP_PT));
  }

  function handleFontIncrease() {
    onFontSizeChange(clampLyricsFontSize(fontSizePt + LYRICS_FONT_SIZE_STEP_PT));
  }

  function handleToggleAllCaps() {
    onAllCapsChange(!allCaps);
  }

  return (
    <View style={styles.container} onLayout={handleViewportLayout}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarGroup}>
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            testID="edit-lyrics-button"
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.toolbarButtonText}>{t.lyrics.edit}</Text>
          </Pressable>
          <Pressable
            onPress={onOpenSync}
            hitSlop={8}
            testID="open-lyrics-sync-button"
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.toolbarButtonText}>{t.lyrics.sync}</Text>
            {syncPoints.length > 0 && (
              <View style={styles.syncBadge} testID="lyrics-sync-badge">
                <Text style={styles.syncBadgeText}>{syncPoints.length}</Text>
              </View>
            )}
          </Pressable>
        </View>
        <View style={styles.fontControls}>
          <Pressable
            onPress={handleToggleAllCaps}
            hitSlop={8}
            testID="lyrics-allcaps-toggle"
            accessibilityLabel={t.lyrics.allCaps}
            style={({ pressed }) => [
              styles.fontButton,
              allCaps && styles.fontButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.fontButtonText, allCaps && styles.fontButtonTextActive]}>ABC</Text>
          </Pressable>
          <Pressable
            onPress={handleFontDecrease}
            hitSlop={8}
            testID="lyrics-font-decrease"
            style={({ pressed }) => [styles.fontButton, pressed && styles.pressed]}
          >
            <Text style={styles.fontButtonText}>A−</Text>
          </Pressable>
          <Pressable
            onPress={handleFontIncrease}
            hitSlop={8}
            testID="lyrics-font-increase"
            style={({ pressed }) => [styles.fontButton, pressed && styles.pressed]}
          >
            <Text style={styles.fontButtonText}>A+</Text>
          </Pressable>
        </View>
      </View>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t.lyrics.emptyText}</Text>
          <Pressable
            onPress={onEdit}
            testID="add-lyrics-button"
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Text style={styles.addButtonText}>{t.lyrics.addLyrics}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}
          contentContainerStyle={styles.linesContainer}
        >
          {lines.map((line, index) => {
            if (line.trim().length === 0) {
              return <View key={index} style={{ height: fontSizePt * LINE_HEIGHT_RATIO }} />;
            }
            return (
              <Pressable
                key={index}
                onPress={() => onTapLine(index)}
                onLayout={(event) => handleLineLayout(index, event)}
                testID={`lyrics-line-${index}`}
                style={({ pressed }) => [styles.line, pressed && styles.pressed]}
              >
                <Text
                  style={[
                    styles.lineText,
                    {
                      fontSize: fontSizePt,
                      lineHeight: fontSizePt * LINE_HEIGHT_RATIO,
                      textTransform: allCaps ? 'uppercase' : 'none',
                    },
                    index === activeLine && styles.lineTextActive,
                  ]}
                >
                  {line}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toolbarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.borderLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  toolbarButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  syncBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  syncBadgeText: {
    color: '#0a0a0a',
    fontSize: 10,
    fontWeight: '800',
  },
  fontControls: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  fontButton: {
    width: 32,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.borderLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  fontButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  fontButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  fontButtonTextActive: {
    color: '#0a0a0a',
  },
  pressed: {
    opacity: 0.7,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  addButtonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '700',
  },
  linesContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  line: {
    paddingVertical: 2,
  },
  lineText: {
    fontFamily: MONOSPACE_FONT,
    color: colors.textSecondary,
  },
  lineTextActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  });
}
