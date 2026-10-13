# Roadmap

## Cycle 1: studio and scheduler (14 to 27 October 2026)
The plan is in `docs/project-guidelines.md`. It replaces phases 1a and 1c below: a weekly Showrunner, Grok CLI assets, a review page, a scheduler, and TikTok and YouTube publishers. The status board is `docs/project-status.md`.

## Phase 1: render queue (built)
- `npm run render -- <slug>` renders a 15 s 9:16 video into `out/`.
- A caption JSON sits next to each video: caption draft, hashtags, `aiGenerated: true`.
- Upload is manual. The human taps publish.

## Phase 1a: Grok CLI asset generation (folded into cycle 1)
- Run Grok headless: `grok agent` or `grok -p`, with `--max-turns 25` or more.
- Cap the files it may read.
- Outputs go to `assets/generated/<slug>/` (ignored by git).
- Add a `make-clip` skill or prompt. It follows `~/Studio/Smokrates/image-style.md`.
- First verify the real name of the video tool. Do not guess it.
- Feed a clip to the renderer with `--background <path>`.

## Phase 1b: TikTok Content Posting API (built, untested against TikTok)
- `npm run tiktok:auth` authorizes once (PKCE, scope `video.upload`).
- `npm run tiktok:draft -- out/<file>.mp4` uploads a DRAFT to the creator inbox. The human finishes and publishes.
- Setup: `docs/tiktok-setup.md`. The human registers a TikTok developer app.
- Direct post needs an audit. Do not plan on it.
- Open: first live run, chunked upload for files over 64 MB.

## Phase 1c: scheduled renders (folded into cycle 1)
- A launchd job renders 1 to 3 videos a day.
- It picks tracks that have no video yet.
- It stops on error and writes a log. It never publishes.

## Phase 2
- Pulsu Studio becomes a second asset source.
- ChatGPT images land in ignored `assets/inbox/`.
- More templates: quote card, set teaser, image montage.
