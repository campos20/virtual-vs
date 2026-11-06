/**
 * Exponent for `peakToHeight`. Below 1 lifts quiet material more than loud:
 * a stem peaking at -20 dBFS (0.1) draws at a quarter of the lane's height
 * instead of a tenth, so pads, room mics and the like read as audio rather
 * than a flat line - while 1.0 stays 1.0 and silence stays silence, and loud
 * passages still look louder than quiet ones.
 */
const HEIGHT_CURVE = 0.6;

/**
 * Maps a waveform peak (linear 0-1, occasionally a little over) to the
 * fraction of the lane's height its bar should fill. Purely visual - it
 * reshapes already-computed peaks and never touches the audio.
 */
export function peakToHeight(peak: number): number {
  if (!(peak > 0)) return 0;
  return Math.min(1, peak) ** HEIGHT_CURVE;
}
