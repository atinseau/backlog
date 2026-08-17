// Type declarations for the board-UI files embedded into the compiled binary
// via `import ... with { type: "file" }` (see packages/server/src/ui-assets.ts).
//
// Bun rewrites such an import to a string path inside the executable's virtual
// filesystem. The patterns below are scoped to packages/board-ui/dist so they
// never shadow real module resolution elsewhere — and so they win over the
// broader `*.html` declaration @types/bun ships (which resolves to HTMLBundle,
// the wrong shape for a `type: "file"` import).

declare module "*/board-ui/dist/index.html" {
  const path: string;
  export default path;
}

declare module "*/board-ui/dist/assets/app.js" {
  const path: string;
  export default path;
}

declare module "*/board-ui/dist/assets/app.css" {
  const path: string;
  export default path;
}
