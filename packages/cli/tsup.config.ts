import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  // Bundle the workspace packages (@backlog/*) into a single output so the
  // published `backlog` tarball is self-contained on npm.
  noExternal: [/^@backlog\//],
  // Keep third-party deps external (commander, etc.) — they install via npm.
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  minify: false,
  outDir: "dist",
  esbuildOptions(options) {
    // Preserve `import.meta.url` semantics for templates that read relative files.
    options.charset = "utf8";
  },
});
