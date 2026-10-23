/**
 * ModelRouter: routes each task to a Nemotron tier (Nano/Super/Ultra) on Nebius Token Factory.
 *
 * Handles structured JSON outputs, retries with backoff, tier fallback, telemetry and a per-run token budget.
 */

import { z } from "zod";

import { CancelledError, logger, sleep } from "../util.js";
import { OpenAICompatibleClient } from "./client.js";
import { systemPrompt } from "./prompts.js";
import { schemaJson } from "./schemas.js";

const log = logger("fixsi.llm");

export const NANO = "nano";
export const SUPER = "super";
export const ULTRA = "ultra";
const TIER_ORDER = [ULTRA, SUPER, NANO];

/** The routing table: task -> tier. Change routing here. */
export const TASK_TIERS = {
  // Nano: fast, cheap, high-volume
  label_incident: NANO,
  pick_files: NANO,
  condense_logs: NANO,
  summarize_file: NANO,
  classify_failure: NANO,
  // Super: code generation and reading test output
  write_repro_test: SUPER,
  repair_test: SUPER,
  write_fix: SUPER,
  interpret_test_output: SUPER,
  pr_title: SUPER,
  // Ultra: deep reasoning where mistakes are expensive
  generate_hypotheses: ULTRA,
  judge_reproduction: ULTRA,
  diagnose_fix_failure: ULTRA,
  postmortem: ULTRA,
};

const MAX_COMPLETION_TOKENS = { [NANO]: 2048, [SUPER]: 6144, [ULTRA]: 8192 };
const TEMPERATURE = { [NANO]: 0.1, [SUPER]: 0.2, [ULTRA]: 0.3 };
const MAX_RETRIES = 3;

export class LLMError extends Error {
  name = "LLMError";
}

export class BudgetExceeded extends LLMError {
  name = "BudgetExceeded";
}

export class LLMOutputError extends LLMError {
  name = "LLMOutputError";
}

export function stripReasoning(text) {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (/<\/think>/i.test(out)) out = out.split(/<\/think>/i).at(-1); // opening tag swallowed by the template
  return out.trim();
}

/** Return the first complete JSON object that starts at `start`, or undefined. */
function decodeObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Strip code fences / reasoning and return the first decodable JSON object. */
export function extractJson(text) {
  const cleaned = stripReasoning(text);
  const fenced = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const candidate of [...fenced, cleaned]) {
    for (let i = candidate.indexOf("{"); i >= 0; i = candidate.indexOf("{", i + 1)) {
      const obj = decodeObjectAt(candidate, i);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    }
  }
  throw new LLMOutputError("no JSON object found in model output");
}

export function isRetryable(err) {
  const status = err?.status ?? err?.statusCode;
  if (typeof status === "number") return status === 429 || status >= 500;
  const name = String(err?.name ?? "").toLowerCase();
  return ["timeout", "abort", "connection", "ratelimit"].some((k) => name.includes(k))
    || (err instanceof TypeError && /fetch failed|network/i.test(err.message));
}

function describeError(err) {
  return err instanceof z.ZodError ? z.prettifyError(err) : String(err?.message ?? err);
}

export class ModelRouter {
  constructor(settings, { client = null, backoffBase = 0.75 } = {}) {
    this.settings = settings;
    this.models = { [NANO]: settings.nemotronNanoModel, [SUPER]: settings.nemotronSuperModel, [ULTRA]: settings.nemotronUltraModel };
    this.backoffBase = backoffBase;
    this.jsonModeOk = new Map();
    if (!client && settings.llmConfigured) {
      client = new OpenAICompatibleClient({
        baseUrl: settings.nebiusBaseUrl, apiKey: settings.nebiusApiKey, timeoutSeconds: settings.llmTimeoutSeconds,
      });
    }
    this.client = client;
  }

  get available() {
    return this.client !== null;
  }

  tierFor(task) {
    return TASK_TIERS[task];
  }

  session(runId, onCall = null, signal = null) {
    return new RunLLM(this, runId, { limit: this.settings.maxTokensPerRun, used: 0, calls: [] }, onCall, signal);
  }

  async create(model, tier, task, messages, signal) {
    const params = {
      model, messages, task, temperature: TEMPERATURE[tier], max_tokens: MAX_COMPLETION_TOKENS[tier],
    };
    const useJson = this.settings.llmUseJsonMode && this.jsonModeOk.get(model) !== false;
    if (!useJson) return this.client.createChatCompletion(params, { signal });
    try {
      return await this.client.createChatCompletion({ ...params, response_format: { type: "json_object" } }, { signal });
    } catch (err) {
      if (err?.status === 400 || err?.status === 422) { // JSON mode unsupported -> remember and retry plain
        this.jsonModeOk.set(model, false);
        return this.client.createChatCompletion(params, { signal });
      }
      throw err;
    }
  }
}

