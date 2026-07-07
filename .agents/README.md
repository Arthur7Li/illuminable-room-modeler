# Future Agent Team Brief

Use this folder as the handoff point for future agents working on `unfolder`.
The project is a Vite/React floating-point visual workbench for finite triangle
unfoldings related to an invisible-point conjecture. It is not a proof backend
and it is not a periodic-path tool.

Start every session by reading these files:

1. `README.md`
2. `PROJECT_WORKING_NOTES.md`
3. `CODEBASE_COMMENTARY.md`
4. `src/App.jsx`
5. The role file in `.agents/` matching your task

## Non-Negotiable Context

- The conjecture context is:
  `point invisible iff x divides 90 and y = k*x for k >= 1 and y < z`.
- The app currently helps inspect finite poolshot unfoldings. It does not prove
  invisibility, decide the conjecture, or use exact arithmetic.
- The code-mode red dashed line is endpoint-defined:
  first physical `A` vertex to final physical `A` vertex.
- In the default symbolic mapping, that physical `A` endpoint is displayed as
  `z/A`. Do not change the red line into an `x -> x` symbolic convention.
- Fan validation checks symbolic `y` vertices on the positive side of the red
  line and symbolic `z` vertices on the negative side.
- The first and final shot endpoints are allowed to lie on the red line and must
  be excluded from fan-obstacle validation.
- Side checks use a signed cross product, not slope division, so vertical red
  lines remain valid.
- The UI should remain a dark, dense workbench. The existing multicolor triangle
  palette is intentional and should stay recognizable.

## Three-Person Team Split

- Agent 1: geometry and validator owner. See `geometry-validator.md`.
- Agent 2: UI and viewer owner. See `ui-viewer.md`.
- Agent 3: documentation, tests, and repo hygiene owner. See `docs-qa.md`.

## Shared Working Rules

- Preserve user work. Never reset, checkout, or delete unrelated changes.
- Prefer small, reviewable edits that follow existing project style.
- Update documentation when changing math, conventions, labels, or validation.
- Keep JSON and lockfiles valid; document them externally instead of inserting
  comments into files that do not support comments.
- Run `npm.cmd run lint` and `npm.cmd run build` before handing off code changes.
- If a change affects visible geometry, also run the app and inspect the canvas.
- Be explicit about uncertainty. Do not describe floating-point visualization as
  proof-grade validation.

