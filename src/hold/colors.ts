import * as THREE from 'three';
import { HOLD } from './config';

/**
 * Colour state as a function of resolution progress — derived, never
 * hardcoded, so the palette can be re-grounded (light or dark) without
 * anything resolving into invisibility.
 *
 * The rule: a mark is only allowed to keep its intended colour if it has
 * enough luminance separation from the ground it sits on. If it does not,
 * it inverts to whichever of ink/cream reads best against that ground.
 */

const ink = new THREE.Color(HOLD.colors.ink);
const brand = new THREE.Color(HOLD.colors.brand);
const bgStart = new THREE.Color(HOLD.colors.bgStart);
const bgMid = new THREE.Color(HOLD.colors.bgMid);
const bgEnd = new THREE.Color(HOLD.colors.bgEnd);
const cream = new THREE.Color(HOLD.colors.head);
const near = new THREE.Color('#141413');
const BLACK = new THREE.Color(0x000000);

export interface ColorState {
  bg: THREE.Color;
  mark: THREE.Color;
  head: THREE.Color;
  /** Colour for UI text against the current ground. */
  ui: THREE.Color;
}

const _bg = new THREE.Color();
const _mark = new THREE.Color();
const _head = new THREE.Color();
const _ui = new THREE.Color();

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Whichever of cream/near-black separates most from the ground. */
function contrastingInk(bg: THREE.Color, out: THREE.Color): THREE.Color {
  return out.copy(luminance(bg) > 0.45 ? near : cream);
}

/** Minimum luminance separation before a colour is considered legible. */
const MIN_SEPARATION = 0.12;

/**
 * @param t resolution progress 0..1 (0 = unresolved scribble, 1 = the mark)
 */
export function colorState(t: number): ColorState {
  const p = Math.min(Math.max(t, 0), 1);

  _bg.copy(bgStart);
  if (HOLD.backgroundTransition) {
    // synced to the acts: hold through DISORDER, shift during BREAKTHROUGH,
    // land during SETTLE — the room brightens at the moment of clarity
    const B = HOLD.backgroundCurve;
    const raw = clamp01((p - B.from) / Math.max(B.to - B.from, 1e-4));
    const t = raw * raw * (3 - 2 * raw);
    // route through the warm waypoint so the room never goes neutral grey
    if (t < 0.5) _bg.lerp(bgMid, t * 2);
    else _bg.copy(bgMid).lerp(bgEnd, (t - 0.5) * 2);
    // a slight darkening just before the release, so it has something to
    // release from
    const d = B.preDip;
    if (d.enabled) {
      const dip = Math.exp(-Math.pow((p - d.at) / d.width, 2)) * d.amount;
      _bg.lerp(BLACK, dip);
    }
  }

  // intended journey: the unresolved ink colour toward the brand mark
  _mark.copy(ink).lerp(brand, p);
  // ...unless it would disappear into the ground
  if (Math.abs(luminance(_mark) - luminance(_bg)) < MIN_SEPARATION) {
    contrastingInk(_bg, _mark);
  }

  contrastingInk(_bg, _head);
  _ui.copy(_head);

  return { bg: _bg, mark: _mark, head: _head, ui: _ui };
}
