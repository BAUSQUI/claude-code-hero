import { HOLD } from './config';

/**
 * Custom cursor: an ink dot inside a thin ring trailing the pointer on an
 * eased follow. Over the scribble the ring swells (grab affordance); while
 * carrying it the ring tightens and the dot grows (grabbing).
 */
export type CursorMode = 'default' | 'grab' | 'grabbing';

export class HoldCursor {
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private dot: SVGCircleElement;
  private x = -100;
  private y = -100;
  private tx = -100;
  private ty = -100;
  private visible = false;
  private mode: CursorMode = 'default';

  constructor() {
    const c = HOLD.cursor;
    const size = c.ringSize + 4;
    const r = c.ringSize / 2;

    this.root = document.createElement('div');
    this.root.id = 'hold-cursor';
    this.root.style.cssText = `
      position: fixed; left: 0; top: 0; pointer-events: none; z-index: 10;
      transform: translate(-100px, -100px); opacity: 0;
      transition: opacity 0.25s ease;
    `;

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('width', String(size));
    this.svg.setAttribute('height', String(size));
    this.svg.style.cssText = 'overflow: visible; transition: transform 0.2s ease;';

    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [k, v] of Object.entries({
      cx: size / 2, cy: size / 2, r,
      fill: 'none', stroke: HOLD.colors.ink, 'stroke-opacity': '0.5', 'stroke-width': '1.2',
    }))
      ring.setAttribute(k, String(v));

    this.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [k, v] of Object.entries({
      cx: size / 2, cy: size / 2, r: c.dotSize / 2, fill: HOLD.colors.ink,
    }))
      this.dot.setAttribute(k, String(v));
    this.dot.style.transition = 'r 0.2s ease';

    this.svg.append(ring, this.dot);
    this.root.append(this.svg);
    document.body.appendChild(this.root);

    const app = document.getElementById('app');
    window.addEventListener('pointermove', (e) => {
      this.tx = e.clientX;
      this.ty = e.clientY;
      // the custom cursor belongs to the hero canvas only
      // `contains` throws on anything that is not a Node; real pointer events
      // always target an element, but synthetic ones need not
      const t = e.target;
      const over = !!app && (t === app || (t instanceof Node && app.contains(t)));
      if (over && !this.visible) {
        this.x = this.tx;
        this.y = this.ty;
        this.setVisible(true);
      } else if (!over && this.visible) {
        this.setVisible(false);
      }
    });
    document.addEventListener('mouseleave', () => this.setVisible(false));
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.opacity = v ? '1' : '0';
  }

  setMode(mode: CursorMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const scale = mode === 'grab' ? 1.3 : mode === 'grabbing' ? 0.8 : 1;
    this.svg.style.transform = `scale(${scale})`;
    this.dot.setAttribute('r', String((HOLD.cursor.dotSize / 2) * (mode === 'grabbing' ? 1.8 : 1)));
  }

  /** Eased follow — call every frame. */
  update(): void {
    const e = HOLD.cursor.ease;
    this.x += (this.tx - this.x) * e;
    this.y += (this.ty - this.y) * e;
    const half = (HOLD.cursor.ringSize + 4) / 2;
    this.root.style.transform = `translate(${this.x - half}px, ${this.y - half}px)`;
  }
}
