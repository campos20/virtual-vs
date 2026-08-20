import { useSyncExternalStore } from 'react';
import { nowPlayingStore, type NowPlayingSnapshot } from '@/playback/nowPlayingStore';

/** Subscribes to `nowPlayingStore` - which project (if any) is currently loaded into the engine. */
export function useNowPlaying(): NowPlayingSnapshot {
  return useSyncExternalStore(nowPlayingStore.subscribe, nowPlayingStore.getSnapshot);
}
