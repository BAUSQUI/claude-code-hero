import * as THREE from 'three';
import { HOLD } from './config';
import type { Scribble } from './scribble';

/**
 * Structure during the morph — the parts that make the transformation read
 * as CONSTRUCTED rather than interpolated.
 *
 *  - Construction lines: hairline guides from a point's current position to
 *    its target, alive only while that point is in motion, and only a
 *    fraction of them at a time so it never becomes a mesh. These are
 *    deliberately 1px GL lines: a technical drawing uses hairlines, they
 *    live for a fraction of a second, and keeping them off the fat-line
 *    path costs nothing.
 *  - Anchor flashes: small dots that pop as each arm tip clicks into its
 *    final position.
 *
 * Both are silent outside the morph, and gone entirely once it completes.
 */

/** Arm tips of the resolved mark: windowed local maxima of radius. */
export function findArmTips(points: THREE.Vector2[]): number[] {
  const n = points.length;
  const r = points.map((p) => p.length());
  const maxR = Math.max(...r);
  const win = Math.max(3, Math.round(n / 80));
  const tips: number[] = [];
  for (let i = 0; i < n; i++) {
    if (r[i] < 0.45 * maxR) continue;
    let isMax = true;
    for (let k = -win; k <= win; k++) {
      if (r[(i + k + n) % n] > r[i]) {
        isMax = false;
        break;
      }
    }
    if (isMax) tips.push(i);
  }
  // collapse plateaus into a single tip
  return tips.filter((idx, k) => k === 0 || idx - tips[k - 1] > win);
}

export class Construction {
  group = new THREE.Group();
  private lines: THREE.LineSegments;
  private linePos: Float32Array;
  private lineMat: THREE.LineBasicMaterial;
  private capacity: number;

  private anchors: THREE.Points;
  private anchorPos: Float32Array;
  private anchorAlpha: Float32Array;
  private anchorMat: THREE.ShaderMaterial;
  private tipIndices: number[];
  /** Seconds since each tip landed; -1 = not yet. */
  private tipAge: Float32Array;
  private tipFired: boolean[];

  private enabledLines: boolean;
  private enabledAnchors: boolean;

  constructor(sampleCount: number, tipIndices: number[], isMobile: boolean) {
    this.enabledLines = isMobile
      ? HOLD.construction.mobileEnabled
      : HOLD.construction.enabled;
    this.enabledAnchors = isMobile ? HOLD.anchors.mobileEnabled : HOLD.anchors.enabled;

    // --- construction lines ------------------------------------------------
    const stride = Math.max(1, Math.round(1 / HOLD.construction.density));
    this.capacity = Math.ceil(sampleCount / stride);
    this.linePos = new Float32Array(this.capacity * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(HOLD.colors.brand),
      transparent: true,
      opacity: HOLD.construction.opacity,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.group.add(this.lines);

    // --- anchor flashes ----------------------------------------------------
    this.tipIndices = tipIndices;
    this.tipAge = new Float32Array(tipIndices.length).fill(-1);
    this.tipFired = tipIndices.map(() => false);
    this.anchorPos = new Float32Array(tipIndices.length * 3);
    this.anchorAlpha = new Float32Array(tipIndices.length);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.anchorPos, 3));
    ag.setAttribute('aAlpha', new THREE.BufferAttribute(this.anchorAlpha, 1));
    ag.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.anchorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(HOLD.colors.brand) },
        uSize: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_PointSize = uSize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          // soft round dot, no glow
          float d = length(gl_PointCoord * 2.0 - 1.0);
          float a = (1.0 - smoothstep(0.6, 1.0, d)) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.anchors = new THREE.Points(ag, this.anchorMat);
    this.anchors.frustumCulled = false;
    this.anchors.visible = false;
    this.group.add(this.anchors);
  }

  /** Convert the world-unit anchor size to pixels for gl_PointSize. */
  setResolution(heightPx: number, worldHeight: number): void {
    this.anchorMat.uniforms.uSize.value = (HOLD.anchors.size / worldHeight) * heightPx;
  }

  reset(): void {
    this.tipAge.fill(-1);
    this.tipFired.fill(false);
    this.lines.visible = false;
    this.anchors.visible = false;
  }

  /**
   * @param scribble  source of current positions and per-point progress
   * @param centre    world position of the mark
   * @param active    false once the morph is over — everything goes silent
   */
  update(dt: number, scribble: Scribble, centre: THREE.Vector2, active: boolean): void {
    if (!active) {
      this.lines.visible = false;
      this.anchors.visible = false;
      return;
    }

    const target = scribble.targetPoints;
    if (!target) return;
    // targets are unit-normalised; renderScale is what puts them on screen
    const sc = scribble.renderScale;
    const disp = scribble.displacedPositions;
    const localT = scribble.localT;
    const n = localT.length;

    // --- guides for points currently in motion ---------------------------
    if (this.enabledLines) {
      const stride = Math.max(1, Math.round(1 / HOLD.construction.density));
      const fade = HOLD.construction.fadeAt;
      let w = 0;
      for (let i = 0; i < n && w < this.capacity; i += stride) {
        const q = localT[i];
        if (q <= 0.02 || q >= 0.98) continue; // only points in flight
        const o = w * 6;
        this.linePos[o] = disp[i * 2];
        this.linePos[o + 1] = disp[i * 2 + 1];
        this.linePos[o + 2] = 0;
        // guides shorten as the point closes on its target, then vanish
        const shrink = q > fade ? (1 - q) / (1 - fade) : 1;
        const tx = target[i].x * sc + centre.x;
        const ty = target[i].y * sc + centre.y;
        this.linePos[o + 3] = disp[i * 2] + (tx - disp[i * 2]) * shrink;
        this.linePos[o + 4] = disp[i * 2 + 1] + (ty - disp[i * 2 + 1]) * shrink;
        this.linePos[o + 5] = 0;
        w++;
      }
      // park unused segments at a single point so they draw nothing
      for (let k = w; k < this.capacity; k++) {
        this.linePos.fill(0, k * 6, k * 6 + 6);
      }
      this.lines.geometry.getAttribute('position').needsUpdate = true;
      this.lines.visible = w > 0;
    }

    // --- anchor flashes as each tip lands ---------------------------------
    if (this.enabledAnchors) {
      let anyVisible = false;
      for (let k = 0; k < this.tipIndices.length; k++) {
        const i = this.tipIndices[k];
        if (!this.tipFired[k] && localT[i] >= 0.995) {
          this.tipFired[k] = true;
          this.tipAge[k] = 0;
          this.anchorPos[k * 3] = target[i].x * sc + centre.x;
          this.anchorPos[k * 3 + 1] = target[i].y * sc + centre.y;
        }
        if (this.tipAge[k] >= 0) {
          this.tipAge[k] += dt;
          const s = this.tipAge[k] / HOLD.anchors.duration;
          // quick pop in, gentle fade out — it clicks into place
          this.anchorAlpha[k] = s >= 1 ? 0 : Math.min(s / 0.15, 1) * (1 - s) ** 1.5;
          if (this.anchorAlpha[k] > 0) anyVisible = true;
        } else {
          this.anchorAlpha[k] = 0;
        }
      }
      this.anchors.geometry.getAttribute('position').needsUpdate = true;
      this.anchors.geometry.getAttribute('aAlpha').needsUpdate = true;
      this.anchors.visible = anyVisible;
    }
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lineMat.dispose();
    this.anchors.geometry.dispose();
    this.anchorMat.dispose();
  }
}
