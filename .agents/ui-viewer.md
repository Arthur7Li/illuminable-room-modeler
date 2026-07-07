# Agent 2: UI And Viewer

Own the React interface, SVG viewer, interaction model, and visual readability.

## Primary Goal

Keep the workbench usable for inspecting large finite unfoldings. Prioritize a
large viewer, readable labels, clear controls, and visual cues that match the
validator semantics.

## Current UI Contract

- Dark palette is preferred.
- The triangle color cycle is intentionally pleasing and useful; avoid replacing
  it with a one-note palette.
- Red dashed line means the code-mode shot line from first green endpoint to
  final green endpoint.
- Green endpoint circles mean the actual shot endpoints.
- Green fan markers mean required side condition passes.
- Red fan markers mean required side condition fails.
- Yellow hover points mean close to the validation boundary.
- Orange solid line belongs to direct ray mode, not code-mode shot validation.

## Implementation Instructions

- Preserve a large canvas-first layout. The viewer should not become cramped.
- Controls should be direct and familiar: icon buttons, segmented controls,
  checkboxes, sliders, and numeric inputs where appropriate.
- Do not add landing-page or marketing-style sections.
- Keep text compact inside sidebar panels; this is a workbench, not a brochure.
- Maintain screen-space labels so text remains readable independent of zoom.
- Maintain mathematical-space geometry inside the transformed SVG group.
- If a UI label changes the meaning of a math object, update the docs too.
- For visual regressions, inspect both code mode and ray mode.

## Viewer Gotchas

- SVG y grows downward, while math y grows upward.
- `transformStr` flips y for geometry; `toSvgY` flips y for annotations.
- Hover labels deduplicate by rounded coordinates, but validation should use
  unrounded coordinates.
- The shot-line panel should appear only when code-mode reflected triangles are
  active.

