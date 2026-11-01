import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";
import { WAVEFORM_PIXELS_PER_SECOND } from "@/engine/waveform";

/**
 * Keeps a horizontal, non-user-scrollable timeline (`ScrollView` with
 * `scrollEnabled={false}`) centred on the playhead. Shared by every waveform
 * lane and the ruler above them, so they all scroll by the exact same rule
 * and stay lined up with one another and with WaveformView's playhead line.
 *
 * Scrolling is imperative (`scrollTo`) off the throttled playhead value
 * (~15fps, see usePlayhead) - no gesture-handler/reanimated involved (see
 * AGENTS.md "Stability over appearance"). Content should be padded by
 * `viewportWidth / 2` on each side, so time 0 and the end can both reach
 * the centre line.
 *
 * Also re-scrolls once the viewport is first measured: the `ScrollView` only
 * mounts after layout, and a paused transport sends no further playhead
 * updates, so without this it would sit at 0:00 instead of where the song is.
 */
export function useTimelineScroll(playheadSec: number) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      x: playheadSec * WAVEFORM_PIXELS_PER_SECOND,
      animated: false,
    });
  }, [playheadSec, viewportWidth]);

  return { scrollRef, viewportWidth, onLayout };
}
