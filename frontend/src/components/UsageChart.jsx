import { useState } from "react";

import { TIERS, TIER_BG, TIER_LABEL, fmtTokens } from "../lib/constants";

const METRICS = [
  { id: "tokens", label: "Tokens" },
  { id: "calls", label: "Calls" },
  { id: "latency", label: "Avg latency" },
];

/** One measure per view (never two scales on one axis); every bar is direct-labelled with tier + value. */
export function UsageChart({ stats }) {
  const [metric, setMetric] = useState("tokens");
  const [hover, setHover] = useState(null);
  const rows = TIERS.map((t) => {
    const s = stats.tiers.find((x) => x.tier === t);
    const value = metric === "tokens" ? s.prompt_tokens + s.completion_tokens : metric === "calls" ? s.calls : s.avg_latency_ms;
    return { tier: t, s, value };
  });
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = (v) => (metric === "tokens" ? fmtTokens(v) : metric === "latency" ? `${v.toLocaleString()} ms` : String(v));
  const total = rows.reduce((a, r) => a + r.s.calls, 0);

  return (
    <figure className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <figcaption className="mr-auto text-sm font-medium">Model usage by tier</figcaption>
        <div role="group" aria-label="Metric" className="flex rounded-lg border border-line p-0.5">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={`min-h-[40px] rounded-md px-3 text-xs ${metric === m.id ? "bg-raised font-medium text-fg" : "text-muted"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {total === 0 ? (
        <p className="mt-6 text-sm text-muted">No model calls yet — run an investigation and come back.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((r) => (
            <div
              key={r.tier}
              className="relative"
              onMouseEnter={() => setHover(r.tier)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.tier)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${TIER_LABEL[r.tier]}: ${fmt(r.value)}`}
            >
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium">{TIER_LABEL[r.tier]} <span className="font-normal text-muted">{stats.models[r.tier]}</span></span>
                <span className="tabular-nums text-muted">{fmt(r.value)}</span>
              </div>
              <div className="h-3 rounded-r bg-raised">
                <div className={`h-3 rounded-r ${TIER_BG[r.tier]} transition-all duration-500`} style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
              </div>
              {hover === r.tier && (
                <div role="tooltip" className="absolute right-0 top-full z-10 mt-1 w-64 max-w-full rounded-lg border border-line bg-surface p-3 text-xs shadow-lg">
                  <div className="font-medium">{TIER_LABEL[r.tier]}</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted tabular-nums">
                    <span>Calls</span><span className="text-right text-fg">{r.s.calls}</span>
                    <span>Prompt tokens</span><span className="text-right text-fg">{r.s.prompt_tokens.toLocaleString()}</span>
                    <span>Completion tokens</span><span className="text-right text-fg">{r.s.completion_tokens.toLocaleString()}</span>
                    <span>Avg latency</span><span className="text-right text-fg">{r.s.avg_latency_ms} ms</span>
                    <span>Fallbacks</span><span className="text-right text-fg">{r.s.fallbacks}</span>
                    <span>Live / replay</span><span className="text-right text-fg">{r.s.live_calls} / {r.s.replay_calls}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="mt-5">
        <summary className="min-h-[44px] cursor-pointer py-2 text-xs text-muted">Show as table</summary>
        <div className="code-scroll">
          <table className="w-full min-w-[480px] text-left text-xs tabular-nums">
            <thead className="text-muted">
              <tr><th className="py-1">Tier</th><th>Calls</th><th>Prompt</th><th>Completion</th><th>Avg ms</th><th>Fallbacks</th><th>Replay</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tier} className="border-t border-line">
                  <th scope="row" className="py-1 font-medium">{TIER_LABEL[r.tier]}</th>
                  <td>{r.s.calls}</td><td>{r.s.prompt_tokens}</td><td>{r.s.completion_tokens}</td>
                  <td>{r.s.avg_latency_ms}</td><td>{r.s.fallbacks}</td><td>{r.s.replay_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
