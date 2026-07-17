import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TARGET_CELL_SIZE_PX, MAX_VISIBLE_SAMPLE_CELLS, MAX_RENDER_STEP_DEGREES,
  calculateSamplingStride, isWithinRenderCell,
} from '../src/anglePlot/renderSamplingPolicy.js';

const wideBounds = { minA: 0, maxA: 90, minB: 0, maxB: 90 };
const viewport = { width: 560, height: 350 };

test('calculateSamplingStride decreases (finer) as the visible world area shrinks (zooming in)', () => {
  // visibleWorldBounds already encodes zoom (a smaller visible width *is*
  // "zoomed in" — see AnglePlotPanel's toDataA/toDataB), so this varies
  // bounds directly rather than a separate zoomLevel, matching how the
  // real caller (generateVisibleAnglePoints) always derives bounds from
  // the panel's actual current zoom.
  const wide = calculateSamplingStride({ userStepDegrees: 1e-6, visibleWorldBounds: { minA: 0, maxA: 20, minB: 40, maxB: 60 }, viewportSize: viewport });
  const narrow = calculateSamplingStride({ userStepDegrees: 1e-6, visibleWorldBounds: { minA: 14, maxA: 16, minB: 49, maxB: 51 }, viewportSize: viewport });
  const wider = calculateSamplingStride({ userStepDegrees: 1e-6, visibleWorldBounds: { minA: 0, maxA: 40, minB: 30, maxB: 70 }, viewportSize: viewport });

  assert.ok(narrow.stride <= wide.stride, `expected the narrower (more zoomed-in) view's stride (${narrow.stride}) <= the wider view's (${wide.stride})`);
  assert.ok(wider.stride >= wide.stride, `expected the even-wider (more zoomed-out) view's stride (${wider.stride}) >= the original (${wide.stride})`);
});

test('calculateSamplingStride reaches stride 1 (full user precision) once the viewport can show it', () => {
  // A tiny, heavily-zoomed-in view where TARGET_CELL_SIZE_PX-spaced samples
  // are already finer than the user's own Angle Step — this was exactly
  // the regression reported live: at high zoom with a small viewport, the
  // renderer should reach the user's real step, not stay stuck coarser.
  const { stride, budgetLimited } = calculateSamplingStride({
    userStepDegrees: 0.01, visibleWorldBounds: { minA: 14, maxA: 16, minB: 49, maxB: 51 }, viewportSize: { width: 1030, height: 500 },
  });
  assert.equal(stride, 1, `expected full precision (stride 1) at this viewport, got stride ${stride}`);
  assert.equal(budgetLimited, false);
});

test('calculateSamplingStride never goes below stride 1 (never finer than the user Angle Step)', () => {
  const { stride } = calculateSamplingStride({ userStepDegrees: 2, visibleWorldBounds: { minA: 10, maxA: 10.5, minB: 40, maxB: 40.5 }, viewportSize: viewport });
  assert.ok(stride >= 1, `expected stride (${stride}) to never go below 1`);
});

test('calculateSamplingStride never produces an effective step above MAX_RENDER_STEP_DEGREES even at extreme zoom-out', () => {
  const { stride } = calculateSamplingStride({ userStepDegrees: 0.0000003, visibleWorldBounds: wideBounds, viewportSize: { width: 10, height: 10 } });
  assert.ok(stride * 0.0000003 <= MAX_RENDER_STEP_DEGREES + 1e-9);
});

test('calculateSamplingStride coarsens (marking budgetLimited) to respect MAX_VISIBLE_SAMPLE_CELLS over a large visible area', () => {
  // A large viewport over the full domain: pixel targeting alone would want
  // far more sample cells than MAX_VISIBLE_SAMPLE_CELLS allows.
  const bigViewport = { width: 5000, height: 5000 };
  const { stride, desiredStride, budgetLimited } = calculateSamplingStride({ userStepDegrees: 1e-9, visibleWorldBounds: wideBounds, viewportSize: bigViewport });
  const cells = (90 / (1e-9 * stride)) * (90 / (1e-9 * stride));
  assert.ok(cells <= MAX_VISIBLE_SAMPLE_CELLS * 1.1, `expected cell count (${cells}) to respect the ~${MAX_VISIBLE_SAMPLE_CELLS} budget`);
  assert.ok(stride > desiredStride, 'expected the budget to have coarsened the stride beyond what pixel targeting alone requested');
  assert.equal(budgetLimited, true);
});

test('calculateSamplingStride is always a finite positive integer for pathological inputs', () => {
  for (const bounds of [wideBounds, { minA: 5, maxA: 5, minB: 5, maxB: 5 }, { minA: -1, maxA: 91, minB: -1, maxB: 91 }]) {
    const { stride } = calculateSamplingStride({ userStepDegrees: 0.1, visibleWorldBounds: bounds, viewportSize: viewport });
    assert.ok(Number.isInteger(stride) && stride >= 1, `expected a positive integer stride for bounds=${JSON.stringify(bounds)}, got ${stride}`);
  }
});

test('isWithinRenderCell is a square (Chebyshev) test, not a circular one', () => {
  // A point exactly on the diagonal at (halfWidth, halfHeight) is inside a
  // square tolerance but would be outside a circular radius of the same size.
  assert.equal(isWithinRenderCell(1 + 0.5, 2 + 0.5, 1, 2, 0.5, 0.5), true);
  assert.equal(isWithinRenderCell(1 + 0.51, 2, 1, 2, 0.5, 0.5), false);
  assert.equal(isWithinRenderCell(1, 2 + 0.51, 1, 2, 0.5, 0.5), false);
  // Independent per-axis tolerance (halfCellWidth != halfCellHeight).
  assert.equal(isWithinRenderCell(1.9, 2.05, 1, 2, 1, 0.1), true);
  assert.equal(isWithinRenderCell(1.9, 2.2, 1, 2, 1, 0.1), false);
});

test('TARGET_CELL_SIZE_PX and MAX_VISIBLE_SAMPLE_CELLS are sane, documented defaults', () => {
  assert.ok(TARGET_CELL_SIZE_PX >= 1 && TARGET_CELL_SIZE_PX <= 3);
  assert.ok(MAX_VISIBLE_SAMPLE_CELLS >= 10_000);
});
