import { HOLD } from './config';

/**
 * The resolution is not one uniform ease — it is three acts:
 *
 *   DISORDER      slow, almost reluctant. The shape barely commits.
 *   BREAKTHROUGH  the fastest section. Most structure snaps into place.
 *   SETTLE        slows again; the last points ease in and the noise dies.
 *
 * Each act owns a portion of `resolutionDuration`, the progress it reaches,
 * and its own easing — so the impact comes from the CONTRAST between the
 * slow acts and the fast one, not from adding brightness.
 */

export type EaseName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic';

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

export const EASES: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => t * t * (3 - 2 * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
};

export interface ActState {
  /** Overall morph progress 0..1. */
  p: number;
  /** Index of the current act. */
  index: number;
  /** Name of the current act. */
  name: string;
  /** Progress within the current act, 0..1. */
  local: number;
  /**
   * How "inside" BREAKTHROUGH we are, 0..1 with soft edges — drives the
   * effects that only belong to the fast section (trails).
   */
  breakthrough: number;
}

/** Map elapsed resolution seconds onto the three-act progress curve. */
export function actProgress(seconds: number): ActState {
  const acts = HOLD.acts;
  const total = HOLD.resolutionDuration;
  const t = clamp01(seconds / total);

  let cursor = 0; // portion consumed so far
  let from = 0; // progress at the start of this act
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const end = cursor + a.portion;
    if (t <= end || i === acts.length - 1) {
      const local = a.portion > 0 ? clamp01((t - cursor) / a.portion) : 1;
      const eased = EASES[a.ease as EaseName](local);
      const p = from + (a.to - from) * eased;
      // soft-edged membership of the breakthrough act
      let breakthrough = 0;
      if (a.name === 'breakthrough') {
        breakthrough = Math.sin(Math.PI * clamp01(local)) ** 0.6;
      }
      return { p: clamp01(p), index: i, name: a.name, local, breakthrough };
    }
    cursor = end;
    from = a.to;
  }
  return { p: 1, index: acts.length - 1, name: 'settle', local: 1, breakthrough: 0 };
}

/**
 * Scale gesture: gathers (contracts) at the end of DISORDER, expands
 * through BREAKTHROUGH, settles to 1. Kept under a few percent — breath,
 * not zoom.
 */
export function scaleGesture(p: number): number {
  const g = HOLD.scaleGesture;
  if (!g.enabled) return 1;
  // contraction centred at the disorder/breakthrough seam
  const gather = Math.exp(-Math.pow((p - g.gatherAt) / g.gatherWidth, 2));
  // expansion centred inside breakthrough
  const swell = Math.exp(-Math.pow((p - g.swellAt) / g.swellWidth, 2));
  return 1 - g.contract * gather + g.expand * swell;
}
