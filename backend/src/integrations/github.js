/** GitHub REST integration: fetch issues, open PRs. The token is never logged. */

import fs from "node:fs";
import path from "node:path";

import { Incident } from "../agent/incident.js";

const API = "https://api.github.com";
// A JS error line followed by its "    at ..." frames.
const STACK_RE = /^[\w$.]*(?:Error|Exception)\b[^\n]*(?:\n[ \t]+at [^\n]+)+/m;

export class GitHubError extends Error {
  name = "GitHubError";
}

export class GitHubClient {
  constructor(settings, fetchImpl = globalThis.fetch) {
    this.owner = settings.githubRepoOwner;
    this.repo = settings.githubRepoName;
    this.base = settings.githubBaseBranch;
    this.headers = {
      Authorization: `Bearer ${settings.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fixsi",
    };
    this.fetch = fetchImpl;
  }

  async request(method, endpoint, { body, query } = {}) {
    const url = new URL(API + endpoint);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    return this.fetch(url, {
      method,
      headers: { ...this.headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  }

  async call(method, endpoint, options) {
    const res = await this.request(method, endpoint, options);
    if (res.status >= 400) throw new GitHubError(`GitHub API ${method} ${endpoint} -> ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  parseIssueUrl(url) {
    const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/.exec(url.trim());
    if (!m) throw new GitHubError("Not a GitHub issue URL (expected https://github.com/<owner>/<repo>/issues/<n>).");
    const [, owner, repo, number] = m;
    if (owner.toLowerCase() !== this.owner.toLowerCase() || repo.toLowerCase() !== this.repo.toLowerCase()) {
      throw new GitHubError(`Issues must belong to the configured repo ${this.owner}/${this.repo}.`);
    }
    return Number(number);
  }

  async fetchIssue(url) {
    const number = this.parseIssueUrl(url);
    const repo = `/repos/${this.owner}/${this.repo}`;
    const issue = await this.call("GET", `${repo}/issues/${number}`);
    const comments = await this.call("GET", `${repo}/issues/${number}/comments`, { query: { per_page: 20 } });
    const body = issue.body ?? "";
    const commentText = (Array.isArray(comments) ? comments : [])
      .map((c) => `Comment by ${c.user?.login ?? "?"}:\n${c.body ?? ""}`).join("\n\n");
    const trace = STACK_RE.exec(`${body}\n${commentText}`)?.[0] ?? "";
    return new Incident({
      source: "github_issue", title: (issue.title ?? "").slice(0, 200), url, number,
      report: (body + (commentText ? `\n\n${commentText}` : "")).slice(0, 50_000),
      stack_trace: trace.slice(0, 20_000),
    });
  }

  async openPr(runId, title, body, root, files) {
    const branch = `fixsi/${runId}`;
    const repo = `/repos/${this.owner}/${this.repo}`;
    const ref = await this.call("GET", `${repo}/git/ref/heads/${this.base}`);
    await this.call("POST", `${repo}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha: ref.object.sha } });
    for (const rel of files) {
      const payload = {
        message: `fixsi: update ${rel}`, branch, content: fs.readFileSync(path.join(root, rel)).toString("base64"),
      };
      const existing = await this.request("GET", `${repo}/contents/${rel}`, { query: { ref: branch } });
      if (existing.status === 200) payload.sha = (await existing.json()).sha;
      await this.call("PUT", `${repo}/contents/${rel}`, { body: payload });
    }
    const pr = await this.call("POST", `${repo}/pulls`, {
      body: { title: title.slice(0, 250), head: branch, base: this.base, body: body.slice(0, 60_000) },
    });
    return { url: pr.html_url, number: pr.number ?? null, branch };
  }
}
