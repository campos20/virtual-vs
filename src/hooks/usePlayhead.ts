import { useEffect, useRef, useState } from 'react';
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
 */
export function usePlayhead(): { seconds: number; ref: React.RefObject<number> } {
  const ref = useRef(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let frame: number;
    let lastDisplayUpdate = 0;
    const tick = (now: number) => {
      const value = audioEngine.getPlayhead();
      ref.current = value;
      if (now - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL_SEC * 1000) {
        lastDisplayUpdate = now;
        setSeconds(value);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return { seconds, ref };
}
