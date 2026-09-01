import { Search, File, Pencil, Terminal, Check, GitBranch } from 'lucide';
import { HOLD, type WorkStep } from './config';

/**
 * The working overlay: Claude Code's interface language, rendered beside the
 * mark as it resolves. Not decoration — evidence. Every row is keyed to
 * MORPH PROGRESS, so each task visibly completes as the shape resolves:
 *
 *   p < step.from            row not yet shown
 *   step.from <= p < step.to active — spinner, full strength
 *   p >= step.to             complete — check, dimmed
 *
 * Type and icons only: no boxes, borders, shadows or panel chrome. Icons are
 * drawn at the mark's own line weight so they read as the same drawing.
 */

/** lucide icon nodes: [tag, attrs][] — no <svg> wrapper. */
type IconNode = readonly (readonly [string, Record<string, string | number>])[];

const ICONS: Record<string, IconNode> = {
  search: Search as unknown as IconNode,
  file: File as unknown as IconNode,
  pencil: Pencil as unknown as IconNode,
  terminal: Terminal as unknown as IconNode,
  check: Check as unknown as IconNode,
  'git-branch': GitBranch as unknown as IconNode,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build an svg from a lucide icon node at our size and stroke weight. */
function renderIcon(node: IconNode, iconSize: number): SVGSVGElement {
  const { iconStrokeWidth } = HOLD.workLog;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(iconSize));
  svg.setAttribute('height', String(iconSize));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(iconStrokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.cssText = 'display:block;flex:none';
  for (const [tag, attrs] of node) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  return svg;
}

/** A quarter-arc spinner, same weight as the icons. */
function renderSpinner(iconSize: number): SVGSVGElement {
  const { iconStrokeWidth } = HOLD.workLog;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(iconSize));
  svg.setAttribute('height', String(iconSize));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(iconStrokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('d', 'M12 3a9 9 0 0 1 9 9');
  svg.appendChild(arc);
  svg.style.cssText = 'display:block;flex:none;animation:hold-spin 0.9s linear infinite';
  return svg;
}

interface Row {
  el: HTMLDivElement;
  spinner: SVGSVGElement;
  check: SVGSVGElement;
  step: WorkStep;
  /** The +/- badges, if this row has any — dropped when the row won't fit. */
  diff: HTMLElement | null;
}

export class WorkLog {
  private root: HTMLDivElement;
  private rows: Row[] = [];
  private maxRows: number;
  private lastKey = '';
  private notice!: HTMLDivElement;
  private fontSize: number;
  private lineHeight: number;
  private iconSize: number;

  constructor(isMobile: boolean) {
    const W = HOLD.workLog;
    // mobile keeps all five rows, just smaller
    this.maxRows = isMobile ? W.steps.length : W.maxRows;
    this.fontSize = isMobile ? W.mobileFontSize : W.fontSize;
    this.lineHeight = isMobile ? W.mobileLineHeight : W.lineHeight;
    this.iconSize = isMobile ? W.mobileIconSize : W.iconSize;

    if (!document.getElementById('hold-log-style')) {
      const style = document.createElement('style');
      style.id = 'hold-log-style';
      style.textContent = '@keyframes hold-spin { to { transform: rotate(360deg) } }';
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute', 'z-index:6', 'pointer-events:none',
      "font-family:'SF Mono','Cascadia Mono',Consolas,ui-monospace,monospace",
      'font-size:' + this.fontSize + 'px',
      'line-height:' + this.lineHeight + 'px',
      'letter-spacing:0.03em', 'text-align:left', 'white-space:nowrap',
      'transition:opacity 0.4s ease',
    ].join(';');

    for (const step of W.steps) {
      const el = document.createElement('div');
      el.style.cssText = [
        'display:flex', 'align-items:center', 'gap:8px',
        // min-height, not height: the summary row carries a larger type size
        // and has to be allowed to be taller than the rest, or it renders
        // outside its own box
        'min-height:' + this.lineHeight + 'px',
        'opacity:0', 'transform:translateY(5px)',
        'transition:opacity ' + W.rowFade + 's ease,transform ' + W.rowFade +
          's ease,color 0.3s ease',
      ].join(';');

      // status gutter: spinner while active, check once complete
      const status = document.createElement('span');
      status.style.cssText =
        'display:flex;justify-content:center;width:' + this.iconSize + 'px;flex:none';
      const spinner = renderSpinner(this.iconSize);
      const check = renderIcon(ICONS.check, this.iconSize);
      check.style.display = 'none';
      status.append(spinner, check);
      el.appendChild(status);

      // type-icon gutter: fixed width even when empty (the summary row),
      // so every label shares one exact left edge — terminal output, not
      // scattered captions
      const typeSlot = document.createElement('span');
      typeSlot.style.cssText =
        'display:flex;justify-content:center;width:' + this.iconSize + 'px;flex:none';
      if (!step.final) typeSlot.appendChild(renderIcon(ICONS[step.icon] ?? ICONS.file, this.iconSize));
      el.appendChild(typeSlot);

      // The summary row's larger type is set here rather than in update():
      // it is a property of the row, and applying it now means the height
      // measured below already includes it. Set later, the row would grow
      // mid-resolution and shove everything under it down the page.
      if (step.final) el.style.fontSize = W.finalScale + 'em';

      const label = document.createElement('span');
      label.textContent = step.file ?? step.label ?? '';
      el.appendChild(label);

      let diffEl: HTMLElement | null = null;
      if (step.add !== undefined || step.del !== undefined) {
        const diff = document.createElement('span');
        diffEl = diff;
        diff.style.cssText = 'display:flex;gap:6px;margin-left:2px';
        if (step.add !== undefined) {
          const a = document.createElement('span');
          a.textContent = '+' + step.add;
          a.style.color = HOLD.colors.diffAdd;
          diff.appendChild(a);
        }
        if (step.del !== undefined) {
          const d = document.createElement('span');
          d.textContent = '-' + step.del;
          d.style.color = HOLD.colors.diffDel;
          diff.appendChild(d);
        }
        el.appendChild(diff);
      }

      this.root.appendChild(el);
      this.rows.push({ el, spinner, check, step, diff: diffEl });
    }
    this.notice = document.createElement('div');
    this.notice.style.display = 'none';
    this.root.appendChild(this.notice);

    (document.getElementById('stage') ?? document.body).appendChild(this.root);

    this.fullHeight = this.measureFullHeight();
  }

  /** The log's full, fully-populated height — known before it is shown. */
  fullHeight = 0;

  /**
   * The height the log needs with EVERY row present and at its final size —
   * the most it will ever occupy. Rows are forced visible for the measurement
   * because the caller can ask at any point in the sequence, including while
   * the desktop row-window has some of them hidden.
   */
  private measureFullHeight(): number {
    const was = this.rows.map((r) => r.el.style.display);
    for (const r of this.rows) r.el.style.display = 'flex';
    const h = this.root.getBoundingClientRect().height;
    this.rows.forEach((r, i) => {
      r.el.style.display = was[i];
    });
    return h;
  }

  /**
   * Put the log where this breakpoint wants it: absolutely positioned over
   * the stage on desktop, or in the document flow inside `host` on mobile,
   * where the CTA below has to be pushed clear of it rather than overlapped.
   */
  mount(host: HTMLElement | null): void {
    const inFlow = host !== null;
    const parent = host ?? document.getElementById('stage') ?? document.body;
    if (this.root.parentElement !== parent) parent.appendChild(this.root);
    if (inFlow === this.inFlow) return;
    this.inFlow = inFlow;
    this.root.style.position = inFlow ? 'static' : 'absolute';
    if (inFlow) {
      this.root.style.left = '';
      this.root.style.top = '';
    }
    // re-measured here: the rows are laid out differently in flow, and the
    // reservation has to match what they now actually need
    this.fullHeight = this.measureFullHeight();
  }

  private inFlow = false;

  /**
   * Show free-form lines beneath the step rows — used to answer a prompt
   * the intent map did not recognise. Same type, same column, so it reads
   * as the same system talking back.
   */
  showNotice(lines: string[], ui: string): void {
    this.notice.innerHTML = '';
    const W = HOLD.workLog;
    lines.forEach((text, i) => {
      const row = document.createElement('div');
      row.style.cssText = [
        'height:' + W.lineHeight + 'px',
        'display:flex', 'align-items:center', 'gap:8px',
        'color:' + ui, 'opacity:' + (i === 0 ? '1' : '0.45'),
      ].join(';');
      {
        const dot = document.createElement('span');
        dot.textContent = i === 0 ? '·' : '';
        dot.style.cssText = 'width:' + W.iconSize + 'px;flex:none;text-align:center';
        const spacer = document.createElement('span');
        spacer.style.cssText = 'width:' + W.iconSize + 'px;flex:none';
        row.append(dot, spacer);
      }
      const t = document.createElement('span');
      t.textContent = text;
      row.appendChild(t);
      this.notice.appendChild(row);
    });
    this.notice.style.display = 'block';
  }

  hideNotice(): void {
    this.notice.innerHTML = '';
    this.notice.style.display = 'none';
  }

  /**
   * Anchor the column (screen coords of its top-left). `maxWidth` is the room
   * the row has before it would wrap; the diff badges are the one part that
   * gives way, and only on the rows that actually need it.
   */
  place(x: number, y: number, maxWidth = 0): void {
    if (!this.inFlow) {
      this.root.style.left = x + 'px';
      this.root.style.top = y + 'px';
    }
    if (maxWidth > 0 && maxWidth !== this.maxWidth) {
      this.maxWidth = maxWidth;
      this.fitRows();
    }
  }

  private maxWidth = 0;

  /**
   * Any row that cannot fit both its label and its badges gives up the
   * badges — decided per row, so a short row keeps them.
   *
   * The row's own content width has to be summed from its children: rows are
   * flex items in a block container, so they all stretch to the widest one
   * and their `scrollWidth` reports the container, not themselves.
   */
  private fitRows(): void {
    const gap = 8; // the row's flex gap, set in the constructor
    for (const r of this.rows) {
      if (!r.diff) continue;
      r.diff.style.display = '';
      const kids = Array.from(r.el.children) as HTMLElement[];
      let natural = gap * Math.max(kids.length - 1, 0);
      for (const k of kids) natural += k.offsetWidth;
      if (natural > this.maxWidth) r.diff.style.display = 'none';
    }
  }

  reset(): void {
    this.lastKey = '';
    this.hideNotice();
    for (const r of this.rows) {
      r.el.style.opacity = '0';
      r.el.style.transform = 'translateY(5px)';
      r.el.style.display = 'flex';
      r.spinner.style.display = 'block';
      r.check.style.display = 'none';
    }
  }

  /**
   * @param p       morph progress 0..1
   * @param visible false hides the whole overlay (before resolution)
   * @param ui      css colour for ordinary rows
   */
  update(p: number, visible: boolean, ui: string): void {
    this.root.style.opacity = visible ? '1' : '0';
    if (!visible) return;

    const W = HOLD.workLog;
    // sliding window: only the most recent `maxRows` started rows are shown
    const started = this.rows.filter((r) => p >= r.step.from).length;
    const completed = this.rows.filter((r) => p >= r.step.to).length;
    const firstShown = Math.max(0, started - this.maxRows);

    // skip DOM writes when nothing changed this frame
    const key = started + '|' + completed + '|' + firstShown;
    if (key === this.lastKey) return;
    this.lastKey = key;

    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const shown = p >= r.step.from && i >= firstShown;
      const done = p >= r.step.to;

      r.el.style.display = i < firstShown ? 'none' : 'flex';
      r.el.style.opacity = shown
        ? done && !r.step.final
          ? String(W.completedOpacity)
          : '1'
        : '0';
      r.el.style.transform = shown ? 'translateY(0)' : 'translateY(5px)';
      if (!shown) continue;

      // the summary row is never "in progress" — it lands already resolved
      const spinning = !done && !r.step.final;
      r.spinner.style.display = spinning ? 'block' : 'none';
      r.check.style.display = spinning ? 'none' : 'block';

      if (r.step.final) {
        r.el.style.color = HOLD.colors.brand;
      } else {
        r.el.style.color = ui;
      }
    }
  }
}
