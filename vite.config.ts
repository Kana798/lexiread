import path from 'path';
import {defineConfig} from 'vite';

// The live entry point is `index.html` -> `/src/app.ts`: a hand-written
// TypeScript application that renders into the static markup and styles itself
// with `src/style.css`. There is no React and no Tailwind in the shipped app —
// the former React UI now lives, unused, in `deprecated/react-legacy/`.
export default defineConfig(() => {
  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
