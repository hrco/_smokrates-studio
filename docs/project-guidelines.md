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

**A weekly showrunner, not a post factory.** Once a week the studio writes a seven-night series. It makes each night's picture and edit, and puts the week on one review page. You approve the week in about ten minutes. Then the scheduler releases each approved night to each connected platform.

```
 Library ─────► Showrunner ─────► Asset run ─────► Render ─────► Review page ─────► Scheduler ─────► Publishers
 tracks         week plan          Grok CLI          Remotion       approve, swap,      launchd,          TikTok inbox draft
 the man's      (Claude Code,      image_edit,       9:16 master,   skip, time,         every 15 min,     YouTube upload (private
 approved still  headless)         video inserts     type in code   label decision      originality guard  until the API audit)
```

1. **Library.**
   - **Tracks** come from smok-studio (`SMOK_STUDIO_DIR`). The studio only reads them.
   - **The man's approved 9:16 still** is his identity. It is approved once and kept in `assets/generated/canon/`. Every later picture descends from that file.
   - **Earlier stills and clips:** every one generated so far, recorded with its parent still, so the studio can tell what is new.
2. **Showrunner.** A headless Claude Code run that writes one week plan from the seven-job template in the research.

   | Night | Job | Length |
   | --- | --- | --- |
   | 1 | names the artist in one phrase | 15–30 s |
   | 2 | a true loop, or a skipped night | under 10 s |
   | 3 | pays off a claim made in frame one | 15–30 s |
   | 4 | the same man in a new scene | 15–30 s |
   | 5 | the track title on screen | 15–30 s |
   | 6 | a genre phrase, never a health claim | 15–30 s |
   | 7 | restates the name, then stops; pin it | 15–30 s |

   For each night it gives the format, the track and its start second, the claim, the caption (one question answered in ordinary words), the Grok edit sentence, and the motion sentence. It never puts the word SMOKRATES or a hex code in a Grok prompt.
3. **Asset run.** Grok CLI, headless, once per night that needs a new picture.
   - `image_edit` makes a new scene from the approved still: one to three changes, and the same face.
   - Image-to-video makes a 6 s insert at 1080p.
   - `reference_to_video` with the same still as first and last frame makes a pinned loop at 720p.
   - Clips are always silent (`generate_audio: false`). If the CLI cannot send the flag, the edit mutes the clip.
   - A result whose face drifts is rejected, never patched.
4. **Formats.** Remotion compositions that draw every letter, so the name is identical on every post. Cycle 1 has four:
   - **TrackCard** (exists)
   - **Scene:** a Grok insert, then the type on the bare cream panel
   - **Loop:** a pinned clip, with no intro
   - **Title:** the track title, then the part of the dub worth replaying

   The dub is the only sound. The code colours are cream `#f3e9d2`, neon cyan `#2fe6ff`, neon purple `#a64dff` and navy `#0b1030`.
5. **Review page.** A local web page at `http://127.0.0.1:8724`, drawn in the DNP XIII design system. The week is one comic page: a panel per night with:
   - the preview
   - the caption
   - the claim
   - the **label decision**: the AI label is on only if a frame is photoreal, or if TikTok adds it from Content Credentials
   - the Approve, Swap, Skip and Time controls
6. **Scheduler.** A launchd job every 15 minutes. It publishes approved episodes whose time has come. Two guards run first:
   - **Idempotence:** an episode with a stored publish id is never sent twice.
   - **Originality:** an episode whose still and audio section match an earlier post is held back and marked "not new".
7. **Publishers.**
   - **TikTok inbox draft** works today; you add the caption and tap Post in TikTok.
   - **TikTok direct post** (`video.publish`, `is_aigc` from the label decision) is a switch for after TikTok's audit.
   - **YouTube** uploads with the Data API. Uploads from an unaudited API project stay private, so you set each one public in YouTube Studio, just as you tap Post in TikTok. The YouTube audit request starts on day 1, because it takes weeks.

## Rabbit holes

- **The two audits.** TikTok's app review and YouTube's API audit can each take weeks or fail. The cycle ships on drafts and private uploads alone. Going public automatically is a switch for later.
- **Character drift.** Only edits of the approved still, never a new text prompt for him. Text-to-video invents a new face and is not used.
- **Grok CLI options.** The research could not confirm that the CLI passes `generate_audio`, `last_frame` or the resolution. Test this on day 1 with one call per tool, before the asset run depends on it.
- **Render time on 8 GB.** A week renders overnight at concurrency 2, never during the day, and never at the same time as an asset run.
- **TikTok delivery lag.** Delivery can take longer than 5 minutes. The scheduler re-checks on its next run and does not block.
- **The public-account stall.** On 14 October, inbox uploads to the public Smokrates account stayed in `PROCESSING_UPLOAD` while a private test account received them. Until the app is approved, a stalled draft is shown as "stalled", not retried. Each retry spends one of 5 pending shares a day.

## No-gos

- No per-token AI API, no paid xAI account, no paid scheduler, no paid hosting.
- No agent ever taps Post or flips a video public. Nothing is sent until you approve the week.
- No bought followers, no engagement pods, no Promote, no Business account.
- No health, sleep, anxiety or focus claims in any caption or on-screen text.
- No padding a loop to 60 s. No second post that only crops the first.
- No Instagram, X or Facebook. No Pulsu Studio integration (the Library keeps one slot for it).
- No analytics dashboard. View counts need TikTok's `video.list` scope, which is a later cycle.
- No phone access to the review page, no other creators, no accounts. One user, local only.
- No monetisation work. A distributor delivery is your step, outside this tool.

## Success metric

On 27 October, `npm run studio:week -- 2026-10-26` writes a plan of up to seven nights that follows the seven-job template. The review page shows every night with a rendered 9:16 master. After you approve, the scheduler sends each approved night to the TikTok inbox and to YouTube with no further command. The publish log shows one TikTok publish id and one YouTube video id per approved night, and no two posts share a still and an audio section.

## Quality bar

Production for one user: tested, idempotent, never posts twice, never posts unapproved, never leaks a token.

## Actors

- **Creator** is you: you approve weeks, make the label decision, and tap Post in TikTok or Public in YouTube.
- **Admin** is also you: you connect platforms, approve the man's canonical still, and change schedules and formats.

The template's Customer and Client actors do not exist here.
