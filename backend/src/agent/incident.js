/** Incident model and built-in demo incidents. */

import fs from "node:fs";
import path from "node:path";

const FIELDS = ["source", "title", "report", "logs", "stack_trace", "id", "number", "kind", "url", "severity"];

export class Incident {
  /** `source` is demo | paste | github_issue | webhook. Field names are snake_case to match the API. */
  constructor({ source, title = "", report = "", logs = "", stack_trace = "", id = null, number = null, kind = null,
    url = null, severity = null }) {
    Object.assign(this, { source, title, report, logs, stack_trace, id, number, kind, url, severity });
  }

  with(overrides) {
    return new Incident({ ...this, ...overrides });
  }

  asText() {
    const parts = [`# Incident: ${this.title || "(untitled)"}`];
    if (this.report) parts.push(`## Report\n${this.report}`);
    if (this.stack_trace) parts.push(`## Stack trace\n${this.stack_trace}`);
    if (this.logs) parts.push(`## Logs\n${this.logs}`);
    return parts.join("\n\n");
  }

  /** JSON-safe view without empty optional fields. */
  public() {
    return Object.fromEntries(FIELDS.filter((k) => this[k] !== null && this[k] !== undefined).map((k) => [k, this[k]]));
  }
}

const cache = new Map();

function load(directory) {
  if (!cache.has(directory)) {
    const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((f) => f.endsWith(".json")).sort() : [];
    const items = files.map((f) => JSON.parse(fs.readFileSync(path.join(directory, f), "utf8")));
    cache.set(directory, items.sort((a, b) => (a.number ?? 99) - (b.number ?? 99)));
  }
  return cache.get(directory);
}

export function demoIncidents(directory) {
  return load(directory).map((d) => ({ ...d }));
}

export function demoIncident(directory, incidentId) {
  return demoIncidents(directory).find((d) => d.id === incidentId) ?? null;
}

export function incidentFromDemo(data, source = "demo") {
  return new Incident({
    source,
    id: data.id,
    number: data.number ?? null,
    kind: data.kind ?? null,
    title: data.title,
    report: data.report ?? "",
    logs: data.logs ?? "",
    stack_trace: data.stack_trace ?? "",
    severity: data.severity ?? null,
  });
}
