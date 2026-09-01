import { HOLD } from './config';

/**
 * Mobile gesture: PRESS AND HOLD rather than drag. Dragging with a thumb is
 * awkward; holding is the native mobile gesture.
 *
 * `progress` runs 0 -> 1 over `holdDuration` while the pointer is down on the
 * scribble, and eases back to 0 if released early — fully reversible. It only
 * commits once it reaches 1.
 *
 * There is deliberately NO ring, arc or spinner: the head empties in direct
 * proportion to this progress, so the drawing itself is the progress
 * indicator and a second one would only say the same thing twice.
 */
export class HoldGesture {
  progress = 0;
  holding = false;
  /** True once a hold has completed; the caller then runs the resolution. */
  committed = false;

  private hitTest: (x: number, y: number) => boolean;
  private hapticHalfDone = false;
  /** Fired the moment the press lands on the scribble, before any progress. */
  onGrab: (() => void) | null = null;

  constructor(target: HTMLElement, hitTest: (x: number, y: number) => boolean) {
    this.hitTest = hitTest;

    target.addEventListener('pointerdown', (e) => {
      if (!this.hitTest(e.clientX, e.clientY)) return;
      e.preventDefault();
      this.holding = true;
      this.hapticHalfDone = false;
      this.onGrab?.();
      // capture is a nice-to-have: never let it abort the gesture
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released or not capturable */
      }
    });
    const up = () => {
      this.holding = false;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    // iOS: suppress the long-press callout and text selection
    target.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private buzz(ms: number): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* vibration unavailable — silently skip */
      }
    }
  }

  update(dt: number): void {
    if (this.committed) return;
    const H = HOLD.hold;
    if (this.holding) {
      this.progress = Math.min(this.progress + dt / H.holdDuration, 1);
      if (!this.hapticHalfDone && this.progress >= 0.5) {
        this.hapticHalfDone = true;
        this.buzz(H.hapticHalf);
      }
      if (this.progress >= 1) {
        this.committed = true;
        this.holding = false;
        this.buzz(H.hapticFull);
      }
    } else {
      this.progress = Math.max(this.progress - dt / H.releaseDuration, 0);
      if (this.progress === 0) this.hapticHalfDone = false;
    }
  }

  reset(): void {
    this.progress = 0;
    this.holding = false;
    this.committed = false;
    this.hapticHalfDone = false;
  }
}
