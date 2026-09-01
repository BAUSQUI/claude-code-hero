import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { HOLD } from './config';
import { sampleSvgPath, loadSvgArt, loadHeadMesh, loadOutlinePoints } from './assets';
import { Scribble, pairByAngle } from './scribble';
import { HoldCursor } from './cursor';
import { DragController } from './drag';
import { colorState } from './colors';
import { WorkLog } from './worklog';
import { actProgress, EASES, type EaseName } from './acts';
import { Construction, findArmTips } from './construction';
import { Arrival } from './arrival';
import { measureGrid, buildGridOverlay, type Grid } from './grid';
import { buildPage } from './page';
import { HoldGesture } from './holdgesture';
import { asset } from './paths';
import { ChaosAudio } from './audio';
import {
  parseIntent,
  applyIntent,
  defaultParams,
  isNoOp,
  lerpParams,
  type MarkParams,
} from './intent';

/**
 * "Stop holding it all in your head" — drag-and-drop build, step 1:
 * grab, elastic spring follow, drop detection, inside-vs-outside-head test.
 * The scribble stays at full chaos throughout; resolution comes after the
 * drop in later steps.
 */

const container = document.getElementById('app')!;
const grainEl = document.getElementById('grain') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(HOLD.colors.bgStart);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
camera.position.z = 5;

function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
}

function isMobile(): boolean {
  return viewportSize().w < HOLD.performance.mobileBreakpoint;
}

/** Live grid + the world/pixel scale derived from the head's target size. */
let grid: Grid = measureGrid();
let viewHeight = 4;
let worldPerPx = 1;
/** Stage-space top of the thinking log (set by layout from the subtitle). */
let logTop = 0;
/** Layout mode the current state was built for; drives the teardown below. */
let lastMobile = viewportSize().w < HOLD.performance.mobileBreakpoint;
/** 0 = scribble fully inside the head, 1 = fully out. Drives the head. */
let dragProgress = 0;
/** Stroke fade-in, 0..1 over strokeFadeInDuration. Reversible. */
let strokeInT = 0;
/** Mobile: the head's removal once the thought is dropped. */
let headGoneT = 0;

/**
 * The head's pixel size comes from the CONTAINER GRID (columns fromCol..
 * toCol of the measured container), and the camera's view height is derived
 * from it — so the head's world height, and every proportion downstream,
 * stays exactly as authored while the whole scene rides the container.
 */
/** The head's left edge: column 1 of the container (no bleed). */
function headLeftPx(g: Grid): number {
  return g.colLeft(HOLD.layout.head.startCol);
}

/**
 * The mobile head slot's height. ONE owner: layout() and the per-frame
 * reflow both read this, so they cannot fight each other and thrash the
 * stage height (which the camera is derived from).
 */
function fullHeadHeight(g: Grid): number {
  return g.contentWidth / headAspect;
}

/**
 * Reserve the log's box: exactly the log's own full height, so its rows have
 * their space before they arrive and none of them shifts the page as it fades
 * in. Deliberately NOT padded out to absorb the head slot's collapse — the
 * CTA is meant to ride up with that collapse and come to rest directly under
 * the last log row, where it is visible and reads as "there is more below".
 */
function reserveLogSlot(mobile: boolean): void {
  const logSlot = document.getElementById('logSlot');
  if (!logSlot) return;
  const want = mobile ? `${Math.ceil(workLog.fullHeight)}px` : '';
  if (logSlot.style.minHeight !== want) logSlot.style.minHeight = want;
}

function desiredSlotHeight(g: Grid): number {
  const L = HOLD.layout;
  const headPx = fullHeadHeight(g);
  const dropped = drag.state === 'dropped' || dropPhase !== 'none';
  if (!dropped) return headPx;
  // Once the head is gone the slot tightens to the mark, closing the gap the
  // empty silhouette leaves behind. What it gives up is handed straight to
  // the log's box below (see layout()), so the two always sum to the same
  // height and nothing under them moves.
  // Hugs the mark: the top pad keeps it off the subtitle, but a matching pad
  // underneath only pushes the CTA further down the page for nothing — the
  // log's own box provides the separation below.
  const markPx = L.mobileSymbolScale * headPx;
  return Math.min(markPx + L.mobileMarkTopPx, headPx);
}

/** Stage-space top of the CTA block — the head's lower bound. */
function ctaTopPx(g: Grid): number {
  const cta = document.querySelector('.hero__cta');
  const stage = document.getElementById('stage');
  if (!cta || !stage) return g.heroTop + g.heroHeight * 0.8;
  return cta.getBoundingClientRect().top - stage.getBoundingClientRect().top;
}

function headPixelSize(g: Grid): { w: number; h: number } {
  const L = HOLD.layout;
  if (g.mobile) {
    // mobile: the head fills the content width, in the document flow
    const w = g.contentWidth;
    return { w, h: w / headAspect };
  }
  // sized by HEIGHT: from just under the secondary bar down to just above
  // the CTA block. Width then follows from the artwork's aspect.
  const top = g.heroTop + L.head.topPx;
  const h = Math.max(ctaTopPx(g) - L.head.gapAboveCta - top, 40);
  return { w: h * headAspect, h };
}

function computeScale(g: Grid): void {
  const { h } = headPixelSize(g);
  worldPerPx = HOLD.layout.headHeight / h;
  viewHeight = g.stageHeight * worldPerPx;
}

/** Column edge/centre -> world x. THE bridge between the grid and canvas. */
function columnToWorld(col: number, edge: 'left' | 'right' | 'center' = 'left'): number {
  const px =
    edge === 'left'
      ? grid.colLeft(col)
      : edge === 'right'
        ? grid.colRight(col)
        : (grid.colLeft(col) + grid.colRight(col)) / 2;
  return pxToWorldX(px);
}

/** CSS px -> world coordinates. */
function pxToWorldX(px: number): number {
  return (px - grid.stageWidth / 2) * worldPerPx;
}
function pxToWorldY(py: number): number {
  return (grid.stageHeight / 2 - py) * worldPerPx;
}

