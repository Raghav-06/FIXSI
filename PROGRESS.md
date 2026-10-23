# Fixsi: progress

Stack: Node.js + Express backend (`backend/src`), Vite + React + Tailwind frontend (`frontend/src`),
and the demo-shop victim app with 4 planted bugs (`backend/demo-shop`).

## Commands

```bash
cd backend && npm install && npm test             # backend suite (node:test, no API key needed)
cd backend/demo-shop && npm test                  # victim app's own suite (passes on the buggy code)
cd frontend && npm install && npm run lint && npm run build

cd backend && npm run dev                         # API on http://localhost:8000
cd frontend && npm run dev                        # UI on http://localhost:5173 (proxies /api)

cd backend && npm run list:models                 # check Nemotron IDs against the Token Factory catalog (needs key)
cd backend && npm run record:replays              # re-record the 4 demo replays with live models (needs key)
docker compose up --build                         # nginx UI on :3000, API on :8000
```

## Done

- [x] Backend: 6-stage orchestrator, model router (Nano / Super / Ultra), sandbox (local + Nebius Jobs), patcher, SSE, SQLite history, GitHub PRs, webhooks, rate limiting, replay mode
- [x] Frontend: home, run view (case file, hypothesis board, lab, report), history, how-it-works; no horizontal scroll on phone, tablet or desktop
- [x] demo-shop with 4 planted bugs, incidents and a 13-commit git history
- [x] Replays for all 4 demo bugs (recorded with `--scripted` model replies)
- [x] Backend tests 68/68, demo-shop tests 30/30, frontend lint + build clean

## Remaining (finish-and-ship list)

| # | Task | Status |
|---|---|---|
| 1 | Rewrite this file for the JS stack | DONE |
| 2 | Hardening: placeholder webhook secret, LICENSE name, phone Report header | DONE |
| 3 | Verify Nemotron model IDs (needs key) | BLOCKED: no `NEBIUS_API_KEY` |
| 4 | Live end-to-end runs of all 4 bugs + one pasted error (needs key) | BLOCKED: no `NEBIUS_API_KEY` |
| 5 | Re-record replays with live models (needs key) | BLOCKED: no `NEBIUS_API_KEY` |
| 6 | Deployment readiness: SPA rewrites, Render blueprint, Docker check, README deploy steps | DONE, except the Docker check (Docker is not installed on the dev machine; `docker compose up` still unverified) |
| 7 | README screenshots and GIF | PARTIAL: `frontend/scripts/capture-screenshots.mjs` (`npm run capture`) works and makes all 4 files (clip is `.webm`, 4.1 MB; no ffmpeg for GIF). Images not committed because they would show "Replay (scripted)"; rerun after Task 5 |
| 8 | README finishing touches | DONE |
| 9 | Final check | TODO |

Deadline: Devpost submission closes **Oct 30, 2026, 10:30 PM IST**.

## Blocked: needs API key

There is no `.env` and no `NEBIUS_API_KEY`, so these could not run. With a key in `.env`:

1. **Task 3:** `cd backend && npm run list:models`. If a configured Nemotron ID is missing, update `backend/src/config.js` and `.env.example`.
2. **Task 4:** start `npm run dev` with `REPLAY_MODE=false` and run all 4 demo incidents plus one pasted error. For each, record status, model calls per tier, tokens and duration here.
3. **Task 5:** `cd backend && npm run record:replays`. Commit only successful recordings (bug #4 must show a rejected hypothesis), then remove the "recordings are scripted" note from the README.
