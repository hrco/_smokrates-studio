# Project guidelines

The bet for cycle 1 (14–27 October 2026). Change it when the appetite or the no-gos change. The facts behind it are in `docs/research/reports/Smokrates seven day TikTok.md` and `docs/research/reports/TikTok virality for AI video.md`.

## Problem

On 13 October the first Smokrates video took one evening to reach a TikTok inbox. Every step was by hand:
- pick a track
- render it
- write the caption
- open a terminal
- sign in
- upload
- remember to post

At that cost Smokrates posts only on days you have an evening free. The research asks for the opposite:
- **A steady week of distinct posts.** At most one post a day. Three to five strong posts a week is the efficient band. Skip a weak day.
- **Every post must be new.** Since 24 September 2026, a reused picture with nothing new is not eligible for For You.

## Appetite

Two weeks. One person plus coding agents, on the MacBook Air (8 GB) that already renders the videos. No paid service, no per-token AI API, and no paid xAI account. Grok runs in the Grok CLI on the SuperGrok plan.

## Solution

**A hand-written week, one daemon, one review page.** In cycle 1 you write the week by hand as one JSON file. The studio makes each night's video and puts the week on one review page. You approve the week in about ten minutes. Then the scheduler releases each approved night to the TikTok inbox.

```
 Week file ───► Daemon ───────────► Render ─────► Review page ─────► Tick ──────────► TikTok inbox
 hand-written   one process,        Remotion      approve, skip,     launchd,         draft; you tap Post
 (plan.import)  one store,          9:16 master,  time, label        every 15 min,
                jobs table          type in code  decision           POST /api/tick
```

1. **Library.**
   - **Tracks** come from smok-studio (`SMOK_STUDIO_DIR`). The studio only reads them.
   - **The man's approved 9:16 still** is his identity. It is approved once and kept in `assets/generated/canon/`.
2. **Week file.** You write up to seven nights by hand. The seven-job template in the research is your guide. For each night you give the format, the track and its start second, the duration, the claim, the caption (one question answered in ordinary words) and the publish time. The API refuses a Grok prompt with the word SMOKRATES or a hex code, and a caption or prompt with a health claim. The Showrunner (`claude -p`) is deferred to cycle 2.
3. **Day-1 Grok kill-gate.** Test the Grok CLI on day 1, one call per tool: `image_edit`, image-to-video, `generate_audio` and the resolution flags.
   - **If the test passes,** cycle 1 adds the Scene format after the TrackCard path works. Scene is a Grok insert, then the type on the bare cream panel.
   - **If the test fails,** cycle 1 is TrackCard plus a Ken Burns move on the cover art. No Grok asset run is built. The week file uses only TrackCard.
   - A result whose face drifts is rejected, never patched. Clips are always silent.
4. **Formats.** Remotion compositions that draw every letter, so the name is identical on every post. Cycle 1 ships **TrackCard** (exists). Scene ships only if the kill-gate passes. Loop and Title are cycle 2. The code colours are cream `#f3e9d2`, neon cyan `#2fe6ff`, neon purple `#a64dff` and navy `#0b1030`. The dub is the only sound.
5. **Review page.** The daemon serves it at `http://127.0.0.1:8724`, drawn in the DNP XIII design system. The week is one comic page: a panel per night with:
   - the preview
   - the caption
   - the claim
   - the **label decision**: the AI label is on only if a frame is photoreal, or if TikTok adds it from Content Credentials
   - the Approve, Skip and Time controls
6. **Scheduler.** A launchd job calls `POST /api/tick` every 15 minutes. The daemon sends approved episodes whose time has come. Two guards run first:
   - **Idempotence:** a publish row is written at TikTok init, one per episode and platform. An episode with a publish row is never sent twice.
   - **Originality:** in week 1 the guard is Skip: you skip a night that repeats an earlier one. Later, the guard is a hash of (stillAssetId, trackSlug, startSecond, durationSeconds). A match is held back and marked "not new". There is no image hashing.
7. **Publisher.** **TikTok inbox draft** works today; you add the caption and tap Post in TikTok. **TikTok direct post** is a switch for after TikTok's audit. The **YouTube** audit request is a human task that starts on day 1, because it takes weeks. YouTube upload is cycle 2.

## Deferred to cycle 2

- The `claude -p` Showrunner, and the plan generator it feeds.
- Swapping a night for a new one.
- The Loop and Title formats.
- The Scene format, if the Grok kill-gate fails.
- YouTube upload and YouTube sign-in. The audit request stays in cycle 1 as a human task.
- Five SQLite writers. The design is one daemon.

## Rabbit holes

- **The two audits.** TikTok's app review and YouTube's API audit can each take weeks or fail. The cycle ships on TikTok drafts alone. Going public automatically is a switch for later.
- **Character drift.** Only edits of the approved still, never a new text prompt for him. Text-to-video invents a new face and is not used.
- **Grok CLI options.** The research could not confirm that the CLI passes `generate_audio`, `last_frame` or the resolution. The day-1 kill-gate tests this.
- **Render time on 8 GB.** A week renders overnight at concurrency 2, never during the day, and never at the same time as an asset run. The daemon enforces this.
- **TikTok delivery lag.** Delivery can take longer than 5 minutes. The tick re-checks on its next run and does not block.
- **The public-account stall.** On 14 October, inbox uploads to the public Smokrates account stayed in `PROCESSING_UPLOAD` while a private test account received them. A share in `PROCESSING_UPLOAD` for over 30 minutes becomes "stalled" and is never retried. Each init spends one of 5 pending shares a day, so the tick stops at 5 shares in flight.

## No-gos

- No per-token AI API, no paid xAI account, no paid scheduler, no paid hosting.
- No agent ever taps Post or flips a video public. Nothing is sent until you approve the week.
- No bought followers, no engagement pods, no Promote, no Business account.
- No health, sleep, anxiety or focus claims in any caption or on-screen text.
- No padding a loop to 60 s. No second post that only crops the first.
- No X or Facebook. Instagram Reels go out by CLI only: `instagram:draft` makes a container and the human runs `instagram:publish`. It is not in the daemon tick in cycle 1. No Pulsu Studio integration (the Library keeps one slot for it).
- No analytics dashboard. View counts need TikTok's `video.list` scope, which is a later cycle.
- No phone access to the review page, no other creators, no accounts. One user, local only.
- No monetisation work. A distributor delivery is your step, outside this tool.

## Success metric

On 27 October, a hand-written week file for 2026-10-26 is loaded with `plan.import`. The review page shows every night with a rendered 9:16 master. After you approve, the tick sends each approved night to the TikTok inbox with no further command. The publish log shows one TikTok publish id per approved night, and no two posts share a still and an audio section. The YouTube audit request is filed. That is a human task and not part of the metric.

## Quality bar

Production for one user: tested, idempotent, never posts twice, never posts unapproved, never leaks a token.

## Actors

- **Creator** is you: you approve weeks, make the label decision, and tap Post in TikTok or Public in YouTube.
- **Admin** is also you: you connect platforms, approve the man's canonical still, and change schedules and formats.

The template's Customer and Client actors do not exist here.