function viewHalfWidth(): number {
  return (viewHeight / 2) * (grid.stageWidth / grid.stageHeight);
}

// --- build ------------------------------------------------------------------

const headHeight = HOLD.layout.headHeight;
const head = await loadHeadMesh(asset('head.png'), headHeight);
scene.add(head);
const headMat = head.material as THREE.ShaderMaterial;
const headU = headMat.uniforms;

// The head's outline is its own vector asset, normalised to unit height and
// then scaled/positioned onto exactly the same box as the filled plane — so
// swapping between the two states cannot shift a pixel.
const outlinePts = await loadOutlinePoints(asset('Head-stroke.svg'), 900);
const outlineGeo = new LineGeometry();
outlineGeo.setPositions(outlinePts.flatMap((p) => [p.x, p.y, 0]));
const outlineMat = new LineMaterial({
  color: new THREE.Color(HOLD.colors.head).getHex(),
  linewidth: HOLD.headStrokeWidth,
  worldUnits: false,
  transparent: true,
  opacity: 0,
});
const headOutline = new Line2(outlineGeo, outlineMat);
headOutline.visible = false;
headOutline.position.z = 0.02;
scene.add(headOutline);
const headAspect =
  (head.geometry as THREE.PlaneGeometry).parameters.width / headHeight;

// Sampled at a CANONICAL size, not the current breakpoint's: Scribble
// unit-normalises whatever it is given, and every size the figure is drawn at
// is an explicit transform the layout sets. Nothing about the shape data is
// therefore tied to the mode the page happened to boot in. (Sample COUNT is
// still chosen once, for cost — it affects fidelity, never position or size.)
const scribblePts = await sampleSvgPath(
  asset('scribble.svg'),
  isMobile() ? HOLD.scribble.mobileSamples : HOLD.scribble.samples,
  headHeight * HOLD.layout.scribbleScale,
);
const scribble = new Scribble(scribblePts);
// points are placed in world coords by the anchor blend; object stays put
scribble.object.position.set(0, 0, 0.1);
scene.add(scribble.object);

// the resolved mark: same sample count, paired index-to-index (with a
// shift/direction pass to reduce crossing during the morph)
/** World extent the filled mark's geometry is authored at. */
const symbolGeomSize = headHeight * HOLD.layout.symbolScale;
const symbolArt = await loadSvgArt(asset('claude-symbol.svg'), scribblePts.length, symbolGeomSize);
// guarantee identical counts (sampling of closed paths can differ by one)
const symbolPts = Array.from(
  { length: scribblePts.length },
  (_, i) => symbolArt.points[i % symbolArt.points.length],
);
// ANGULAR correspondence: each point travels along its own ray to the
// symbol's boundary at the same angle, so nothing crosses the shape.
scribble.setTarget(pairByAngle(scribblePts, symbolPts));

// The resolved mark is the real filled logo. Its geometry shares the exact
// transform of the sampled points, so the stroke lands on its contour and
// hands over cleanly.
symbolArt.fill.computeBoundingSphere();
const markMaxR = symbolArt.fill.boundingSphere?.radius ?? 1;

// The breathing pulse lives on the filled mark: a radial wave travelling
// centre → tips, displacing vertices outward as it passes.
const markFillMat = new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.DoubleSide,
  uniforms: {
    uColor: { value: new THREE.Color(HOLD.colors.brand) },
    uOpacity: { value: 0 },
    uFlood: { value: 0 }, // reveal front, radial 0..1(+feather); 0 = no fill
    uFloodFeather: { value: HOLD.fill.feather },
    uFillOrigin: { value: new THREE.Vector2(HOLD.fill.origin.x, HOLD.fill.origin.y) },
    uPulse: { value: -10 }, // wave front in 0..1 radial units; <0 = off
    uBand: { value: HOLD.pulse.bandWidth },
    uAmp: { value: HOLD.pulse.amplitude },
    uMaxR: { value: markMaxR },
    uSharpness: { value: 1 },
    uArmLength: { value: 1 },
    uArmVariance: { value: 0 },
    uRotation: { value: 0 },
    uArmCount: { value: 12 }, // set from the detected arm tips after load
  },
  vertexShader: /* glsl */ `
    uniform float uPulse, uBand, uAmp, uMaxR;
    uniform float uSharpness, uArmLength, uArmVariance, uRotation, uArmCount;
    uniform vec2 uFillOrigin;
    varying float vR0;

    // cheap deterministic per-arm hash
    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    void main() {
      vec3 p = position;
      float r = length(p.xy);

      // All shaping happens in the mark's own frame, so rotating never
      // reshuffles which arm gets which variance.
      if (r > 1e-4) {
        float rn = clamp(r / uMaxR, 1e-4, 1.0);
        // radial gamma: >1 pinches the waists between arms (sharper points),
        // <1 fattens them. Tips sit at uMaxR so the silhouette survives.
        float k = pow(rn, uSharpness - 1.0);
        // arm reach, weighted by radius so the hub stays where it is
        k *= mix(1.0, uArmLength, rn);
        // per-arm length variation on top of the mark's own irregularity
        if (uArmVariance > 1e-4) {
          float idx = floor((atan(p.y, p.x) + 3.14159265) / 6.28318531 * uArmCount);
          k *= 1.0 + uArmVariance * (hash11(idx) * 2.0 - 1.0) * 0.16 * rn;
        }
        p.xy *= k;
        r = length(p.xy);
      }

      // radial coordinate for the flood reveal (pre-pulse, post-shaping)
      vR0 = length(p.xy - uFillOrigin) / uMaxR;

      if (uPulse > -5.0 && r > 1e-4) {
        float dr = (r / uMaxR - uPulse) / uBand;
        p.xy += normalize(p.xy) * exp(-dr * dr) * uAmp;
      }

      // tilt applied last
      float ca = cos(uRotation), sa = sin(uRotation);
      p.xy = mat2(ca, -sa, sa, ca) * p.xy;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uOpacity;
    uniform float uFlood, uFloodFeather;
    varying float vR0;
    void main() {
      // the fill floods outward: visible only behind the travelling front
      float reveal = clamp((uFlood - vR0) / uFloodFeather, 0.0, 1.0);
      float alpha = uOpacity * reveal;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(uColor, alpha);
      #include <colorspace_fragment>
    }
  `,
});
const markFill = new THREE.Mesh(symbolArt.fill, markFillMat);
markFill.position.z = 0.05;
markFill.visible = false;
scene.add(markFill);

