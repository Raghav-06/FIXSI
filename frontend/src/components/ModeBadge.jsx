import { PlayCircle, Radio } from "lucide-react";

import { useHealth } from "../lib/useHealth";

export function ModeBadge({ compact = false }) {
  const { health, error } = useHealth();
  if (error) return <span className="chip bg-fail/15 text-fail">Backend offline</span>;
  if (!health) return <span className="chip bg-raised text-muted">…</span>;
  const live = health.mode === "live";
  return (
    <span
      className={`chip ${live ? "bg-pass/15 text-pass" : "bg-warn/15 text-warn"}`}
      title={live ? "Live: real Nemotron models on Nebius Token Factory" : "Replay: recorded investigations (no API key or REPLAY_MODE=true)"}
    >
      {live ? <Radio size={12} aria-hidden /> : <PlayCircle size={12} aria-hidden />}
      {live ? "Live" : "Replay"}
      {!compact && <span className="sr-only"> mode</span>}
    </span>
  );
}
