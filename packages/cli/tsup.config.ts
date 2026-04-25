import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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
  // Inject version from package.json at build time so the CLI's --version
  // never drifts from the published package version.
  define: {
    __BACKLOG_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    // Preserve `import.meta.url` semantics for templates that read relative files.
    options.charset = "utf8";
  },
});
