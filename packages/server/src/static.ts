import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Context, Next } from "hono";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function mimeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function safeJoin(rootDir: string, requestPath: string): string | null {
  const cleaned = requestPath.replace(/^\/+/, "");
  const normalized = normalize(cleaned);
  if (normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    return null;
  }
  const joined = resolve(rootDir, normalized);
  if (!joined.startsWith(resolve(rootDir))) {
    return null;
  }
  return joined;
}

function readFileResponse(absolutePath: string): Response {
  const body = readFileSync(absolutePath);
  return new Response(body, {
    headers: {
      "content-type": mimeFor(absolutePath),
      "cache-control": "no-cache",
    },
  });
}

export interface StaticOptions {
  rootDir: string;
  indexFile?: string;
}

/**
 * Serve the board from a directory on disk. Used when `--ui-dist` points at a
 * live Vite build during development; the shipped binary uses the embedded
 * assets instead (see `embeddedUiHandler`).
 */
export function staticHandler(options: StaticOptions) {
  const indexFile = options.indexFile ?? "index.html";
  const indexPath = join(options.rootDir, indexFile);

  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return next();
    }
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    const candidate = safeJoin(options.rootDir, pathname);
    if (candidate && existsSync(candidate)) {
      const stats = statSync(candidate);
      if (stats.isFile()) {
        return readFileResponse(candidate);
      }
    }

    if (existsSync(indexPath)) {
      return readFileResponse(indexPath);
    }
    return next();
  };
}

interface EmbeddedUi {
  assets: Record<string, string>;
  index: string;
}

let embeddedUi: EmbeddedUi | null | undefined;

/**
 * Resolve the board assets baked into the executable.
 *
 * The import is dynamic and guarded: `ui-assets.ts` imports files out of
 * packages/board-ui/dist, which only exists after a UI build. A dev run
 * without one degrades to the placeholder page rather than crashing.
 */
export async function loadEmbeddedUi(): Promise<EmbeddedUi | null> {
  const cached = embeddedUi;
  if (cached !== undefined) return cached;
  let resolved: EmbeddedUi | null;
  try {
    const mod = await import("./ui-assets.js");
    resolved = { assets: mod.UI_ASSETS, index: mod.UI_INDEX };
  } catch {
    resolved = null;
  }
  embeddedUi = resolved;
  return resolved;
}

/**
 * Serve the embedded board. Unknown non-API paths fall back to index.html so
 * client-side routes survive a hard refresh.
 */
export function embeddedUiHandler(fallbackHtml: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return next();
    }
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      return next();
    }

    const ui = await loadEmbeddedUi();
    if (!ui) {
      return c.html(fallbackHtml);
    }

    const target = ui.assets[pathname] ?? ui.index;
    const file = Bun.file(target);
    return new Response(file, {
      headers: {
        "content-type": mimeFor(target),
        "cache-control": "no-cache",
      },
    });
  };
}
