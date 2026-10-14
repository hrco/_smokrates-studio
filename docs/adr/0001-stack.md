# ADR 0001: Stack

## Status

Accepted, 2026-10-14

## Context

- One person plus coding agents builds and runs this on a MacBook Air with 8 GB of memory.
- Remotion 4.0.535, Node 22 and TypeScript are already in the repo. The render and the TikTok upload work.
- The pitch bans per-token AI APIs, paid xAI accounts, paid schedulers and paid hosting. See `docs/project-guidelines.md`.
- Grok runs in the Grok CLI on the SuperGrok flat fee. Claude Code runs headless on the flat plan.
- The Oracle box has 1 GB of memory. It already hosts the public site that TikTok reviews.
- The tool has one user. The review page is local.
- Five processes writing one SQLite file, and long work behind plain HTTP calls, would take longer to build than the two-week appetite.

## Decision

One long-lived process, the StudioDaemon, owns everything that changes state.

| Layer | Choice |
| --- | --- |
| Language and runtime | Node 22 with TypeScript |
| Render | Remotion 4.0.535 |
| Store | SQLite through the built-in node:sqlite module. Only the daemon opens `studio-data/studio.db`. |
| Daemon | One Node process on 127.0.0.1:8724. It serves the built review page and `/api`. |
| Review page | Plain Vite and React. Vite runs only in development, proxied to the daemon. |
| Design | DNP XIII design system, vendored into the repo |
| Scheduling | launchd, one job every 15 minutes. It calls `POST /api/tick`. |
| AI layer | Grok CLI and Claude Code CLI, both headless. Grok is a day-1 kill-gate. |

```
ReviewPage ──► StudioDaemon ──► studio.db
launchdTick ──► StudioDaemon ──► OneWorkerChild ──► studio.db (through the daemon)
```

- **One writer.** The daemon is the only process that opens the database. A worker (render, Grok asset run) is a child of the daemon. A worker reports to the daemon. It never opens the file.
- **Store.** node:sqlite is built in. It adds no native dependency. Node prints an experimental warning. We accept it. There is no JSON fallback. If the module breaks, a new ADR picks another store. A `schema_migrations` table records every applied migration. The daemon applies pending migrations at start. The folder `studio-data/` is git-ignored.
- **Jobs.** Long work is a row in a `jobs` table. A call enqueues a job and returns 202 with a job id. The page polls the job.
- **Mutex.** The daemon runs one worker at a time. A render and an asset run never overlap.
- **Origin.** The daemon serves the built page and the API from one origin, `http://127.0.0.1:8724`. There is no login, because only this laptop can reach it.
- **Design tokens.** The page uses DNP XIII tokens and components. A script copies tokens.css and the components bundle into the repo. The page never loads a claude.ai artifact URL at run time.
- **Scheduler.** A launchd plist runs `curl -X POST http://127.0.0.1:8724/api/tick` every 15 minutes. The tick is idempotent. A missed run is caught by the next run. If the daemon is down, the tick fails and does nothing.
- **Tokens.** Platform token refresh happens only inside the daemon. No other process refreshes a token. A test covers two refreshes at once.
- **AI layer.** The Showrunner is `claude -p`, deferred to cycle 2. The asset worker is the grok CLI. Both bill a flat fee. No code calls a per-token API.

## Options considered

| Option | Why rejected |
| --- | --- |
| n8n cloud | Paid. Holds the platform tokens off this machine. Hard to test. |
| Paid schedulers such as Buffer | Paid. The pitch bans a paid scheduler. They also do not run the originality guard. |
| Per-token AI APIs | The cost has no cap. The pitch bans them. The CLIs cover the work at a flat fee. |
| Host the studio on the 1 GB Oracle box | Remotion needs more memory than the box has. Tokens would leave the laptop. The box stays a static site host. |
| better-sqlite3 | Adds a native dependency to build. node:sqlite does the job. |
| Next.js for the review page | Adds a server and a build step for one local page. |
| API, scheduler and workers as separate SQLite writers | Needs locking, retries and a second source of truth for the mutex. One owner is simpler. |

## Consequences

- Easier: no new paid service, no native build, one language everywhere, tokens stay on the laptop.
- Easier: one process owns state, so the mutex, the token refresh and the publish log have one place to live.
- Harder: node:sqlite is experimental. A Node upgrade can change it. Pin the Node version.
- Harder: if the daemon is down, nothing is sent. launchd keeps the daemon alive.
- Harder: launchd runs only while the laptop is awake. A missed tick waits for the next one.
- Harder: the CLIs can change their flags. The day-1 capability test checks them before the asset run depends on them.
- The next ADR decides how the studio moves to direct post after TikTok's audit.