// structure during the morph: guides + anchor flashes
const symbolTips = findArmTips(symbolPts);
const construction = new Construction(scribblePts.length, symbolTips, isMobile());
// the per-arm variance keys off the mark's real arm count
markFillMat.uniforms.uArmCount.value = Math.max(symbolTips.length, 3);
scene.add(construction.group);
scribble.trailAllowed = isMobile() ? HOLD.trail.mobileEnabled : HOLD.trail.enabled;
if (scribble.trailObject) scene.add(scribble.trailObject);

grainEl.style.opacity = String(HOLD.grainOpacity);
const cursor = new HoldCursor();
buildPage();
const workLog = new WorkLog(isMobile());
const arrival = new Arrival();

const scribbleRadius =
  (headHeight *
    (isMobile() ? HOLD.layout.mobileScribbleScale : HOLD.layout.scribbleScale)) /
  2;
const hitScale = isMobile() ? HOLD.drag.mobileHitRadiusScale : HOLD.drag.hitRadiusScale;
const drag = new DragController(scribbleRadius * hitScale);

// Mobile swaps drag-and-drop for press-and-hold. The hit test is in client
// coords and generous — well beyond the scribble's visual bounds.
const holdGesture: HoldGesture = new HoldGesture(container, (cx, cy) => {
  const p = screenToWorld(cx, cy);
  return Math.hypot(p.x - drag.pos.x, p.y - drag.pos.y) <= drag.hitRadius;
});
// mobile's equivalent of the drag starting: the press itself is the grab
holdGesture.onGrab = () => audio.grab();

/** Post-drop timeline state. Declared here because the first layout pass —
 *  which runs at module top level — already reads it. */
type DropPhase = 'none' | 'settling' | 'beat' | 'resolving' | 'resolved';
let dropPhase: DropPhase = 'none';
let dropTimer = 0;

// static monospace label near the head
const labelEl = document.createElement('div');
labelEl.textContent = isMobile() ? HOLD.hold.label : HOLD.idleLabel;
labelEl.style.cssText = `
  position: absolute; z-index: 5; pointer-events: none;
  font-family: 'Archivo', system-ui, sans-serif; font-weight: 400;
  color: ${HOLD.colors.ink2};
  transform: translate(-50%, 0); white-space: nowrap;
  transition: opacity 0.3s ease;
`;
(document.getElementById('stage') ?? document.body).appendChild(labelEl);

// The idle hint animates an inner span, so it can never fight the wrapper's
// opacity — which the frame loop rewrites every tick as the gesture advances.
const labelText = document.createElement('span');
labelText.textContent = labelEl.textContent;
labelText.style.display = 'inline-block';
labelEl.textContent = '';
labelEl.appendChild(labelText);
{
  const st = document.createElement('style');
  st.textContent =
    '@keyframes holdIdleHint{' +
    '0%,100%{transform:scale(1);opacity:1}' +
    '35%{transform:scale(1.06);opacity:0.55}' +
    '70%{transform:scale(1);opacity:1}}' +
    '.hold-idle-hint{animation:holdIdleHint 1.1s ease-in-out}' +
    '@media (prefers-reduced-motion: reduce){.hold-idle-hint{animation:none}}';
  document.head.appendChild(st);
}
labelText.addEventListener('animationend', () => labelText.classList.remove('hold-idle-hint'));

/** Once per idle stretch: a single soft pulse, never a loop. */
let idleT = 0;
let idleHintArmed = true;
function pulseLabel(): void {
  labelText.classList.remove('hold-idle-hint');
  void labelText.offsetWidth; // restart the animation
  labelText.classList.add('hold-idle-hint');
}

// debug readout (?debug)
let debugEl: HTMLDivElement | null = null;
if (new URLSearchParams(location.search).has('grid')) buildGridOverlay();

if (new URLSearchParams(location.search).has('debug')) {
  debugEl = document.createElement('div');
  debugEl.style.cssText = `
    position: fixed; left: 12px; bottom: 10px; z-index: 20; pointer-events: none;
    font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em;
    color: ${HOLD.colors.ink}; opacity: 0.7; white-space: pre;
  `;
  document.body.appendChild(debugEl);
}

/**
 * onSubmit(text): parse locally against the intent map and animate the mark.
 * No network. Unrecognised input answers in the log rather than doing nothing.
 */
arrival.onSubmit = (text: string) => {
  const ui = '#' + colorState(resolveT).ui.getHexString();
  const hit = parseIntent(text);
  if (!hit) {
    const f = HOLD.demo.fallback;
    workLog.showNotice([f.message, ...f.suggestions], ui);
    return;
  }
  const next = applyIntent(markParams, hit.rule);
  if (isNoOp(markParams, next)) {
    // already at the safe limit for this property — say so, don't no-op
    workLog.showNotice([hit.rule.label + ' — already at its limit'], ui);
    return;
  }
  workLog.hideNotice();
  markFrom = { ...markParams };
  markTo = next;
  tweenT = 0;
};

// --- layout / resize --------------------------------------------------------