/** Per-run view of the router: tracks budget and reports telemetry. */
export class RunLLM {
  constructor(router, runId, budget, onCall, signal) {
    this.router = router;
    this.runId = runId;
    this.budget = budget;
    this.onCall = onCall;
    this.signal = signal;
  }

  get tokensUsed() {
    return this.budget.used;
  }

  async record(call) {
    this.budget.calls.push(call);
    this.budget.used += call.prompt_tokens + call.completion_tokens;
    if (this.onCall) await this.onCall(call);
  }

  async ask({ stage, task, user, schema, fmt = {} }) {
    if (!this.router.available) throw new LLMError("no LLM configured (NEBIUS_API_KEY is empty)");
    if (this.budget.used >= this.budget.limit) {
      throw new BudgetExceeded(`token budget of ${this.budget.limit} tokens for this run is exhausted`);
    }
    const messages = [
      { role: "system", content: systemPrompt(task, schemaJson(schema), fmt) },
      { role: "user", content: user },
    ];
    const chain = TIER_ORDER.slice(TIER_ORDER.indexOf(TASK_TIERS[task]));
    let lastErr = null;
    for (const [i, tier] of chain.entries()) {
      try {
        return await this.askTier(stage, task, tier, messages, schema, i > 0);
      } catch (err) {
        if (err instanceof LLMOutputError || err instanceof BudgetExceeded || err instanceof CancelledError) throw err;
        if (this.signal?.aborted) throw new CancelledError();
        lastErr = err;
        log.warn(`tier ${tier} failed for ${task} (${err?.name}); ${i + 1 < chain.length ? "falling back" : "no tiers left"}`);
      }
    }
    throw new LLMError(`all tiers failed for ${task}: ${lastErr?.name}: ${String(lastErr?.message ?? "").slice(0, 200)}`);
  }

  async askTier(stage, task, tier, messages, schema, fallback) {
    const model = this.router.models[tier];
    let convo = [...messages];
    for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
      const response = await this.callWithRetries(stage, task, tier, model, convo, fallback);
      const message = response.choices?.[0]?.message ?? {};
      const content = message.content || message.reasoning_content || "";
      try {
        return schema.parse(extractJson(content));
      } catch (err) {
        if (!(err instanceof LLMOutputError || err instanceof z.ZodError)) throw err;
        if (this.budget.used >= this.budget.limit) throw new BudgetExceeded("token budget exhausted while repairing output");
        if (parseAttempt === 1) {
          throw new LLMOutputError(`${task}: model output did not match schema: ${describeError(err).slice(0, 300)}`);
        }
        convo = [
          ...convo,
          { role: "assistant", content: stripReasoning(content).slice(0, 4000) },
          { role: "user", content: `Your reply was not valid. Error:\n${describeError(err).slice(0, 1500)}\nReply again with ONLY the corrected JSON object.` },
        ];
      }
    }
    throw new Error("unreachable");
  }

  async callWithRetries(stage, task, tier, model, messages, fallback) {
    const base = { run_id: this.runId, stage, task, tier, model, fallback };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const started = performance.now();
      let response;
      try {
        response = await this.router.create(model, tier, task, messages, this.signal);
      } catch (err) {
        if (this.signal?.aborted) throw new CancelledError();
        const latency = Math.round(performance.now() - started);
        await this.record({ ...base, prompt_tokens: 0, completion_tokens: 0, latency_ms: latency, success: false, error: String(err?.name ?? "Error") });
        if (!isRetryable(err) || attempt === MAX_RETRIES - 1) throw err;
        await sleep(this.router.backoffBase * 1000 * 2 ** attempt, this.signal);
        continue;
      }
      const latency = Math.round(performance.now() - started);
      let promptTokens = response.usage?.prompt_tokens;
      let completionTokens = response.usage?.completion_tokens;
      if (promptTokens == null) { // estimate when the server omits usage
        promptTokens = Math.floor(messages.reduce((n, m) => n + m.content.length, 0) / 4);
        completionTokens = Math.floor((response.choices?.[0]?.message?.content ?? "").length / 4);
      }
      await this.record({ ...base, prompt_tokens: Math.trunc(promptTokens), completion_tokens: Math.trunc(completionTokens ?? 0), latency_ms: latency, success: true, error: null });
      return response;
    }
    throw new Error("unreachable");
  }
}
