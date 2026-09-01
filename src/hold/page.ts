import {
  Terminal,
  Globe,
  Apple,
  Bot,
  GitBranch,
  Code,
  Braces,
  Hash,
  ExternalLink,
} from 'lucide';

/**
 * The page around the hero: platform-aware CTA, the surfaces row, the logo
 * wall, and the reveal-on-scroll behaviour. Pure DOM — none of this touches
 * the interaction logic.
 */

type IconNode = readonly (readonly [string, Record<string, string | number>])[];
const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(node: IconNode, size: number, strokeWidth = 1.75): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
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

/** The Windows four-pane glyph (lucide has no Windows mark). */
function windowsIcon(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.style.cssText = 'display:block;flex:none';
  for (const d of [
    'M3 5.5 10.5 4.4v7.1H3z',
    'M12 4.2 21 3v8.5h-9z',
    'M3 13h7.5v7.1L3 19z',
    'M12 13h9v8l-9-1.2z',
  ]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// CTA: detect the visitor's platform, swap label + icon
// ---------------------------------------------------------------------------

function detectPlatform(): 'macOS' | 'Linux' | 'Windows' {
  const p = (navigator.platform || '') + ' ' + navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(p)) return 'macOS';
  if (/Linux/i.test(p) && !/Android/i.test(p)) return 'Linux';
  return 'Windows';
}

function buildCta(): void {
  const label = document.getElementById('ctaLabel');
  const slot = document.getElementById('ctaIcon');
  const doc = document.getElementById('ctaDocIcon');
  if (!label || !slot || !doc) return;

  const platform = detectPlatform();
  label.textContent = `Download for ${platform}`;
  slot.style.cssText = doc.style.cssText = 'display:flex';
  slot.appendChild(
    platform === 'macOS'
      ? icon(Apple as unknown as IconNode, 16, 2)
      : platform === 'Linux'
        ? icon(Terminal as unknown as IconNode, 16, 2)
        : windowsIcon(15),
  );
  doc.appendChild(icon(ExternalLink as unknown as IconNode, 15));
}

// ---------------------------------------------------------------------------
// Surfaces row
// ---------------------------------------------------------------------------

const SURFACES: [string, IconNode][] = [
  ['Terminal', Terminal as unknown as IconNode],
  ['Web', Globe as unknown as IconNode],
  ['iOS', Apple as unknown as IconNode],
  ['Android', Bot as unknown as IconNode],
  ['GitHub', GitBranch as unknown as IconNode],
  ['VS Code', Code as unknown as IconNode],
  ['JetBrains', Braces as unknown as IconNode],
  ['Slack', Hash as unknown as IconNode],
];

function buildSurfaces(): void {
  const row = document.getElementById('surfaceTiles');
  if (!row) return;
  for (const [name, node] of SURFACES) {
    const tile = document.createElement('a');
    tile.className = 'tile';
    tile.href = '#';
    const box = document.createElement('div');
    box.className = 'tile__box';
    box.appendChild(icon(node, 22));
    const label = document.createElement('span');
    label.className = 'tile__label';
    label.textContent = name;
    tile.append(box, label);
    row.appendChild(tile);
  }
}

// ---------------------------------------------------------------------------
// Logo wall — simple lockups in each brand's own colour (placeholders until
// real logo assets are dropped in)
// ---------------------------------------------------------------------------

function lockup(html: string): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;align-items:center;gap:9px';
  d.innerHTML = html;
  return d;
}

function buildLogoWall(): void {
  const wall = document.getElementById('logoWall');
  if (!wall) return;
  const f = "font-family:'Archivo',sans-serif;font-weight:500;letter-spacing:0.02em";
  wall.append(
    lockup(
      `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#105BD8"/><text x="16" y="20.5" text-anchor="middle" fill="#fff" style="font:italic 700 10px 'Archivo',sans-serif;letter-spacing:0.5px">NASA</text></svg>`,
    ),
    lockup(
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="#FAF9F5"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" opacity="0.9" transform="rotate(45 12 12) scale(0.72) translate(4.7 4.7)"/></svg><span style="${f};font-size:17px;color:#FAF9F5">PLAID</span>`,
    ),
    lockup(
      `<span style="${f};font-size:14px;color:#fff;background:#663DB3;border-radius:7px;padding:6px 14px">StubHub</span>`,
    ),
    lockup(
      `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:#06AC38"></span><span style="${f};font-size:17px;color:#FAF9F5">PagerDuty</span>`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Reveal on scroll — subtle rise + fade, honouring reduced motion
// ---------------------------------------------------------------------------

function watchReveals(): void {
  const els = Array.from(document.querySelectorAll('.reveal:not(.in)'));
  if (els.length === 0) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  for (const el of els) io.observe(el);
}

export function buildPage(): void {
  buildCta();
  buildSurfaces();
  buildLogoWall();
  watchReveals();
}
