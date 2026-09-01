import * as THREE from 'three';
import { HOLD } from './config';

/**
 * Drag-and-drop mechanics. The scribble is a weighty, living thing on a
 * spring: while dragged it trails the pointer with elastic lag and
 * overshoots on direction changes; at idle it leans slightly toward a
 * nearby cursor (grabbable) and occasionally lifts toward the head's exit
 * point as a hint. Dropping it back inside the head returns it home; only
 * a drop OUTSIDE the head hands off to resolution (later build steps).
 */

export type DragState = 'idle' | 'dragging' | 'returning' | 'dropped';

export class DragController {
  state: DragState = 'idle';
  /** Scribble center, world. The spring's current position. */
  pos = new THREE.Vector2();
  vel = new THREE.Vector2();
  /** Rest position inside the head. */
  home = new THREE.Vector2();
  /** Pointer in world coords (updated by main every pointer event). */
  pointerWorld = new THREE.Vector2(1e3, 1e3);
  /** True when the pointer is inside the (generous) hit area. */
  hovering = false;

  hitRadius: number;
  private grabOffset = new THREE.Vector2();
  private target = new THREE.Vector2();
  private dropPoint = new THREE.Vector2();
  private idleTime = 0;
  private hintT = -1;

  constructor(hitRadius: number) {
    this.hitRadius = hitRadius;
  }

  setHome(x: number, y: number, snap: boolean): void {
    this.home.set(x, y);
    if (snap) {
      this.pos.set(x, y);
      this.vel.set(0, 0);
    }
  }

  /** Attempt to grab at the current pointerWorld. True if it took hold. */
  tryGrab(): boolean {
    if (this.state === 'dragging') return false;
    if (this.pointerWorld.distanceTo(this.pos) > this.hitRadius) return false;
    this.state = 'dragging';
    this.grabOffset.copy(this.pos).sub(this.pointerWorld);
    this.hintT = -1;
    this.idleTime = 0;
    return true;
  }

  /**
   * Release. insideHead decides return-to-idle vs. hand-off to resolution;
   * a drop outside eases to `restTarget` (the right-hand resting position),
   * carried velocity giving the natural settle-overshoot on arrival.
   */
  drop(insideHead: boolean, restTarget?: { x: number; y: number }): void {
    if (this.state !== 'dragging') return;
    if (insideHead) {
      this.state = 'returning';
    } else {
      this.state = 'dropped';
      if (restTarget) this.dropPoint.set(restTarget.x, restTarget.y);
      else this.dropPoint.copy(this.pos);
    }
  }

  /**
   * Re-place a piece that has already been dropped. The resting position is
   * derived from the grid, so it is wrong the moment the layout changes
   * under it; `snap` jumps there outright (a breakpoint change, where no
   * motion should carry across), otherwise the spring walks it over.
   */
  setDropPoint(x: number, y: number, snap: boolean): void {
    this.dropPoint.set(x, y);
    if (snap) {
      this.pos.set(x, y);
      this.vel.set(0, 0);
    }
  }

  /** True once the dropped scribble has settled at rest. */
  settled(): boolean {
    return (
      this.state === 'dropped' &&
      this.pos.distanceTo(this.dropPoint) < 0.04 &&
      this.vel.length() < 0.08
    );
  }

  update(dt: number): void {
    this.hovering =
      this.state !== 'dragging' && this.pointerWorld.distanceTo(this.pos) < this.hitRadius;

    switch (this.state) {
      case 'dragging':
        this.target.copy(this.pointerWorld).add(this.grabOffset);
        break;

      case 'returning':
        this.target.copy(this.home);
        if (this.pos.distanceTo(this.home) < 0.02 && this.vel.length() < 0.05) {
          this.state = 'idle';
          this.idleTime = 0;
        }
        break;

      case 'dropped':
        this.target.copy(this.dropPoint);
        break;

      case 'idle': {
        this.target.copy(this.home);
        // proximity lean: it notices the cursor — reads as grabbable
        const d = this.pointerWorld.distanceTo(this.pos);
        if (d < HOLD.drag.leanRadius) {
          const t = 1 - d / HOLD.drag.leanRadius;
          this.target.x += (this.pointerWorld.x - this.home.x) * HOLD.drag.leanStrength * t;
          this.target.y += (this.pointerWorld.y - this.home.y) * HOLD.drag.leanStrength * t;
        }
        // idle hint: lift toward the exit point and settle back
        if (this.hintT >= 0) {
          this.hintT += dt;
          const s = this.hintT / HOLD.hint.duration;
          if (s >= 1) {
            this.hintT = -1;
            this.idleTime = 0;
          } else {
            const lift = HOLD.hint.amplitude * Math.sin(Math.PI * s) ** 2;
            const dir = HOLD.hint.dir;
            const len = Math.hypot(dir.x, dir.y) || 1;
            this.target.x += (dir.x / len) * lift;
            this.target.y += (dir.y / len) * lift;
          }
        } else if (!this.hovering) {
          this.idleTime += dt;
          if (this.idleTime >= HOLD.hintDelay) this.hintT = 0;
        }
        break;
      }
    }

    // spring toward target (semi-implicit Euler; underdamped by config)
    const { stiffness: k, damping: c, mass: m } = HOLD.dragSpring;
    const ax = (k * (this.target.x - this.pos.x) - c * this.vel.x) / m;
    const ay = (k * (this.target.y - this.pos.y) - c * this.vel.y) / m;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }
}
