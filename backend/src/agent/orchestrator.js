/**
 * The six-stage investigation state machine.
 *
 * Trigger -> Investigate -> Reproduce -> Fix -> Verify -> Report
 *
 * Core rule: application code stays locked (Workspace.applyEdits throws) until a reproduction
 * test has failed for the reason a hypothesis predicts. That test is the proof, and the bar the fix must clear.
 */

import path from "node:path";

import {
  FailureClassification, FileSelection, FileSummary, FixDiagnosis, FixProposal, HypothesisList, IncidentLabel,
  LogDigest, Postmortem, PrTitle, ReproTest, Verdict,
} from "../llm/schemas.js";
import { logger, throwIfCancelled } from "../util.js";
import { PatchError, revert, unifiedDiff } from "./patcher.js";

const log = logger("fixsi.orchestrator");

const LONG_LOG_CHARS = 3000;
const MAX_CONTEXT_FILE_CHARS = 12_000;
const LARGE_FILE_LINES = 300;
const MAX_CONTEXT_FILES = 6;
const SOURCE_GLOB = "**/*.js";

export class RunFailed extends Error {
  name = "RunFailed";

  constructor(message, code = "run_failed") {
    super(message);
    this.code = code;
  }
}

const unique = (items) => [...new Set(items)];
const json = (value) => JSON.stringify(value, null, 2);

export class Orchestrator {
  constructor({ runId, incident, settings, llm, workspace, bus, github = null, onStage = null, signal = null }) {
    this.runId = runId;
    this.incident = incident;
    this.settings = settings;
    this.llm = llm;
    this.ws = workspace;
    this.bus = bus;
    this.github = github;
    this.onStage = onStage;
    this.signal = signal;
    this.hyps = []; // { id, data, round, status: pending | rejected | confirmed, reason }
    this.ctx = { files: new Map(), summaries: new Map(), logsDigest: "", gitLog: "", commits: new Map(), helpers: "" };
    this.baseline = null;
    this.confirmed = null;
    this.reproPath = null;
    this.reproContent = "";
    this.reproResult = null;
    this.finalSuite = null;
    this.fix = null;
    this.attempts = 0;
    this.stage = "trigger";
  }

  // -- event helpers ------------------------------------------------------------
  emit(type, payload) {
    return this.bus.publish(this.runId, type, payload);
  }

  say(message, level = "info") {
    this.emit("log", { message, level });
  }

  setStage(stage) {
    throwIfCancelled(this.signal);
    this.stage = stage;
    this.emit("stage_changed", { stage });
    this.onStage?.(stage);
  }

  ask(task, user, schema, fmt = {}) {
    throwIfCancelled(this.signal);
    return this.llm.ask({ stage: this.stage, task, user, schema, fmt });
  }

  async runTests(purpose, selector = null, meta = {}) {
    throwIfCancelled(this.signal);
    const started = { purpose, selector, hypothesis_id: meta.hypothesisId ?? null, attempt: meta.attempt ?? null };
    this.emit("test_run_started", started);
    const res = await this.ws.runTests(selector, { signal: this.signal });
    this.emit("test_run_finished", {
      ...started,
      passed: res.passed, failed: res.failed, errors: res.errors, duration_ms: res.durationMs,
      exit_code: res.exitCode, timed_out: res.timedOut, backend: res.backend,
      output_tail: res.outputTail.slice(-3000),
      failures: res.failures.slice(0, 10).map((f) => ({ ...f })),
    });
    return res;
  }

  // -- main -------------------------------------------------------------------
  async run() {
    await this.trigger();
    await this.investigate(1);
    if (!(await this.reproduce())) {
      this.say("Every hypothesis was rejected. Re-investigating with the new evidence.", "warn");
      await this.investigate(2);
      if (!(await this.reproduce())) {
        throw new RunFailed("Could not reproduce the bug: all hypotheses were rejected by tests.", "not_reproduced");
      }
    }
    await this.fixAndVerify();
    return this.report();
  }

