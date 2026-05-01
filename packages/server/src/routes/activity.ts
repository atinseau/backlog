import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { listActiveRuns } from "@backlog/core";
import type { AppEnv } from "../project-resolver.js";

// One emitted event per ndjson line. We forward the underlying line's
// fields verbatim and add `run_id` so the UI can group by run. Shape
// of `ts` / `type` / `message` mirrors what executors append via
// `appendRunEvent` in core.
interface ActivityLine {
  run_id: string;
  ts: string;
  type: string;
  message?: string;
  // Pass-through for executor-specific extras (e.g. attempt number,
  // exit code) so future executor events surface without a server
  // schema change.
  [key: string]: unknown;
}

interface RunCursor {
  run_id: string;
  events_path: string;
  // Byte offset into the file we've already streamed. Cursor-by-bytes
  // (not line count) so partial writes mid-poll don't get re-emitted.
  offset: number;
}

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_MS = 25_000;
const INITIAL_TAIL_LINES = 30;

function readNewLines(cursor: RunCursor): { lines: string[]; offset: number } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cursor.events_path);
  } catch {
    return { lines: [], offset: cursor.offset };
  }
  if (stat.size <= cursor.offset) {
    // File rotated/truncated (rare) — restart from head.
    if (stat.size < cursor.offset) cursor.offset = 0;
    return { lines: [], offset: cursor.offset };
  }
  const fd = fs.openSync(cursor.events_path, "r");
  try {
    const len = stat.size - cursor.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, cursor.offset);
    const text = buf.toString("utf8");
    // Defer trailing partial line — newer write may extend it. We
    // advance the offset only past the last newline we saw.
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { lines: [], offset: cursor.offset };
    const consumed = text.slice(0, lastNl);
    const lines = consumed.split("\n").filter((l) => l.length > 0);
    return { lines, offset: cursor.offset + lastNl + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

function parseLine(line: string, runId: string): ActivityLine | null {
  const trimmed = line.trim();
  // Defensive guard for transient stream/tail artifacts. We should
  // only ever store NDJSON objects here, but a live reader can still
  // encounter an orphan JSON delimiter from a provider stream or a
  // partial write. Showing a naked "}" as user-visible activity is
  // pure noise.
  if (/^[{}\[\],]+$/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const ts = typeof parsed["ts"] === "string" ? (parsed["ts"] as string) : new Date().toISOString();
    const type = typeof parsed["type"] === "string" ? (parsed["type"] as string) : "raw";
    const event: ActivityLine = { ...parsed, run_id: runId, ts, type };
    return event;
  } catch {
    return { run_id: runId, ts: new Date().toISOString(), type: "raw", message: trimmed };
  }
}

export function activityRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/activity/stream", (c) => {
    const project = c.get("project");
    return streamSSE(c, async (stream) => {
      let id = 0;
      const cursors = new Map<string, RunCursor>();

      const send = async (event: string, payload: Record<string, unknown>) => {
        try {
          await stream.writeSSE({ event, id: String(id++), data: JSON.stringify(payload) });
        } catch {
          // client gone — stream.onAbort will tear down the loop
        }
      };

      // Seed with the most recent INITIAL_TAIL_LINES across all active
      // runs so the user sees context the moment they open the drawer
      // (instead of an empty pane until the next event).
      const seedLines: ActivityLine[] = [];
      for (const run of listActiveRuns(project.backlogDir)) {
        const eventsPath = path.join(project.backlogDir, "runs", "active", run.id, "events.ndjson");
        try {
          const stat = fs.statSync(eventsPath);
          cursors.set(run.id, { run_id: run.id, events_path: eventsPath, offset: stat.size });
          const all = fs.readFileSync(eventsPath, "utf8").split("\n").filter((l) => l.length > 0);
          for (const line of all.slice(-INITIAL_TAIL_LINES)) {
            const parsed = parseLine(line, run.id);
            if (parsed) seedLines.push(parsed);
          }
        } catch {
          cursors.set(run.id, { run_id: run.id, events_path: eventsPath, offset: 0 });
        }
      }
      seedLines.sort((a, b) => a.ts.localeCompare(b.ts));
      for (const ev of seedLines.slice(-INITIAL_TAIL_LINES)) {
        await send("activity", ev);
      }
      await send("ready", { ts: new Date().toISOString() });

      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      const heartbeat = setInterval(() => {
        void send("ping", { ts: new Date().toISOString() });
      }, HEARTBEAT_MS);

      // Polling loop: every tick, find any runs we haven't seen yet and
      // start cursors for them, then advance every cursor and emit new
      // lines. Cheap enough at 1Hz for typical workloads (1–5 active
      // runs, events.ndjson under a few KB).
      while (!aborted) {
        try {
          for (const run of listActiveRuns(project.backlogDir)) {
            if (cursors.has(run.id)) continue;
            const eventsPath = path.join(project.backlogDir, "runs", "active", run.id, "events.ndjson");
            cursors.set(run.id, { run_id: run.id, events_path: eventsPath, offset: 0 });
          }
          for (const cursor of cursors.values()) {
            const { lines, offset } = readNewLines(cursor);
            cursor.offset = offset;
            for (const line of lines) {
              const parsed = parseLine(line, cursor.run_id);
              if (parsed) await send("activity", parsed);
            }
          }
        } catch {
          // Best-effort tail; transient FS errors shouldn't kill the stream.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      clearInterval(heartbeat);
    });
  });

  return app;
}
