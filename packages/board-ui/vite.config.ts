import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// BACKLOG_API_URL wins when set. Otherwise follow BACKLOG_DEV_PORT, so that
// `BACKLOG_DEV_PORT=7993 bun run dev:all` moves both halves of the stack at
// once instead of leaving the proxy pointing at the old port.
const apiTarget =
  process.env.BACKLOG_API_URL ?? `http://127.0.0.1:${process.env.BACKLOG_DEV_PORT ?? 7878}`;

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The bundle is embedded byte-for-byte into the compiled binary; sourcemaps
    // would roughly double its size for no benefit in a shipped build.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Deterministic names: packages/server/src/ui-assets.ts imports these
        // paths statically so `bun build --compile` can embed them. Content
        // hashes would break that import on every rebuild.
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/app.[ext]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
