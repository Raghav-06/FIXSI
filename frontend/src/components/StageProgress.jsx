import { Check, Loader2, X } from "lucide-react";

import { STAGES, STAGE_LABEL } from "../lib/constants";

export function StageProgress({ stage, done, failed }) {
  const current = stage ? STAGES.indexOf(stage) : -1;
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label="Investigation stages">
      {STAGES.map((s, i) => {
        const complete = i < current || (done && !failed && i <= current);
        const active = i === current && !done;
        const broken = failed && i === current;
        const color = broken ? "bg-fail" : complete ? "bg-pass" : active ? "bg-warn" : "bg-line";
        return (
          <li key={s} className="min-w-0" aria-current={active ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${color} ${active ? "animate-pulseDot" : ""}`} />
            <div className={`mt-1.5 flex items-center gap-1 truncate text-[11px] sm:text-xs ${active ? "text-fg font-medium" : "text-muted"}`}>
              {broken ? <X size={12} className="shrink-0 text-fail" aria-hidden /> :
                complete ? <Check size={12} className="shrink-0 text-pass" aria-hidden /> :
                active ? <Loader2 size={12} className="shrink-0 animate-spin text-warn" aria-hidden /> : null}
              <span className="truncate">{STAGE_LABEL[s]}</span>
              <span className="sr-only">{broken ? " (failed)" : complete ? " (done)" : active ? " (in progress)" : " (pending)"}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
