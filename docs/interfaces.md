Three hops. The browser and launchd call no service other than the studio daemon's API. The daemon talks to the database, its worker children and the outside services. There is no browser-to-database connection.

`docs/openapi.yaml` is the contract for every browser-to-API call and for the tick. Write the operation there before the handler. This file is the map across all three hops. Every dotted id in backticks on this page is an operationId and must exist in the OpenAPI file. The gate checks both directions.

Roles are Creator and Admin. Both are the same person on the same laptop. The daemon binds to 127.0.0.1 and has no login. The daemon is the only process that opens the database.

All dates and times use the Europe/Ljubljana timezone. This covers weekStart and publishAt.

## Operations

| operationId | Method and path | Role | Reads | Writes | Failure the user sees |
| --- | --- | --- | --- | --- | --- |
| `plan.import` | POST /api/plans | Creator | plans, episodes | plans, episodes | "This week already has work in progress. Send replace to overwrite it." (409, when any episode is not planned). "The caption makes a health claim." or "The Grok prompt names SMOKRATES." Nothing changes. |
| `plan.get` | GET /api/plans/{weekStart} | Creator | plans, episodes, renders | nothing | "No plan for this week yet." |
| `week.approve` | POST /api/plans/{weekStart}/approve | Creator | plans, episodes, renders | plans, episodes | "Night 3 is not rendered. Render it or skip it." The week stays a draft. |
| `episode.update` | PATCH /api/episodes/{episodeId} | Creator | episodes | episodes | "That time is in the past." or "That caption makes a health claim." The typed value stays. The caption and prompt validator runs here. |
| `episode.approve` | POST /api/episodes/{episodeId}/approve | Creator | episodes, renders | episodes | "Render this night before you approve it." |
| `episode.skip` | POST /api/episodes/{episodeId}/skip | Creator | episodes | episodes | "This night is already sent and cannot be skipped." |
| `episode.render` | POST /api/episodes/{episodeId}/render | Creator | episodes, assets | jobs | "Another render or asset run is busy. Try again soon." The old render stays. Returns 202 and a job id. |
| `job.get` | GET /api/jobs/{jobId} | Creator | jobs | nothing | "Could not read the job." The panel keeps its last state. |
| `canon.get` | GET /api/canon | Creator, Admin | canon, assets | nothing | "No canonical still yet." |
| `canon.approve` | POST /api/canon | Admin | assets | canon | "That file is not a still." The old canon stays. |
| `assets.list` | GET /api/assets | Creator, Admin | assets | nothing | "Could not read the stills." The picker stays closed. |
| `health.get` | GET /api/health | Creator | daemon state | nothing | The page says "The daemon is down." |
| `tick.run` | POST /api/tick | launchd | episodes, publishes | jobs, publishes | Returns 202 and a job id, or 200 when nothing is due. A failed tick sends nothing. The next tick tries again. |
| `connections.list` | GET /api/connections | Creator, Admin | token files (stat only) | nothing | "Could not read the connections." The page shows each platform as unknown. |
| `publishes.list` | GET /api/publishes?weekStart= | Creator | publishes | nothing | "Could not read the publish log." The week still shows. |

Every operation validates input at the API. A bad weekStart or an unknown episode id returns a plain message and changes nothing. The caption and prompt validator runs at the API boundary for `episode.update` and `plan.import`. It refuses the word SMOKRATES or a hex code in a Grok prompt, and a health claim in a caption.

Deferred to cycle 2: the plan generator, the swap of a night, the Showrunner, Loop and Title.

## Records

