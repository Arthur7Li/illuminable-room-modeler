// AnglePair equivalent: the smallest possible representation of one plotted
// (A, B) point plus the formatting helper the graph/tooltips share, so the
// "A = __.__, B = __.__, A+B = __.__" display logic lives in exactly one
// place.

/** Builds one immutable angle pair, keeping the sum precomputed for display. */
export const createAnglePair = (angleA, angleB) => ({
  a: angleA,
  b: angleB,
  sum: angleA + angleB,
});

/** Formats a degree value to one decimal place, e.g. formatAngleDegrees(45) -> "45.0". */
export const formatAngleDegrees = (degrees) => degrees.toFixed(1);