  // -- 1. trigger -----------------------------------------------------------------
  async trigger() {
    this.setStage("trigger");
    this.say(`Workspace ready: isolated copy of the target repo (${this.ws.listFiles().length} files).`);
    if (!this.incident.title) {
      const label = await this.ask("label_incident", this.incident.asText().slice(0, 6000), IncidentLabel);
      this.incident = this.incident.with({ title: label.title });
      this.say(`Incident labelled: ${label.title}`);
    }
    this.say("Running the existing test suite to record a baseline.");
    this.baseline = await this.runTests("baseline");
    if (this.baseline.total === 0) {
      throw new RunFailed("The target repo has no runnable tests; Fixsi needs a suite to verify against.", "no_tests");
    }
    if (this.baseline.failed || this.baseline.errors) {
      this.say(`Baseline already has ${this.baseline.failed + this.baseline.errors} failing tests; `
        + "they will be tolerated but no new failures are allowed.", "warn");
    } else {
      this.say(`Baseline green: ${this.baseline.passed} tests pass.`, "success");
    }
  }

  // -- 2. investigate ---------------------------------------------------------------
  async investigate(round) {
    this.setStage("investigate");
    const inc = this.incident;
    if (round === 1) {
      const rawLogs = [inc.stack_trace, inc.logs].filter(Boolean).join("\n");
      if (rawLogs.length > LONG_LOG_CHARS) {
        this.say("Logs are long; condensing them to the anomalies that matter.");
        const digest = await this.ask("condense_logs", rawLogs.slice(-40_000), LogDigest);
        this.ctx.logsDigest = digest.anomalies.map((a) => `- ${a}`).join("\n");
      }
      const listing = this.ws.listFiles(SOURCE_GLOB);
      this.say(`Scanning the repo: ${listing.length} JavaScript files.`);
      const traced = this.filesFromTrace(listing);
      if (traced.length) this.say(`Stack trace mentions: ${traced.join(", ")}`);
      const pick = await this.ask("pick_files", `${inc.asText().slice(0, 8000)}\n\n## Repository files\n${listing.join("\n")}`,
        FileSelection);
      const chosen = unique([...traced, ...pick.files].filter((f) => listing.includes(f) && !f.startsWith("tests/fixsi/")))
        .slice(0, MAX_CONTEXT_FILES);
      for (const rel of chosen) await this.loadFile(rel);
      this.say(chosen.length ? `Read ${chosen.join(", ")}` : "No obviously relevant files; using the listing.");
      if (listing.includes("tests/helpers.js")) this.ctx.helpers = this.ws.raw("tests/helpers.js");
      this.ctx.gitLog = await this.ws.gitLog(12);
      this.say("Checked recent git history (last 12 commits).");
      for (const sha of await this.recentCommitsTouching(chosen.filter((f) => !f.startsWith("tests/")))) {
        const show = await this.ws.gitShow(sha);
        this.ctx.commits.set(sha, show.slice(0, 3500));
        const lines = show.split("\n");
        this.say(`Inspected commit ${sha}: ${lines.length > 4 ? lines[4].trim() : sha}`);
      }
    } else {
      const listing = this.ws.listFiles(SOURCE_GLOB);
      for (const h of this.hyps) {
        for (const f of h.data.suspected_files) {
          if (!this.ctx.files.has(f) && listing.includes(f)) await this.loadFile(f);
        }
      }
    }

    const rejected = this.hyps.filter((h) => h.status === "rejected");
    let prompt = this.contextBlock();
    if (rejected.length) {
      prompt += "\n\n## Rejected hypotheses (disproven by tests — do not repeat)\n"
        + rejected.map((h) => `- ${h.data.title}: ${h.reason}`).join("\n");
    }
    const n = this.settings.maxHypotheses;
    this.say("Generating ranked hypotheses (Nemotron Ultra).");
    const out = await this.ask("generate_hypotheses", prompt, HypothesisList, { n: `between 2 and ${n}` });
    const fresh = [...out.hypotheses].sort((a, b) => b.confidence - a.confidence).slice(0, n);
    const start = this.hyps.length;
    fresh.forEach((data, i) => {
      const state = { id: `h${start + i + 1}`, data, round, status: "pending", reason: "" };
      this.hyps.push(state);
      this.emit("hypothesis_created", { id: state.id, rank: i + 1, round, ...data });
    });
    this.say(`${fresh.length} hypotheses on the board. Testing the most likely first.`);
  }

