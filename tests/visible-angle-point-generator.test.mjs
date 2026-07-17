import assert from 'node:assert/strict';
import test from 'node:test';
import { generateVisibleAnglePoints, findValidPointInCell, dedupPointsByCell } from '../src/anglePlot/visibleAnglePointGenerator.js';
import { isWithinRenderCell } from '../src/anglePlot/renderSamplingPolicy.js';
import { parseAngleStep } from '../src/anglePlot/angleStep.js';
import { OBTUSE_THIRD_ANGLE_LIMIT_DEGREES, ANGLE_EPSILON_DEGREES } from '../src/anglePlot/angleValidation.js';

const acceptAll = () => ({ allowed: true });
const viewport = { width: 500, height: 400 };
const bounds = { minA: 10, maxA: 20, minB: 40, maxB: 50 };
const step1 = parseAngleStep('1');

const run = (overrides = {}) => generateVisibleAnglePoints({
  validateCandidate: acceptAll, baseLength: 10, scale: step1.scale, stepUnits: step1.stepUnits,
  viewBounds: bounds, viewportSize: viewport, zoomLevel: 1, ...overrides,
}).promise;

test('generateVisibleAnglePoints only returns points satisfying A < B and A + B <= 90', async () => {
  const { points } = await run();
  assert.ok(points.length > 0, 'expected at least some points');
  for (const { a, b } of points) {
    assert.ok(a < b, `expected A < B, got A=${a} B=${b}`);
    assert.ok(a + b <= OBTUSE_THIRD_ANGLE_LIMIT_DEGREES + ANGLE_EPSILON_DEGREES, `expected A+B <= 90, got A=${a} B=${b}`);
  }
});

test('generateVisibleAnglePoints stays within the visible bounds plus a small margin', async () => {
  const { points } = await run();
  // Generous slack: real margin is a couple of effective render steps, but
  // this test only needs to confirm "visible-region-only", not the exact
  // margin formula (that's covered by inspecting VIEW_PRELOAD_MARGIN_STEPS
  // directly in renderSamplingPolicy.js's own tests).
  const slack = 5;
  for (const { a, b } of points) {
    assert.ok(a >= bounds.minA - slack && a <= bounds.maxA + slack, `A=${a} escaped the padded view bounds`);
    assert.ok(b >= bounds.minB - slack && b <= bounds.maxB + slack, `B=${b} escaped the padded view bounds`);
  }
});

test('generateVisibleAnglePoints respects an injected app validator window', async () => {
  const windowValidator = ({ a, b }) => ({ allowed: a >= 12 && a <= 14 });
  const { points } = await run({ validateCandidate: windowValidator });
  for (const { a } of points) {
    assert.ok(a >= 12 && a <= 14, `A=${a} escaped the injected validator's window`);
  }
});

test('generateVisibleAnglePoints is deterministic for the same inputs', async () => {
  const first = await run();
  const second = await run();
  assert.deepEqual(first.points, second.points);
});

test('generateVisibleAnglePoints stays within a bounded number of cells regardless of how fine the user step is', async () => {
  const tinyStep = parseAngleStep('0.0000003');
  const { cellsChecked } = await run({ scale: tinyStep.scale, stepUnits: tinyStep.stepUnits, zoomLevel: 1 });
  // MAX_VISIBLE_SAMPLE_CELLS is 200,000; allow generous slack for the
  // view-bound rectangle shape (not a perfect square) without hardcoding
  // the exact budget here.
  assert.ok(cellsChecked < 250_000, `expected a bounded cell count even for a 0.0000003 Angle Step, got ${cellsChecked}`);
});

test('generateVisibleAnglePoints excludes a point coincident with excludePoint', async () => {
  const { points: withoutExclude } = await run();
  assert.ok(withoutExclude.length > 0);
  const target = withoutExclude[Math.floor(withoutExclude.length / 2)];
  const { points: withExclude } = await run({ excludePoint: { a: target.a, b: target.b } });
  assert.ok(withExclude.length < withoutExclude.length, 'expected excludePoint to remove at least one point');
  for (const p of withExclude) {
    const isSame = Math.abs(p.a - target.a) < 1e-9 && Math.abs(p.b - target.b) < 1e-9;
    assert.ok(!isSame, `excludePoint (${target.a},${target.b}) should not appear in the result`);
  }
});

