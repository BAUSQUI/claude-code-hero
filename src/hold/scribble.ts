import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { HOLD } from './config';
import { simplex2 } from './noise';
import { scaleGesture } from './acts';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The scribble: an ordered point array along the stroke, rendered as one
 * continuous fat line (Line2/LineMaterial — controllable weight, no thin-GL
 * shimmer), displaced every frame so it reads as an agitated, unresolved
 * thought rather than a static drawing.
 *
 * Displacement = two simplex bands + arrhythmic spikes, all × `chaos`:
 *  - low band:  slow, broad undulation — the thought circling
 *  - high band: nervous micro-tremor — the line never sits still
 * Each point's noise is offset by its arc-length position, so movement
 * travels ALONG the stroke (writhing) instead of shifting it as a block.
 * Spikes fire at irregular intervals, localised to a random section — the
 * intrusive thought. Nothing sits on a fixed beat.
 *
 * The two bands fall off on separate curves as chaos drops: the tremor dies
 * first, the sway last — panic settles before the shape finds its form.
 */

interface Spike {
  /** Center of the burst, in arc-length 0..1. */
  center: number;
  age: number;
  strength: number;
}

/**
 * Correspondence between the scribble and the resolved mark.
 *
 * Both curves are uniform arc-length samples of the same length, so the
 * pairing is a rotation of one index array against the other (optionally
 * reversed). We pick the rotation + direction that minimises total ANGULAR
 * mismatch about each shape's bounding-box centre: every point then travels
 * to a target sitting at roughly its own bearing, so paths run outward along
 * their own ray instead of sweeping across the shape and crossing.
 *
 * Crucially this only chooses WHICH target each point gets - the targets are
 * the mark's real sampled points, so the morph ends on the exact logo
 * contour. (Reconstructing targets from a radial profile r(theta) instead
 * looks equivalent but is not: an arm's long sides span almost no angular
 * range, so every point along them collapses onto the arm's outer radius and
 * the mark resolves into a spiky star that misses its own fill.)
 */
export function pairByAngle(source: THREE.Vector2[], target: THREE.Vector2[]): THREE.Vector2[] {
  const n = Math.min(source.length, target.length);
  const cs = boxCenterOf(source);
  const ct = boxCenterOf(target);

  const sa = new Float64Array(n);
  const ta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sa[i] = Math.atan2(source[i].y - cs.y, source[i].x - cs.x);
    ta[i] = Math.atan2(target[i].y - ct.y, target[i].x - ct.x);
  }

  // Coarse-to-fine search over the shift so the O(n^2) scan stays cheap on
  // the long mobile sample counts.
  const cost = (shift: number, dir: number): number => {
    let sum = 0;
    for (let i = 0; i < n; i += 4) {
      const j = ((((dir > 0 ? i : n - i) + shift) % n) + n) % n;
      let d = sa[i] - ta[j];
      // wrap to [-PI, PI] so 179 deg vs -179 deg counts as 2 deg apart
      d = Math.atan2(Math.sin(d), Math.cos(d));
      sum += d * d;
    }
    return sum;
  };

  let best = Infinity;
  let bestShift = 0;
  let bestDir = 1;
  const coarse = Math.max(1, Math.round(n / 360));
  for (const dir of [1, -1]) {
    for (let shift = 0; shift < n; shift += coarse) {
      const c = cost(shift, dir);
      if (c < best) {
        best = c;
        bestShift = shift;
        bestDir = dir;
      }
    }
  }
  for (let shift = bestShift - coarse; shift <= bestShift + coarse; shift++) {
    const c = cost(shift, bestDir);
    if (c < best) {
      best = c;
      bestShift = shift;
    }
  }

  // Emit the mark's own points, reordered, and framed on the origin - where
  // the source's bbox centre also sits - so the shape neither translates nor
  // rescales as it morphs. Position and scale stay owned by the caller.
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < source.length; i++) {
    const k = i % n;
    const j = ((((bestDir > 0 ? k : n - k) + bestShift) % n) + n) % n;
    out.push(new THREE.Vector2(target[j].x - ct.x, target[j].y - ct.y));
  }
  return out;
}

