import { Beaker, CheckCircle2, Loader2, Wrench, XCircle } from "lucide-react";

import { CodeBlock, DiffLines, JsCode } from "./CodeBlock";
import { ModelMeter } from "./ModelMeter";

const PURPOSE = {
  baseline: "Baseline suite",
  reproduce: "Reproduction test",
  verify_repro: "Reproduction test (after fix)",
  verify_suite: "Full suite (after fix)",
};

function RunRow({ run }) {
  const ok = run.failed === 0 && run.errors === 0 && run.passed > 0 && !run.timed_out;
  return (
    <li className={`animate-flip flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${ok ? "border-pass/40 bg-pass/5" : "border-fail/40 bg-fail/5"}`}>
      {ok ? <CheckCircle2 size={16} className="shrink-0 text-pass" aria-hidden /> : <XCircle size={16} className="shrink-0 text-fail" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {PURPOSE[run.purpose]}
          {run.hypothesis_id && <span className="text-muted"> · {run.hypothesis_id.toUpperCase()}</span>}
          {run.attempt && <span className="text-muted"> · attempt {run.attempt}</span>}
        </div>
        <div className="text-xs text-muted">
          <span className={ok ? "text-pass" : "text-fail"}>{ok ? "PASS" : run.timed_out ? "TIMEOUT" : "FAIL"}</span>
          {" · "}{run.passed} passed · {run.failed} failed{run.errors ? ` · ${run.errors} errors` : ""} · {(run.duration_ms / 1000).toFixed(1)}s
          <span className="hidden sm:inline"> · {run.backend}</span>
        </div>
        {!ok && run.failures[0] && (
          <div className="mt-1 truncate font-mono text-[11px] text-fail/90" title={run.failures[0].message}>
            {run.failures[0].message.split("\n")[0]}
          </div>
        )}
      </div>
    </li>
  );
}

export function Lab({ state }) {
  const test = [...state.tests].reverse().find((t) => state.hypotheses.find((h) => h.id === t.hypothesis_id)?.status !== "rejected")
    ?? state.tests[state.tests.length - 1];
  const patch = [...state.patches].reverse().find((p) => p.diff);
  const diff = state.report?.diff || patch?.diff || "";
  const attempts = state.patches.length;
  return (
    <div className="space-y-4 p-4">
      <h2 className="panel-title"><Beaker size={14} aria-hidden /> Lab</h2>

      <section aria-label="Reproduction test">
        <h3 className="mb-2 text-sm font-medium">Reproduction test</h3>
        {test ? (
          <CodeBlock code={test.content} title={test.path + (test.repaired ? " (repaired)" : "")} maxHeight="20rem">
            <JsCode code={test.content} />
          </CodeBlock>
        ) : (
          <p className="text-sm text-muted">No test yet. Fixsi writes a failing test before it touches any code.</p>
        )}
        {test?.expected_failure && <p className="mt-2 text-xs text-muted">Predicts: {test.expected_failure}</p>}
      </section>

      <section aria-label="Test runs">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          Test runs
          {state.runningTest && (
            <span className="chip bg-warn/15 text-warn"><Loader2 size={12} className="animate-spin" aria-hidden /> running {PURPOSE[state.runningTest.purpose] ?? ""}</span>
          )}
        </h3>
        {state.testRuns.length ? (
          <ol className="space-y-2">{state.testRuns.slice(-6).map((r, i) => <RunRow key={i} run={r} />)}</ol>
        ) : (
          <p className="text-sm text-muted">Waiting for the sandbox…</p>
        )}
      </section>

      <section aria-label="Patch">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Wrench size={14} aria-hidden /> Patch
          {attempts > 0 && <span className="chip bg-raised text-muted">attempt {attempts}</span>}
        </h3>
        {diff ? (
          <CodeBlock code={diff} title={state.report ? "final diff" : `attempt ${patch?.attempt}`} maxHeight="22rem">
            <DiffLines diff={diff} />
          </CodeBlock>
        ) : (
          <p className="text-sm text-muted">{state.hypotheses.some((h) => h.status === "confirmed") ? "Writing a fix…" : "Code is locked until a hypothesis is confirmed."}</p>
        )}
        {patch?.explanation && !state.report && <p className="mt-2 text-xs text-muted">{patch.explanation}</p>}
      </section>

      <ModelMeter calls={state.modelCalls} />
    </div>
  );
}
