/**
 * Entry point, and the page's safety net.
 *
 * Everything in main.ts depends on a WebGL context and on art fetched with
 * top-level await. Either can fail — an old browser, a blocked context, a
 * dropped request — and because it is a module, a failure there would leave
 * the hero permanently blank with no error the visitor can act on.
 *
 * So the scene is imported only after WebGL is known to work, and the import
 * itself is caught. In both failure paths a static composition takes over:
 * the head and the scribble as plain DOM, using the same art the canvas would
 * have drawn. The headline, subtitle and CTA are real markup and were never
 * at risk, so what the visitor gets is the page minus the animation.
 */

function canUseWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

/** Reveal the no-canvas composition that ships in the markup. */
function showFallback(): void {
  document.documentElement.classList.add('no-webgl');
}

if (!canUseWebGL()) {
  showFallback();
} else {
  import('./main').catch(() => showFallback());
}
