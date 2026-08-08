import type { Bus } from '@/types/project';

export type MonitorMode = 'split' | 'monitor';

export type EngineTransportState = 'stopped' | 'playing' | 'paused';

export interface TrackRuntimeState {
  id: string;
  bus: Bus;
  /** Committed linear gain (matches the store's committed track volume). */
  volume: number;
  muted: boolean;
  soloed: boolean;
}
