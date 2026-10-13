# Interfaces

Three hops. The browser calls no data service other than the studio API. The API talks to the database, the workers and the outside services. There is no browser-to-database connection.

`docs/openapi.yaml` is the contract for every browser-to-API call. Write the operation there before the handler. This file is the map across all three hops. Every dotted id in backticks on this page is an operationId and must exist in the OpenAPI file. The gate checks both directions.

Roles are Creator and Admin. Both are the same person on the same laptop. The API binds to 127.0.0.1 and has no login.

## Operations

| operationId | Method and path | Role | Reads | Writes | Failure the user sees |
| --- | --- | --- | --- | --- | --- |
| `plan.generate` | POST /api/plans | Creator | canon, assets, publishes | plans, episodes | "The Showrunner could not write the week. Nothing changed. Try again." A plan for that week stays untouched. |
| `plan.get` | GET /api/plans/{weekStart} | Creator | plans, episodes, renders | nothing | "No plan for this week yet." with a Make plan control. |
| `week.approve` | POST /api/plans/{weekStart}/approve | Creator | plans, episodes, renders | plans, episodes | "Night 3 is not rendered. Render it or skip it." The week stays a draft. |
| `episode.update` | PATCH /api/episodes/{episodeId} | Creator | episodes | episodes | "That time is in the past." or "That track has no audio." The typed value stays. |
| `episode.approve` | POST /api/episodes/{episodeId}/approve | Creator | episodes, renders | episodes | "Render this night before you approve it." |
| `episode.skip` | POST /api/episodes/{episodeId}/skip | Creator | episodes | episodes | "This night is already sent and cannot be skipped." |
| `episode.swap` | POST /api/episodes/{episodeId}/swap | Creator | plans, episodes, assets | episodes | "The Showrunner could not find a new night. The old night stays." |
| `episode.render` | POST /api/episodes/{episodeId}/render | Creator | episodes, assets | assets, renders, episodes | "The picture or render failed. See the log line below the panel." The old render stays. |
| `canon.approve` | POST /api/canon | Admin | assets | canon | "That file is not a still." The old canon stays. |
| `connections.list` | GET /api/connections | Creator, Admin | connections | nothing | "Could not read the connections." The page shows each platform as unknown. |
| `publishes.list` | GET /api/publishes?weekStart= | Creator | publishes | nothing | "Could not read the publish log." The week still shows. |

Every operation validates input at the API. A bad weekStart or an unknown episode id returns a plain message and changes nothing.

## Records

| Entity | Key | Fields the UI needs | Who can read | Who can write | Through |
| --- | --- | --- | --- | --- | --- |
| plans | weekStart | status (draft or approved), created time | Creator | the Showrunner, Creator | `plan.generate`, `week.approve` |
| episodes | id | night, format, track slug, start second, claim, caption, publish time, label decision, status | Creator | the Showrunner, Creator | `episode.update`, `episode.approve`, `episode.skip`, `episode.swap` |
| assets | id | kind (still or clip), parent asset id, grok tool, prompt, file path, approved | Creator | the asset worker, Admin for approved | `episode.render`, `canon.approve` |
| renders | id | episode id, file path, duration, frame count, created time | Creator | the render worker | `episode.render` |
| publishes | id | episode id, platform, external id, status, attempts, last checked | Creator | the scheduler | `publishes.list` reads it |
| connections | platform | connected, environment, scopes | Creator, Admin | the sign-in scripts | `connections.list` reads it |
| canon | id | asset id, approved time | Creator | Admin | `canon.approve` |

The status of an episode is one of: planned, rendering, ready, approved, skipped, not new, published. The UI shows it as a word plus a colour.

An asset of kind clip has a parent asset that is a still. An asset of kind still has a parent that is the canon or another still. The originality guard compares the still and the audio section of an episode with earlier publishes.

Add a row here in the same change as a new operation or record.

## Connectors

Secrets stay as names in .env.example. Tokens live in the git-ignored token folders, mode 600.

| Id | System | Called by | Sends | Stores here | If it is down |
| --- | --- | --- | --- | --- | --- |
| smok-studio-folder | The smok-studio repo on disk | render worker, Showrunner | nothing. It reads track files and art. | a copy of cover and audio in ignored public/media | The render fails with "Track files not found." The plan can still be read. |
| grok-cli | The Grok CLI on the SuperGrok plan | asset worker | an edit sentence, a motion sentence and the parent still | still and clip files, one asset row each | The night stays planned. The page says "No new picture yet." The Creator can swap or skip. |
| claude-cli | Claude Code, headless | `plan.generate`, `episode.swap` | the seven-job template, the Library list, the week start | plan and episode rows | No new plan. The old plan stays. The page says the Showrunner is down. |
| tiktok-login | TikTok Login Kit | the TikTok sign-in script | PKCE code and client key | access token and refresh token in the token folder | The connection shows "Not connected". Publishing to TikTok pauses. |
| tiktok-content-posting | TikTok Content Posting API | publisher adapter | the video file and a publish request | publish id, status, attempts, last checked | The publish stays queued. A stalled draft shows "Stalled" and is not retried. |
| youtube-data | YouTube Data API | publisher adapter | the video file, title, description, private status | video id, status, attempts | The publish stays queued. Uploads stay private until the API audit. |
| launchd | macOS launchd | the OS | nothing. It starts the scheduler every 15 minutes. | nothing | No episode is sent. The next run picks up due episodes. |
