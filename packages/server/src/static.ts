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

export function staticPlaceholderHandler(message: string) {
  return (c: Context): Response => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Method Not Allowed", 405);
    }
    if (c.req.path.startsWith("/api/")) {
      return c.text("Not Found", 404);
    }
    return c.html(message);
  };
}
