import { BadgeCheck, Bell, FileText, FlaskConical, Search, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { UsageChart } from "../components/UsageChart";
import { api } from "../lib/api";
import { TIERS, TIER_BG, TIER_LABEL } from "../lib/constants";

const STEPS = [
  { icon: Bell, title: "Trigger", body: "A demo incident, a pasted stack trace, a GitHub issue, or a signed webhook from the app when it throws." },
  { icon: Search, title: "Investigate", body: "Reads logs and traces, lists the repo, reads the relevant files and recent git commits, then ranks 2–4 hypotheses with evidence for and against." },
  { icon: FlaskConical, title: "Reproduce", body: "Writes a node:test test that must FAIL if the top hypothesis is right and runs it in the sandbox. Passing or unrelated failures reject the hypothesis." },
  { icon: Wrench, title: "Fix", body: "Proposes a minimal search/replace edit, applies it, and reads failures to retry — up to the attempt limit." },
  { icon: BadgeCheck, title: "Verify", body: "Accepts only when the reproduction test passes AND every pre-existing test still passes. Pre-existing tests are never edited." },
  { icon: FileText, title: "Report", body: "Unified diff, the new test, and a postmortem — opened as a pull request when GitHub is configured, or a .patch download." },
];

export default function HowItWorks() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.stats().then(setStats, (e) => setError(e.message));
  }, []);

  const byTier = (t) => Object.entries(stats?.routing ?? {}).filter(([, tier]) => tier === t).map(([task]) => task);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold sm:text-3xl">How Fixsi works</h1>
        <p className="mt-2 max-w-2xl text-muted">Six stages, one rule.</p>
        <div className="mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-pass/40 bg-pass/5 p-4">
          <ShieldCheck size={22} className="shrink-0 text-pass" aria-hidden />
          <p className="text-sm leading-relaxed">
            <strong>Reproduce first.</strong> Application code is locked until a reproduction test fails for the reason a
            hypothesis predicts. That failing test is the proof — and the bar the fix must clear.
          </p>
        </div>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="panel p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-raised text-accent"><Icon size={16} aria-hidden /></span>
                <span className="font-mono text-xs text-muted">{i + 1}</span>
                <h2 className="font-medium">{title}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="routing-h">
        <h2 id="routing-h" className="text-xl font-semibold">NVIDIA Nemotron routing</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Each task goes to the smallest Nemotron model that can do it well: Nano for fast, high-volume calls; Super for
          code; Ultra where a wrong answer is expensive. If a tier fails after retries, Fixsi falls back one tier and marks the call.
        </p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-fail/40 bg-fail/10 p-3 text-sm">{error}</p>}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="panel overflow-hidden">
            <ul className="divide-y divide-line">
              {TIERS.map((t) => (
                <li key={t} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-3 w-3 rounded-sm ${TIER_BG[t]}`} aria-hidden />
                    <span className="font-medium">{TIER_LABEL[t]}</span>
                    <code className="min-w-0 break-all font-mono text-xs text-muted">{stats?.models[t] ?? "…"}</code>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {byTier(t).map((task) => <code key={task} className="chip bg-raised font-mono text-muted">{task}</code>)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {stats ? <UsageChart stats={stats} /> : !error && <div className="panel h-64 animate-pulse" />}
        </div>
        {stats && (
          <p className="mt-3 text-xs text-muted">
            {stats.runs} runs recorded · {stats.succeeded_runs} succeeded. Replayed runs are counted separately in the table view.
          </p>
        )}
      </section>
    </div>
  );
}
