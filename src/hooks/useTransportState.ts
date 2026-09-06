import { useEffect, useState } from 'react';
import { getAudioEngine, type EngineTransportState } from '@/engine';

/** Subscribes to the engine's transport state (playing/paused/stopped). */
export function useTransportState(): EngineTransportState {
  // A freshly constructed engine always starts 'stopped', so this matches
  // the real engine without reading it during render - the engine must only
  // ever be built from an effect/handler (see getAudioEngine's doc comment).
  const [state, setState] = useState<EngineTransportState>('stopped');

  useEffect(() => {
    const engine = getAudioEngine();
    setState(engine.getTransportState());
    return engine.onTransportStateChange(setState);
  }, []);

  return state;
}