| Entity | Key | Fields the UI needs | Who can read | Who can write | Through |
| --- | --- | --- | --- | --- | --- |
| plans | weekStart | status (draft or approved), created time | Creator | Creator | `plan.import`, `week.approve` |
| episodes | id | night, format, track slug, start second, duration seconds, claim, caption, publish time, label decision, status | Creator | Creator | `plan.import`, `episode.update`, `episode.approve`, `episode.skip` |
| assets | id | kind (still or clip), parent asset id, grok tool, prompt, file path, approved | Creator | the asset worker, Admin for approved | `episode.render`, `canon.approve` |
| renders | id | episode id, file path, duration, frame count, created time | Creator | the render worker | `episode.render` |
| jobs | id | kind (render, asset or send), episode id, status (queued, running, succeeded, failed), message, created time | Creator | the daemon | `episode.render`, `tick.run`, `job.get` reads it |
| publishes | id | episode id, platform, external id, status, attempts, last checked | Creator | the daemon | `tick.run` writes it, `publishes.list` reads it |
| canon | id | asset id, approved time | Creator | Admin | `canon.approve` |

Connections are not a table. `connections.list` stats the token files and derives connected, environment and scopes.

The status of an episode is one of: planned, rendering, ready, approved, skipped, not_new. The UI shows it as a word plus a colour. The UI writes "Not new" for not_new.

Publish state is per platform, in publishes. A publish status is one of: processing, sent, stalled, failed. Rules:
- A publish is unique per episode and platform.
- The daemon writes the row at TikTok init, with status processing, before the upload.
- A share in processing for over 30 minutes becomes stalled. It is never retried.
- The tick stops at 5 shares in flight, because TikTok allows 5 pending shares a day.

A render is keyed by episode id. The output is `out/<episodeId>.mp4`. The staging folder is `public/media/<episodeId>/`. An episode has its own duration in seconds. Two episodes with the same track never share a path.

An asset of kind clip has a parent asset that is a still. An asset of kind still has a parent that is the canon or another still. In week 1 the originality guard is the Creator's Skip. Later it compares a hash of still, track, start second and duration with earlier publishes.

Add a row here in the same change as a new operation or record.

## Connectors

Secrets stay as names in .env.example. Tokens live in the git-ignored token folders, mode 600.

| Id | System | Called by | Sends | Stores here | If it is down |
| --- | --- | --- | --- | --- | --- |
| smok-studio-folder | The smok-studio repo on disk | render worker | nothing. It reads track files and art. | a copy of cover and audio in ignored public/media/<episodeId> | The render fails with "Track files not found." The plan can still be read. |
| grok-cli | The Grok CLI on the SuperGrok plan. Day-1 kill-gate: if the test fails, cycle 1 has no Grok assets. | asset worker | an edit sentence, a motion sentence and the parent still | still and clip files, one asset row each | The night stays planned. The page says "No new picture yet." The Creator can skip. |
| tiktok-login | TikTok Login Kit | the TikTok sign-in script | PKCE code and client key | access token and refresh token in the token folder, refreshed only by the daemon | The connection shows "Not connected". Publishing to TikTok pauses. |
| tiktok-content-posting | TikTok Content Posting API | publisher adapter in the daemon | the video file and a publish request | publish row at init: publish id, status, attempts, last checked | The publish stays processing. After 30 minutes it shows "Stalled" and is not retried. |
| instagram-login | Instagram API with Instagram Login (long-lived user token, 60 days) | the Instagram scripts | the old token, to renew it | token and expiry in the token folder, renewed by the refresh script | The scripts stop with "no-token" or a Graph error. Nothing is posted. |
| instagram-content-publishing | Instagram Content Publishing API on the Graph host, resumable Reels upload | the Instagram draft and publish scripts | the caption, the video bytes and a publish request | draft record next to the video: container id, expiry, media id, permalink | The draft stops with an error. A container expires after 24 hours; run the draft script again. |
| youtube-login | Deferred to cycle 2. Google OAuth 2.0, Desktop client, scope youtube.upload, consent screen in Testing | the YouTube sign-in script | PKCE code and client id | access token and refresh token in the token folder | The connection shows "Not connected". Publishing to YouTube pauses. |
| youtube-data | Deferred to cycle 2. YouTube Data API v3, upload with the OAuth token | publisher adapter | the video file, title, description, private status | video id, status, attempts | The publish stays queued. Uploads stay private until the API audit. |
| launchd | macOS launchd | the OS | a POST to the tick every 15 minutes | nothing | No episode is sent. The next tick picks up due episodes. |