/**
 * Centre on the bounding box and scale the longest side to 1. Two shapes put
 * through this share a centre and a scale, which is what lets a morph between
 * them carry shape alone.
 */
function toUnitShape(pts: THREE.Vector2[]): THREE.Vector2[] {
  const box = new THREE.Box2().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector2());
  const e = box.getSize(new THREE.Vector2());
  const k = 1 / Math.max(e.x, e.y, 1e-9);
  return pts.map((p) => new THREE.Vector2((p.x - c.x) * k, (p.y - c.y) * k));
}

/** Centre of the axis-aligned bounding box — the shape's visual centre. */
function boxCenterOf(pts: THREE.Vector2[]): THREE.Vector2 {
  let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
  for (const p of pts) {
    if (p.x < lx) lx = p.x;
    if (p.x > hx) hx = p.x;
    if (p.y < ly) ly = p.y;
    if (p.y > hy) hy = p.y;
  }
  return new THREE.Vector2((lx + hx) / 2, (ly + hy) / 2);
}

export class Scribble {
  object: Line2;
  material: LineMaterial;
  private geometry: LineGeometry;
  /** Rest positions (current shape before displacement), updated by morph. */
  rest: THREE.Vector2[];
  /** Arc-length position 0..1 per point, for noise travel + stagger. */
  arcT: Float32Array;
  /** The interleaved segment buffer we write displaced positions into. */
  private buffer: THREE.InstancedInterleavedBuffer;
  private displaced: Float32Array;
  /** Shape-only positions for the current frame (unit space, uncentred). */
  private base: Float32Array; // N * 2 (xy)
  /** Unit normals of the rest path, N * 2 — displacement rides these. */
  private normals: Float32Array;

  private spikes: Spike[] = [];
  private nextSpikeAt = 0;

  /** Morph target (the paired Claude symbol points) + progress 0..1. */
  private target: THREE.Vector2[] | null = null;
  private targetRadial: Float32Array | null = null;
  morph = 0;
  /** Breathing pulse; -1 = off, otherwise the time the pulse started. */
  private pulseStart = -1;

  /** Uniform driving the hand-drawn per-point weight variation. */
  private unevenUniform = { value: HOLD.scribble.strokeWeightRange.unevenness };
  /** Local morph progress per point (0..1) — construction lines read this. */
  localT: Float32Array;
  /** Normalised polar angle 0..1 per point — drives the morph's sweep. */
  private angleT: Float32Array;
  /** Per-point path bend, so travel arcs instead of running dead straight. */
  private curveAmt: Float32Array;
  /** Lagged copy of `displaced`, drawn as the BREAKTHROUGH motion trail. */
  private trailHistory: Float32Array[] = [];
  private trailCursor = 0;
  trailObject: Line2 | null = null;
  private trailBuffer: THREE.InstancedInterleavedBuffer | null = null;
  /** Scale gesture applied this frame (breath, not zoom). */
  scale = 1;
  /** Cleared on mobile, where the trail is dropped entirely. */
  trailAllowed = true;
  /**
   * SIZE, held apart from shape. Both the scribble and the mark are stored
   * unit-normalised — same centre, same scale — so the morph interpolates
   * SHAPE ONLY and can neither translate nor resize the figure. What the
   * viewer actually sees is that unit shape put through these two explicit
   * world-unit sizes, which the layout owns and recomputes per breakpoint.
   */
  restSize = 1;
  markSize = 1;
  /** Total multiplier applied to the unit shape this frame (size x breath). */
  renderScale = 1;

  /**
   * Pointer reaction. `cursorRadius` and `cursorMax` are world units, set by
   * the layout from the config's screen px, so the reach is identical at any
   * window size. The per-point offsets are sprung and live ON TOP of the
   * noise — the stroke keeps churning while it leans.
   */
  cursorRadius = 0;
  cursorMax = 0;
  private cursorX = 0;
  private cursorY = 0;
  private cursorOn = false;
  private cursorOff: Float32Array;
  private cursorVel: Float32Array;

  /**
   * Latest pointer position, in world units. Called once per frame by the
   * caller rather than per pointermove, so a fast pointer cannot make this
   * run more often than the animation does.
   */
  setCursor(x: number, y: number, active: boolean): void {
    this.cursorX = x;
    this.cursorY = y;
    this.cursorOn = active;
  }

