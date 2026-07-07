# Agent 1: Geometry And Validator

Own the mathematical behavior and validator semantics.

## Primary Goal

Keep the unfolding, shot line, and fan-side checks mathematically consistent
with the current conjecture workflow while clearly labeling anything heuristic.

## Current Geometry Contract

- Base triangle vertices are stored as physical indices:
  - `0 = A`
  - `1 = B`
  - `2 = C`
- Symbolic labels `x`, `y`, `z` are mapped onto physical vertices by the code
  parser heuristic in `src/App.jsx`.
- The code-mode shot line is:
  `baseTriangle.points[0] -> lastActiveTriangle.points[0]`.
- The UI may display that endpoint as `z/A` when physical `A` carries symbolic
  label `z`.
- A fan vertex is valid only if it is strictly on the required side of the red
  shot line:
  - symbolic `y`: positive signed cross product;
  - symbolic `z`: negative signed cross product.
- Points inside the tolerance band are invalid unless they are the first or final
  shot endpoint.

## Implementation Instructions

- Use cross products for side tests:
  `side = dx * (p.y - start.y) - dy * (p.x - start.x)`.
- Avoid slope comparison unless you also handle vertical and near-vertical lines.
- Keep tolerances explicit and scale-aware.
- Keep `reflectPoint`, centroid logic, angle measurement, parser mapping, and
  validator logic separable in comments even while they live in `App.jsx`.
- If you change symbolic mapping, update:
  - `PROJECT_WORKING_NOTES.md`;
  - `CODEBASE_COMMENTARY.md`;
  - `.agents/README.md`;
  - this file.
- If you introduce exact arithmetic, keep the floating-point visual path separate
  from the exact decision path.

## Known Technical Debt

- Code-mode edge selection is heuristic, not a canonical legal-code validator.
- The app does not test `x divides 90` or `y = k*x`.
- The app does not certify invisibility.
- Singular hits and forbidden vertex crossings are not fully handled.

