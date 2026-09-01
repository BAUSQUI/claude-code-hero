import { HOLD } from './config';

/**
 * The design's 1440 container, MEASURED from the DOM at runtime — padding,
 * gap and bounds come from the rendered `.hero` container itself, so the
 * canvas and the CSS can never disagree. Every canvas element is positioned
 * in column units through these helpers; nothing uses viewport fractions.
 */

export interface Grid {
  vw: number;
  vh: number;
  /** Content box (inside the container's padding), viewport px. */
  contentLeft: number;
  contentWidth: number;
  /** Full container width including its padding (1440 at the design). */
  containerWidth: number;
  /** The stage box the canvas covers. On mobile it is taller than the
   *  viewport, so all canvas mapping uses this, never the viewport. */
  stageWidth: number;
  stageHeight: number;
  /** Stage's offset from the viewport top (negative once scrolled). */
  stageTop: number;
  /** True below the mobile breakpoint. */
  mobile: boolean;
  gutter: number;
  columns: number;
  colWidth: number;
  /** How much the container has shrunk vs the 1440 design (1 at >=1440). */
  scale: number;
  /** Hero band, in stage/viewport px. */
  heroTop: number;
  heroHeight: number;
  /**
   * Left edge of column n (1-indexed). n = 0 is one column into the left
   * bleed — used for elements that intentionally run off the container.
   */
  colLeft(n: number): number;
  colRight(n: number): number;
  /** Horizontal centre of an inclusive column span. */
  spanCenter(from: number, to: number): number;
}

/** Reference column width at the authored 1440 (1440 − 2·96 − 11·24) / 12. */
const REF_COL_WIDTH =
  (1440 - 2 * HOLD.layout.margin - 11 * HOLD.layout.gutter) / HOLD.layout.columns;

export function measureGrid(): Grid {
  const vw = window.innerWidth || 1440;
  const vh = window.innerHeight || 900;

  const hero = document.querySelector('.hero') as HTMLElement | null;
  const stage = document.getElementById('stage');

  let contentLeft: number;
  let contentWidth: number;
  let containerWidth: number;
  let gutter = HOLD.layout.gutter;
  let heroTop: number;
  let heroHeight: number;
  let stageWidth = vw;
  let stageHeight = vh;
  let stageTop = 0;

  if (hero && stage) {
    const r = hero.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const cs = getComputedStyle(hero);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    gutter = parseFloat(cs.columnGap) || gutter;
    contentLeft = r.left + padL;
    contentWidth = r.width - padL - padR;
    containerWidth = r.width;
    heroTop = r.top - st.top;
    heroHeight = r.height;
    stageWidth = st.width;
    stageHeight = st.height;
    stageTop = st.top;
  } else {
    // pre-DOM fallback (never used after boot, kept for safety)
    const margin = HOLD.layout.margin;
    const boxW = Math.min(vw, 1440);
    contentLeft = (vw - boxW) / 2 + margin;
    contentWidth = boxW - margin * 2;
    containerWidth = boxW;
    heroTop = 90;
    heroHeight = Math.max(vh - heroTop, 1);
  }

  const columns = HOLD.layout.columns;
  const colWidth = (contentWidth - gutter * (columns - 1)) / columns;
  const colLeft = (n: number) => contentLeft + (n - 1) * (colWidth + gutter);
  const colRight = (n: number) => colLeft(n) + colWidth;

  return {
    vw,
    vh,
    contentLeft,
    contentWidth,
    containerWidth,
    stageWidth,
    stageHeight,
    stageTop,
    mobile: vw < HOLD.performance.mobileBreakpoint,
    gutter,
    columns,
    colWidth,
    scale: colWidth / REF_COL_WIDTH,
    heroTop,
    heroHeight,
    colLeft,
    colRight,
    spanCenter: (from, to) => (colLeft(from) + colRight(to)) / 2,
  };
}

/** Paint the ?grid overlay columns once (inside its own container copy). */
export function buildGridOverlay(): void {
  const wrap = document.getElementById('gridOverlay');
  const cols = document.getElementById('gridOverlayCols');
  if (!wrap || !cols) return;
  cols.innerHTML = '';
  for (let i = 0; i < HOLD.layout.columns; i++) cols.appendChild(document.createElement('span'));
  wrap.classList.add('on');
}
