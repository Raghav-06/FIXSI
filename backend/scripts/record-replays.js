#!/usr/bin/env node
/**
 * Record replay files (src/replay/<incident>.json) for the four demo incidents.
 *
 *     npm run record:replays                                  # live: real Nemotron models (needs NEBIUS_API_KEY)
 *     npm run record:replays -- --scripted                    # no key: scripted model replies, everything else real
 *     npm run record:replays -- bug-4-misleading-inventory    # just one
 *
 * Each incident is run end to end against a fresh copy of demo-shop with the real sandbox. Only
 * successful runs are written. Replays are what judges see when credits run out or no key is set.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventBus } from "../src/agent/events.js";
import { demoIncident, demoIncidents, incidentFromDemo } from "../src/agent/incident.js";
import { RunManager } from "../src/agent/runs.js";
import { getSettings } from "../src/config.js";
import { ensureTargetRepo } from "../src/demoShop.js";
import { ScriptedLLM } from "../src/llm/fake.js";
import { ModelRouter } from "../src/llm/router.js";
import { REPLAY_DIR, recordingFromEvents } from "../src/replay/player.js";
import { SCRIPTS } from "../src/replay/scripted.js";
import { Store } from "../src/storage/db.js";

// Simulated per-tier latency for scripted recordings so playback pacing feels realistic.
const SCRIPTED_LATENCY = { nano: 0.7, super: 2.2, ultra: 4.5 };

async function record(incidentId, scripted, tmp) {
  const base = getSettings();
  const settings = base.with({
    workspacesDir: path.join(tmp, "ws"), databaseUrl: `sqlite:///${path.join(tmp, `${incidentId}.db`)}`,
  });
  ensureTargetRepo(settings.resolve(settings.targetRepoPath), settings.demoShopSource);
  const store = new Store(settings.databaseUrl);
  const bus = new EventBus((e) => store.addEvent(e));
  let client = null;
  if (scripted) {
    const tierOf = {
      [settings.nemotronNanoModel]: "nano", [settings.nemotronSuperModel]: "super", [settings.nemotronUltraModel]: "ultra",
    };
    client = new ScriptedLLM(SCRIPTS[incidentId], (model) => SCRIPTED_LATENCY[tierOf[model] ?? "super"]);
  } else if (!settings.llmConfigured) {
    console.error("NEBIUS_API_KEY is not set. Use --scripted or fill in .env.");
    process.exit(2);
  }
  const router = new ModelRouter(settings, { client });
  const manager = new RunManager(settings, store, bus, router); // GitHub off: replays never open PRs
  const incidentsDir = path.join(settings.demoShopSource, "incidents");
  const runId = manager.startLive(incidentFromDemo(demoIncident(incidentsDir, incidentId)));
  console.log(`[${incidentId}] run ${runId} (${scripted ? "scripted" : "live"}) ...`);
  await manager.wait(runId);
  const run = store.getRun(runId);
  const events = store.events(runId);
  store.close();
  if (run.status !== "succeeded") {
    const err = events.find((e) => e.type === "error")?.payload.message ?? "unknown";
    console.log(`[${incidentId}] FAILED: ${err} — not recorded`);
    return false;
  }
  if (incidentId.startsWith("bug-4") && !events.some((e) => e.type === "hypothesis_rejected")) {
    console.log(`[${incidentId}] warning: no hypothesis was rejected in this run; consider re-recording`);
  }
  const note = scripted
    ? "Scripted model replies (no live key at record time); workspace, tests, patch and diff are real."
    : "Recorded live against NVIDIA Nemotron models on Nebius Token Factory.";
  const rec = recordingFromEvents(incidentId, events, { scripted, note });
  const out = path.join(REPLAY_DIR, `${incidentId}.json`);
  fs.writeFileSync(out, JSON.stringify(rec, null, 1) + "\n");
  console.log(`[${incidentId}] recorded ${events.length} events, ${run.tokens} tokens -> ${out}`);
  return true;
}

const args = process.argv.slice(2);
const scripted = args.includes("--scripted");
const settings = getSettings();
const ids = args.filter((a) => !a.startsWith("--"));
const targets = ids.length ? ids : demoIncidents(path.join(settings.demoShopSource, "incidents")).map((d) => d.id);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fixsi-record-"));
let ok = true;
try {
  for (const id of targets) ok = (await record(id, scripted, tmp)) && ok;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
