import { HOLD, type IntentRule, type MarkParam } from './config';

/**
 * Local, deterministic intent parsing. No network, no model — the submitted
 * text is matched against `HOLD.demo.intentMap` and turned into clamped
 * parameter nudges. Unrecognised input returns null so the caller can
 * respond gracefully; it never fails silently.
 */

export interface ParsedIntent {
  rule: IntentRule;
  /** The matched keyword, for the log copy. */
  matched: string;
}

/** Match on whole words so "sharp" doesn't fire inside "sharpener". */
function hasKeyword(text: string, keyword: string): boolean {
  if (keyword.includes(' ')) return text.includes(keyword);
  return new RegExp(`\\b${keyword}\\b`).test(text);
}

export function parseIntent(input: string): ParsedIntent | null {
  const text = input.toLowerCase().trim();
  if (!text) return null;

  let best: ParsedIntent | null = null;
  let bestLen = 0;
  for (const rule of HOLD.demo.intentMap) {
    for (const k of rule.keywords) {
      // longest keyword wins, so multi-word phrases beat single words
      if (hasKeyword(text, k) && k.length > bestLen) {
        bestLen = k.length;
        best = { rule, matched: k };
      }
    }
  }
  return best;
}

export type MarkParams = Record<MarkParam, number>;

/** Neutral state — the mark exactly as it resolved. */
export function defaultParams(): MarkParams {
  return {
    sharpness: 1,
    armLength: 1,
    armVariance: 0,
    pulseRate: 1,
    rotation: 0,
    value: 0,
  };
}

/** Linear blend between two parameter sets (used by the transform tween). */
export function lerpParams(a: MarkParams, b: MarkParams, t: number): MarkParams {
  const out = {} as MarkParams;
  for (const k of Object.keys(a) as MarkParam[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Apply a rule's deltas to a parameter set, clamped to safe brand limits. */
export function applyIntent(params: MarkParams, rule: IntentRule): MarkParams {
  const next: MarkParams = { ...params };
  const clamps = HOLD.demo.clamps;
  for (const [key, delta] of Object.entries(rule.delta) as [MarkParam, number][]) {
    const [lo, hi] = clamps[key];
    next[key] = Math.min(Math.max(params[key] + delta, lo), hi);
  }
  return next;
}

/** True when a rule would change nothing (already at its clamp). */
export function isNoOp(from: MarkParams, to: MarkParams): boolean {
  return (Object.keys(to) as MarkParam[]).every((k) => Math.abs(to[k] - from[k]) < 1e-4);
}
