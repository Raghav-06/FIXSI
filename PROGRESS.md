# Fixsi — progress (audited 2026-10-18)

> **2026-10-23: converted to an all-JavaScript stack.** Backend is now Node.js + Express (`backend/src`),
> frontend is Vite + React JSX (`frontend/src`), and demo-shop is a JS app tested with `node:test`
> (`backend/demo-shop`). Replays were re-recorded (`--scripted`) through the new pipeline.
> Verified: backend `npm test` 68/68, frontend lint + build clean, demo-shop 30/30, and a replay of
> bug #4 driven in a headless browser with no console errors. Commands below that mention
> `pytest`/`python` now map to the `npm` scripts in the README. `docker compose up` has not been verified.

Audit of `D:\FIXSI` against `FIXSI_PROMPT.md` (§13 milestones, §14 acceptance criteria).
Checks were run on a copy of the project: backend tests, frontend typecheck/lint/build,
a replay run of bug #4 through the API, and phone (375px) + desktop screenshots.

## Milestones

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Scaffold, LICENSE, .gitignore, config, health | DONE | LICENSE still says `YOUR NAME` |
| 2 | demo-shop + 4 planted bugs + incidents + history | DONE | 13-commit history incl. "refactor: round prices consistently" |
| 3 | Local sandbox, patcher, tools | DONE | tests pass |
| 4 | Model router + telemetry + fake client | DONE | tests pass |
| 5 | Orchestrator, SSE, SQLite, scripted E2E test | DONE | bug #4 reject → confirm → fix → verify → report works |
| 6 | Frontend (home, run view, history, how-it-works) | DONE | build/lint/typecheck clean; no horizontal scroll at 375px; 3 columns on desktop; bottom tabs on phone |
| 7 | GitHub PR + .patch download | DONE (code) | not tested against real GitHub yet |
| 8 | Webhook + "Break it" | DONE (code) | needs `WEBHOOK_SECRET` set |
| 9 | Rate limit, replay mode, record script | PARTIAL | replays are **scripted** (shown as "Replay (scripted)"); re-record live once keys are set |
| 10 | Nebius Serverless Jobs sandbox + fallback | DONE (code) | not tested against real Nebius Jobs |
| 11 | Dockerfiles + docker-compose | PARTIAL | files exist; `docker compose up` not verified |
| 12 | README + final pass | PARTIAL | all sections present; TODO placeholders remain (see below) |

**Test results:** backend `pytest` 66 passed · frontend `typecheck`, `lint`, `build` all clean.

## What's left (in order)

1. **Commit and push.** The repo history shows only the original clone of `github.com/Raghav-06/FIXSI`; none of the work appears to be committed yet. Commit and push now so nothing is lost.
2. **Fill `.env`:** `NEBIUS_API_KEY`; confirm the three Nemotron model IDs against the Token Factory catalog (`python backend/scripts/list_models.py`); set `WEBHOOK_SECRET`.
3. **Live test:** run all 4 demo bugs live; bug #4 must show a rejected hypothesis before confirming.
4. **Re-record replays live:** `cd backend && python scripts/record_replays.py` so judges see real Nemotron runs, not "scripted".
5. **Verify `docker compose up`.**
6. **(Optional) GitHub PRs:** run `scripts/publish_demo_shop.sh`, fill the `GITHUB_*` values, test one PR.
7. **Deploy:** backend container (Render/Railway/Fly/Nebius) + frontend on Vercel; set `CORS_ALLOWED_ORIGINS` and `NEXT_PUBLIC_API_BASE_URL`.
8. **Fill TODOs:** LICENSE name; README live-demo link, video link, screenshots/GIF, feedback section, "What was built during the hackathon".
9. **Record the demo video (≤3 min), submit on Devpost before Oct 30, 10:30 PM IST.**

## Resume instructions for Claude Code

Read `PROGRESS.md` and `FIXSI_PROMPT.md`, then continue from the first unfinished item in "What's left".
Don't redo finished milestones. Update this file after each item.
