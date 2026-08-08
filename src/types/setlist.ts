export type SetlistAdvance = 'manual' | 'auto';

export interface SetlistManifest {
  name: string;
  songs: string[];
  advance: SetlistAdvance;
  padBetween: boolean;
}