/** World position of the label anchor, projected to screen. */
function placeLabel() {
  const scale = head.scale.x || 1;
  const p = new THREE.Vector3(
    // Centred on the HEAD's box, not on the scribble: the scribble sits
    // off-centre inside the head, so following it left the label visibly
    // off to one side of the silhouette it is printed on.
    grid.mobile ? head.position.x : drag.home.x,
    drag.home.y -
      headHeight *
        scale *
        (grid.mobile ? HOLD.layout.mobileLabelDrop : HOLD.layout.labelDrop),
    0,
  ).project(camera);
  // the label is absolutely positioned inside the STAGE, and the camera maps
  // to the stage box — never the viewport, which is shorter on mobile
  labelEl.style.left = `${((p.x + 1) / 2) * grid.stageWidth}px`;
  labelEl.style.top = `${((1 - p.y) / 2) * grid.stageHeight}px`;
}

function layout() {
  const L = HOLD.layout;
  const mobile = grid.vw < HOLD.performance.mobileBreakpoint;

  // The log sits in the document flow on mobile and over the stage on
  // desktop. Its flow box reserves the log's FULL height from the start, so
  // the CTA under it is pushed clear before a single row has appeared and
  // never moves once they do.
  workLog.mount(mobile ? document.getElementById('logSlot') : null);
  reserveLogSlot(mobile);

  // head on the container grid: right edge locked to its column span,
  // left running into the bleed (fromCol 0 = one column outside)
  const { w: headWpx, h: headPx } = headPixelSize(grid);
  const slot = document.getElementById('headSlot');
  const stageEl = document.getElementById('stage');
  let headLeft = headLeftPx(grid);
  let headTop = grid.heroTop + L.head.topPx;
  if (mobile && slot && stageEl) {
    // the head's box IS the placeholder's box, so the flow owns its space
    const want = Math.round(desiredSlotHeight(grid)) + 'px';
    if (slot.style.height !== want) slot.style.height = want;
    const sr = slot.getBoundingClientRect();
    const st = stageEl.getBoundingClientRect();
    headLeft = sr.left;
    headTop = sr.top - st.top;
  }
  head.position.set(pxToWorldX(headLeft + headWpx / 2), pxToWorldY(headTop + headPx / 2), 0);
  // geometry was built at `headHeight` world units; keep it exact
  head.scale.setScalar((headPx * worldPerPx) / headHeight);

  // the outline shares the head's box exactly: same centre, scaled by the
  // head's world height (its points are normalised to unit height)
  const headWorldH = headPx * worldPerPx;
  headOutline.position.set(head.position.x, head.position.y, 0.02);
  headOutline.scale.setScalar(headWorldH);
  outlineMat.linewidth = HOLD.headStrokeWidth * grid.scale * renderer.getPixelRatio();

  drag.setHome(
    head.position.x + L.scribbleOffset.x * headHeight,
    head.position.y + L.scribbleOffset.y * headHeight,
    drag.state === 'idle',
  );

  // log anchor: below the subtitle, on the 8px rhythm (stage coordinates)
  const sub = document.querySelector('.sub');
  const stage = document.getElementById('stage');
  if (sub && stage) {
    const sr = sub.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    logTop = sr.bottom - st.top + HOLD.workLog.gapBelowSubtitle;
    if (mobile) {
      // mobile stacks: the log goes under the mark, inside the head's box
      const slotEl = document.getElementById('headSlot');
      if (slotEl) {
        const slotR = slotEl.getBoundingClientRect();
        const markPx = L.mobileSymbolScale * (grid.contentWidth / headAspect);
        logTop = slotR.top - st.top + L.mobileMarkTopPx + markPx + 12;
      }
    }

    // The mark's design size is a fixed ratio of the CONTAINER width
    // (349px at 1440), so it keeps its presence as the viewport changes;
    // it is then capped by the room the grid actually leaves between the
    // subtitle and the input so it can never overlap either.
    const inp = document.querySelector('.hero__input');
    const designPx = L.symbolScale * headPx; // what the geometry renders at
    // The pointer field's reach, converted from screen px through the very
    // same px->world scale the rest of the layout uses — so it is the same
    // 220px at any window size, and cannot drift the way a viewport fraction
    // would.
    scribble.cursorRadius = HOLD.cursorField.influenceRadius * worldPerPx;
    scribble.cursorMax = HOLD.cursorField.maxDisplacement * worldPerPx;

    // The two world sizes the morph runs between. Recomputed here every
    // layout pass, so a breakpoint change simply gives new numbers rather
    // than leaving the figure at the other mode's scale.
    scribble.restSize =
      headHeight * (mobile ? L.mobileScribbleScale : L.scribbleScale);
    if (inp && !mobile) {
      const wantPx = (L.markBoxAt1440 / 1440) * grid.containerWidth;
      const gapPx =
        inp.getBoundingClientRect().top - st.top - (sr.bottom - st.top) - L.markGutter * 2;
      // the design size, capped by the room the grid actually leaves
      scribble.markSize =
        headHeight * L.symbolScale * (Math.min(wantPx, Math.max(gapPx, 40)) / designPx);
    } else {
      scribble.markSize = headHeight * (mobile ? L.mobileSymbolScale : L.symbolScale);
    }
  }

  placeLabel();
}

/**
 * On mobile `layout()` sets the head slot's height, which changes the stage
 * height the camera was just derived from — so a single pass can leave the
 * canvas mapped to a stale box. Iterate until the stage stops moving.
 */
function resize() {
  // the gesture differs by platform, so the prompt has to follow the breakpoint
  labelText.textContent = isMobile() ? HOLD.hold.label : HOLD.idleLabel;
  labelEl.style.fontSize = `${isMobile() ? HOLD.hold.labelSize : HOLD.idleLabelSize}px`;

  // A breakpoint change is a discontinuity, not a resize: the two modes place
  // the figure by different rules, so anything still in flight would land it
  // using the old ones. Tear that down BEFORE measuring, then rebuild every
  // position from the new grid below — nothing is carried across.
  const modeChanged = isMobile() !== lastMobile;
  if (modeChanged) enterMode();

  for (let pass = 0; pass < 3; pass++) {
    grid = measureGrid();
    computeScale(grid);
    const w = grid.stageWidth;
    const h = grid.stageHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, HOLD.performance.maxPixelRatio));
    renderer.setSize(w, h);
    const hw = viewHalfWidth();
    camera.left = -hw;
    camera.right = hw;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    scribble.setResolution(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    outlineMat.resolution.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    construction.setResolution(h * renderer.getPixelRatio(), viewHeight);
    layout();
    const settled = document.getElementById('stage')?.getBoundingClientRect().height ?? h;
    if (Math.abs(settled - h) < 1) break;
  }

  // The resting place is derived from the grid, so a piece that has already
  // been dropped is holding a position computed against the old one. Re-place
  // it against the new grid — snapping across a mode change, springing within
  // a mode so an ordinary resize stays continuous.
  if (drag.state === 'dropped' || dropPhase !== 'none') {
    const rest = restingPosition();
    drag.setDropPoint(rest.x, rest.y, modeChanged);
  }
  lastMobile = isMobile();
}

