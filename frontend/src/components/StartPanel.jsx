import { AlertTriangle, Bomb, ClipboardPaste, Github, Loader2, Play, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../lib/api";
import { useHealth } from "../lib/useHealth";

const SEVERITY = { high: "bg-fail/15 text-fail", medium: "bg-warn/15 text-warn" };

const PASTE_PLACEHOLDER = "TypeError: Cannot read properties of undefined (reading 'country')\n"
  + "    at OrderService.checkout (shop/orders.js:54:45)";

export function StartPanel() {
  const navigate = useNavigate();
  const { health } = useHealth();
  const [incidents, setIncidents] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [logs, setLogs] = useState("");
  const [issueUrl, setIssueUrl] = useState("");

  useEffect(() => {
    api.incidents().then(setIncidents, (e) => setLoadError(e.message));
  }, []);

  const replay = health?.mode === "replay";
  const go = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      const { run_id } = await fn();
      navigate(`/runs/${run_id}`);
    } catch (e) {
      setError({ message: e.message, rateLimited: !!e.rateLimited });
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${error.rateLimited ? "border-warn/40 bg-warn/10" : "border-fail/40 bg-fail/10"}`}>
          <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${error.rateLimited ? "text-warn" : "text-fail"}`} aria-hidden />
          <div className="min-w-0 break-words">
            {error.rateLimited && <strong className="block">Slow down a little</strong>}
            {error.message}
          </div>
        </div>
      )}

      <section aria-labelledby="demo-h">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <h2 id="demo-h" className="text-base font-semibold">1 · Pick a demo incident</h2>
          <p className="text-sm text-muted">Four real bugs planted in <code className="font-mono">demo-shop</code>.</p>
        </div>
        {loadError && <p className="rounded-lg border border-fail/40 bg-fail/10 p-3 text-sm">{loadError}</p>}
        {!incidents && !loadError && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="panel h-48 animate-pulse" />)}
          </div>
        )}
        {incidents && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {incidents.map((inc) => (
              <li key={inc.id} className="panel flex flex-col p-4 animate-rise">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono text-muted">#{inc.number}</span>
                  <span className="chip bg-raised text-muted">{inc.kind}</span>
                  <span className={`chip ${SEVERITY[inc.severity] ?? "bg-raised text-muted"}`}>{inc.severity}</span>
                </div>
                <h3 className="mt-2 font-medium leading-snug">{inc.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm text-muted">{inc.report}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={!!busy || (replay && !inc.has_replay)}
                    onClick={() => go(inc.id, () => api.startRun({ source: "demo", incident_id: inc.id }))}
                  >
                    {busy === inc.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
                    Investigate
                  </button>
                  {health?.webhooks && (
                    <button
                      type="button"
                      className="btn-ghost"
                      title="Run the bug for real in demo-shop; its error hook fires a signed webhook into Fixsi"
                      disabled={!!busy}
                      onClick={() => go(`break-${inc.id}`, () => api.breakIt(inc.id))}
                    >
                      {busy === `break-${inc.id}` ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Bomb size={16} aria-hidden />}
                      Break it
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="paste-h" className="panel p-4">
          <h2 id="paste-h" className="flex items-center gap-2 text-base font-semibold"><ClipboardPaste size={18} aria-hidden /> 2 · Paste an error</h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              go("paste", () => api.startRun({ source: "paste", error_text: errorText, logs: logs || undefined }));
            }}
          >
            <label className="block text-sm">
              <span className="text-muted">Error, stack trace or bug description</span>
              <textarea
                required
                value={errorText}
                onChange={(e) => setErrorText(e.target.value)}
                rows={6}
                maxLength={50000}
                placeholder={PASTE_PLACEHOLDER}
                className="mt-1 w-full rounded-lg border border-line bg-raised/50 p-3 font-mono text-[16px] sm:text-sm"
              />
            </label>
            <details>
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-muted">Add logs (optional)</summary>
              <textarea
                value={logs}
                onChange={(e) => setLogs(e.target.value)}
                rows={4}
                maxLength={50000}
                aria-label="Logs"
                className="w-full rounded-lg border border-line bg-raised/50 p-3 font-mono text-[16px] sm:text-sm"
              />
            </details>
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!!busy || replay || !errorText.trim()}>
              {busy === "paste" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Zap size={16} aria-hidden />} Investigate
            </button>
            {replay && <p className="text-xs text-warn">Needs live mode — set NEBIUS_API_KEY on the backend.</p>}
          </form>
        </section>

        <section aria-labelledby="gh-h" className="panel p-4">
          <h2 id="gh-h" className="flex items-center gap-2 text-base font-semibold"><Github size={18} aria-hidden /> 3 · GitHub issue</h2>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              go("gh", () => api.startRun({ source: "github_issue", issue_url: issueUrl }));
            }}
          >
            <label className="block text-sm">
              <span className="text-muted">Issue URL{health?.github.repo ? ` on ${health.github.repo}` : ""}</span>
              <input
                type="url"
                required
                value={issueUrl}
                onChange={(e) => setIssueUrl(e.target.value)}
                placeholder={`https://github.com/${health?.github.repo ?? "you/demo-shop"}/issues/1`}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-line bg-raised/50 px-3 text-[16px] sm:text-sm"
              />
            </label>
            <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!!busy || replay || !health?.github.configured}>
              {busy === "gh" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Zap size={16} aria-hidden />} Investigate issue
            </button>
            {health && !health.github.configured && <p className="text-xs text-muted">GitHub isn&apos;t configured on this server. Fixsi will offer a .patch download instead of a PR.</p>}
          </form>
        </section>
      </div>
    </div>
  );
}
