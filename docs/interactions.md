# Interactions

What a person can do. One screen section, then one row per control. An empty cell means the row is not ready to build.

Roles are Creator and Admin. They are the same person. The review page is local, at http://127.0.0.1:8724. It is drawn in the DNP XIII design system. The repo holds a vendored copy of the tokens. The page never loads a claude.ai artifact URL at run time. The daemon serves the page.

A control that calls the server uses the operationId as its id. A control that only changes the view uses a local id, such as `week.prev`. Only operationIds appear in `docs/openapi.yaml`.

## Motion

Each control points at a token. DNP XIII allows no transition over 100ms.

| Token | What moves | Duration | Reduced motion |
| --- | --- | --- | --- |
| `none` | Nothing | 0 | Nothing |
| `button.press` | Button lifts on hover, sinks on press | 100ms | No movement. The outline thickens. |

Video previews do not start by themselves. A preview plays only after the Creator presses Play. A preview has a Pause control.

## Screen: week

| Field | Value |
| --- | --- |
| id | week |
| path | / |
| title | The week |
| roles | Creator, Admin |
| arrive | Open http://127.0.0.1:8724 |
| leave | None. It is the only screen. |
| needs | `plan.get`, `week.approve`, `connections.list`, `publishes.list`, `health.get`, `job.get`, `canon.get`, `assets.list` |

### Week controls

| Control id | Where | Who | What it does | States | Keyboard | Motion |
| --- | --- | --- | --- | --- | --- | --- |
| week.prev | Week header | Creator | Shows the previous week. Calls `plan.get` for that week. Local only. | Enabled. Disabled on the first stored week. | Enter, Space | none |
| week.next | Week header | Creator | Shows the next week. Local only. | Enabled | Enter, Space | none |
| plan.get | Page load, after each change | Creator | Loads the plan for the shown week. | Loading shows "Loading the week...". Empty shows "No plan for this week yet. Load a week file with plan.import." Error shows a balloon with Retry. | none (runs by itself) | none |
| week.approve | Week header | Creator | Approves every ready episode in the week. One accent button on the page. | Disabled until every non-skipped night is rendered. Busy. Done shows the word "Approved". | Enter, Space | button.press |
| connections.list | Connections caption, top right | Creator, Admin | Shows TikTok and YouTube as Connected or Not connected, with environment and scopes. | Loading. Loaded. Error shows "Unknown". | none (runs by itself) | none |
| publishes.list | Publish log panel under the week | Creator | Shows one line per publish: platform, status word, attempts, last checked. | Empty shows "Nothing sent yet." | none (runs by itself) | none |
| canon.approve | Canon panel, Admin only section | Admin | Sets the chosen still as the man's canonical still. | Disabled when no still is chosen. Done shows "Approved". | Enter, Space | button.press |
| canon.pick | Canon panel | Admin | Opens the list of earlier stills (assets.list) to choose from. | Closed. Open. | Enter, Space, Escape to close | none |

### Episode panel controls

One panel per night, seven in the week. Each control below repeats once per panel. The control id has the operationId as its name.

| Control id | Where | Who | What it does | States | Keyboard | Motion |
| --- | --- | --- | --- | --- | --- | --- |
| episode.play | Panel preview | Creator | Plays or pauses the video preview. Captions text under the preview equals the on-screen text. Local only. | Paused. Playing. | Space, Enter | none |
| episode.update | Panel time, caption, track, start second, format and label fields | Creator | Saves the changed field. The label field is the label decision: on only if a frame is photoreal. | Saved shows the word "Saved". Busy. Error shows a balloon on the field and keeps the typed value. Disabled when the episode is sent. | Tab to the field, Enter to save | none |
| episode.approve | Panel footer | Creator | Approves this night. | Disabled until the night is rendered. Done shows "Approved". | Enter, Space | button.press |
| episode.skip | Panel footer | Creator | Skips this night. A skipped night is never sent. | Disabled when sent. Done shows "Skipped". | Enter, Space | button.press |
| episode.render | Panel footer | Creator | Queues the render of this night, then polls job.get. | Idle. Busy shows "Rendering..." Done shows "Ready". Error shows the job message. | Enter, Space | button.press |

### Keyboard path through a week

1. Tab reaches the skip link, then week.prev, week.next and week.approve.
2. Tab then enters the first panel and runs through its controls in visual order: preview, fields, render, approve, skip.
3. Tab continues panel by panel to night 7, then the publish log and the connections caption.
4. Escape closes canon.pick and returns focus to its trigger.
