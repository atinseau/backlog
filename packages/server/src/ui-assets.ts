// The board UI, embedded into the compiled binary.
//
// `bun build --compile` follows these `type: "file"` imports and copies each
// file into the executable; at runtime the default export is a path inside
// Bun's virtual filesystem (`/$bunfs/root/...`) that `Bun.file()` can read.
// That is what makes `backlog serve` a single self-contained binary with no
// sibling `public/` directory to ship.
//
// The paths are deterministic by design — see the `rollupOptions.output` block
// in packages/board-ui/vite.config.ts. scripts/build.ts asserts that every file
// Vite emitted is listed here, so a newly introduced asset fails the build
// loudly instead of 404ing at runtime.
//
// Importing this module throws when packages/board-ui/dist is missing. Callers
// must reach it through a dynamic import guarded by try/catch so that dev runs
// without a UI build degrade to the "UI not built" placeholder.
import appCss from "../../board-ui/dist/assets/app.css" with { type: "file" };
import appJs from "../../board-ui/dist/assets/app.js" with { type: "file" };
import indexHtml from "../../board-ui/dist/index.html" with { type: "file" };

/** Request path (leading slash, as it arrives over HTTP) → embedded file path. */
export const UI_ASSETS: Record<string, string> = {
  "/index.html": indexHtml,
  "/assets/app.js": appJs,
  "/assets/app.css": appCss,
};

export const UI_INDEX = indexHtml;
