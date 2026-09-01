/**
 * Every runtime asset URL goes through here.
 *
 * The art and audio live in public/, so Vite copies them verbatim and does
 * NOT rewrite references to them. A leading slash would therefore hard-code
 * the domain root and 404 the moment the site is served from a sub-path —
 * a project page, a preview URL, a staging folder. `BASE_URL` follows the
 * build's `base` setting instead, so the same code works either way.
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}
