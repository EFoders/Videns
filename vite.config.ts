import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [preact()],
  // MapLibre's worker is an ES module that imports a shared chunk; bundle it as one.
  worker: { format: "es" },
  build: {
    target: "es2023",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    // Two pages: the viewer, and the scenario editor (VIDENS_SPEC.md 16), sharing chunks.
    rollupOptions: {
      input: {
        viewer: fileURLToPath(new URL("./index.html", import.meta.url)),
        editor: fileURLToPath(new URL("./editor.html", import.meta.url)),
      },
    },
  },
  server: {
    // `npm run dev` inside the tools container proxies the feed like nginx does.
    proxy: {
      "/picture": { target: process.env.VIDENS_FEED_UPSTREAM ?? "http://mock-feed:8090", changeOrigin: true },
      "/truth": { target: process.env.VIDENS_FEED_UPSTREAM ?? "http://mock-feed:8090", changeOrigin: true },
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
