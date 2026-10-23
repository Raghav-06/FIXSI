/** Minimal OpenAI-compatible chat client for Nebius Token Factory (plain fetch, no SDK). */

export class APIError extends Error {
  name = "APIError";

  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class OpenAICompatibleClient {
  constructor({ baseUrl, apiKey, timeoutSeconds = 120, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutSeconds * 1000;
    this.fetch = fetchImpl;
  }

  async _request(method, endpoint, body, { signal, task } = {}) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(task ? { "X-Fixsi-Task": task } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new APIError(res.status, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  /** POST /chat/completions; returns the raw OpenAI-style response object. */
  createChatCompletion({ task, ...params }, { signal } = {}) {
    return this._request("POST", "/chat/completions", params, { signal, task });
  }

  async listModels() {
    const out = await this._request("GET", "/models");
    return (out.data ?? []).map((m) => m.id);
  }
}