/**
 * Debounced so a drag-resize does not thrash the layout, and trailing so the
 * FINAL size always applies. The first pass runs straight away — there is
 * nothing to debounce yet and the page must not paint unpositioned.
 */
let resizeTimer = 0;
function scheduleResize(): void {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resize, HOLD.performance.resizeDebounceMs);
}
window.addEventListener('resize', scheduleResize);
new ResizeObserver(scheduleResize).observe(container);
resize();

// --- pointer plumbing -------------------------------------------------------

function screenToWorld(px: number, py: number): { x: number; y: number } {
  // client coords -> stage coords (the stage scrolls with the page)
  return {
    x: pxToWorldX(px),
    y: pxToWorldY(py - grid.stageTop),
  };
}

/** Generous ellipse test against the head silhouette's bounds. */
function insideHead(x: number, y: number): boolean {
  const ex = (headHeight * headAspect * 0.5) * HOLD.drag.headEllipse.x;
  const ey = headHeight * 0.5 * HOLD.drag.headEllipse.y;
  const dx = (x - head.position.x) / ex;
  const dy = (y - head.position.y) / ey;
  return dx * dx + dy * dy < 1;
}

window.addEventListener('contextmenu', (e) => e.preventDefault());
container.addEventListener(
  'touchmove',
  (e) => {
    if (drag.state === 'dragging') e.preventDefault();
  },
  { passive: false },
);

container.addEventListener('pointerdown', (e) => {
  // once the head has begun fading the piece is committed: resolution runs
  // on its own and the thought is no longer the user's to carry
  if (grabLocked()) return;
  const p = screenToWorld(e.clientX, e.clientY);
  drag.pointerWorld.set(p.x, p.y);
  if (drag.tryGrab()) {
    // fired here rather than from the frame loop: the sound belongs to the
    // instant of taking hold, not to the frame that notices it
    audio.grab();
    // capture so the drag survives leaving the canvas
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});
window.addEventListener('pointermove', (e) => {
  const p = screenToWorld(e.clientX, e.clientY);
  drag.pointerWorld.set(p.x, p.y);
});
function restingPosition(): { x: number; y: number } {
  const L = HOLD.layout;
  const mobile = grid.vw < HOLD.performance.mobileBreakpoint;
  const [c0, c1] = L.markColumns;
  // both axes computed in px on the grid, then converted once
  const xPx = mobile
    ? grid.contentLeft + grid.contentWidth / 2
    : (grid.colLeft(c0) + grid.colRight(c1)) / 2;
  // vertically: centred between the subtitle and the input. The log sits
  // BESIDE the mark (columns 7-9 against the mark's 9-12), as in the
  // reference, so it does not push the mark down.
  let y = grid.heroTop + grid.heroHeight * (mobile ? L.mobileMarkHeroY : L.markHeroY);
  if (mobile) {
    // centred in the space the head occupied, with the log beneath it
    const slot = document.getElementById('headSlot');
    const stageEl = document.getElementById('stage');
    if (slot && stageEl) {
      const sr = slot.getBoundingClientRect();
      const st = stageEl.getBoundingClientRect();
      const markPx = L.mobileSymbolScale * (grid.contentWidth / headAspect);
      y = sr.top - st.top + markPx / 2 + L.mobileMarkTopPx;
    }
  } else {
    const sub = document.querySelector('.sub');
    const inp = document.querySelector('.hero__input');
    const stage = document.getElementById('stage');
    if (sub && inp && stage) {
      const st = stage.getBoundingClientRect();
      y =
        (sub.getBoundingClientRect().bottom -
          st.top +
          (inp.getBoundingClientRect().top - st.top)) /
        2;
    }
  }
  // fine nudge (x right, y up), scaled with the container
  const nx = L.markNudge.x * grid.scale;
  const ny = L.markNudge.y * grid.scale;
  return { x: pxToWorldX(xPx + nx), y: pxToWorldY(y - ny) };
}

const release = () => drag.drop(insideHead(drag.pos.x, drag.pos.y), restingPosition());
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

// --- loop -------------------------------------------------------------------

const clock = new THREE.Clock();
let elapsed = 0;
let running = true;
let rafId = 0;

/** chaos stays 1 through idle and drag; resolution (step 3) lowers it. */
let chaos = 1;

/** Post-drop timeline: settle at rest → one-beat pause, head visibly empty →
 *  head fades → resolution (automatic) → resolved, breathing. */

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Resolution progress, 0..1 — drives every colour in the composition. */
let resolveT = 0;
/** System time at which resolution completed (starts the breathing). */
let resolvedAt = 0;
/** Seconds since the flood began (BREAKTHROUGH onward). */
let floodT = 0;
const smooth01 = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};
/** Live mark parameters, and the tween that animates between them. */
let markParams: MarkParams = defaultParams();
let markFrom: MarkParams = defaultParams();
let markTo: MarkParams = defaultParams();
let tweenT = 1;
/** Accumulated breathing phase, so rate changes stay continuous. */
let pulsePhase = 0;

