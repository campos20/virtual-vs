// DAW-style per-channel-strip color coding (Logic/Ableton-esque palette on a dark console).
const TRACK_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#FFD166',
  '#A78BFA',
  '#60A5FA',
  '#F472B6',
  '#34D399',
  '#FB923C',
];

export function getTrackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}
