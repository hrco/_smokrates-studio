# Grok CLI day-1 test

Date: 14 October 2026. Grok CLI 1.0.52, signed in on the SuperGrok plan. `XAI_API_KEY` was not set, so no call used the per-token API.

Result: **pass**. The Scene format stays in cycle 1.

## Method

One headless run made one call per tool:

```
grok -p "<test prompt>" --always-approve --max-turns 30
```

The run used `assets/generated/day1-grok-test/` as its working directory. That folder is git-ignored. The source still was `~/Studio/Smokrates/style-reference.jpg` (1086×724). The canonical 9:16 still does not exist yet, so the reference stood in for it. The whole run took about 3 minutes. No call was blocked, and no upgrade notice appeared.

The probes used the ffmpeg that Remotion bundles. That build has no `select`, `ssim`, `rawvideo` or `s16le`. Frames were compared as BMP files made with `sips`.

## Tool schemas as Grok reports them

| Tool | Parameters that matter |
| --- | --- |
| `image_edit` | `prompt`, `image` (paths), `aspect_ratio` (`9:16` is listed) |
| `reference_to_video` | `prompt`, `aspect_ratio` (required), `first_frame`, `last_frame`, `images` (max 14), `keyframes` (max 4), `voices` (max 3), `duration` 1–15 s (default 6), `resolution_name` `480p` or `720p` (default 480p) |

There is no text-to-video tool. There is no `generate_audio` parameter. The only audio parameter is `voices`, which adds speech.

## Calls and measurements

| Step | Call | Output | Measured |
| --- | --- | --- | --- |
| Still | `image_edit`, reference still, `aspect_ratio` `9:16`, rooftop scene, no text | `edit-scene.png` | 720×1280. The schema says a single-image edit ignores `aspect_ratio`, but the output was 9:16. Same face, beard, toga and brooch as the reference. |
| Insert | `reference_to_video`, `first_frame` = the still, 9:16, 6 s, `720p`, slow push-in | `insert-6s.mp4` | H.264 720×1280, 24 fps, 6.04 s. AAC audio, peak −26.2 dBFS. The face holds through the push-in. |
| Loop | `reference_to_video`, `first_frame` = `last_frame` = the still, 9:16, 4 s, `720p` | `loop-4s.mp4` | H.264 720×1280, 24 fps, 4.04 s. AAC audio, peak −12.5 dBFS. First and last frame differ by 1.87/255 (mean absolute), so the seam is not visible. |

The pinned first frame differs from the source still by about 11/255. That is colour and compression drift, not a new picture.

## What the plan changes

- **Resolution.** Clips are 720p at most. Remotion scales them to 1080×1920. The insert is short and sits under drawn type, so the softness is acceptable.
- **Sound.** Every clip has an ambient soundtrack. The Scene composition plays the clip muted. The dub is the only sound.
- **Files.** Grok saves into `~/.grok/sessions/<encoded cwd>/<session>/images|videos/`. The asset worker reads the path from the tool message and copies the file into `assets/generated/`.
- **Loop.** A pinned loop works. Loop stays in cycle 2 because of the cut, not because of the tool.

## Repeat the test

Run it again after a Grok CLI update and before an asset run depends on it. Compare against this page.
