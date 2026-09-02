/**
 * "Stop holding it all in your head" — every art-directable value.
 * Tune this file, not the code.
 */

/** A transformable property of the mark. */
export type MarkParam =
  | 'sharpness'
  | 'armLength'
  | 'armVariance'
  | 'pulseRate'
  | 'rotation'
  | 'value';

/** One entry of the local intent map. */
export interface IntentRule {
  id: string;
  keywords: string[];
  /** Copy shown in the working overlay while it applies. */
  label: string;
  /** Relative nudges to mark parameters, clamped after application. */
  delta: Partial<Record<MarkParam, number>>;
}

/** One row of the working overlay, keyed to morph progress. */
export interface WorkStep {
  /** Morph progress at which the row appears. */
  from: number;
  /** Morph progress at which it checks off. */
  to: number;
  icon: 'search' | 'file' | 'pencil' | 'terminal' | 'check' | 'git-branch';
  label?: string;
  /** Renders as a file chip instead of a plain label. */
  file?: string;
  add?: number;
  del?: number;
  /** The summary row: emphasised, no spinner. */
  final?: boolean;
}

export const HOLD = {
  /** Global speed multiplier for everything. */
  timeScale: 1.0,

  colors: {
    bgStart: '#141413', // near-black ground
    bgMid: '#D97757', // warm waypoint — the room never passes through grey
    bgEnd: '#FAF9F5', // where the room lands once it is clear
    head: '#FAF9F5', // cream silhouette
    ink: '#D97757', // the scribble — coral from the very start
    brand: '#D97757', // the resolved mark, filled
    accent: '#6A9BCC', // flash at resolution only
    muted: '#8A8781', // log text
    diffAdd: '#7D9A6B', // muted sage, additions
    diffDel: '#B06455', // muted brick, deletions
    markDark: '#A85436', // value shift floor — still warm
    markLight: '#EDA98A', // value shift ceiling — still warm
    ink2: '#141413', // type that sits on the cream head
  },

  /**
   * The interaction is DRAG AND DROP: grab the scribble, carry it out of
   * the head, let go. Releasing is the point — resolution happens after
   * the drop, never during the drag.
   */
  dragSpring: {
    /** Spring toward the pointer; underdamped so it trails and overshoots. */
    stiffness: 42,
    damping: 9,
    mass: 1,
  },
  drag: {
    /** Hit area radius, × the scribble's visual radius (generous). */
    hitRadiusScale: 1.6,
    mobileHitRadiusScale: 2.2,
    /** Idle proximity lean: radius the scribble notices the cursor in. */
    leanRadius: 1.3,
    /** How far it leans toward the cursor (fraction of the distance). */
    leanStrength: 0.16,
    /** Drop-zone ellipse, as a fraction of the head's half extents. */
    headEllipse: { x: 0.92, y: 0.95 },
  },
  /**
   * Extraction: as the scribble is carried away, it peels out of the head
   * progressively along its own length — trailing strands stay anchored
   * inside until it is fully drawn out.
   */
  extraction: {
    /** Carry distance (world units) at which it is fully out of the head. */
    distance: 1.15,
    /** Stagger along the stroke, 0 = whole shape at once, 1 = long peel. */
    spread: 0.55,
  },
  /** How much agitation rises with distance from the head while dragging. */
  dragAgitationIncrease: 0.35,
  /**
   * Below the mobile breakpoint the gesture is PRESS-AND-HOLD, not drag:
   * dragging with a thumb is awkward. Desktop keeps drag-and-drop.
   */
  hold: {
    /** Seconds of holding to reach full progress. */
    holdDuration: 1.2,
    /** Seconds for progress to ease back when released early. */
    releaseDuration: 0.45,
    label: 'Hold it and let it go',
    /** Archivo regular, design size for the mobile prompt. */
    labelSize: 18,
    /** Seconds of stillness before the label pulses once, in case the
     *  gesture went unnoticed. Mobile only — the desktop cursor already
     *  advertises the grab. */
    idleHintAfter: 7,
    /** Px of finger travel that reclassifies a hold as a scroll. */
    moveCancel: 10,
    /** Front-loaded, so the head is visibly emptying within ~150ms of the
     *  press: the drain is this gesture's only progress indicator. */
    drainEasing: 'easeOutCubic' as const,
    /** Haptic pulses (ms) at the halfway mark and on completion. */
    hapticHalf: 8,
    hapticFull: 18,
    /** One beat alone in the empty space before resolution begins. */
    beforeResolve: 0.55,
  },

  /** Idle seconds before the lift-toward-the-exit hint plays. */
  hintDelay: 7,
  hint: {
    /** World units the scribble lifts toward the exit point. */
    amplitude: 0.28,
    duration: 1.5,
    /** Exit direction — up and out through the forehead/temple. */
    dir: { x: 0.82, y: 0.57 },
  },

  /** Phase 3 — drop & resolution (consumed from step 2 of the build on). */
  /** One-beat pause with the head visibly empty, before it fades. Seconds. */
  headExitDelay: 1.0,
  /**
   * The head empties AS THE USER DRAGS — direct manipulation, driven by
   * dragProgress (0 = scribble fully inside, 1 = fully out) and therefore
   * fully reversible. Stroke and fill are never cross-faded:
   *
   *   stroke  snaps to full opacity in `strokeFadeInDuration` ms at the very
   *           start of the drag, so the silhouette never loses its edge
   *   fill    then DRAINS beneath it — a soft-edged mask receding toward the
   *           point the scribble exits, at 100% opacity throughout, so it
   *           stays solid rather than washing out
   */
  headStrokeWidth: 5,
  headStrokeOpacity: 1,
  strokeFadeInDuration: 150,
  fillDrainEasing: 'easeInOut' as const,
  /** Soft edge on the receding mask, in px. */
  fillMaskSoftness: 50,
  /** Where the ink leaves: the exit point, in head-texture UV. */
  fillDrainOrigin: { x: 0.6, y: 0.78 },
  resolutionDuration: 6.5,
  /**
   * The three acts of the resolution. `portion` is the share of
   * `resolutionDuration` the act occupies; `to` is the morph progress it
   * reaches. Struggle, then release, then rest.
   */
  acts: [
    { name: 'disorder', portion: 0.4, to: 0.35, ease: 'easeInCubic' },
    { name: 'breakthrough', portion: 0.154, to: 0.72, ease: 'easeInOut' },
    { name: 'settle', portion: 0.446, to: 1.0, ease: 'easeOutCubic' },
  ],

  /** A single frame of cold blue as the last point lands. One frame only. */
  blueFrame: { enabled: true },

  /**
   * Construction lines: hairline guides from a point's current position to
   * its target, alive only while that point is in motion. A technical
   * drawing being built — never a mesh.
   */
  construction: {
    enabled: true,
    mobileEnabled: false,
    /** Fraction of in-motion points that get a guide line. */
    density: 0.18,
    opacity: 0.28,
    /** Guides fade out over the last part of a point's travel. */
    fadeAt: 0.75,
  },

  /** Anchor dots that flash as each arm tip clicks into its final position. */
  anchors: {
    enabled: true,
    mobileEnabled: false,
    /** Dot diameter in world units. */
    size: 0.05,
    /** Seconds a flash lives. */
    duration: 0.45,
  },

  /** Motion trail — BREAKTHROUGH only, so the fast section reads as fast. */
  trail: {
    enabled: true,
    mobileEnabled: false,
    /** How many frames behind the ghost copy lags. */
    lagFrames: 5,
    /** Peak opacity of the trail at the height of breakthrough. */
    opacity: 0.3,
  },

  /** Breath, not zoom: keep the total gesture under ~8%. */
  scaleGesture: {
    enabled: true,
    /** Contraction depth, and where it sits in progress. */
    contract: 0.045,
    gatherAt: 0.33,
    gatherWidth: 0.16,
    /** Expansion height, centred inside breakthrough. */
    expand: 0.035,
    swellAt: 0.6,
    swellWidth: 0.18,
  },

  /**
   * Background follows the acts: holds through DISORDER, shifts during
   * BREAKTHROUGH, lands during SETTLE. `preDip` darkens slightly at the end
   * of DISORDER so the release has something to release from.
   */
  backgroundCurve: {
    /** Progress at which the shift begins / completes. */
    from: 0.35,
    to: 0.9,
    preDip: { enabled: true, amount: 0.35, at: 0.33, width: 0.14 },
  },

  /** Where the dropped mark eases to rest (fractions of half-extents). */
  restingPosition: { x: 0.5, y: 0 },

  /**
   * Phase 4 — the working overlay. Each step is keyed to MORPH PROGRESS
   * (not wall time): it appears at `from`, spins while active, and checks
   * off at `to`, so the shape visibly resolves as the work completes.
   * Rewrite copy and timings freely.
   */
  /**
   * Phase 5 — the interactive demo. Everything here is LOCAL, deterministic
   * and instant: no network, no API. Prompts are matched against
   * `intentMap` and applied as parameterised transforms of the mark, which
   * animate from the current state and are clamped so the brand asset can
   * never break into something unrecognisable.
   */
  demo: {
    placeholder: "What's in your head?",
    examplePrompts: ['make it sharper', 'add more arms', 'make it breathe slower'],
    /** Seconds for a transformation to animate. Must feel instant. */
    transformDuration: 1.1,
    maxVersions: 6,
    /** Hard limits — the mark stays the Claude symbol at every setting. */
    clamps: {
      /** Radial gamma: >1 pinches the waists (sharper), <1 fattens (softer). */
      sharpness: [0.72, 1.55] as [number, number],
      /** How far the arms reach. 1 = the mark exactly as drawn. */
      armLength: [0.82, 1.22] as [number, number],
      /** Extra per-arm length variation on top of the mark's own. */
      armVariance: [0, 0.85] as [number, number],
      /** Breathing speed multiplier. */
      pulseRate: [0.4, 2.2] as [number, number],
      /** Tilt in radians — kept well under one arm period. */
      rotation: [-0.5, 0.5] as [number, number],
      /** Value shift inside the warm palette: -1 darker, +1 lighter. */
      value: [-1, 1] as [number, number],
    },
    /** Shown when nothing matches. Never fail silently. */
    fallback: {
      message: 'not sure how to apply that, try:',
      suggestions: ['make it sharper', 'make it breathe slower'],
    },
    intentMap: [
      {
        id: 'sharper',
        keywords: ['sharper', 'sharp', 'crisp', 'crisper', 'tighter', 'pointy'],
        label: 'sharpening outline',
        delta: { sharpness: 0.28 },
      },
      {
        id: 'softer',
        keywords: ['softer', 'soft', 'round', 'rounder', 'smooth', 'smoother'],
        label: 'softening outline',
        delta: { sharpness: -0.24 },
      },
      {
        id: 'bolder',
        keywords: ['more arms', 'more', 'bigger', 'bolder', 'bold', 'louder', 'stronger'],
        label: 'extending arms',
        delta: { armLength: 0.12, armVariance: 0.28 },
      },
      {
        id: 'simpler',
        keywords: ['fewer', 'fewer arms', 'simpler', 'simple', 'minimal', 'quieter', 'less'],
        label: 'simplifying arms',
        delta: { armLength: -0.1, armVariance: -0.35 },
      },
      {
        id: 'slower',
        keywords: ['slower', 'slow', 'calmer', 'calm', 'gentler', 'breathe slower'],
        label: 'slowing the pulse',
        delta: { pulseRate: -0.35 },
      },
      {
        id: 'faster',
        keywords: ['faster', 'fast', 'energetic', 'quicker', 'lively'],
        label: 'quickening the pulse',
        delta: { pulseRate: 0.45 },
      },
      {
        id: 'rotate',
        keywords: ['rotate', 'spin', 'tilt', 'turn', 'angle'],
        label: 'adjusting rotation',
        delta: { rotation: 0.2 },
      },
      {
        id: 'straighten',
        keywords: ['straighten', 'upright', 'level', 'unrotate', 'straight'],
        label: 'straightening the mark',
        delta: { rotation: -0.2 },
      },
      {
        id: 'darker',
        keywords: ['darker', 'dark', 'deeper', 'richer'],
        label: 'deepening value',
        delta: { value: -0.4 },
      },
      {
        id: 'lighter',
        keywords: ['lighter', 'light', 'paler', 'brighter'],
        label: 'lifting value',
        delta: { value: 0.4 },
      },
    ] as IntentRule[],
  },

  workLog: {
    steps: [
      { from: 0.0, to: 0.2, icon: 'search', label: 'reading the scribble' },
      { from: 0.2, to: 0.45, icon: 'file', file: 'paths.ts', add: 42, del: 0 },
      { from: 0.45, to: 0.7, icon: 'pencil', label: 'restructuring outline' },
      { from: 0.7, to: 0.9, icon: 'terminal', label: 'ran 2 commands' },
      { from: 0.9, to: 1.0, icon: 'check', label: 'resolved', final: true },
    ] as WorkStep[],
    /** Never more than this many rows on screen at once. */
    maxRows: 5,
    mobileMaxRows: 3,
    /** Mobile drops the diff badges to stay quiet. */
    mobileDiffBadges: false,
    /** Vertical gap between the subtitle and the log, px (rhythm of 8). */
    gapBelowSubtitle: 24,
    /** The log's own column span — it sits beside the mark, not under it. */
    columns: [7, 9] as [number, number],
    fontSize: 12,
    /** One shared baseline rhythm — a multiple of 8. */
    lineHeight: 24,
    mobileFontSize: 10,
    mobileLineHeight: 16,
    mobileIconSize: 11,
    /** Icons match the mark's line weight so they read as one drawing. */
    iconSize: 13,
    iconStrokeWidth: 1.75,
    /** Completed rows dim so the active step stays brightest. */
    completedOpacity: 0.4,
    /** The final row is the summary: emphasised. */
    finalScale: 1.15,
    /** Seconds for a row to fade + slide into place. */
    rowFade: 0.35,
  },

  /**
   * The resolved mark is the real filled logo. The fill does NOT cross-fade
   * in globally: it FLOODS outward from `origin` along the arms, synced to
   * the BREAKTHROUGH act, so the mark visibly solidifies as its structure
   * locks in.
   */
  fill: {
    /** Seconds for the flood front to sweep centre -> tips. */
    spreadDuration: 1.0,
    /** Flood origin in the mark's local space. */
    origin: { x: 0, y: 0 },
    /** Softness of the flood front, in radial 0..1 units. */
    feather: 0.16,
  },

  layout: {
    /** Grid — the CSS container is the source of truth; these mirror it. */
    columns: 12,
    margin: 96,
    gutter: 24,

    /** World height the head was authored at (everything scales off it). */
    headHeight: 2.9,
    /**
     * Head placement in COLUMN UNITS. Per the reference it sits ON column 1
     * (no bleed) and is sized by HEIGHT: it runs from just under the
     * secondary bar down to just above the CTA block, so its width follows
     * from the artwork's aspect and lands across columns 1-5/6.
     */
    head: { startCol: 1, topPx: 14, gapAboveCta: 16 },

    /**
     * Mobile recompose. The head fills the content width (330 -> 424.88 at
     * a 390 viewport), and the scribble/mark are sized against that box:
     * 196px inside the head, growing to 296px as it resolves.
     */
    mobileHeadHeightFraction: 0.4,
    mobileHeadTopPx: 8,
    mobileScribbleScale: 196 / 424.88,
    mobileSymbolScale: 296 / 424.88,
    /** Nudge of the resolved mark within the vacated head box, px. */
    mobileMarkTopPx: 8,

    /** Scribble size relative to head height. */
    scribbleScale: 0.36,
    /** Resolved Claude mark size relative to head height. */
    symbolScale: 0.48,
    /** Scribble offset from head center, in head-heights (x right, y up). */
    scribbleOffset: { x: -0.055, y: 0.13 },

    /** Where the resolved mark rests: a column span and a hero fraction. */
    markColumns: [9, 12] as [number, number],
    markHeroY: 0.62,
    /** Breathing room kept above and below the resolved mark, px. */
    markGutter: 16,
    /**
     * Fine positional nudge of the resolved mark, in px at the authored
     * 1440 (x right, y up). Scaled with the container like everything else.
     */
    markNudge: { x: 5, y: 5 },
    /**
     * The resolved mark's bounding box at the authored 1440: 349px. Held as
     * a ratio of the CONTAINER width so it keeps that presence as the
     * viewport changes.
     */
    markBoxAt1440: 349,
    mobileMarkHeroY: 0.2,
    /** "Drag it out" sits this far below the scribble, in head-heights. */
    labelDrop: 0.24,
    mobileLabelDrop: 0.33,
  },

  scribble: {
    /** Ordered samples along the stroke. */
    samples: 2000,
    mobileSamples: 900,
    /**
     * Stroke weight: thick and hand-drawn while unresolved, thin and precise
     * once the fill arrives. `unevenness` is the per-point weight variation
     * (fraction of the base width) that keeps the line hand-drawn; it evens
     * out as the fill floods in.
     */
    strokeWeightRange: { max: 9.5, min: 1.6, unevenness: 0.4 },
  },

  /**
   * Two displacement bands, applied along the stroke's local NORMAL only —
   * the line boils about its own spine (Figma dynamic-noise style) and the
   * silhouette is respected. Each sample offset by arc-length position.
   */
  noise: {
    low: {
      spatialScale: 1.4,
      timeScale: 0.5,
      amplitude: 0.038,
      /** chaos exponent — low band dies LAST (sway outlives tremor). */
      falloffPower: 1.0,
    },
    high: {
      spatialScale: 6.0,
      timeScale: 2.5,
      amplitude: 0.016,
      /** high band dies FIRST — gone by ~60% of the journey. */
      falloffPower: 2.5,
      /** dropped entirely on mobile */
      mobileAmplitude: 0,
    },
    /**
     * Line-boil: the noise clock advances in discrete steps (frames/sec),
     * like a redrawn hand animation, instead of swimming smoothly.
     * 0 = smooth continuous noise.
     */
    boilFps: 9,
  },

  /** Arrhythmic spikes: intrusive-thought bursts, never on a beat. */
  spikes: {
    intervalMin: 0.8,
    intervalMax: 2.5,
    /** Amplitude multiplier at a spike's peak. */
    intensity: 1.8,
    /** Seconds for a spike to decay. */
    decay: 0.5,
    /** Fraction of the stroke's length a spike localises to. */
    sectionWidth: 0.18,
  },

  /**
   * Morph shaping. Points are paired by ANGLE from the centroid (not by
   * index, which makes them cross and swirl), staggered by that same angle
   * so the shape resolves as a sweep, and bowed slightly off a straight line.
   */
  staggerAmount: 0.55,
  pathCurvature: 0.12,

  /** Breathing pulse of the resolved mark: a radial wave center → tips. */
  pulse: {
    period: 3.6,
    /** Radial displacement of the wave crest, world units. Keep subtle. */
    amplitude: 0.022,
    /** Width of the travelling band, in radial 0..1 units. */
    bandWidth: 0.3,
  },

  /**
   * Sound. One loop for now: the churn of the unresolved thought, which stops
   * when the thought resolves. Muted by default — the visitor opts in.
   */
  audio: {
    /** Master switch. False builds no audio graph at all. */
    audioEnabled: true,
    /** Steady-state gain of the chaos loop. Expect to tune this. */
    chaosVolume: 0.5,
    /** Seconds. Never starts or stops abruptly. */
    fadeInDuration: 0.8,
    fadeOutDuration: 0.6,
    /**
     * Loop seam trim, in seconds. MP3 encoding pads both ends of the file, so
     * looping the whole buffer clicks; these cut inside the padding.
     * `loopEnd` is absolute — 0 means "the buffer's duration minus the same
     * trim as loopStart", which is the sane default. Read the decoded length
     * off `__hold.audio.duration` if you want to pin it by hand.
     */
    loopStart: 0.02,
    loopEnd: 0,

    /**
     * The bed under everything. Unlike the chaos loop this never stops: it
     * plays through idle, the drag, the resolution and after. The chaos
     * leaving is what reveals it, which is the whole point — so it must not
     * fade at the same moment.
     */
    ambientVolume: 1,
    /** Held level once the chaos has gone: ~25% up, the room opening out. */
    ambientResolvedVolume: 0.15,
    ambientSwellDuration: 1.2,
    /** Slower than the chaos fade, so it settles in underneath rather than
     *  announcing itself. */
    ambientFadeIn: 2.0,
    /** Seam trim, as above. `ambientLoopEnd` 0 means duration - loopStart. */
    ambientLoopStart: 0.02,
    ambientLoopEnd: 0,

    /**
     * The moment of taking hold. A one-shot, and louder than either bed so it
     * reads as an EVENT against them rather than part of the texture.
     */
    grabVolume: 0.06,
    /**
     * What the chaos does when the thought is picked up: it ducks rather than
     * stops. You are carrying the thought now, not free of it — full silence
     * belongs to the resolution, where it means something.
     *
     * `chaosDuckLevel` is a FRACTION of chaosVolume, not an absolute level.
     */
    chaosDuckLevel: 0.15,
    chaosDuckDuration: 0.2,
    /** Back to full when the grab is abandoned and the thought returns. */
    chaosRestoreDuration: 0.4,
    /** True silences the chaos outright on grab instead of ducking it —
     *  here to be compared against the duck by ear. */
    chaosStopsOnGrab: false,
    /** Seconds. A second grab inside this window does not re-fire the sound. */
    grabRetrigger: 0.12,
  },

  /**
   * The scribble's reaction to the pointer, layered ON TOP of the noise —
   * the churn continues while the stroke leans. Idle only: once the thought
   * is being carried, or has resolved, it stops answering the cursor.
   */
  cursorField: {
    /** 'attract' — the thought reaches out, asking to be taken. 'repel'
     *  inverts it, so the same falloff can be tested as a flinch. */
    mode: 'attract' as 'attract' | 'repel',
    /** Screen px. Converted to world units by the layout, never a viewport
     *  fraction, so the reach is the same at any window size. */
    influenceRadius: 220,
    /** Screen px of travel for a point right under the cursor. */
    maxDisplacement: 18,
    /** Per-point spring, so points lean rather than snap and the whole
     *  reaction trails the pointer slightly. */
    spring: { stiffness: 90, damping: 11, mass: 1 },
    /** Seconds to settle back to the noise-driven rest once out of reach. */
    returnDuration: 0.6,
    /** Noise amplitude multiplier at closest approach — attention makes the
     *  thought more agitated, not less. */
    proximityAgitation: 1.3,
  },

  /** Custom cursor: dot + trailing ring; swells to a grab affordance over
   *  the scribble, tightens while carrying it. */
  cursor: {
    dotSize: 6,
    ringSize: 34,
    /** Follow easing per frame, 0..1 — lower trails more. */
    ease: 0.16,
  },
  /** Static monospace label near the head. */
  idleLabel: 'Drag it out',
  /** Archivo regular, design size for the desktop prompt. */
  idleLabelSize: 30,

  /** Interpolate bg bgStart → bgEnd across the journey. */
  backgroundTransition: false,
  /** Grain overlay opacity (0 disables). */
  grainOpacity: 0.06,

  performance: {
    maxPixelRatio: 2,
    mobileBreakpoint: 768,
    /** Resize debounce, ms. Trailing, so the final size always applies. */
    resizeDebounceMs: 150,
  },
};

export type HoldConfig = typeof HOLD;