/**
 * Switch layout modes, keeping the interaction phase but nothing else.
 *
 * The phase (idle / dragging / dropped / resolving / resolved) is preserved
 * deliberately: the visitor's place in the story should survive a rotation or
 * a window drag. Everything the phase is DRAWN with, though, is mode-specific
 * — positions, sizes, the log — so it is all discarded here and rebuilt from
 * the new grid by the layout pass that follows. In-flight tweens are cleared
 * for the same reason: any of them would otherwise finish by writing a
 * position computed under the old geometry.
 */
function enterMode(): void {
  // (the log is switched by layout(), which runs right after this)

  // in-flight tweens and trails, all of which would land stale
  tweenT = 1;
  markFrom = { ...markParams };
  markTo = { ...markParams };
  scribble.setTrail(0, null);
  construction.reset();
  drag.vel.set(0, 0);

  // the gestures are mutually exclusive — a half-finished hold must not
  // survive into a mode that has no hold
  holdGesture.reset();
}

/** The one-frame cold snap at the instant the last point lands. */
let blueFramePending = false;
let blueFrameShown = false;

/** Push the colour state for the current resolveT into the scene + DOM. */
function applyColors() {
  const c = colorState(resolveT);
  renderer.setClearColor(c.bg);
  document.body.style.background = `#${c.bg.getHexString()}`;
}
applyColors();

/** Mark colour for the current `value` param — always inside the warm family. */
const _markCol = new THREE.Color();
const colBrand = new THREE.Color(HOLD.colors.brand);
const colDark = new THREE.Color(HOLD.colors.markDark);
const colLight = new THREE.Color(HOLD.colors.markLight);
function currentMarkColor(): THREE.Color {
  const v = markParams.value;
  _markCol.copy(colBrand);
  if (v < 0) _markCol.lerp(colDark, -v);
  else if (v > 0) _markCol.lerp(colLight, v);
  return _markCol;
}

/** Push the live parameters into the mark's shader. */
function pushMarkParams(): void {
  const u = markFillMat.uniforms;
  u.uSharpness.value = markParams.sharpness;
  u.uArmLength.value = markParams.armLength;
  u.uArmVariance.value = markParams.armVariance;
  u.uRotation.value = markParams.rotation;
  if (!blueFrameShown) u.uColor.value.copy(currentMarkColor());
}

/** True once the piece is committed — no more picking the thought back up. */
function grabLocked(): boolean {
  return dropPhase === 'resolving' || dropPhase === 'resolved';
}

