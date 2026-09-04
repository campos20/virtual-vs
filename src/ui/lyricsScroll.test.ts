import {
  activeLyricsLineIndex,
  buildLyricsScrollAnchors,
  clampLyricsFontSize,
  computeLyricsScrollY,
  LYRICS_FONT_SIZE_MAX_PT,
  LYRICS_FONT_SIZE_MIN_PT,
} from './lyricsScroll';

describe('buildLyricsScrollAnchors', () => {
  it('is just the two virtual boundary anchors with zero taps', () => {
    expect(buildLyricsScrollAnchors([], {}, 100, 800)).toEqual([
      { timeSec: 0, scrollY: 0 },
      { timeSec: 100, scrollY: 800 },
    ]);
  });

  it('inserts a tapped anchor between the virtual boundaries, sorted by time', () => {
    const anchors = buildLyricsScrollAnchors(
      [{ lineIndex: 2, timeSec: 40 }],
      { 2: 300 },
      100,
      800
    );
    expect(anchors).toEqual([
      { timeSec: 0, scrollY: 0 },
      { timeSec: 40, scrollY: 300 },
      { timeSec: 100, scrollY: 800 },
    ]);
  });

  it('drops a sync point whose line has not been measured', () => {
    const anchors = buildLyricsScrollAnchors([{ lineIndex: 5, timeSec: 40 }], {}, 100, 800);
    expect(anchors).toEqual([
      { timeSec: 0, scrollY: 0 },
      { timeSec: 100, scrollY: 800 },
    ]);
  });

  it('clamps a tap outside the track/content bounds', () => {
    const anchors = buildLyricsScrollAnchors(
      [{ lineIndex: 0, timeSec: -5 }],
      { 0: 5000 },
      100,
      800
    );
    expect(anchors[0]).toEqual({ timeSec: 0, scrollY: 0 });
    expect(anchors.some((a) => a.scrollY === 800 && a.timeSec === 0)).toBe(true);
  });
});

describe('computeLyricsScrollY', () => {
  it('reproduces plain duration-proportional scroll with no taps', () => {
    const anchors = buildLyricsScrollAnchors([], {}, 60, 1200);
    expect(computeLyricsScrollY(0, anchors)).toBe(0);
    expect(computeLyricsScrollY(30, anchors)).toBe(600);
    expect(computeLyricsScrollY(60, anchors)).toBe(1200);
  });

  it('interpolates smoothly between two tapped anchors', () => {
    const anchors = [
      { timeSec: 0, scrollY: 0 },
      { timeSec: 10, scrollY: 100 },
      { timeSec: 20, scrollY: 300 },
      { timeSec: 60, scrollY: 1200 },
    ];
    expect(computeLyricsScrollY(15, anchors)).toBe(200);
  });

  it('stays pinned at top when content fits the viewport (maxScrollY 0)', () => {
    const anchors = buildLyricsScrollAnchors([], {}, 60, 0);
    expect(computeLyricsScrollY(0, anchors)).toBe(0);
    expect(computeLyricsScrollY(30, anchors)).toBe(0);
    expect(computeLyricsScrollY(60, anchors)).toBe(0);
  });

  it('returns 0 for a zero-duration track', () => {
    const anchors = buildLyricsScrollAnchors([], {}, 0, 800);
    expect(computeLyricsScrollY(0, anchors)).toBe(0);
  });

  it('clamps playhead beyond the last anchor', () => {
    const anchors = buildLyricsScrollAnchors([], {}, 60, 1200);
    expect(computeLyricsScrollY(999, anchors)).toBe(1200);
  });

  it('clamps a negative playhead', () => {
    const anchors = buildLyricsScrollAnchors([], {}, 60, 1200);
    expect(computeLyricsScrollY(-5, anchors)).toBe(0);
  });

  it('returns 0 for an empty anchor list', () => {
    expect(computeLyricsScrollY(10, [])).toBe(0);
  });
});

describe('activeLyricsLineIndex', () => {
  it('is line 0 before any tap', () => {
    expect(activeLyricsLineIndex(5, [])).toBe(0);
  });

  it('is the furthest-along tapped line at or before the playhead', () => {
    const points = [
      { lineIndex: 1, timeSec: 5 },
      { lineIndex: 3, timeSec: 20 },
      { lineIndex: 7, timeSec: 45 },
    ];
    expect(activeLyricsLineIndex(25, points)).toBe(3);
    expect(activeLyricsLineIndex(45, points)).toBe(7);
    expect(activeLyricsLineIndex(0, points)).toBe(0);
  });
});

describe('clampLyricsFontSize', () => {
  it('clamps below the minimum', () => {
    expect(clampLyricsFontSize(0)).toBe(LYRICS_FONT_SIZE_MIN_PT);
  });

  it('clamps above the maximum', () => {
    expect(clampLyricsFontSize(999)).toBe(LYRICS_FONT_SIZE_MAX_PT);
  });

  it('passes an in-range value through unchanged', () => {
    expect(clampLyricsFontSize(20)).toBe(20);
  });
});
