import { useEffect, useRef } from "react";

const DOT = { info: "bg-muted", warn: "bg-warn", success: "bg-pass", error: "bg-fail" };

export function Narration({ logs }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);
  return (
    <ol ref={ref} className="h-24 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs sm:h-20" aria-label="Agent narration">
      {logs.length === 0 && <li className="text-muted">Waiting for the agent…</li>}
      {logs.map((l) => (
        <li key={l.id} className="animate-rise flex items-start gap-2 py-0.5">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[l.level]}`} aria-hidden />
          <span className="text-muted tabular-nums">{new Date(l.timestamp * 1000).toLocaleTimeString([], { hour12: false })}</span>
          <span className={`min-w-0 break-words ${l.level === "warn" ? "text-warn" : l.level === "success" ? "text-pass" : l.level === "error" ? "text-fail" : ""}`}>
            {l.message}
          </span>
        </li>
      ))}
    </ol>
  );
}
