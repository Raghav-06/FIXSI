import { Download, ExternalLink, FileText, GitPullRequest } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../lib/api";
import { CopyButton } from "./CodeBlock";

export function ReportPanel({ runId, state }) {
  const r = state.report;
  return (
    <div className="p-4">
      <h2 className="panel-title"><FileText size={14} aria-hidden /> Report</h2>
      {r && (
        // Own row under the heading: full-width primary action on phones, then the two copy buttons side by side.
        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {state.pr ? (
            <a href={state.pr.url} target="_blank" rel="noreferrer" className="btn-primary col-span-2">
              <GitPullRequest size={16} aria-hidden /> Open PR{state.pr.number ? ` #${state.pr.number}` : ""} <ExternalLink size={14} aria-hidden />
            </a>
          ) : (
            <a href={api.patchUrl(runId)} className="btn-primary col-span-2" download>
              <Download size={16} aria-hidden /> Download .patch
            </a>
          )}
          <CopyButton text={r.markdown} label="Copy postmortem" showLabel />
          <CopyButton text={r.diff} label="Copy diff" showLabel />
        </div>
      )}
      {r ? (
        <article className="md mt-3 min-w-0 break-words">
          <p className="text-xs text-muted">PR title: <code>{r.pr_title}</code></p>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.markdown}</ReactMarkdown>
        </article>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {state.completed ? "This run ended without a report." : "The postmortem appears here once the fix is verified."}
        </p>
      )}
    </div>
  );
}