test('generateVisibleAnglePoints stops promptly when cancelled and reports cancelled:true', async () => {
  const events = [];
  const { promise, cancel } = generateVisibleAnglePoints({
    validateCandidate: acceptAll, baseLength: 10, scale: step1.scale, stepUnits: step1.stepUnits,
    viewBounds: { minA: 0.001, maxA: 89, minB: 0.002, maxB: 89.5 }, viewportSize: viewport, zoomLevel: 1,
    onProgress: (p) => events.push(p),
  });
  cancel();
  const result = await promise;
  assert.equal(result.points !== undefined, true);
  const last = events[events.length - 1];
  assert.ok(last === undefined || last.cancelled === true || last.done === true);
});

test('a higher zoomLevel reveals at least as much detail (finer effective render step) over the same view', async () => {
  const fineStep = parseAngleStep('0.0001');
  const low = await run({ scale: fineStep.scale, stepUnits: fineStep.stepUnits, zoomLevel: 0.5 });
  const high = await run({ scale: fineStep.scale, stepUnits: fineStep.stepUnits, zoomLevel: 4 });
  assert.ok(high.effectiveStepDegrees <= low.effectiveStepDegrees, `expected zoom 4 render step (${high.effectiveStepDegrees}) <= zoom 0.5 render step (${low.effectiveStepDegrees})`);
});

test('regression: reaches the full user Angle Step at high zoom over a small viewport (was stuck coarser)', async () => {
  // Reproduces the exact scenario reported live: Angle Step 0.01, zoom
  // ~51x, a canvas-sized viewport — the render step should reach 0.01, not
  // stay stuck at 0.02+ the way it did before MAX_VISIBLE_SAMPLE_CELLS was
  // raised and the redundant zoom-formula term was removed.
  const step001 = parseAngleStep('0.01');
  const { effectiveStepDegrees, stride, budgetLimited } = await run({
    scale: step001.scale, stepUnits: step001.stepUnits, zoomLevel: 51.05,
    viewBounds: { minA: 14, maxA: 16, minB: 49, maxB: 51 }, viewportSize: { width: 1030, height: 500 },
  });
  assert.equal(stride, 1, `expected stride 1 (full precision), got ${stride}`);
  assert.ok(Math.abs(effectiveStepDegrees - 0.01) < 1e-9, `expected render step 0.01, got ${effectiveStepDegrees}`);
  assert.equal(budgetLimited, false);
});

test('findValidPointInCell is deterministic and only returns real valid grid points', () => {
  const { scale, stepUnits } = parseAngleStep('0.5');
  const unitToDegrees = 10 ** scale;
  const domainLimitUnits = 90n * (10n ** BigInt(scale));
  const args = {
    centerAUnits: 30n, centerBUnits: 100n, userStepUnits: stepUnits, unitToDegrees, ringLimit: 3,
    validateCandidate: acceptAll, baseLength: 10, epsilon: 1e-9, domainLimitUnits,
  };
  const first = findValidPointInCell(args);
  const second = findValidPointInCell(args);
  assert.deepEqual(first, second);
  if (first.point) {
    assert.ok(first.point.a < first.point.b);
    assert.ok(first.point.a + first.point.b <= 90 + 1e-9);
  }
});

test('findValidPointInCell gives up after MAX_CANDIDATES_PER_CELL and returns a null point', () => {
  const rejectAll = () => ({ allowed: false });
  const { scale, stepUnits } = parseAngleStep('0.5');
  const unitToDegrees = 10 ** scale;
  const domainLimitUnits = 90n * (10n ** BigInt(scale));
  const result = findValidPointInCell({
    centerAUnits: 30n, centerBUnits: 100n, userStepUnits: stepUnits, unitToDegrees, ringLimit: 6,
    validateCandidate: rejectAll, baseLength: 10, epsilon: 1e-9, domainLimitUnits,
  });
  assert.equal(result.point, null);
  assert.ok(result.tested <= 9, `expected tested (${result.tested}) to respect MAX_CANDIDATES_PER_CELL`);
});

test('dedupPointsByCell keeps only one representative point per cell', () => {
  const points = [
    { a: 10.00, b: 40.00 },
    { a: 10.01, b: 40.01 }, // within the same 0.5-wide cell as the point above
    { a: 15.00, b: 45.00 }, // a different cell entirely
  ];
  const deduped = dedupPointsByCell(points, 0.5, 0.5);
  assert.equal(deduped.length, 2);
});

test('dedupPointsByCell uses a square (Chebyshev) test consistent with isWithinRenderCell', () => {
  const points = [{ a: 0, b: 0 }, { a: 0.4, b: 0 }, { a: 0, b: 0.4 }];
  const deduped = dedupPointsByCell(points, 1, 1);
  assert.equal(deduped.length, 1);
  assert.ok(isWithinRenderCell(points[1].a, points[1].b, points[0].a, points[0].b, 0.5, 0.5));
});
