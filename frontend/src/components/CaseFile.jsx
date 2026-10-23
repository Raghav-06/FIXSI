import { ChevronDown, FileWarning } from "lucide-react";

import { CodeBlock } from "./CodeBlock";

function Section({ title, children, open = true }) {
  return (
    <details open={open} className="group border-t border-line first:border-t-0">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={16} className="text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function CaseFile({ incident, title }) {
  if (!incident) {
    return <div className="p-4 text-sm text-muted">Loading the case file…</div>;
  }
  return (
    <div>
      <div className="px-4 pb-3 pt-4">
        <h2 className="panel-title"><FileWarning size={14} aria-hidden /> Case file</h2>
        <p className="mt-2 font-semibold leading-snug">{title || incident.title || "Untitled incident"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="chip bg-raised text-muted">{incident.source}</span>
          {incident.kind && <span className="chip bg-raised text-muted">{incident.kind}</span>}
          {incident.severity && <span className="chip bg-raised text-muted">severity: {incident.severity}</span>}
          {incident.url && (
            <a className="chip bg-raised text-accent underline" href={incident.url} target="_blank" rel="noreferrer">issue</a>
          )}
        </div>
      </div>
      {incident.report && (
        <Section title="Report">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg/90">{incident.report}</p>
        </Section>
      )}
      {incident.stack_trace && (
        <Section title="Stack trace">
          <CodeBlock code={incident.stack_trace} title="stack trace" maxHeight="18rem" />
        </Section>
      )}
      {incident.logs && (
        <Section title="Logs" open={!incident.stack_trace}>
          <CodeBlock code={incident.logs} title="logs" maxHeight="18rem" />
        </Section>
      )}
    </div>
  );
}
