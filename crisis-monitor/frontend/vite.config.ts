import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const maplibreVersion = require("maplibre-gl/package.json").version as string;
const maplibreDistDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));

// MapLibre GL's worker isn't self-contained: maplibre-gl-worker.mjs itself
// does `import ... from "./maplibre-gl-shared.mjs"`, so both files have to
// land in the build together, next to each other, at whatever URL we tell
// MapLibre's setWorkerUrl() to use (see src/components/Map3D.tsx). Vite's
// normal asset pipeline can't discover either file on its own — MapLibre
// resolves its worker URL at runtime, not via a statically-analyzable
// `new URL(..., import.meta.url)` — so this plugin copies both files
// verbatim into a version-tagged folder under dist/ after the main build.
// The version tag means the path (and therefore any CDN/browser cache
// entry for it) automatically changes whenever maplibre-gl is upgraded,
// instead of staying frozen at a content hash that never changes because
// Vite hashes file contents and this vendor file's contents don't change
// between our own commits.
function copyMaplibreWorkerAssets(): Plugin {
  return {
    name: "copy-maplibre-worker-assets",
    apply: "build",
    closeBundle() {
      const outDir = join(process.cwd(), "dist", "assets", `maplibre-${maplibreVersion}`);
      mkdirSync(outDir, { recursive: true });
      for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        copyFileSync(join(maplibreDistDir, file), join(outDir, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyMaplibreWorkerAssets()],
  define: {
    __MAPLIBRE_WORKER_URL__: JSON.stringify(`/assets/maplibre-${maplibreVersion}/maplibre-gl-worker.mjs`),
  },
  server: {
    port: 5173,
  },
});