function applyFrame(dt: number) {
  drag.update(dt);

  // post-drop sequence
  if (drag.state === 'dropped') {
    if (dropPhase === 'none') dropPhase = 'settling';
    switch (dropPhase) {
      case 'settling':
        if (drag.settled()) {
          dropPhase = 'beat';
          dropTimer = 0;
        }
        break;
      case 'beat':
        // the emotional payoff: the head, visibly empty. Do not rush.
        dropTimer += dt;
        if (dropTimer >= HOLD.headExitDelay) {
          dropPhase = 'resolving';
          // the loop is the sound of the problem — it must not outlive it
          audio.endChaos();
          dropTimer = 0;
          floodT = 0;
          markFill.scale.setScalar(scribble.renderScale / symbolGeomSize);
          markFill.visible = true;
          markFillMat.uniforms.uOpacity.value = 1;
        }
        break;
      case 'resolving': {
        // automatic: chaos 1 → 0, scribble morphs to the mark, stroke thick
        // → thin, then the outline hands over to the real filled logo.
        dropTimer += dt;
        // three acts: struggle, release, rest — the impact is the contrast
        const act = actProgress(dropTimer);
        const p = act.p;
        scribble.morph = p;
        chaos = 1 - p;
        resolveT = p;
        applyColors();
        // the trail belongs to BREAKTHROUGH alone
        scribble.setTrail(act.breakthrough, scribble.material.resolution);
        markFill.scale.setScalar(scribble.renderScale / symbolGeomSize);
        // stroke: thins and evens out as the fill arrives
        const W = HOLD.scribble.strokeWeightRange;
        scribble.material.linewidth = W.max + (W.min - W.max) * p;
        scribble.setUneven(W.unevenness * (1 - p));

        // the fill FLOODS outward from the centre, synced to BREAKTHROUGH —
        // the mark solidifies as its structure locks in
        if (act.index >= 1) floodT += dt;
        const flood = Math.min(floodT / HOLD.fill.spreadDuration, 1);
        markFillMat.uniforms.uFlood.value = flood * (1 + HOLD.fill.feather);

        // the outline stays through the flood, then cedes to the solid
        scribble.material.transparent = true;
        scribble.material.opacity = 1 - smooth01((p - 0.86) / 0.125);

        if (dropTimer >= HOLD.resolutionDuration) {
          dropPhase = 'resolved';
          resolvedAt = elapsed;
          scribble.setTrail(0, null); // no residual motion; the reward is silence
          blueFramePending = HOLD.blueFrame.enabled;
        }
        break;
      }
      case 'resolved': {
        // exactly one frame of cold blue as the last point lands
        if (blueFramePending) {
          markFillMat.uniforms.uColor.value.set(HOLD.colors.accent);
          blueFramePending = false;
          blueFrameShown = true;
        } else if (blueFrameShown) {
          blueFrameShown = false;
          markFillMat.uniforms.uColor.value.copy(currentMarkColor());
        }
        markFillMat.uniforms.uFlood.value = 1 + HOLD.fill.feather;
        // Kept in step with the outline every frame, not just on the way in:
        // a resize while resolved changes the mark's size, and without this
        // the fill would sit at whatever scale it happened to land on.
        markFill.scale.setScalar(scribble.renderScale / symbolGeomSize);
        // the wave front itself is advanced by the phase accumulator above
        break;
      }
      default:
        break;
    }
  } else if (dropPhase !== 'none') {
    // regrabbed (or returned) — cancel the timeline, bring the head back
    dropPhase = 'none';
    dropTimer = 0;
    floodT = 0;
    strokeInT = 0;
    headGoneT = 0;
    headU.uDrain.value = 0;
    headU.uOpacity.value = 1;
    headOutline.visible = false;
    outlineMat.opacity = 0;
    holdGesture.reset();
    audio.restoreChaos();
    chaos = 1;
    scribble.morph = 0;
    resolveT = 0;
    scribble.stopPulse();
    scribble.material.opacity = 1;
    markFill.visible = false;
    markFillMat.uniforms.uOpacity.value = 0;
    markFillMat.uniforms.uPulse.value = -10;
    workLog.reset();
    construction.reset();
    scribble.setTrail(0, null);
    markFill.scale.setScalar(scribble.renderScale / symbolGeomSize);
    markFillMat.uniforms.uColor.value.set(HOLD.colors.brand);
    blueFramePending = false;
    blueFrameShown = false;
    markParams = defaultParams();
    markFrom = defaultParams();
    markTo = defaultParams();
    tweenT = 1;
    pushMarkParams();
    markFillMat.uniforms.uPulse.value = -10;
    pulsePhase = 0;
    arrival.hide();
    applyColors();
    scribble.material.linewidth = HOLD.scribble.strokeWeightRange.max;
    scribble.material.opacity = 1;
    scribble.setUneven(HOLD.scribble.strokeWeightRange.unevenness);
    markFillMat.uniforms.uFlood.value = 0;
  }

  // animate mark parameters toward their target (never snap)
  if (tweenT < 1) {
    tweenT = Math.min(tweenT + dt / HOLD.demo.transformDuration, 1);
    markParams = lerpParams(markFrom, markTo, easeInOut(tweenT));
    pushMarkParams();
  }

  // the breathing pulse accumulates phase, so changing its rate never jumps
  if (dropPhase === 'resolved') {
    pulsePhase = (pulsePhase + (dt * markParams.pulseRate) / HOLD.pulse.period) % 1;
    const band = HOLD.pulse.bandWidth;
    markFillMat.uniforms.uPulse.value = pulsePhase * (1 + 4 * band) - 2 * band;
  }

  // arrival: the input becomes available once the mark has resolved
  if (dropPhase === 'resolved') arrival.show();
  else arrival.hide();

  // ---- the head empties as the thought is pulled out ---------------------
  // dragProgress is the same signal that peels the scribble out of the head,
  // so the emptying tracks the user's hand exactly and reverses with it.
  if (grid.mobile) {
    // press-and-hold drives everything; the scribble itself does not move
    holdGesture.update(dt);
    dragProgress = holdGesture.progress;
    if (holdGesture.committed && drag.state !== 'dropped') {
      drag.state = 'dropped';
      dropPhase = 'settling';
      dropTimer = 0;
    }
  } else {
    dragProgress = Math.min(drag.pos.distanceTo(drag.home) / HOLD.extraction.distance, 1);
  }

  // stroke snaps in over strokeFadeInDuration at the very start of the drag
  const strokeTarget = dragProgress > 0.005 ? 1 : 0;
  const strokeStep = dt / Math.max(HOLD.strokeFadeInDuration / 1000, 1e-3);
  // step toward the target without overshooting it — an overshoot would
  // oscillate and flicker the outline once it is fully in
  const strokeDelta = strokeTarget - strokeInT;
  strokeInT += Math.sign(strokeDelta) * Math.min(Math.abs(strokeDelta), strokeStep);
  strokeInT = Math.min(Math.max(strokeInT, 0), 1);
  const strokeIn = EASES.easeOut(strokeInT);
  // The head emptying IS the hold's progress bar, so on mobile the drain runs
  // on a front-loaded curve: it has to be visibly moving within the first
  // frames or the gesture reads as unregistered. Dragging keeps the gentler
  // curve, where the travel itself already shows progress.
  const drainEase = grid.mobile
    ? (EASES[HOLD.hold.drainEasing as EaseName] ?? EASES.easeOutCubic)
    : (EASES[HOLD.fillDrainEasing as EaseName] ?? EASES.easeInOut);

  if (grid.mobile) {
    // Mobile has no room to keep an emptied head in the composition, so it
    // fades out entirely and the flow reclaims its space. The carry distance
    // is short here, so the fade also completes on the drop itself.
    const goneTarget = drag.state === 'dropped' || dropPhase !== 'none' ? 1 : 0;
    const goneStep = dt / 0.45;
    const gd = goneTarget - headGoneT;
    headGoneT += Math.sign(gd) * Math.min(Math.abs(gd), goneStep);
    headGoneT = Math.min(Math.max(headGoneT, 0), 1);
    // Mobile: the head DRAINS AWAY — the mask recedes while the fill stays
    // at 100% opacity, so it empties rather than fading. No outline state.
    headOutline.visible = false;
    headU.uDrain.value = drainEase(dragProgress);
    headU.uOpacity.value = 1 - headGoneT;
  } else {
    headU.uOpacity.value = 1;
    headOutline.visible = strokeIn > 0.01;
    outlineMat.opacity = strokeIn * HOLD.headStrokeOpacity;
    // fill drains only once the outline is established, so there is never a
    // translucent fill sitting under a translucent stroke
    headU.uDrain.value = drainEase(dragProgress) * strokeIn;
  }

  // mobile reflow: once the thought is out, the head's reserved space
  // collapses to what the mark and log need. The CSS transition on
  // .hero__head eases the elements below up rather than jumping them.
  if (grid.mobile) {
    const slot = document.getElementById('headSlot');
    if (slot) {
      const px = Math.round(desiredSlotHeight(grid)) + 'px';
      if (slot.style.height !== px) slot.style.height = px;
    }
    reserveLogSlot(true);
  }

  // the filled mark rides with the scribble it replaces
  markFill.position.set(drag.pos.x, drag.pos.y, 0.05);

  // guides and anchor flashes live only while the shape is being built
  construction.update(dt, scribble, drag.pos, dropPhase === 'resolving');

  // the working overlay lives ON THE GRID: left edge exactly column 7
  // (sharing the H1/subtitle edge), below the subtitle
  const c = colorState(resolveT);
  // mobile: flush to the 30px content margin, with the full content width to
  // run in. desktop: its own column span beside the mark.
  workLog.place(
    grid.mobile ? grid.contentLeft : grid.colLeft(HOLD.workLog.columns[0]),
    logTop,
    grid.mobile
      ? grid.contentWidth
      : grid.colRight(HOLD.workLog.columns[1]) - grid.colLeft(HOLD.workLog.columns[0]),
  );
  workLog.update(
    scribble.morph,
    dropPhase === 'resolving' || dropPhase === 'resolved',
    '#' + c.ui.getHexString(),
  );

  cursor.setMode(
    drag.state === 'dragging' ? 'grabbing' : drag.hovering && !grabLocked() ? 'grab' : 'default',
  );
  labelEl.style.opacity = grid.mobile
    ? String(Math.max(0.85 * (1 - dragProgress * 2), 0))
    : drag.state === 'idle'
      ? '0.85'
      : '0';

  // Mobile has no cursor to advertise the gesture, so if the hero sits
  // untouched the label pulses once to say it is interactive. It re-arms only
  // after the visitor actually touches it, so it never nags.
  if (grid.mobile && dropPhase === 'none' && !holdGesture.holding && holdGesture.progress === 0) {
    idleT += dt;
    if (idleHintArmed && idleT >= HOLD.hold.idleHintAfter) {
      idleHintArmed = false;
      pulseLabel();
    }
  } else {
    idleT = 0;
    idleHintArmed = true;
  }

  if (debugEl) {
    debugEl.textContent =
      `state ${drag.state}  phase ${dropPhase}  pos ${drag.pos.x.toFixed(2)},${drag.pos.y.toFixed(2)}` +
      `  chaos ${chaos.toFixed(2)}  morph ${scribble.morph.toFixed(2)}`;
  }
}

