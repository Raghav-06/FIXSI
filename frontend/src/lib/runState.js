/** Folds the run's SSE events into the state the run view renders. */

export const initialRunState = {
  lastId: 0, title: "", source: "", mode: null, scripted: false, sandbox: "local", incident: null, stage: null,
  stagesSeen: [], logs: [], hypotheses: [], tests: [], testRuns: [], runningTest: null, patches: [], modelCalls: [],
  report: null, pr: null, completed: null, error: null, counts: { board: 0, lab: 0, report: 0, case: 0 },
};

const BOARD = new Set(["hypothesis_created", "hypothesis_rejected", "hypothesis_confirmed", "evidence_added"]);
const LAB = new Set(["test_written", "test_run_finished", "patch_proposed", "patch_applied"]);

function updateHyp(list, id, patch) {
  return list.map((h) => (h.id === id ? { ...h, ...patch } : h));
}

export function reduce(state, ev) {
  if (ev.id <= state.lastId) return state; // de-duplicate after reconnects
  const p = ev.payload;
  const s = { ...state, lastId: ev.id };
  s.counts = {
    board: state.counts.board + (BOARD.has(ev.type) ? 1 : 0),
    lab: state.counts.lab + (LAB.has(ev.type) ? 1 : 0),
    report: state.counts.report + (ev.type === "report_ready" || ev.type === "pr_opened" ? 1 : 0),
    case: state.counts.case + (ev.type === "run_started" ? 1 : 0),
  };
  switch (ev.type) {
    case "run_started":
      return { ...s, title: p.title, source: p.source, mode: p.mode, scripted: !!p.scripted, incident: p.incident, sandbox: p.sandbox };
    case "stage_changed":
      return { ...s, stage: p.stage, stagesSeen: s.stagesSeen.includes(p.stage) ? s.stagesSeen : [...s.stagesSeen, p.stage] };
    case "log":
      return { ...s, logs: [...s.logs, { id: ev.id, message: p.message, level: p.level, timestamp: ev.timestamp }] };
    case "hypothesis_created":
      return { ...s, hypotheses: [...s.hypotheses, { ...p, status: "pending" }] };
    case "evidence_added": {
      const key = p.kind === "for" ? "evidence_for" : "evidence_against";
      return {
        ...s,
        hypotheses: s.hypotheses.map((h) => (h.id === p.hypothesis_id ? { ...h, [key]: [...h[key], p.text] } : h)),
      };
    }
    case "hypothesis_rejected":
      return { ...s, hypotheses: updateHyp(s.hypotheses, p.id, { status: "rejected", reason: p.reason }) };
    case "hypothesis_confirmed":
      return { ...s, hypotheses: updateHyp(s.hypotheses, p.id, { status: "confirmed", reason: p.reason }) };
    case "test_written":
      return { ...s, tests: [...s.tests, p], hypotheses: updateHyp(s.hypotheses, p.hypothesis_id, { status: "testing" }) };
    case "test_run_started":
      return { ...s, runningTest: { purpose: p.purpose, selector: p.selector } };
    case "test_run_finished":
      return { ...s, runningTest: null, testRuns: [...s.testRuns, p] };
    case "patch_proposed":
      return { ...s, patches: [...s.patches, p] };
    case "patch_applied":
      return {
        ...s,
        patches: s.patches.map((x) => (x.attempt === p.attempt ? { ...x, files: p.files, diff: p.diff } : x)),
      };
    case "model_call":
      return { ...s, modelCalls: [...s.modelCalls, p] };
    case "report_ready":
      return { ...s, report: p };
    case "pr_opened":
      return { ...s, pr: p };
    case "error":
      return { ...s, error: { message: p.message, code: p.code } };
    case "run_completed":
      return { ...s, completed: p, runningTest: null };
    default:
      return s;
  }
}
