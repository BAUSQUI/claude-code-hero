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
 *
 * SCROLLING COMES FIRST. The hero fills the screen on a phone, so anything
 * this class does to touch behaviour is felt as "the page is broken":
 *
 *  - The press only engages when it lands ON the scribble. Anywhere else on
 *    the canvas is left completely alone.
 *  - A finger that MOVES is scrolling, not holding. Past a small threshold
 *    the hold cancels itself, hands the pointer back, and gets out of the way.
 *  - `touch-action: none` is set for the life of the hold and taken off the
 *    moment it ends, so the canvas sits on its `pan-y` default almost always.
 *    The browser latches touch-action when a gesture BEGINS, so setting it
 *    here cannot trap the gesture in progress — that one can still scroll,
 *    which is precisely what makes the cancel path below work.
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

  private target: HTMLElement;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;

  constructor(target: HTMLElement, hitTest: (x: number, y: number) => boolean) {
    this.hitTest = hitTest;
    this.target = target;

    target.addEventListener('pointerdown', (e) => {
      if (this.committed) return;
      // ONLY on the scribble. A press anywhere else on the canvas is someone
      // beginning to scroll, and belongs entirely to the browser.
      if (!this.hitTest(e.clientX, e.clientY)) return;

      this.pointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.holding = true;
      this.hapticHalfDone = false;
      this.onGrab?.();

      // held only for the duration of the press
      target.style.touchAction = 'none';
      // capture is a nice-to-have: never let it abort the gesture
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released or not capturable */
      }
    });

    // A finger that travels is a scroll. Cancelling on movement is what lets
    // a swipe that happens to start on the scribble still scroll the page.
    target.addEventListener('pointermove', (e) => {
      if (!this.holding || e.pointerId !== this.pointerId) return;
      const moved = Math.max(
        Math.abs(e.clientX - this.startX),
        Math.abs(e.clientY - this.startY),
      );
      if (moved > HOLD.hold.moveCancel) this.release();
    });

    const end = (e: PointerEvent) => {
      if (this.pointerId === null || e.pointerId === this.pointerId) this.release();
    };
    window.addEventListener('pointerup', end);
    // fires when the browser takes the gesture over in order to scroll with it
    window.addEventListener('pointercancel', end);

    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Stop holding and hand everything back: the captured pointer, and the
   * canvas's ordinary scrolling. Called when the press ends, when it turns
   * out to have been a scroll, and when it completes.
   */
  private release(): void {
    this.holding = false;
    if (this.pointerId !== null) {
      try {
        this.target.releasePointerCapture(this.pointerId);
      } catch {
        /* already gone */
      }
      this.pointerId = null;
    }
    // back to the stylesheet's `pan-y`
    this.target.style.touchAction = '';
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
        this.buzz(H.hapticFull);
        // the press is over even though it succeeded: scrolling comes back
        this.release();
      }
    } else {
      this.progress = Math.max(this.progress - dt / H.releaseDuration, 0);
      if (this.progress === 0) this.hapticHalfDone = false;
    }
  }

  reset(): void {
    this.progress = 0;
    this.committed = false;
    this.hapticHalfDone = false;
    this.release();
  }
}
