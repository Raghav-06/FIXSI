import { AlertTriangle, Beaker, CircleSlash, FileText, FileWarning, FlaskConical, PanelLeftOpen, PlayCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { STAGE_LABEL } from "../lib/constants";
import { useRunEvents } from "../lib/useRunEvents";
import { CaseFile } from "./CaseFile";
import { HypothesisBoard } from "./HypothesisBoard";
import { Lab } from "./Lab";
import { Narration } from "./Narration";
import { ReportPanel } from "./Report";
import { StageProgress } from "./StageProgress";

const TABS = [
  { id: "case", label: "Case", icon: FileWarning },
  { id: "board", label: "Board", icon: FlaskConical },
  { id: "lab", label: "Lab", icon: Beaker },
  { id: "report", label: "Report", icon: FileText },
];

export function RunView({ runId }) {
  const { state, connection } = useRunEvents(runId);
  const [tab, setTab] = useState("board");
  const [seen, setSeen] = useState({ case: 0, board: 0, lab: 0, report: 0 });
  const [drawer, setDrawer] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const drawerClose = useRef(null);

  // the active tab has always been "seen"
  const activeCount = state.counts[tab];
  if (seen[tab] !== activeCount) setSeen({ ...seen, [tab]: activeCount });

  // jump to the report on phones once it lands (only while watching live)
  const [hadReport, setHadReport] = useState(false);
  if (state.report && !hadReport) {
    setHadReport(true);
    if (state.lastId > 0 && !state.completed) setTab("report");
  }

  useEffect(() => {
    if (!drawer) return;
    drawerClose.current?.focus();
    const onKey = (e) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  if (connection === "not_found") {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold">Run not found</h1>
        <p className="mt-2 text-sm text-muted">It may have been created on another server instance.</p>
        <Link to="/" className="btn-primary mt-6">Start an investigation</Link>
      </div>
    );
  }

  const running = !state.completed;
  const failed = state.completed ? state.completed.status !== "succeeded" : false;
  const show = (t, base) => `${tab === t ? "block" : "hidden"} ${base}`;
  const panel = "panel sm:max-h-[calc(100dvh-15rem)] sm:overflow-y-auto";

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancel(runId);
    } catch {
      /* already finished */
    }
    setCancelling(false);
  };

  return (
    <div className="min-w-0">
      {/* screen-reader announcements of stage changes */}
      <div className="sr-only" aria-live="polite" role="status">
        {state.stage ? `Stage: ${STAGE_LABEL[state.stage]}` : ""}
        {state.completed ? `. Run ${state.completed.status}.` : ""}
      </div>

      <div className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-lg font-semibold leading-snug sm:text-xl">{state.title || "Loading investigation…"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-muted">{runId}</span>
            {state.mode === "replay" && (
              <span className="chip bg-warn/15 text-warn"><PlayCircle size={12} aria-hidden /> Replay{state.scripted ? " (scripted)" : ""}</span>
            )}
            {state.mode === "live" && <span className="chip bg-pass/15 text-pass">Live</span>}
            {state.source && <span className="chip bg-raised text-muted">{state.source}</span>}
            {connection === "reconnecting" && <span className="chip bg-warn/15 text-warn">reconnecting…</span>}
            {state.completed && (
              <span className={`chip ${failed ? "bg-fail/15 text-fail" : "bg-pass/15 text-pass"}`}>
                {state.completed.status} · {(state.completed.duration_ms / 1000).toFixed(0)}s · {state.completed.tokens.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setDrawer(true)} className="btn-ghost hidden sm:inline-flex lg:hidden">
          <PanelLeftOpen size={16} aria-hidden /> Case file
        </button>
        {running && state.lastId > 0 && (
          <button type="button" onClick={cancel} disabled={cancelling} className="btn-ghost">
            <CircleSlash size={16} aria-hidden /> Cancel
          </button>
        )}
      </div>

      <div className="sticky top-14 z-20 -mx-4 mb-3 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <StageProgress stage={state.stage} done={!!state.completed} failed={failed} />
      </div>

      {state.error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-fail/40 bg-fail/10 p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-fail" aria-hidden />
          <span className="min-w-0 break-words">{state.error.message}</span>
        </div>
      )}

      <div className="mb-3"><Narration logs={state.logs} /></div>

      <div className="gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.2fr)]">
        <section className={show("case", `${panel} sm:hidden lg:block`)} aria-label="Case file">
          <CaseFile incident={state.incident} title={state.title} />
        </section>
        <section className={show("board", `${panel} sm:block`)} aria-label="Hypothesis board">
          <HypothesisBoard hypotheses={state.hypotheses} running={running} />
        </section>
        <section className={show("lab", `${panel} sm:block`)} aria-label="Lab">
          <Lab state={state} />
        </section>
        <section className={show("report", "panel mt-0 sm:col-span-2 sm:mt-4 sm:block lg:col-span-3")} aria-label="Report">
          <ReportPanel runId={runId} state={state} />
        </section>
      </div>

      {/* tablet: case file drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 hidden sm:block lg:hidden" role="dialog" aria-modal="true" aria-label="Case file">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close case file" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(28rem,90vw)] overflow-y-auto border-r border-line bg-surface shadow-xl animate-rise">
            <div className="flex justify-end p-2">
              <button ref={drawerClose} type="button" onClick={() => setDrawer(false)} className="btn-ghost w-11 px-0" aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>
            <CaseFile incident={state.incident} title={state.title} />
          </div>
        </div>
      )}

      {/* phone: bottom tab bar */}
      <nav aria-label="Run sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <ul className="grid grid-cols-4" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => {
            const fresh = state.counts[id] > seen[id] && tab !== id;
            return (
              <li key={id} className="contents">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${tab === id ? "text-accent" : "text-muted"}`}
                >
                  <Icon size={20} aria-hidden />
                  {label}
                  {fresh && (
                    <span className="absolute right-[calc(50%-18px)] top-2 h-2 w-2 rounded-full bg-warn">
                      <span className="sr-only">new activity</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
