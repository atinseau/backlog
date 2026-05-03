import { aggregateUsage, aggregateUsageByBucket, type CostBucket } from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const periodSchema = z.enum(["7d", "30d", "90d", "12m", "all"]).default("30d");
const bucketSchema = z.enum(["day", "week", "month"]).optional();

function sinceForPeriod(period: z.infer<typeof periodSchema>): string | undefined {
  if (period === "all") return undefined;
  const date = new Date();
  if (period === "12m") date.setUTCMonth(date.getUTCMonth() - 12);
  else {
    const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    date.setUTCDate(date.getUTCDate() - days);
  }
  return date.toISOString();
}

function bucketForPeriod(period: z.infer<typeof periodSchema>, requested?: CostBucket): CostBucket {
  if (requested) return requested;
  if (period === "7d" || period === "30d") return "day";
  if (period === "90d") return "week";
  return "month";
}

function totalTokens(totals: ReturnType<typeof aggregateUsage>["totals"]): number {
  return totals.input_tokens
    + totals.output_tokens
    + totals.cache_read_input_tokens
    + totals.cache_creation_input_tokens;
}

export function usageRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/usage", (c) => {
    const parsed = z.object({
      period: periodSchema,
      bucket: bucketSchema,
    }).safeParse({
      period: c.req.query("period") ?? undefined,
      bucket: c.req.query("bucket") ?? undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
    }

    const project = c.get("project");
    const period = parsed.data.period;
    const bucket = bucketForPeriod(period, parsed.data.bucket);
    const sinceIso = sinceForPeriod(period);
    const options = sinceIso ? { sinceIso } : {};
    const aggregate = aggregateUsage(project.backlogDir, options);
    const timeline = aggregateUsageByBucket(project.backlogDir, bucket, options);

    return c.json({
      generated_at: new Date().toISOString(),
      period,
      bucket,
      since: sinceIso ?? null,
      totals: aggregate.totals,
      by_model: Object.entries(aggregate.perModel)
        .map(([model, totals]) => ({
          model,
          totals,
          total_tokens: totalTokens(totals),
        }))
        .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd || b.total_tokens - a.total_tokens),
      timeline: timeline.map((point) => ({
        bucket: point.bucket,
        totals: point.totals,
        total_tokens: totalTokens(point.totals),
      })),
      runs: aggregate.runs
        .map((run) => ({
          run_id: run.runId,
          totals: run.totals,
          total_tokens: totalTokens(run.totals),
          models: Object.keys(run.perModel).sort(),
        }))
        .sort((a, b) => b.totals.cost_usd - a.totals.cost_usd || b.total_tokens - a.total_tokens),
    });
  });

  return app;
}
