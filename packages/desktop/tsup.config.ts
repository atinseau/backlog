import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

// We emit ESM for the main process (Electron 28+ supports it) so that
// pure-ESM transitive deps like execa can be imported normally rather than
// require()d. Workspace packages are bundled inline; electron itself is
// provided by the runtime.
export default defineConfig([
  {
    entry: { main: "src/main.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    noExternal: [/^@backlog\//, "execa"],
    external: ["electron"],
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    shims: true,
    outDir: "dist",
    outExtension: () => ({ js: ".mjs" }),
    // Bundled CJS deps (cross-spawn -> child_process, etc.) call require()
    // dynamically. ESM doesn't have require by default, so inject one.
    banner: {
      js: "import { createRequire as __backlogCreateRequire } from 'node:module'; const require = __backlogCreateRequire(import.meta.url);",
    },
    async onSuccess() {
      // Mirror the CLI's behaviour: copy the prebuilt UI assets next to the
      // bundle so the embedded server serves them without an explicit path.
      const uiSrc = resolve(import.meta.dirname, "../server/dist/public");
      const uiDest = resolve(import.meta.dirname, "dist/public");
      if (existsSync(uiSrc)) {
        cpSync(uiSrc, uiDest, { recursive: true });
      }
    },
  },
  {
    entry: { preload: "src/preload.ts" },
    format: ["cjs"],
    target: "node20",
    platform: "node",
    external: ["electron"],
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: false,
    outDir: "dist",
    outExtension: () => ({ js: ".cjs" }),
  },
]);
