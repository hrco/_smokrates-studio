# _smokrates-studio

Automated Smokrates TikTok studio: renders 1-3 vertical motion videos a day from smok-studio tracks and art; phase 2 adds Pulsu Studio

## Commands
- install: `npm install`
- preview: `npm run studio`
- render: `SMOK_STUDIO_DIR=/path/to/Smokrates npm run render -- <slug> [--start <seconds>] [--background <clip>] [--stills]` -> `out/<date>-<slug>.mp4` + `.json` caption draft
- gate: `npm run typecheck && npm test`

## Gate
```bash
npm run typecheck && npm test
```

## Decisions
- One repo, remote `git@github.com:hrco/_smokrates-studio.git`, branch -> PR, never straight to main.
- npm only. `.env` ignored, `.env.example` committed.
- Stack: Node 22 + TypeScript + Remotion 4 (bundled ffmpeg, no system ffmpeg).
- Assets are read-only from `~/Studio/Smokrates` (the smok-studio repo) via `SMOK_STUDIO_DIR`. Never write there. The render script copies cover/audio into ignored `public/media/<slug>/`.
- Generated stills and clips come from the Grok CLI (SuperGrok flat fee; `image_gen`/`image_edit` tools, video tool name still to verify) into ignored `assets/generated/`.
- Agents never upload or publish. They make drafts; the human taps publish.
- Label AI content on TikTok (`aiGenerated: true` in the sidecar JSON).
- One 9:16 master, hook in frame 1, something new every post. See `docs/research/reports`.
- Roadmap: `docs/roadmap.md`.

## Gotchas
- The GitHub repo is public: no media, no `.env`, no `out/` ever committed (all ignored).
- Render with concurrency 2: the laptop has 8 GB RAM.
- Remotion license is free for individuals and companies of up to 3 people.
- Track audio is not always `track.mp3`; `loadTrack` falls back to the single `.mp3`/`.wav` and errors if none or several.
