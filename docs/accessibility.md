# Accessibility

Target: WCAG 2.2 level AA, applied to the DNP XIII design system. The review page is local and has one user. The bar is the same as for a public site.

DNP XIII is in https://claude.ai/artifact/YNcLF1gPzaPmo2gDqZMYpR. The repo holds a vendored copy of its tokens.css and components bundle. The page never loads a claude.ai artifact URL at run time.

## Features

- A skip link is the first focusable control on the page.
- Landmarks: header, nav, main. One h1: the week title.
- Tab order follows the visual order of the panels, night 1 to night 7.
- Focus is a solid 3px ring in the focus token, with a 3px offset. It shows on every surface in the day theme and the night theme. No sticky bar covers it.
- Text contrast is at least 4.5:1 in both themes. Outlines and the focus ring are at least 3:1.
- Status is always a word plus a colour: "Draft", "Ready", "Approved", "Skipped", "Not new", "Stalled", "Error". Colour alone never carries a state.
- Primary controls are at least 44 by 44 CSS pixels. Every control is at least 24 by 24.
- Every control has a name, a role and a state. A name is the action, such as "Approve night 3".
- Errors sit on the field and are announced. The typed value stays.
- Busy states are announced with a polite live region ("Rendering night 3...").
- No motion over 100ms. DNP XIII has no transitions beyond the button lift and press. With prefers-reduced-motion, the lift is off.
- Video previews do not start by themselves. They have a Pause control.
- Video previews have captions text. The text equals the episode's on-screen text, shown under the preview as real text. The dub has no speech.
- The page language is set.
- Keyboard path through a week: skip link, week controls, then each night panel in order, as written in `docs/interactions.md`.

A control row is ready to build when its keyboard cell and its visible label, or accessible name, are filled. Meeting this file is a separate check against the features above.

## Exceptions

| Control id | Rule | Reason |
| --- | --- | --- |
| None yet | | |
