# Status

Updated: 2026-10-14

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
5. Review page on 127.0.0.1:8724 with vendored DNP XIII tokens. Approve, Skip and Time. Replace the sidecar flag aiGenerated:true with a per-episode label decision. No Showrunner.
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

None yet.
