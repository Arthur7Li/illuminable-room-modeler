import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAngleStep, estimateAngleGridIterations, displayScaleForStep, computeSweepRange, isExactModeStep, MAX_ANGLE_GRID_ITERATIONS } from '../src/anglePlot/angleStep.js';

test('parseAngleStep accepts whole numbers with scale 0', () => {
  const result = parseAngleStep('1');
  assert.equal(result.valid, true);
  assert.equal(result.scale, 0);
  assert.equal(result.stepUnits, 1n);
  assert.equal(result.stepDegrees, 1);
});

test('parseAngleStep accepts one decimal place', () => {
  const result = parseAngleStep('0.1');
  assert.equal(result.valid, true);
  assert.equal(result.scale, 1);
  assert.equal(result.stepUnits, 1n);
});

test('parseAngleStep accepts two decimal places', () => {
  const result = parseAngleStep('0.01');
  assert.equal(result.valid, true);
  assert.equal(result.scale, 2);
  assert.equal(result.stepUnits, 1n);
});

test('parseAngleStep accepts a seven-decimal-place step exactly (the 0.0000003 example)', () => {
  const result = parseAngleStep('0.0000003');
  assert.equal(result.valid, true);
  assert.equal(result.scale, 7);
  assert.equal(result.stepUnits, 3n);
  assert.equal(result.stepDegrees, 0.0000003);
});

test('parseAngleStep rejects zero', () => {
  const result = parseAngleStep('0');
  assert.equal(result.valid, false);
  assert.match(result.error, /greater than zero/);
});

test('parseAngleStep rejects a negative value', () => {
  const result = parseAngleStep('-1');
  assert.equal(result.valid, false);
  assert.match(result.error, /greater than zero/);
});

test('parseAngleStep rejects a blank string', () => {
  assert.equal(parseAngleStep('').valid, false);
  assert.equal(parseAngleStep('   ').valid, false);
});

test('parseAngleStep rejects non-numeric input', () => {
  const result = parseAngleStep('abc');
  assert.equal(result.valid, false);
  assert.match(result.error, /numeric/);
});

test('parseAngleStep rejects scientific notation (exact-digit parsing requires plain decimal)', () => {
  const result = parseAngleStep('3e-7');
  assert.equal(result.valid, false);
  assert.match(result.error, /scientific notation/);
});

test('estimateAngleGridIterations flags a very fine step as exceeding the safety limit', () => {
  const { scale, stepUnits } = parseAngleStep('0.0000003');
  const estimate = estimateAngleGridIterations(scale, stepUnits);
  assert.ok(estimate > BigInt(MAX_ANGLE_GRID_ITERATIONS), `expected the 0.0000003 estimate (${estimate}) to exceed the ${MAX_ANGLE_GRID_ITERATIONS} safety limit`);
});

test('estimateAngleGridIterations does not flag ordinary steps', () => {
  for (const stepText of ['1', '0.1', '0.25']) {
    const { scale, stepUnits } = parseAngleStep(stepText);
    const estimate = estimateAngleGridIterations(scale, stepUnits);
    assert.ok(estimate <= BigInt(MAX_ANGLE_GRID_ITERATIONS), `expected step ${stepText} (estimate ${estimate}) to stay under the safety limit`);
  }
});

test('displayScaleForStep mirrors the step scale, floored at zero', () => {
  assert.equal(displayScaleForStep(0), 0);
  assert.equal(displayScaleForStep(1), 1);
  assert.equal(displayScaleForStep(7), 7);
});

test('a viewBounds rectangle keeps a very fine step under the safety limit', () => {
  // 0.0000003 fails without bounds (see the test above) but should pass once
  // narrowed to a small on-screen rectangle, which is the whole point of
  // "scope to current view": a fine step only has to cover the zoomed-in
  // area, not the full 0-90 domain.
  const { scale, stepUnits } = parseAngleStep('0.0000003');
  const estimate = estimateAngleGridIterations(scale, stepUnits, { minA: 10, maxA: 10.0002, minB: 40, maxB: 40.0002 });
  assert.ok(estimate > 0n, 'expected a positive estimate for a non-empty view rectangle');
  assert.ok(estimate <= BigInt(MAX_ANGLE_GRID_ITERATIONS), `expected the bounded estimate (${estimate}) to stay under the safety limit`);
});

test('computeSweepRange narrows the A range to the viewport and leaves it untouched outside the view', () => {
  const { scale, stepUnits } = parseAngleStep('1');
  const unbounded = computeSweepRange(scale, stepUnits, undefined);
  const bounded = computeSweepRange(scale, stepUnits, { minA: 10, maxA: 20, minB: 40, maxB: 50 });

  assert.ok(bounded.startAUnits > unbounded.startAUnits, 'expected the view to raise the A start above the domain minimum');
  assert.ok(bounded.endAUnits < unbounded.endAUnits, 'expected the view to lower the A end below the domain maximum');
  assert.equal(bounded.startAUnits, 10n);
  assert.equal(bounded.endAUnits, 20n);
  assert.equal(bounded.minBUnits, 40n);
  assert.equal(bounded.maxBUnitsCap, 50n);
});

test('computeSweepRange with no viewBounds imposes no extra B bound', () => {
  const { scale, stepUnits } = parseAngleStep('1');
  const range = computeSweepRange(scale, stepUnits, undefined);
  assert.equal(range.minBUnits, null);
  assert.equal(range.maxBUnitsCap, null);
});

test('isExactModeStep selects exact mode for 0.1 and coarser', () => {
  for (const stepText of ['10', '5', '1', '0.5', '0.1']) {
    const { scale, stepUnits } = parseAngleStep(stepText);
    assert.equal(isExactModeStep(scale, stepUnits), true, `expected step ${stepText} to select exact mode`);
  }
});

test('isExactModeStep selects adaptive mode below 0.1', () => {
  for (const stepText of ['0.09', '0.01', '0.001', '0.0000003']) {
    const { scale, stepUnits } = parseAngleStep(stepText);
    assert.equal(isExactModeStep(scale, stepUnits), false, `expected step ${stepText} to select adaptive mode`);
  }
});

test('isExactModeStep compares exactly at the 0.1 boundary regardless of decimal representation', () => {
  // "0.10" and "0.1" must compare exactly equal to the threshold despite
  // having different scale/stepUnits representations (scale 2/10n vs scale
  // 1/1n) — this is exactly the case a naive floating-point >= 0.1 compare
  // could get wrong.
  const a = parseAngleStep('0.1');
  const b = parseAngleStep('0.10');
  assert.equal(isExactModeStep(a.scale, a.stepUnits), true);
  assert.equal(isExactModeStep(b.scale, b.stepUnits), true);
});