  constructor(points: THREE.Vector2[]) {
    // normalised to a unit box about its own centre; every size the figure
    // is ever drawn at is a transform applied on top of this
    this.rest = toUnitShape(points);
    const n = points.length;
    this.arcT = new Float32Array(n);
    for (let i = 0; i < n; i++) this.arcT[i] = i / (n - 1);
    this.displaced = new Float32Array(n * 2);
    /* the shape-only figure, before size, boil or placement */
    this.base = new Float32Array(n * 2);
    this.cursorOff = new Float32Array(n * 2);
    this.cursorVel = new Float32Array(n * 2);
    this.localT = new Float32Array(n);
    this.normals = new Float32Array(n * 2);
    this.angleT = new Float32Array(n);
    this.curveAmt = new Float32Array(n);
    {
      // `angleT` (the stagger phase) is filled in by setTarget, which derives
      // it from the MARK's bearing — see there. It is only ever read while a
      // target exists, so nothing needs it before then.
      for (let i = 0; i < n; i++) {
        // how much this point bows off its straight path, in both directions.
        // A LOW-FREQUENCY band around the stroke, not per-point noise:
        // neighbours bow by +/-curvature * travel distance, so independent
        // values would send adjacent points opposite ways and stretch the
        // segment between them at mid-flight. Integer cycle counts keep it
        // continuous across the seam.
        const u = (i / n) * Math.PI * 2;
        this.curveAmt[i] = Math.sin(3 * u + 0.7) * 0.65 + Math.sin(7 * u + 2.1) * 0.35;
      }
    }

    this.computeNormals();

    this.geometry = new LineGeometry();
    const flat: number[] = [];
    for (const p of points) flat.push(p.x, p.y, 0);
    this.geometry.setPositions(flat);
    this.buffer = (this.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute)
      .data as THREE.InstancedInterleavedBuffer;
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    // static per-point weight jitter: the stroke is slightly uneven along
    // its length, like a hand-drawn line. Amplitude lives in a uniform so it
    // can even out as the fill arrives, without touching the attribute.
    const jitterPairs = new Float32Array((n - 1) * 2);
    for (let j = 0; j < n - 1; j++) {
      jitterPairs[j * 2] = simplex2(this.arcT[j] * 14.0, 3.7);
      jitterPairs[j * 2 + 1] = simplex2(this.arcT[j + 1] * 14.0, 3.7);
    }
    const jitterBuffer = new THREE.InstancedInterleavedBuffer(jitterPairs, 2, 1);
    this.geometry.setAttribute(
      'instanceWidthStart',
      new THREE.InterleavedBufferAttribute(jitterBuffer, 1, 0),
    );
    this.geometry.setAttribute(
      'instanceWidthEnd',
      new THREE.InterleavedBufferAttribute(jitterBuffer, 1, 1),
    );

    this.material = new LineMaterial({
      color: new THREE.Color(HOLD.colors.ink).getHex(), // coral, start to finish
      linewidth: HOLD.scribble.strokeWeightRange.max,
      worldUnits: false,
    });
    // inject the per-segment width factor into LineMaterial's vertex shader
    const uneven = this.unevenUniform;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uUneven = uneven;
      shader.vertexShader = shader.vertexShader
        .replace(
          'uniform float linewidth;',
          [
            'uniform float linewidth;',
            'uniform float uUneven;',
            'attribute float instanceWidthStart;',
            'attribute float instanceWidthEnd;',
          ].join(String.fromCharCode(10)),
        )
        .replace(
          'offset *= linewidth;',
          'offset *= linewidth * (1.0 + uUneven * ((position.y < 0.5) ? instanceWidthStart : instanceWidthEnd));',
        );
    };

    this.object = new Line2(this.geometry, this.material);
    this.object.computeLineDistances();