/** Extraction + agitation for this frame, then displace the scribble. */
/** Previous frame's "thought in hand" state, for edge detection. */
let wasCarrying = false;

/** Set once at boot: the pointer field is motion, so it honours the setting. */
const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function updateScribble(dt: number) {
  // The pointer field answers only while the thought is still sitting in the
  // head. Carrying it, resolving it, and the resolved mark itself are all
  // silent — that stillness at the end is the payoff, and a mark that
  // twitched at the cursor would undo it. No cursor exists below the
  // breakpoint, and reduced motion opts out entirely.
  //
  // drag.pointerWorld is written by the pointermove listener and read here,
  // once, so the field costs one pass per FRAME however fast the pointer moves.
  const fieldActive =
    !grid.mobile && !reducedMotion && drag.state === 'idle' && dropPhase === 'none';
  scribble.setCursor(drag.pointerWorld.x, drag.pointerWorld.y, fieldActive);

  // Is the thought currently in hand? Both gestures answer this, and the
  // FALLING edge is the abandoned grab — dropped back into the head, or the
  // hold let go before it committed. Only that restores the chaos; the
  // rising edge is handled at the source of each gesture, so the sound lands
  // on the press itself.
  const carrying = grid.mobile
    ? holdGesture.holding || holdGesture.committed
    : drag.state === 'dragging' || drag.state === 'dropped';
  if (wasCarrying && !carrying && dropPhase === 'none') audio.releaseGrab();
  wasCarrying = carrying;

  const dist = drag.pos.distanceTo(drag.home);
  // Peel is what lifts the stroke off the head, strand by strand. Travel
  // distance drives it on desktop, but on mobile the stroke never travels —
  // the HOLD is the extraction — so distance alone leaves it permanently
  // half-peeled, and the leftover shear rides all the way into the resolved
  // mark (stretching it off its own fill). Once the drop timeline is running
  // the stroke is free by definition, so peel is complete either way.
  const peel =
    dropPhase !== 'none'
      ? 1
      : Math.max(
          Math.min(dist / HOLD.extraction.distance, 1),
          grid.mobile ? holdGesture.progress : 0,
        );
  const ampGain = 1 + HOLD.dragAgitationIncrease * Math.min(dist / 2.2, 1);
  scribble.update(elapsed, dt, chaos, drag.home, drag.pos, peel, ampGain);
}

function frame() {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1) * HOLD.timeScale;
  elapsed += dt;
  applyFrame(dt);
  updateScribble(dt);
  cursor.update();
  renderer.render(scene, camera);
}

function setRunning(next: boolean) {
  // the sound follows the render loop exactly: nothing plays for a hero that
  // is off screen or in a hidden tab
  audio.setAllowed(next);
  if (next === running) return;
  running = next;
  if (running) {
    clock.getDelta();
    resize();
    frame();
  } else {
    cancelAnimationFrame(rafId);
  }
}
/** The chaos bed. Silent until a gesture unlocks it, and muted by default. */
const audio = new ChaosAudio();

let heroInView = true;
new IntersectionObserver(
  (entries) => {
    heroInView = entries[0].isIntersecting;
    setRunning(!document.hidden && heroInView);
  },
  { threshold: 0 },
).observe(container);
document.addEventListener('visibilitychange', () => setRunning(!document.hidden && heroInView));
frame();

// Debug handle for headless inspection.
(window as unknown as Record<string, unknown>).__hold = {
  audio,
  renderer,
  scene,
  camera,
  scribble,
  head,
  cursor,
  drag,
  insideHead,
  setChaos(c: number) {
    chaos = c;
  },
  restingPosition,
  workLog,
  get grid() {
    return grid;
  },
  get worldPerPx() {
    return worldPerPx;
  },
  headPixelSize: () => headPixelSize(grid),
  headAspect: () => headAspect,
  arrival,
  get markParams() {
    return markParams;
  },
  get elapsed() {
    return elapsed;
  },
  markFill,
  get dropPhase() {
    return dropPhase;
  },
  tick(t: number) {
    while (elapsed < t) {
      const dt = Math.min(1 / 30, t - elapsed);
      elapsed += dt;
      applyFrame(dt);
    }
    updateScribble(1 / 30);
    renderer.render(scene, camera);
  },
};
