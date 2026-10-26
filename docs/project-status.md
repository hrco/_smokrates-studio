# Status

Updated: 2026-10-26

## Now

- TikTok sandbox inbox upload is proven. Publish ids ending 7750 and 300311 reached SEND_TO_USER_INBOX for the test account absurdius3.
- The public Smokrates account stalls in PROCESSING_UPLOAD.
- The review demo video is rendered.
- TikTok app review is not yet submitted.
- Cycle 1 is cut to one daemon, one store, a review page and the TikTok inbox: `docs/project-guidelines.md` is the pitch. The stack ADR is Accepted.

## Next

Ordered, cycle 1. Each item is one slice and one pull request.

1. Done by this pull request: the plan docs follow the architecture review. ADR 0001 is Accepted. The contracts, the guidelines and the config match the cut.
2. Done 14 October 2026: the day-1 Grok CLI test passed. Scene stays in cycle 1. Clips are 720p and carry sound, so Scene upscales and mutes them. See `docs/research/grok-day1-test.md`.
3. Done 14 October 2026: the SQLite schema, a unique (episodeId, platform) publish row, jobs, and `schema_migrations` exist. The one-heavy-job mutex is a partial unique index on jobs. A shared token provider has a concurrent-refresh test.
4. Done 25 October 2026: the publish row is claimed before TikTok init, and the publish_id is saved the moment init returns. One episode never gets a second init. A share in processing for over 30 minutes becomes stalled and is never retried. No new share starts at 5 in flight.
5. Done 26 October 2026: the daemon serves the review page on 127.0.0.1:8724 with vendored DNP XIII tokens. Approve, Skip and Time work. The sidecar flag aiGenerated:true is replaced by a per-episode label decision. No Showrunner.
6. launchd tick to the daemon. The human still taps Post in TikTok.
7. Only then: Scene, then the Showrunner, then YouTube.

Open follow-ups from the review:

- Migrations re-read the applied versions only before the first transaction. If the migrate script and the daemon open the database at the same moment, the second fails with "table exists". Only the daemon opens the database, so this waits. Fix: check the version again inside `BEGIN IMMEDIATE`.

- The tiktok-auth error paths call process.exit from the handler. They can leave the server up. Close the server first.
- The VPS host must come from the environment. `scripts/deploy-site.sh` now requires VPS_HOST.

## Blocked

- TikTok app review. The human submits the demo video.
- YouTube API audit. The human starts the request.

## Accepted this slice

Slice 5, the review page.

- The plan store imports, reads, updates, approves and skips with the guards in `docs/interfaces.md`. A skipped night does not block the week approve. A night that is not new does.
- The daemon (`npm run studio:daemon`) binds 127.0.0.1:8724 and serves the page, the API and the render videos with Range support. It refuses a foreign Host or Origin, a body over 64 KB and a body that is not JSON.
- The API validator refuses SMOKRATES and hex codes in a Grok prompt, and health claims in a caption, claim or prompt.
- The sidecar carries `labelDecision`. Render needs `--label label_on|label_off`.
- Migration 2 adds a groks_prompt column to episodes.
- `npm run studio:attach-render` is temporary. It marks a night ready by hand until the render operation lands.

Not in this slice:

- The page has no render button, no connections caption and no canon panel. Those operations are not built.
- The previous-week button is never disabled, because the API cannot list stored weeks.
- Not yet checked in a real browser or with a screen reader. The page is covered by file checks and unit tests only.
