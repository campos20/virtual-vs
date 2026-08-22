/**
 * Progress reporting for the slow parts of opening or importing a project.
 *
 * Opening a project runs several multi-second phases, some of which are
 * *synchronous* JavaScript (folding channels, encoding WAV, computing
 * waveform peaks, generating the click). While one of those runs, the JS
 * thread is blocked and React cannot paint - which is why a long import used
 * to show a black screen rather than a spinner. Reporting a phase is only
 * half the fix; `yieldToUi()` is the other half.
 */

export type ProgressPhase =
  | 'copying'
  | 'converting'
  | 'decoding'
  | 'building'
  | 'waveforms';

export interface ProgressUpdate {
  phase: ProgressPhase;
  /** Name of the stem being worked on, when the phase is per-stem. */
  name?: string;
  /** 1-based position, for phases that run once per stem. */
  current?: number;
  total?: number;
}

export type ProgressReporter = (update: ProgressUpdate) => void;

/**
 * Hands the thread back long enough for React to flush and the UI to paint.
 *
 * Deliberately a plain `setTimeout` rather than `requestAnimationFrame`: a
 * blocked or backgrounded JS thread may never run an animation frame, and
 * this must never be able to hang the operation it is trying to report on.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Reports a phase and then yields, so the message is on screen *before* the
 * work that blocks the thread begins. Reporting without yielding would queue
 * a re-render that only paints once the slow work is already finished.
 */
export async function report(
  onProgress: ProgressReporter | undefined,
  update: ProgressUpdate
): Promise<void> {
  if (!onProgress) return;
  onProgress(update);
  await yieldToUi();
}
