# Smokrates studio

Makes short vertical videos for the Smokrates music project and sends them to TikTok as inbox drafts. Cycle 1 adds a weekly showrunner, a local review page and a scheduler. Nothing is posted until the Creator approves the week and taps Post.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run studio` | Open Remotion Studio to preview compositions. |
| `SMOK_STUDIO_DIR=/path/to/Smokrates npm run render -- <slug> --label label_on|label_off` | Render a track to out/ as mp4 plus a caption JSON. Options: --start, --background, --stills. |
| `npm run studio:daemon` | Start the daemon and the review page at http://127.0.0.1:8724. The tick is `POST /api/tick`. Optional env: STUDIO_PORT, STUDIO_DB_PATH. |
| See `docs/tick-setup.md` | Install or remove the launchd tick. The human runs those two commands. |
| `npm run studio:attach-render -- <episodeId> out/<file>.mp4` | Temporary: mark a night rendered until the render operation lands. |
| `npm run studio:db:migrate` | Apply database migrations. |
| `npm run render:demo` | Render the TikTok app review demo video. |
| `npm run tiktok:auth` | Sign in to TikTok once. |
| `npm run tiktok:draft -- out/<file>.mp4` | Upload a rendered video to the TikTok inbox. |
| `npm run tiktok:status` | Check a TikTok publish status. |
| `npm run deploy:site` | Publish the static site to the Oracle box. The human runs this. |
| `npm run typecheck` | Type check. |
| `npm test` | Run the tests. |

Setup for TikTok is in `docs/tiktok-setup.md`. Copy `.env.example` to `.env` and fill it. Never commit `.env`.

## Docs

| Layer | Question | File |
| --- | --- | --- |
| Intent | Why this exists, how much time it is worth, what is out | `docs/project-guidelines.md` |
| Structure | What the system is, and why a hard choice was made | `docs/architecture.md`, `docs/adr/` |
| Behaviour | Who can do what, on which control, with what motion | `docs/interactions.md` |
| Access | The bar every control must meet | `docs/accessibility.md` |
| Contracts | Browser to API, API to database, API to outside services | `docs/interfaces.md`, `docs/openapi.yaml` |
| Inventory | Where ad space can be sold (none) | `docs/ad-inventory.md` |
| Control | How a change moves, and whether this slice is finished | `docs/workflow.md`, `docs/project-status.md`, `CLAUDE.md`, `.claude/gate.sh` |
| Plan | Later phases | `docs/roadmap.md` |

## Gate

```bash
bash .claude/gate.sh
```

It runs the type check, the tests, and `scripts/check-docs.sh`. The last one checks that the required docs exist and that every operationId matches in `docs/openapi.yaml` and `docs/interfaces.md`.
