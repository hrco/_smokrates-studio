# Workflow

The path a change takes. Change this file when review, branching, or the gate changes.

- Trunk is `main`. Work happens on a short branch. Merge goes through a pull request.
- Nobody, including an agent, pushes or merges to `main`.
- The gate is `bash .claude/gate.sh`. It runs the type check, the tests and the docs check. Run it before calling a slice done. Done also means every row that slice touches has no empty cell.
- A different model family reviews a non-trivial change, read-only. The human merges.
- The same pull request updates `docs/architecture.md` when topology changes, adds an ADR when the change is a hard-to-reverse decision, and rewrites `docs/project-status.md` when the slice ends.
- A new control lands with its row in `docs/interactions.md`. When it calls the server, its operationId lands in `docs/openapi.yaml` and `docs/interfaces.md` in the same change.
- No agent posts to a platform, taps Post, or sets a video public. Agents make drafts. The Creator publishes.
- No agent runs `npm run deploy:site`. The deploy publishes. The human runs it.
- Secrets stay in `.env`. `.env.example` holds names only. Never read, print or commit `.env` or the token folders.
- Research is cited. A claim about TikTok or YouTube rules names its source in `docs/research/`.
- Commit subjects use `feat:`, `fix:`, `test:`, `docs:`, or `chore:`. The body says why.
