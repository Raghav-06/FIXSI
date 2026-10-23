import { Cpu } from "lucide-react";

import { TIERS, TIER_BG, TIER_LABEL, fmtTokens } from "../lib/constants";

export function ModelMeter({ calls }) {
  const agg = TIERS.map((t) => {
    const cs = calls.filter((c) => c.tier === t);
    return {
      tier: t,
      calls: cs.length,
      tokens: cs.reduce((a, c) => a + c.prompt_tokens + c.completion_tokens, 0),
      fallbacks: cs.filter((c) => c.fallback).length,
    };
  });
  const max = Math.max(1, ...agg.map((a) => a.tokens));
  const last = calls[calls.length - 1];
  return (
    <section className="rounded-lg border border-line p-3" aria-label="Model usage">
      <h3 className="panel-title"><Cpu size={14} aria-hidden /> Nemotron usage</h3>
      <table className="mt-2 w-full text-xs">
        <thead className="sr-only"><tr><th>Tier</th><th>Tokens</th><th>Calls</th></tr></thead>
        <tbody>
          {agg.map((a) => (
            <tr key={a.tier}>
              <th scope="row" className="w-14 py-1 text-left font-medium">{TIER_LABEL[a.tier]}</th>
              <td className="py-1 pr-2">
                <div className="h-2 rounded-full bg-raised">
                  <div className={`h-2 rounded-full ${TIER_BG[a.tier]} transition-all duration-500`} style={{ width: `${(a.tokens / max) * 100}%` }} />
                </div>
              </td>
              <td className="w-28 py-1 text-right tabular-nums text-muted">
                {a.calls} calls · {fmtTokens(a.tokens)}
                {a.fallbacks > 0 && <span className="text-warn"> · {a.fallbacks} fb</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {last && (
        <p className="mt-2 truncate text-[11px] text-muted" title={last.model}>
          Last: <span className="text-fg">{last.task}</span> → {TIER_LABEL[last.tier]} ({last.latency_ms} ms)
        </p>
      )}
    </section>
  );
}
