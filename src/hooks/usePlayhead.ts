import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/engine';

/** How often the hook's React state (and therefore the consumer's render) updates. */
const DISPLAY_UPDATE_INTERVAL_SEC = 1 / 15;

/**
 * Polls the engine's playhead via requestAnimationFrame instead of Redux -
 * dispatching a ~60fps value to the store would re-render everything
 * subscribed to it and bloat devtools (see AGENTS.md state architecture
 * rules). `ref.current` is updated every animation frame for consumers that
 * want the precise instantaneous value without re-rendering (e.g. driving a
 * Reanimated shared value later); the returned `seconds` re-renders at a
 * throttled ~15fps, plenty smooth for a time readout or scrub bar.
 *
 * The returned `stop` lets a screen kill the loop *before* it starts
 * navigating away, rather than waiting for unmount. While playing, this loop
 * re-renders its consumer several times a second; if one of those renders
 * commits while the navigator is tearing the screen's native views down,
 * Android's Fabric mount path can fail with "already has a parent" (see
 * AGENTS.md). `stop` is idempotent and permanent for the hook's lifetime.
 */
export function usePlayhead(): {
  seconds: number;
  ref: React.RefObject<number>;
  stop: () => void;
} {
  const ref = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const activeRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    let lastDisplayUpdate = 0;

    const tick = (now: number) => {
      // Guards the case where a frame was already queued when `stop` ran.
      if (!activeRef.current) return;

      const value = audioEngine.getPlayhead();
      ref.current = value;
      if (now - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL_SEC * 1000) {
        lastDisplayUpdate = now;
        setSeconds(value);
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return stop;
  }, [stop]);

  return { seconds, ref, stop };
}
