# ADR 0001: Stack

## Status

Proposed

## Context

- One person plus coding agents builds and runs this on a MacBook Air with 8 GB of memory.
- Remotion 4.0.535, Node 22 and TypeScript are already in the repo. The render and the TikTok upload work.
- The pitch bans per-token AI APIs, paid xAI accounts, paid schedulers and paid hosting. See `docs/project-guidelines.md`.
- Grok runs in the Grok CLI on the SuperGrok flat fee. Claude Code runs headless on the flat plan.
- The Oracle box has 1 GB of memory. It already hosts the public site that TikTok reviews.
- The tool has one user. The review page is local.

## Decision

We will use this stack, once the status is Accepted.

| Layer | Choice |
| --- | --- |
| Language and runtime | Node 22 with TypeScript |
| Render | Remotion 4.0.535 |
| Store | SQLite through the built-in node:sqlite module |
| Review page | Plain Vite and React, local only |
| Design | DNP XIII design system |
| Scheduling | launchd, one job every 15 minutes |
| AI layer | Grok CLI and Claude Code CLI, both headless |

- **Store.** node:sqlite is built in. It adds no native dependency. Node prints an experimental warning. We accept it. If the module breaks, we fall back to JSON files and keep the same record shapes.
- **Review page.** Plain Vite and React. No Next.js, no server rendering. The page uses the DNP XIII tokens and components (https://claude.ai/artifact/YNcLF1gPzaPmo2gDqZMYpR). Its README says to load tokens.css and the components bundle. The build copies those two files into the repo. The page does not load them from the design system at run time.
- **Local only.** The API binds to 127.0.0.1:8724. There is no login, because only this laptop can reach it.
- **Scheduler.** A launchd plist runs a Node CLI every 15 minutes. The CLI is idempotent. A missed run is caught by the next run.
- **AI layer.** The Showrunner is `claude -p`. The asset worker is the grok CLI. Both bill a flat fee. No code calls a per-token API.

## Options considered

| Option | Why rejected |
| --- | --- |
| n8n cloud | Paid. Holds the platform tokens off this machine. Hard to test. |
| Paid schedulers such as Buffer | Paid. The pitch bans a paid scheduler. They also do not run the originality guard. |
| Per-token AI APIs | The cost has no cap. The pitch bans them. The CLIs cover the work at a flat fee. |
| Host the studio on the 1 GB Oracle box | Remotion needs more memory than the box has. Tokens would leave the laptop. The box stays a static site host. |
| better-sqlite3 | Adds a native dependency to build. node:sqlite does the job. |
| Next.js for the review page | Adds a server and a build step for one local page. |

## Consequences

- Easier: no new paid service, no native build, one language everywhere, tokens stay on the laptop.
- Easier: the scheduler is a small CLI that tests can call directly.
- Harder: node:sqlite is experimental. A Node upgrade can change it. The JSON fallback is the plan for that.
- Harder: launchd runs only while the laptop is awake. A missed run waits for the next one.
- Harder: the CLIs can change their flags. The day-1 capability test checks them before the asset run depends on them.
- The next ADR decides how the studio moves to direct post after TikTok's audit.
