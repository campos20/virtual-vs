// Data shape for a footswitch -> app-action mapping. Lives here (rather than
// inline in the store) because `control/` owns the domain meaning of a
// mapping; `store/pedalMappingsSlice.ts` just persists whatever this type is.
//
// TODO(BLE-MIDI footswitch, see ./README.md): once wired up, `midiNote` is
// matched against incoming MIDI messages from the connected footswitch to
// trigger `action`.
export type PedalAction =
  | 'playPause'
  | 'stop'
  | 'nextSection'
  | 'previousSection'
  | 'toggleClick'
  | 'nextSong'
  | 'previousSong';

export interface PedalMapping {
  id: string;
  /** MIDI note or CC number sent by the footswitch for this mapping. */
  midiNote: number;
  action: PedalAction;
  label: string;
}
