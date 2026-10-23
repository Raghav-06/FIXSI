/** zod schemas for every structured LLM output. */

import { z } from "zod";

const strings = () => z.array(z.string()).default([]);

export const Edit = z.object({ path: z.string(), search: z.string(), replace: z.string() });

export const IncidentLabel = z.object({ title: z.string().max(120) });

export const FileSelection = z.object({ files: z.array(z.string()), reason: z.string().default("") });

export const LogDigest = z.object({ anomalies: z.array(z.string()), summary: z.string().default("") });

export const FileSummary = z.object({ summary: z.string() });

/** Models sometimes answer 70 instead of 0.7. */
const confidence = z.preprocess(
  (v) => (typeof v === "number" && v > 1 && v <= 100 ? v / 100 : v),
  z.number().min(0).max(1),
);

export const Hypothesis = z.object({
  title: z.string(),
  explanation: z.string(),
  suspected_files: strings(),
  confidence,
  evidence_for: strings(),
  evidence_against: strings(),
});

export const HypothesisList = z.object({ hypotheses: z.array(Hypothesis).min(1) });

export const ReproTest = z.object({
  filename: z.string().describe("file name under tests/fixsi/, e.g. checkout-without-address.test.js"),
  content: z.string().describe("complete ES module test source (node:test + node:assert/strict)"),
  expected_failure: z.string().describe("what the failure should look like if the hypothesis is right"),
});

export const FailureClassification = z.object({
  failure_type: z.enum(["assertion", "expected_exception", "import_error", "syntax_error", "fixture_error", "other"]),
  matches_hypothesis: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().default(""),
});

export const Verdict = z.object({ verdict: z.enum(["confirmed", "rejected"]), reasoning: z.string() });

export const FixProposal = z.object({ edits: z.array(Edit).min(1), explanation: z.string() });

export const FixDiagnosis = z.object({ diagnosis: z.string(), next_step: z.string() });

export const TestOutputSummary = z.object({ summary: z.string(), failing_tests: strings() });

export const Postmortem = z.object({
  title: z.string().describe("short root cause, e.g. 'restore() aliases saved line items'"),
  summary: z.string(),
  impact: z.string(),
  root_cause: z.string(),
  evidence: z.array(z.string()),
  fix: z.string(),
  verification: z.string(),
  prevention: z.array(z.string()),
});

export const PrTitle = z.object({ title: z.string() });

/** Compact JSON schema for prompts (what the model must produce). */
export function schemaJson(schema) {
  const { $schema, ...json } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  void $schema;
  return JSON.stringify(json);
}
