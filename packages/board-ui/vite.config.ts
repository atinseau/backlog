import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const apiTarget = process.env.BACKLOG_API_URL ?? "http://127.0.0.1:7878";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "../server/dist/public",
    emptyOutDir: true,
    sourcemap: true,
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
