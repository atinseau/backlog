import { z } from "zod";

export const traceOutcomeSchema = z.enum(["implemented", "rejected", "blocked"]);

// `verified` means the claim came out of executing something (a failing test, a
// reproducible error). `observed` means an agent read code and interpreted it.
// The consolidator treats the two differently: facts enter the canon on first
// sight, interpretations wait for a second witness.
export const traceConfidenceSchema = z.enum(["verified", "observed"]);

export const traceConstraintSchema = z.object({
  statement: z.string().min(1),
  // A resolvable pointer: `path:line`, a test name, a command's error output.
  // No evidence, no promotion to the canon — enforced here at write time.
  evidence: z.string().min(1),
  confidence: traceConfidenceSchema,
});

export const traceDecisionSchema = z.object({
  chose: z.string().min(1),
  rejected: z.string().min(1),
  because: z.string().min(1),
});

export const traceProposalSchema = z.object({
  title: z.string().min(1),
  motive: z.string().min(1),
  scopes: z.array(z.string()).default([]),
});

export const traceDiscoveredDepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), task_id: z.string().min(1) }),
  z.object({ kind: z.literal("proposal"), proposal: traceProposalSchema }),
]);

export const traceSchema = z
  .object({
    version: z.literal(1),
    run_id: z.string().min(1),
    task_id: z.string().min(1),
    subtask_id: z.string().min(1).optional(),
    created_at: z.string().min(1),
    outcome: traceOutcomeSchema,
    summary: z.string().min(1),
    constraints: z.array(traceConstraintSchema).default([]),
    decisions: z.array(traceDecisionSchema).default([]),
    rejection_reason: z.string().min(1).optional(),
    open_question: z.string().min(1).optional(),
    discovered_deps: z.array(traceDiscoveredDepSchema).default([]),
    consolidation_hint: z.enum(["none", "high"]).default("none"),
    consolidation_hint_reason: z.string().min(1).optional(),
  })
  .superRefine((trace, ctx) => {
    if (trace.outcome === "rejected" && !trace.rejection_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejection_reason"],
        message: "rejection_reason is required when outcome is 'rejected'",
      });
    }
    if (trace.outcome === "blocked" && !trace.open_question) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["open_question"],
        message: "open_question is required when outcome is 'blocked'",
      });
    }
    if (trace.consolidation_hint === "high" && !trace.consolidation_hint_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consolidation_hint_reason"],
        message: "consolidation_hint_reason is required when consolidation_hint is 'high'",
      });
    }
  });

export type TraceOutcome = z.infer<typeof traceOutcomeSchema>;
export type TraceConstraint = z.infer<typeof traceConstraintSchema>;
export type TraceDecision = z.infer<typeof traceDecisionSchema>;
export type TraceProposal = z.infer<typeof traceProposalSchema>;
export type TraceDiscoveredDep = z.infer<typeof traceDiscoveredDepSchema>;
export type Trace = z.infer<typeof traceSchema>;
