import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, so the build works served from a sub-path (project pages,
  // preview URLs) and not only from a domain root.
  base: './',
  build: {
    // main.ts loads its SVG/PNG art with top-level await before the scene is
    // built. That needs a target where top-level await exists; vite's default
    // browser baseline predates it, so a production build fails without this.
    target: 'esnext',
  },
});