    // motion trail: a lagged ghost of the stroke, only during breakthrough
    if (HOLD.trail.enabled) {
      const tg = new LineGeometry();
      tg.setPositions(flat);
      this.trailBuffer = (
        tg.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
      ).data as THREE.InstancedInterleavedBuffer;
      this.trailBuffer.setUsage(THREE.DynamicDrawUsage);
      const tm = new LineMaterial({
        color: new THREE.Color(HOLD.colors.brand).getHex(),
        linewidth: HOLD.scribble.strokeWeightRange.min,
        worldUnits: false,
        transparent: true,
        opacity: 0,
      });
      this.trailObject = new Line2(tg, tm);
      this.trailObject.visible = false;
      for (let k = 0; k < HOLD.trail.lagFrames + 1; k++) {
        this.trailHistory.push(new Float32Array(n * 2));
      }
    }

    this.nextSpikeAt = rand(HOLD.spikes.intervalMin, HOLD.spikes.intervalMax);
  }

  /** Target points of the resolved mark, in local coords. */
  get targetPoints(): THREE.Vector2[] | null {
    return this.target;
  }

  /** Current world-space xy per point (post displacement). */
  get displacedPositions(): Float32Array {
    return this.displaced;
  }

  /** Provide the resolved-mark points (already paired index-to-index). */
  setTarget(points: THREE.Vector2[]): void {
    // the mark is normalised into the same unit box as the scribble, so the
    // two shapes share a centre and a scale before anything interpolates
    points = toUnitShape(points);
    this.target = points;
    const n = points.length;
    this.targetRadial = new Float32Array(n);
    let maxR = 0;
    for (let i = 0; i < n; i++) maxR = Math.max(maxR, points[i].length());
    for (let i = 0; i < n; i++) this.targetRadial[i] = points[i].length() / (maxR || 1);

    // The stagger sweeps by bearing, and the bearing is taken from the TARGET,
    // not the scribble. The mark's points all sit well off its centre, so
    // their bearing turns smoothly once around the loop; the scribble's swings
    // hard (and averages to nothing) wherever it passes near its own centre,
    // which put a phase cliff in the middle of the stroke and tore one segment
    // open to 20x the mark's own spacing.
    //
    // A sweep around a closed loop has to wrap somewhere. Measuring the
    // bearing RELATIVE TO POINT 0 puts that wrap at index 0 — the one place
    // the polyline is already broken (segments are drawn 0..n-2), so the seam
    // costs nothing.
    // The bearing is UNWRAPPED along the array — each step is added as its
    // shortest turn — so the phase climbs continuously from the first sample
    // to the last and its one unavoidable discontinuity falls between index
    // n-1 and index 0, where no segment is drawn. Anchoring on a fixed bearing
    // instead leaves the wrap wherever the mark happens to cross it, which
    // lands mid-stroke and tears that segment open.
    const c = boxCenterOf(points);
    let prev = Math.atan2(points[0].y - c.y, points[0].x - c.x);
    let acc = 0;
    const un = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const a = Math.atan2(points[i].y - c.y, points[i].x - c.x);
      const d = a - prev;
      acc += Math.atan2(Math.sin(d), Math.cos(d));
      un[i] = acc;
      prev = a;
    }
    // normalising by the total turn covers either winding direction
    const span = Math.abs(acc) > 1e-6 ? acc : 1;
    for (let i = 0; i < n; i++) {
      this.angleT[i] = Math.min(Math.max(un[i] / span, 0), 1);
    }
  }

  /** Begin the slow breathing pulse (call when resolution completes). */
  startPulse(time: number): void {
    this.pulseStart = time;
  }

  stopPulse(): void {
    this.pulseStart = -1;
  }

  /**
   * Unit normals along the rest path (central differences). Call again
   * whenever `rest` changes (the morph does).
   */
  computeNormals(): void {
    const n = this.rest.length;
    for (let i = 0; i < n; i++) {
      const a = this.rest[(i - 1 + n) % n];
      const b = this.rest[(i + 1) % n];
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      this.normals[i * 2] = -ty / len;
      this.normals[i * 2 + 1] = tx / len;
    }
  }

  /**
   * Advance the living displacement. `time` is system time (already
   * timeScaled), `chaos` is 1 at idle → 0 at resolution.
   *
   * Anchors: each point sits between the `home` anchor (inside the head)
   * and the carried anchor (`carry`), blended by `peel` (0..1) staggered
   * along arc length — the stroke is drawn out of the head strand by
   * strand, not moved as a block. `ampGain` scales the noise (agitation
   * rises with distance from the head while carrying).
   */
  update(
    time: number,
    dt: number,
    chaos: number,
    home: { x: number; y: number },
    carry: { x: number; y: number },
    peel: number,
    ampGain = 1,
  ): void {
    const n = this.rest.length;
    const low = HOLD.noise.low;
    const high = HOLD.noise.high;

    // separate falloff curves: the tremor dies first, the sway last
    // Attention agitates the thought: as the pointer closes on the stroke the
    // noise bands are scaled up a little. Measured once from the shape's
    // anchor, not per point — this is a property of the moment, not of any
    // one part of the line.
    const F = HOLD.cursorField;
    let agitation = 1;
    if (this.cursorOn && this.cursorRadius > 0) {
      const dc = Math.hypot(this.cursorX - carry.x, this.cursorY - carry.y);
      if (dc < this.cursorRadius) {
        const u = 1 - dc / this.cursorRadius;
        agitation = 1 + (F.proximityAgitation - 1) * (u * u * (3 - 2 * u));
      }
    }
    ampGain *= agitation;

    const lowAmp = low.amplitude * Math.pow(chaos, low.falloffPower) * ampGain;
    // the high-frequency tremor is dropped entirely on mobile
    const highBase =
      window.innerWidth < HOLD.performance.mobileBreakpoint
        ? high.mobileAmplitude
        : high.amplitude;
    const highAmp = highBase * Math.pow(chaos, high.falloffPower) * ampGain;

    // --- arrhythmic spike bookkeeping ------------------------------------
    this.nextSpikeAt -= dt * Math.max(chaos, 0.001); // calm thoughts spike less
    if (this.nextSpikeAt <= 0 && chaos > 0.05) {
      this.spikes.push({ center: Math.random(), age: 0, strength: rand(0.6, 1) });
      this.nextSpikeAt = rand(HOLD.spikes.intervalMin, HOLD.spikes.intervalMax);
    }
    for (const s of this.spikes) s.age += dt;
    this.spikes = this.spikes.filter((s) => s.age < HOLD.spikes.decay * 3);

    const sw = HOLD.spikes.sectionWidth;
    const spikeGain = (t: number): number => {
      let g = 0;
      for (const s of this.spikes) {
        // wrap-around distance along the closed stroke
        let d = Math.abs(t - s.center);
        d = Math.min(d, 1 - d);
        const local = Math.exp(-(d * d) / (sw * sw * 0.25));
        const env = Math.exp(-s.age / HOLD.spikes.decay);
        g += s.strength * local * env;
      }
      return 1 + HOLD.spikes.intensity * g;
    };

    // --- displacement ----------------------------------------------------
    // line-boil: the noise clock steps at boilFps like redrawn frames
    const boil = HOLD.noise.boilFps;
    const bt = boil > 0 ? Math.floor(time * boil) / boil : time;
    const tl = bt * low.timeScale;
    const th = bt * high.timeScale;
    // peel weight: staggered along arc length so the stroke leaves the head
    // strand by strand. At peel=1 every point rides the carried anchor.
    const spread = HOLD.extraction.spread;
    const smooth01 = (t: number) => {
      const c = Math.min(Math.max(t, 0), 1);
      return c * c * (3 - 2 * c);
    };
    const dxA = carry.x - home.x;
    const dyA = carry.y - home.y;

    // morph shaping: angular sweep, per-point ease-out, arced travel
    const stagger = HOLD.staggerAmount;
    const curvature = HOLD.pathCurvature;
    const doMorph = this.target !== null && this.morph > 0;

    // breath, not zoom — a gather then a swell across the acts
    this.scale = doMorph ? scaleGesture(this.morph) : 1;
    // Size rides its own smooth curve between two explicit world sizes,
    // about the fixed shared centre. It is deliberately NOT the per-point
    // morph weight: the points carry shape, this carries scale, and the
    // figure therefore holds its centre at every progress value.
    const m = Math.min(Math.max(this.morph, 0), 1);
    const sizeT = m * m * (3 - 2 * m);
    this.renderScale = this.scale * (this.restSize + (this.markSize - this.restSize) * sizeT);
    const sc = this.renderScale;

    // breathing pulse: a radial band travelling center → tips
    let pFront = -10;
    const pBand = HOLD.pulse.bandWidth;
    if (this.pulseStart >= 0) {
      const phase = ((time - this.pulseStart) / HOLD.pulse.period) % 1;
      pFront = phase * (1 + 4 * pBand) - 2 * pBand;
    }

    // PASS 1 — the base figure: shape interpolation and nothing else.
    //
    // Both endpoints are unit-normalised about their bounding box, but an
    // intermediate blend's box is NOT the blend of the two boxes: with the
    // points staggered and bowed, the figure's centre wanders a few percent
    // mid-flight. Measuring the base here and removing that offset below
    // pins the centre at EVERY progress value, so the only thing that moves
    // the figure is a transform something deliberately drives.
    let bLoX = Infinity;
    let bHiX = -Infinity;
    let bLoY = Infinity;
    let bHiY = -Infinity;
    for (let i = 0; i < n; i++) {
      let bx = this.rest[i].x;
      let by = this.rest[i].y;
      if (doMorph) {
        const phase = this.angleT[i] * stagger;
        const raw = Math.min(Math.max(this.morph * (1 + stagger) - phase, 0), 1);
        const mw = easeOutCubic(raw);
        this.localT[i] = mw;

        const tp = this.target![i];
        const dx = tp.x - bx;
        const dy = tp.y - by;
        bx += dx * mw;
        by += dy * mw;

        // perpendicular bow, zero at both ends so start and finish are exact
        if (curvature > 0) {
          const len = Math.hypot(dx, dy);
          if (len > 1e-5) {
            const bend = curvature * this.curveAmt[i] * Math.sin(Math.PI * mw) * len;
            bx += (-dy / len) * bend;
            by += (dx / len) * bend;
          }
        }
      } else {
        this.localT[i] = 0;
      }
      this.base[i * 2] = bx;
      this.base[i * 2 + 1] = by;
      if (bx < bLoX) bLoX = bx;
      if (bx > bHiX) bHiX = bx;
      if (by < bLoY) bLoY = by;
      if (by > bHiY) bHiY = by;
    }
    const baseCx = (bLoX + bHiX) / 2;
    const baseCy = (bLoY + bHiY) / 2;

    // --- pointer field, per-frame constants ------------------------------
    const fieldOn = this.cursorOn && this.cursorRadius > 0 && this.cursorMax > 0;
    const fieldDir = F.mode === 'repel' ? -1 : 1;
    const fieldR = this.cursorRadius;
    const fieldMax = this.cursorMax;
    const { stiffness: fk, damping: fc, mass: fm } = F.spring;
    // Three time constants: ~95% of the way back at returnDuration, with the
    // travel spread across the whole window. A faster curve settles sooner on
    // paper but dumps most of the movement into the first few frames, which
    // is exactly the snap the release is supposed to avoid.
    const release = Math.exp((-dt * 3) / Math.max(F.returnDuration, 1e-3));

    // PASS 2 — size, breath, boil, and where on screen the figure sits.
    for (let i = 0; i < n; i++) {
      const at = this.arcT[i];
      // spikes multiply the band amplitudes (chaos is already inside them)
      const gain = spikeGain(at);
      // displacement rides the local normal only — the line boils about its
      // own spine, so the silhouette is respected however chaotic it gets
      const mag =
        lowAmp * gain * simplex2(at * low.spatialScale * 10, tl) +
        highAmp * gain * simplex2(at * high.spatialScale * 10 + 31.7, th);

      // the shape, re-centred, then sized: scale is the only thing here that
      // can change how big the figure is, and it is about a fixed centre
      let bx = (this.base[i * 2] - baseCx) * sc;
      let by = (this.base[i * 2 + 1] - baseCy) * sc;


      // pulse: push the resolved mark's points outward as the wave passes
      if (pFront > -5 && this.targetRadial) {
        const dr = (this.targetRadial[i] - pFront) / pBand;
        const wave = Math.exp(-dr * dr) * HOLD.pulse.amplitude;
        const r = Math.hypot(bx, by) || 1;
        bx += (bx / r) * wave;
        by += (by / r) * wave;
      }

      const w = smooth01(peel * (1 + spread) - at * spread);
      // where the point sits with the noise, before the pointer is consulted
      const wx = bx + this.normals[i * 2] * mag + home.x + dxA * w;
      const wy = by + this.normals[i * 2 + 1] * mag + home.y + dyA * w;

      // POINTER FIELD — added to that position, never replacing it.
      //
      // The distance test runs against the noise-driven position rather than
      // the offset one, so the reach cannot feed back on itself. In range the
      // offset springs toward its target, which gives the lean its weight and
      // its lag; out of range it eases to zero over returnDuration instead,
      // so the release is a settle rather than a spring-back.
      let ox = this.cursorOff[i * 2];
      let oy = this.cursorOff[i * 2 + 1];
      let tx = 0;
      let ty = 0;
      if (fieldOn) {
        const ddx = this.cursorX - wx;
        const ddy = this.cursorY - wy;
        const d = Math.hypot(ddx, ddy);
        if (d < fieldR && d > 1e-6) {
          const u = 1 - d / fieldR;
          // smoothstep: no crease at the rim, no linear ramp
          const amt = fieldMax * u * u * (3 - 2 * u) * fieldDir;
          tx = (ddx / d) * amt;
          ty = (ddy / d) * amt;
        }
      }
      if (tx !== 0 || ty !== 0) {
        const ax = (fk * (tx - ox) - fc * this.cursorVel[i * 2]) / fm;
        const ay = (fk * (ty - oy) - fc * this.cursorVel[i * 2 + 1]) / fm;
        this.cursorVel[i * 2] += ax * dt;
        this.cursorVel[i * 2 + 1] += ay * dt;
        ox += this.cursorVel[i * 2] * dt;
        oy += this.cursorVel[i * 2 + 1] * dt;
      } else if (ox !== 0 || oy !== 0) {
        ox *= release;
        oy *= release;
        this.cursorVel[i * 2] = 0;
        this.cursorVel[i * 2 + 1] = 0;
        if (Math.abs(ox) < 1e-5) ox = 0;
        if (Math.abs(oy) < 1e-5) oy = 0;
      }
      this.cursorOff[i * 2] = ox;
      this.cursorOff[i * 2 + 1] = oy;

      this.displaced[i * 2] = wx + ox;
      this.displaced[i * 2 + 1] = wy + oy;
    }
    this.writeDisplaced();
    this.updateTrail(n);
  }

  /** Write an xy array into an interleaved segment buffer, in place. */
  private writeSegments(buf: THREE.InstancedInterleavedBuffer, d: Float32Array): void {
    const arr = buf.array as Float32Array;
    const n = this.rest.length;
    for (let j = 0; j < n - 1; j++) {
      const o = j * 6;
      arr[o] = d[j * 2];
      arr[o + 1] = d[j * 2 + 1];
      arr[o + 2] = 0;
      arr[o + 3] = d[j * 2 + 2];
      arr[o + 4] = d[j * 2 + 3];
      arr[o + 5] = 0;
    }
    buf.needsUpdate = true;
  }

  private writeDisplaced(): void {
    this.writeSegments(this.buffer, this.displaced);
  }

  /** Ring-buffer the recent positions and draw the lagged ghost. */
  private updateTrail(n: number): void {
    if (!this.trailObject || !this.trailBuffer || this.trailHistory.length === 0) return;
    void n;
    this.trailHistory[this.trailCursor].set(this.displaced);
    this.trailCursor = (this.trailCursor + 1) % this.trailHistory.length;
    // after advancing, the cursor points at the oldest frame we keep
    this.writeSegments(this.trailBuffer, this.trailHistory[this.trailCursor]);
  }

  /** Hand-drawn weight variation, 0..full — evens out as the fill lands. */
  setUneven(fraction: number): void {
    this.unevenUniform.value = fraction;
  }

  /** Trail strength 0..1 — driven by the breakthrough act only. */
  setTrail(strength: number, resolution: THREE.Vector2 | null): void {
    if (!this.trailObject) return;
    if (!this.trailAllowed) {
      this.trailObject.visible = false;
      return;
    }
    const mat = this.trailObject.material as LineMaterial;
    const on = strength > 0.01;
    this.trailObject.visible = on;
    mat.opacity = HOLD.trail.opacity * strength;
    if (resolution) mat.resolution.copy(resolution);
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