  async loadFile(rel) {
    const text = this.ws.raw(rel);
    if (text.split("\n").length - 1 > LARGE_FILE_LINES) {
      const summary = await this.ask("summarize_file", `File: ${rel}\n\n${text.slice(0, 30_000)}`, FileSummary);
      this.ctx.summaries.set(rel, summary.summary);
    }
    this.ctx.files.set(rel, text.slice(0, MAX_CONTEXT_FILE_CHARS));
  }

  /** Repo files named in JS stack frames, e.g. "at f (/srv/app/shop/orders.js:54:45)" or file:// URLs. */
  filesFromTrace(listing) {
    const text = `${this.incident.stack_trace}\n${this.incident.logs}`;
    const found = [];
    for (const m of text.matchAll(/(?:file:\/\/)?([^\s()'"]+?\.[cm]?js):\d+(?::\d+)?/g)) {
      const p = decodeURI(m[1]).replace(/\\/g, "/");
      for (const rel of listing) {
        if (p.endsWith("/" + rel) || p === rel) found.push(rel);
      }
    }
    return unique(found);
  }

  async recentCommitsTouching(files) {
    if (!files.length) return [];
    const out = await this.ws.git("log", "-n3", "--pretty=format:%h", "--", ...files);
    return out.split(/\s+/).filter(Boolean).slice(0, 3);
  }

  contextBlock(includeGit = true) {
    const parts = [this.incident.asText().slice(0, 12_000)];
    if (this.ctx.logsDigest) parts.push(`## Log anomalies (condensed)\n${this.ctx.logsDigest}`);
    for (const [rel, text] of this.ctx.files) {
      const summary = this.ctx.summaries.has(rel) ? `Summary: ${this.ctx.summaries.get(rel)}\n` : "";
      parts.push(`## File: ${rel}\n${summary}\`\`\`js\n${text}\n\`\`\``);
    }
    if (includeGit && this.ctx.gitLog) {
      parts.push(`## Recent commits\n${this.ctx.gitLog.slice(0, 4000)}`);
      for (const [sha, show] of this.ctx.commits) parts.push(`## git show ${sha}\n${show}`);
    }
    return parts.join("\n\n");
  }

  // -- 3. reproduce -------------------------------------------------------------------
  async reproduce() {
    this.setStage("reproduce");
    for (const h of this.hyps.filter((x) => x.status === "pending")) {
      this.say(`Testing ${h.id}: ${h.data.title}`);
      const [verdict, reason] = await this.testHypothesis(h);
      h.reason = reason;
      if (verdict === "confirmed") {
        h.status = "confirmed";
        this.confirmed = h;
        this.emit("evidence_added", { hypothesis_id: h.id, kind: "for", text: reason });
        this.emit("hypothesis_confirmed", { id: h.id, reason, test_path: this.reproPath });
        this.say(`${h.id} confirmed — the reproduction test fails exactly as predicted.`, "success");
        return true;
      }
      h.status = "rejected";
      this.emit("evidence_added", { hypothesis_id: h.id, kind: "against", text: reason });
      this.emit("hypothesis_rejected", { id: h.id, reason });
      this.say(`${h.id} rejected: ${reason}`, "warn");
    }
    return false;
  }

  async testHypothesis(h) {
    const user = this.contextBlock(false)
      + `\n\n## tests/helpers.js (shared setup you may import)\n\`\`\`js\n${this.ctx.helpers}\n\`\`\``
      + `\n\n## Hypothesis to test\n${json(h.data)}`;
    let test = await this.ask("write_repro_test", user, ReproTest);
    let repaired = false;
    for (;;) {
      const rel = this.ws.writeTest(`tests/fixsi/${path.posix.basename(test.filename.replace(/\\/g, "/"))}`, test.content);
      this.emit("test_written", { hypothesis_id: h.id, path: rel, content: test.content, expected_failure: test.expected_failure, repaired });
      const res = await this.runTests("reproduce", rel, { hypothesisId: h.id });
      const [verdict, reason] = await this.assess(h, test, res);
      if (verdict === "test_bug" && !repaired) {
        this.say(`The test itself is broken (${reason}); repairing it once.`, "warn");
        test = await this.ask("repair_test", `${user}\n\n## Your test\n\`\`\`js\n${test.content}\n\`\`\``
          + `\n\n## Test runner output\n${res.outputTail.slice(-3000)}`, ReproTest);
        this.ws.removeTest(rel);
        repaired = true;
        continue;
      }
      if (verdict === "confirmed") {
        [this.reproPath, this.reproContent, this.reproResult] = [rel, test.content, res];
        return [verdict, reason];
      }
      this.ws.removeTest(rel);
      if (verdict === "test_bug") return ["rejected", `could not write a valid reproduction test (${reason})`];
      return [verdict, reason];
    }
  }

  async assess(h, test, res) {
    if (res.timedOut) return ["test_bug", "test run timed out"];
    if (res.total === 0) return ["test_bug", "no tests were collected"];
    if (res.ok) return ["rejected", `reproduction test passed (${res.passed} passed): the predicted defect is absent`];
    if (res.errors && !res.failed) return ["test_bug", (res.failures[0]?.message || "load/setup error").slice(0, 200)];
    const failure = (res.failed ? res.failures.find((f) => f.kind === "failure") : null) ?? res.failures[0];
    const detail = `${failure.message}\n${failure.details.slice(-2500)}`;
    const cls = await this.ask("classify_failure",
      `## Hypothesis\n${h.data.title}: ${h.data.explanation}\n\n## Expected failure\n${test.expected_failure}\n\n`
      + `## Test\n\`\`\`js\n${test.content}\n\`\`\`\n\n## Actual failure (${failure.nodeid})\n${detail}`, FailureClassification);
    const summary = Orchestrator.failureSummary(failure.message);
    if (["import_error", "syntax_error", "fixture_error"].includes(cls.failure_type)) {
      return ["test_bug", `${cls.failure_type}: ${summary}`];
    }
    if (cls.matches_hypothesis && cls.confidence >= 0.75 && cls.failure_type !== "other") {
      return ["confirmed", `${failure.nodeid} fails as predicted: ${summary}`];
    }
    this.say("Evidence is ambiguous; asking Nemotron Ultra to adjudicate.");
    const verdict = await this.ask("judge_reproduction",
      `## Hypothesis\n${json(h.data)}\n\n## Test\n\`\`\`js\n${test.content}\n\`\`\`\n\n## Result\n${detail}\n\n`
      + `## Classifier said\n${JSON.stringify(cls)}`, Verdict);
    return [verdict.verdict === "confirmed" ? "confirmed" : "rejected", verdict.reasoning];
  }

  static failureSummary(message) {
    const first = message ? message.trim().split("\n")[0] : "test failed";
    return first.slice(0, 240);
  }

  // -- 4 + 5. fix and verify --------------------------------------------------------
  async fixAndVerify() {
    if (!(this.confirmed && this.reproPath && this.reproResult)) throw new Error("fix requires a confirmed hypothesis");
    this.ws.unlockEdits();
    let feedback = "";
    const maxAttempts = this.settings.maxFixAttempts;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.attempts = attempt;
      this.setStage("fix");
      this.say(`Fix attempt ${attempt}/${maxAttempts}.`);
      let user = this.incident.asText().slice(0, 6000)
        + `\n\n## Confirmed root cause\n${json(this.confirmed.data)}`
        + `\n\n## Reproduction test (${this.reproPath}) — must pass after the fix\n\`\`\`js\n${this.reproContent}\n\`\`\``
        + `\n\n## Its current failure\n${Orchestrator.failureText(this.reproResult)}`
        + this.fixContextFiles().map((rel) => `\n\n## File: ${rel} (current content)\n\`\`\`js\n${this.ws.raw(rel)}\n\`\`\``).join("");
      if (feedback) user += `\n\n## Previous attempt failed\n${feedback}`;
      const proposal = await this.ask("write_fix", user, FixProposal);
      this.emit("patch_proposed", { attempt, explanation: proposal.explanation, edits: proposal.edits });
      let patch;
      try {
        patch = this.ws.applyEdits(proposal.edits);
      } catch (err) {
        if (!(err instanceof PatchError)) throw err;
        feedback = `The patch could not be applied: ${err.message}`;
        this.say(`Patch rejected: ${err.message}`, "warn");
        continue;
      }
      const diff = await this.ws.diffFiles(patch.files);
      this.emit("patch_applied", { attempt, files: patch.files, diff });

      this.setStage("verify");
      const repro = await this.runTests("verify_repro", this.reproPath, { attempt });
      const suite = await this.runTests("verify_suite", null, { attempt });
      const problems = this.verificationProblems(repro, suite);
      if (!problems.length) {
        [this.fix, this.finalSuite] = [proposal, suite];
        this.say(`Verified: reproduction test passes and all ${suite.passed} tests are green.`, "success");
        return;
      }
      revert(this.ws.root, patch);
      this.say(`Verification failed: ${problems.join("; ")}`, "warn");
      if (attempt < maxAttempts) {
        const failing = repro.ok ? suite : repro;
        const diag = await this.ask("diagnose_fix_failure",
          `## Root cause\n${this.confirmed.data.title}\n\n## Patch\n\`\`\`diff\n${diff}\n\`\`\`\n\n## Problems\n${problems.join("\n")}`
          + `\n\n## Test output\n${failing.outputTail.slice(-4000)}`, FixDiagnosis);
        feedback = `Patch:\n\`\`\`diff\n${diff}\n\`\`\`\nProblems: ${problems.join("; ")}\n`
          + `Diagnosis: ${diag.diagnosis}\nNext step: ${diag.next_step}`;
        this.say(`Diagnosis: ${diag.diagnosis}`);
      }
    }
    throw new RunFailed(`No fix passed verification after ${maxAttempts} attempts.`, "fix_failed");
  }

  fixContextFiles() {
    const listing = this.ws.listFiles(SOURCE_GLOB);
    const candidates = unique([...this.confirmed.data.suspected_files, ...this.ctx.files.keys()]);
    return candidates.filter((f) => listing.includes(f) && !f.startsWith("tests/")).slice(0, 6);
  }

  static failureText(res) {
    const text = res.failures.slice(0, 3).map((f) => `${f.nodeid}: ${f.message}\n${f.details.slice(-1500)}`).join("\n");
    return text || res.outputTail.slice(-2000);
  }

  verificationProblems(repro, suite) {
    const problems = [];
    if (!repro.ok) problems.push(`reproduction test still fails (${repro.failed} failed, ${repro.errors} errors)`);
    const baselineBad = new Set(this.baseline.failures.map((f) => f.nodeid));
    const newBad = suite.failures.map((f) => f.nodeid).filter((id) => !baselineBad.has(id));
    if (newBad.length) problems.push(`existing tests broke: ${newBad.slice(0, 5).join(", ")}`);
    if (suite.passed < this.baseline.passed + 1) {
      problems.push(`suite passed ${suite.passed}, expected at least ${this.baseline.passed + 1}`);
    }
    const tampered = this.ws.modifiedProtectedTests();
    if (tampered.length) problems.push(`pre-existing tests were modified: ${tampered.join(", ")}`);
    return problems;
  }

  // -- 6. report ----------------------------------------------------------------------
  async report() {
    this.setStage("report");
    const diff = await unifiedDiff(this.ws.root);
    const evidence = this.hyps.filter((h) => h.status !== "pending");
    const commits = [...this.ctx.commits.keys()];
    const user = this.incident.asText().slice(0, 8000)
      + "\n\n## Hypotheses tested\n" + evidence.map((h) => `- [${h.status}] ${h.data.title}: ${h.reason}`).join("\n")
      + `\n\n## Reproduction test (${this.reproPath})\n\`\`\`js\n${this.reproContent}\n\`\`\``
      + `\n\n## Fix\n${this.fix.explanation}\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``
      + `\n\n## Verification\nBaseline: ${this.baseline.passed} passed. After fix: ${this.finalSuite.passed} passed, `
      + `${this.finalSuite.failed} failed, fix attempts: ${this.attempts}.`
      + (commits.length ? `\n\n## Relevant commits\n${commits.join("\n").slice(0, 2000)}` : "");
    const pm = await this.ask("postmortem", user, Postmortem);
    let prTitle = (await this.ask("pr_title", `Root cause: ${pm.title}\nFix: ${this.fix.explanation}`, PrTitle)).title;
    if (!prTitle.toLowerCase().startsWith("fix")) prTitle = `fix: ${prTitle}`;
    const models = unique(this.llm.budget.calls.filter((c) => c.success).map((c) => c.model)).sort();
    const markdown = renderPostmortem(pm, this, models);
    this.emit("report_ready", {
      title: pm.title, markdown, postmortem: pm, diff, test_path: this.reproPath, test_content: this.reproContent,
      pr_title: prTitle, models,
    });
    let prUrl = null;
    if (this.github) {
      try {
        const pr = await this.github.openPr(this.runId, prTitle, markdown, this.ws.root, Orchestrator.changedFiles(diff));
        prUrl = pr.url;
        this.emit("pr_opened", { url: pr.url, number: pr.number ?? null, branch: pr.branch });
        this.say(`Opened pull request #${pr.number}`, "success");
      } catch (err) { // report still succeeds with a downloadable patch
        log.warn(`PR creation failed: ${err?.name}`);
        this.say(`Could not open a PR (${err?.name}); the .patch download is available.`, "warn");
      }
    }
    return {
      title: pm.title, markdown, diff, pr_title: prTitle, pr_url: prUrl, test_path: this.reproPath,
      test_content: this.reproContent,
    };
  }

  static changedFiles(diff) {
    return unique([...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1])).sort();
  }
}

export function renderPostmortem(pm, orch, models) {
  const rejected = orch.hyps.filter((h) => h.status === "rejected");
  return [
    `# Postmortem: ${pm.title}`, "",
    "## Summary", pm.summary, "",
    "## Impact", pm.impact, "",
    "## Root cause", pm.root_cause, "",
    "## Evidence",
    ...pm.evidence.map((e) => `- ${e}`),
    ...rejected.map((h) => `- Ruled out: _${h.data.title}_ — ${h.reason}`), "",
    "## Fix", pm.fix, "",
    "## How it was verified",
    pm.verification, "",
    `- Reproduction test \`${orch.reproPath}\` failed before the fix and passes after it.`,
    `- Full suite: ${orch.finalSuite.passed} passed, ${orch.finalSuite.failed} failed `
      + `(baseline: ${orch.baseline.passed} passed). Pre-existing tests were not modified.`,
    `- Fix attempts: ${orch.attempts}.`, "",
    "## Prevention",
    ...pm.prevention.map((p) => `- ${p}`), "",
    "---",
    `_Generated by Fixsi — it doesn't guess, it proves. Models: ${models.join(", ")}._`,
  ].join("\n");
}
