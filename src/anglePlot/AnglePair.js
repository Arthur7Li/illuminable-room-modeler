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

/**
 * Formats a degree value with enough decimal places to represent the
 * current Angle Step exactly (`scale` = that step's decimal-place count),
 * then trims trailing zeros so a coarse step (e.g. whole-number steps)
 * doesn't force ugly ".000000" tails: formatAngleDegrees(45, 7) -> "45",
 * formatAngleDegrees(45.1, 7) -> "45.1", formatAngleDegrees(45.1234567, 7)
 * -> "45.1234567".
 */
export const formatAngleDegrees = (degrees, scale = 1) => {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 0;
  const fixed = degrees.toFixed(safeScale);
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
};
