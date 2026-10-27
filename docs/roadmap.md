# Roadmap

## Cycle 1: studio and scheduler (14 to 27 October 2026)
The plan is in `docs/project-guidelines.md`. It is cut to a Grok kill-gate, one daemon with one store, a review page, a hand-written week and a tick over the TikTok inbox adapter. It replaces phases 1a and 1c below. The Showrunner, swap, Loop, Title and YouTube upload move to cycle 2. The status board is `docs/project-status.md`.

## Phase 1: render queue (built)
- `npm run render -- <slug>` renders a 15 s 9:16 video into `out/`.
- A caption JSON sits next to each video: caption draft, hashtags, `aiGenerated: true`.
- Upload is manual. The human taps publish.
- `TrackReel` (default `--format reel`) replaces the TrackCard look for Reels and TikTok: full-bleed Grok clips (intro, then loop), one wordmark, bars that follow the audio. `--format card` keeps the old card.

## Phase 1a: Grok CLI asset generation (cycle 1 kill-gate, Scene only if it passes)
- Run Grok headless: `grok agent` or `grok -p`, with `--max-turns 25` or more.
- Cap the files it may read.
- Outputs go to `assets/generated/<slug>/` (ignored by git).
- Add a `make-clip` skill or prompt. It follows `~/Studio/Smokrates/image-style.md`.
- First verify the real name of the video tool. Do not guess it.
- Feed a clip to the renderer with `--background <path>`.

## Phase 1b: TikTok Content Posting API (built, proven in the sandbox)
- `npm run tiktok:auth` authorizes once (PKCE, scope `video.upload`).
- `npm run tiktok:draft -- out/<file>.mp4` uploads a DRAFT to the creator inbox. The human finishes and publishes.
- Sandbox inbox upload proved itself on 13 and 14 October 2026.
- Setup: `docs/tiktok-setup.md`. The human registers a TikTok developer app.
- Direct post needs an audit. Do not plan on it.
- Open: public-account stall, chunked upload for files over 64 MB.

## Phase 1d: Instagram Reels (built as CLI)
- `npm run instagram:draft -- out/<file>.mp4` uploads the video and makes a Reel container. It does not post.
- `npm run instagram:publish -- out/<file>.mp4` posts the container. The human runs it. It refuses a second post.
- `npm run instagram:refresh` renews the 60-day token.
- Not in the tick yet. Setup: `docs/meta-setup.md`.
- The API has no AI-label flag. The human sets the label by hand after publishing.

## Phase 1c: scheduled sends (folded into cycle 1)
- A launchd job calls `POST /api/tick` on the daemon every 15 minutes.
- The daemon sends approved, due episodes to the TikTok inbox, at most one a day.
- It stops on error and writes a log. The human taps Post.

## Phase 2
- Pulsu Studio becomes a second asset source.
- ChatGPT images land in ignored `assets/inbox/`.
- More templates: quote card, set teaser, image montage.
