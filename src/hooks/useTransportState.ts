import { useEffect, useState } from 'react';
import { audioEngine, type EngineTransportState } from '@/engine';

/** Subscribes to the engine's transport state (playing/paused/stopped). */
export function useTransportState(): EngineTransportState {
  const [state, setState] = useState(() => audioEngine.getTransportState());

  useEffect(() => audioEngine.onTransportStateChange(setState), []);

  return state;
}
