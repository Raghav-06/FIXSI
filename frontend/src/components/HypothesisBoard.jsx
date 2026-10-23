import { CheckCircle2, FlaskConical, Lightbulb, Loader2, XCircle } from "lucide-react";

const STATUS = {
  pending: { label: "Untested", icon: Lightbulb, cls: "text-muted" },
  testing: { label: "Testing", icon: Loader2, cls: "text-warn" },
  rejected: { label: "Rejected", icon: XCircle, cls: "text-fail" },
  confirmed: { label: "Confirmed", icon: CheckCircle2, cls: "text-pass" },
};

function Card({ h }) {
  const st = STATUS[h.status];
  const Icon = st.icon;
  const pct = Math.round(h.confidence * 100);
  const frame =
    h.status === "confirmed" ? "border-pass/60 bg-pass/5 animate-glow" :
    h.status === "rejected" ? "border-fail/30 opacity-60" :
    h.status === "testing" ? "border-warn/50" : "border-line";
  return (
    <li className={`animate-rise rounded-xl border bg-surface p-4 transition-all duration-500 ${frame}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 font-mono text-xs text-muted">{h.id.toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className={`font-medium leading-snug ${h.status === "rejected" ? "line-through decoration-fail/70 decoration-2" : ""}`}>
            {h.title}
          </h3>
          <div className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${st.cls}`}>
            <Icon size={14} className={h.status === "testing" ? "animate-spin" : ""} aria-hidden />
            {st.label}
            {h.round > 1 && <span className="text-muted">· round {h.round}</span>}
          </div>
        </div>
      </div>
      <div className="mt-3" aria-label={`Confidence ${pct}%`}>
        <div className="flex justify-between text-[11px] text-muted"><span>confidence</span><span>{pct}%</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="mt-3 break-words text-sm leading-relaxed text-fg/85">{h.explanation}</p>
      {h.suspected_files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {h.suspected_files.map((f) => <code key={f} className="chip bg-raised font-mono text-muted">{f}</code>)}
        </div>
      )}
      {(h.evidence_for.length > 0 || h.evidence_against.length > 0) && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {h.evidence_for.map((e, i) => (
            <li key={`f${i}`} className="flex gap-1.5 break-words rounded-md bg-pass/10 px-2 py-1 text-fg/90">
              <span className="font-semibold text-pass" aria-label="Evidence for">+</span><span className="min-w-0">{e}</span>
            </li>
          ))}
          {h.evidence_against.map((e, i) => (
            <li key={`a${i}`} className="flex gap-1.5 break-words rounded-md bg-fail/10 px-2 py-1 text-fg/90">
              <span className="font-semibold text-fail" aria-label="Evidence against">−</span><span className="min-w-0">{e}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function HypothesisBoard({ hypotheses, running }) {
  return (
    <div className="p-4">
      <h2 className="panel-title"><FlaskConical size={14} aria-hidden /> Hypothesis board</h2>
      {hypotheses.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {running ? "Investigating: reading logs, code and git history before forming hypotheses…" : "No hypotheses were formed."}
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {hypotheses.map((h) => <Card key={h.id} h={h} />)}
        </ol>
      )}
    </div>
  );
}
