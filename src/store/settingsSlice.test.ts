import { DEFAULT_LYRICS_FONT_SIZE_PT } from '@/ui/lyricsScroll';
import reducer, {
  languageOverrideSet,
  libraryOrderSet,
  lyricsAllCapsSet,
  lyricsFontSizeSet,
  monitorModeSet,
} from './settingsSlice';

describe('settingsSlice', () => {
  it('defaults to split monitor mode, the device locale, the default lyrics font size and mixed-case lyrics', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({
      monitorMode: 'split',
      languageOverride: null,
      libraryOrder: [],
      lyricsFontSizePt: DEFAULT_LYRICS_FONT_SIZE_PT,
      lyricsAllCaps: false,
    });
  });

  it('sets the monitor mode', () => {
    const state = reducer(undefined, monitorModeSet('monitor'));
    expect(state.monitorMode).toBe('monitor');
  });

  it('sets and clears the language override', () => {
    const withOverride = reducer(undefined, languageOverrideSet('pt-BR'));
    expect(withOverride.languageOverride).toBe('pt-BR');

    const cleared = reducer(withOverride, languageOverrideSet(null));
    expect(cleared.languageOverride).toBeNull();
  });

  it('replaces the Library order wholesale rather than merging it', () => {
    // The Library hands down a fully-computed order; a merge here would let a
    // stale key the user just deleted survive a reorder.
    const first = reducer(undefined, libraryOrderSet(['folder:a', 'project:b']));
    const second = reducer(first, libraryOrderSet(['project:b']));
    expect(second.libraryOrder).toEqual(['project:b']);
  });

  it('sets the lyrics font size', () => {
    const state = reducer(undefined, lyricsFontSizeSet(24));
    expect(state.lyricsFontSizePt).toBe(24);
  });

  it('sets the lyrics all-caps display', () => {
    const state = reducer(undefined, lyricsAllCapsSet(true));
    expect(state.lyricsAllCaps).toBe(true);
  });
});
