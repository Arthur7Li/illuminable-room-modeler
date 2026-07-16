// AnglePairValidator equivalent: pure, framework-free rules for whether a
// physical (A, B) base-angle pair belongs on the "Valid Angle A-B Region"
// plot. This module intentionally knows nothing about React, SVG, or the
// billiards code parser — the expensive, app-specific validation (does the
// rest of the program actually accept this pair?) is injected as the
// `validateCandidate` callback rather than duplicated here. See
// generateAngleRegion.js for how this is driven across a whole grid, and
// App.jsx for how `validateCandidate` is wired to the exact same
// `validateLockedAngleCandidate` closure the live A/B number inputs use.

// Angle steps are generated in increments of 0.1 degrees. Plain floating
// point degrees (0.1, 0.2, 0.3, ...) do not add up exactly in binary
// floating point, so summing/stepping by 0.1 many times can drift and
// produce near-duplicate grid points (e.g. 45.099999999999994 vs 45.1).
// Representing each step as an integer count of tenths-of-a-degree (451
// meaning 45.1 degrees) keeps every generated angle exact and makes
// point de-duplication a plain integer comparison instead of a fuzzy
// float comparison.
export const ANGLE_STEP_TENTHS = 1; // 0.1 degrees per grid step

// Smallest angle explored by the grid; angles must be strictly positive,
// and this is also the finest resolution requested (0.1 degrees).
export const MIN_ANGLE_TENTHS = 1; // 0.1 degrees

export const degreesToTenths = (degrees) => Math.round(degrees * 10);
export const tenthsToDegrees = (tenths) => tenths / 10;

// Tolerance used only when comparing raw (non-grid) floating point degrees,
// e.g. a value arriving as 89.999999999 that should be treated as exactly
// 90 rather than incorrectly rejected.
export const ANGLE_EPSILON_DEGREES = 1e-6;

// --- Third-angle "obtuse" rule -------------------------------------------
// The implicit third triangle angle is C = 180 - A - B, and A + B <= 90
// keeps C at or above 90 degrees (a right or obtuse third angle). The
// task currently asks for A + B <= 90 exactly. If the intent later
// becomes "the third angle must be *strictly* obtuse", change ONLY the
// comparison below from `<=` to `<` (and drop the epsilon on this side of
// the comparison, since a strict rule should not treat 90 + epsilon as
// passing). Nothing else in this file or in generateAngleRegion.js needs
// to change.
export const OBTUSE_THIRD_ANGLE_LIMIT_DEGREES = 90;

export const isWithinObtuseSumLimit = (angleA, angleB) =>
  angleA + angleB <= OBTUSE_THIRD_ANGLE_LIMIT_DEGREES + ANGLE_EPSILON_DEGREES;

/**
 * boolean isValidAnglePair(angleA, angleB)
 *
 * Checks, in order from cheapest to most expensive:
 *   1. Both angles are finite and strictly positive (minimum bound).
 *   2. A < B.
 *   3. A + B <= 90 (see isWithinObtuseSumLimit above).
 *   4. Whatever the rest of the program already requires, via the injected
 *      `validateCandidate` callback — this is the same check the app runs
 *      when a user types a new A or B value, so a point is never marked
 *      valid here unless the main program would also accept it.
 *
 * `validateCandidate` is optional so this module (and its tests) can run
 * without any app wiring; the plot generator always supplies it in
 * production so step 4 is never skipped for real.
 */
export const isValidAnglePair = (angleA, angleB, { validateCandidate, baseLength } = {}) => {
  if (!Number.isFinite(angleA) || !Number.isFinite(angleB)) return false;
  // Minimum positive-angle bound. The reused app validator re-checks this
  // too (via hasValidAngleTriangle), but failing fast here skips the
  // expensive call for angles that can never be valid.
  if (angleA <= 0 || angleB <= 0) return false;
  // A must be strictly less than B.
  if (angleA >= angleB - ANGLE_EPSILON_DEGREES) return false;
  // Third-angle limit, kept in its own named method so it is easy to find
  // and change later (see comment above isWithinObtuseSumLimit).
  if (!isWithinObtuseSumLimit(angleA, angleB)) return false;

  if (typeof validateCandidate !== 'function') return true;
  // Reuse the exact same constraint-validation logic the main program
  // applies when the user edits A/B directly, instead of re-implementing
  // triangle/unfolding rules here.
  const result = validateCandidate({ a: angleA, b: angleB, length: baseLength });
  return !!(result && result.allowed);
};
