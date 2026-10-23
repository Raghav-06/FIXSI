/** Replay mode: recorded event streams of real runs, played back with realistic timing. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sleep } from "../util.js";

export const REPLAY_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_GAP_SECONDS = 2.5; // long waits (model latency, test runs) are compressed
const SKIP_TYPES = new Set(["pr_opened"]); // a recorded PR belongs to the original run

export function loadRecordings(directory = REPLAY_DIR) {
  const out = {};
  for (const name of fs.readdirSync(directory).filter((f) => f.endsWith(".json")).sort()) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    } catch {
      continue;
    }
    if (data.incident_id && data.events?.length) out[data.incident_id] = data;
  }
  return out;
}

export function recordingFromEvents(incidentId, events, { scripted, note = "" }) {
  const t0 = events.length ? events[0].timestamp : 0;
  return {
    incident_id: incidentId,
    scripted,
    note,
    events: events.map((e) => ({ t: Math.round((e.timestamp - t0) * 1000) / 1000, type: e.type, payload: e.payload })),
  };
}

/** `publish(type, payload)` for each recorded event, sleeping between them. */
export async function play(recording, publish, speed = 1.0, signal = null) {
  let prev = 0;
  for (const item of recording.events) {
    if (SKIP_TYPES.has(item.type)) continue;
    const gap = Math.max(0, item.t - prev);
    prev = item.t;
    await sleep((Math.min(gap, MAX_GAP_SECONDS) / Math.max(speed, 0.01)) * 1000, signal);
    await publish(item.type, structuredClone(item.payload));
  }
}
