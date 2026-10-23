import { CheckCircle2, CircleSlash, ExternalLink, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";

const STATUS = {
  succeeded: { icon: CheckCircle2, cls: "text-pass" },
  failed: { icon: XCircle, cls: "text-fail" },
  cancelled: { icon: CircleSlash, cls: "text-muted" },
  running: { icon: Loader2, cls: "text-warn" },
  queued: { icon: Loader2, cls: "text-warn" },
};

function dur(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function Runs() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.runs().then(setRuns, (e) => setError(e.message));
  }, []);
  return (
    <div>
      <h1 className="text-xl font-semibold">Investigation history</h1>
      {error && <p role="alert" className="mt-4 rounded-lg border border-fail/40 bg-fail/10 p-3 text-sm">{error}</p>}
      {!runs && !error && <p className="mt-4 text-sm text-muted">Loading…</p>}
      {runs && runs.length === 0 && (
        <p className="mt-4 text-sm text-muted">No runs yet. <Link className="text-accent underline" to="/">Start one</Link>.</p>
      )}
      {runs && runs.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {runs.map((r) => {
            const st = STATUS[r.status] ?? STATUS.queued;
            const Icon = st.icon;
            return (
              <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <Link to={`/runs/${r.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 hover:text-accent">
                  <Icon size={18} className={`shrink-0 ${st.cls} ${r.status === "running" ? "animate-spin" : ""}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block text-xs text-muted">
                      <span className={st.cls}>{r.status}</span> · {new Date(r.created_at * 1000).toLocaleString()} · {r.source}
                    </span>
                  </span>
                </Link>
                <div className="flex flex-wrap items-center gap-2 pl-8 text-xs text-muted sm:pl-0">
                  <span className={`chip ${r.mode === "live" ? "bg-pass/15 text-pass" : "bg-warn/15 text-warn"}`}>{r.mode}</span>
                  <span className="tabular-nums">{dur(r.duration_ms)}</span>
                  <span className="tabular-nums">{(r.tokens ?? 0).toLocaleString()} tokens</span>
                  {r.pr_url && (
                    <a href={r.pr_url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-accent underline">
                      PR <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
