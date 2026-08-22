export type SetlistAdvance = 'manual' | 'auto';

/**
 * A named, ordered group of songs - what the Library shows as a **folder**.
 *
 * It holds project *ids*, not audio. Reorganising therefore never moves a
 * file (a song's stems can run to hundreds of megabytes), and the same song
 * can sit in several folders at once, which is how bands actually work: one
 * song belongs to Sunday's set and to the wedding gig both.
 *
 * `advance` and `padBetween` belong to the not-yet-built setlist controller
 * (see src/setlist/README.md) and are inert until it exists - a folder is
 * organisation today, and becomes runnable as a set later without a data
 * migration.
 */
export interface SetlistManifest {
  id: string;
  name: string;
  /** Project ids, in the order this folder lists them. */
  songs: string[];
  advance: SetlistAdvance;
  padBetween: boolean;
}
