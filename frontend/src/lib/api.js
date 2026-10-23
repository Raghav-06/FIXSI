/** Thin client for the Fixsi Express API. */

// Empty = same origin (the Vite dev server and the nginx image proxy /api to the backend).
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.rateLimited = status === 429;
  }
}

async function request(path, init = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Can't reach the Fixsi backend. If it's on a free tier it may be waking up — retry in ~30s.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  health: () => request("/api/health"),
  incidents: () => request("/api/incidents"),
  stats: () => request("/api/stats"),
  runs: () => request("/api/runs"),
  run: (id) => request(`/api/runs/${enc(id)}`),
  /** body: { source: "demo" | "paste" | "github_issue", incident_id?, error_text?, logs?, issue_url? } */
  startRun: (body) => request("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id) => request(`/api/runs/${enc(id)}/cancel`, { method: "POST" }),
  breakIt: (bugId) => request(`/api/demo-shop/break/${enc(bugId)}`, { method: "POST" }),
  patchUrl: (id) => `${API_BASE}/api/runs/${enc(id)}/patch`,
  eventsUrl: (id, after = 0) => `${API_BASE}/api/runs/${enc(id)}/events${after ? `?after=${after}` : ""}`,
};
