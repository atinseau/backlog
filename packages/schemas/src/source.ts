import { z } from "zod";

export const sourceKindSchema = z.enum(["jira", "markdown", "csv"]);

export const sourceConfigSchema = z.object({
  id: z.string().min(1),
  kind: sourceKindSchema,
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
  auth: z.object({
    strategy: z.string().default("none"),
    refs: z.record(z.string(), z.string()).default({}),
  }).default({
    strategy: "none",
    refs: {},
  }),
  mapping: z.record(z.string(), z.unknown()).default({}),
  sync: z.object({
    pull: z.boolean().default(true),
    push_status: z.boolean().default(false),
    push_comments: z.boolean().default(false),
    source_of_truth: z.enum(["external", "cockpit"]).default("external"),
  }).default({
    pull: true,
    push_status: false,
    push_comments: false,
    source_of_truth: "external",
  }),
});

export const sourcesFileSchema = z.object({
  version: z.literal(1),
  sources: z.array(sourceConfigSchema).default([]),
});

export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourcesFile = z.infer<typeof sourcesFileSchema>;
