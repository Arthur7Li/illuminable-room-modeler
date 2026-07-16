import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAngleRegion } from '../src/anglePlot/generateAngleRegion.js';
import { OBTUSE_THIRD_ANGLE_LIMIT_DEGREES, ANGLE_EPSILON_DEGREES } from '../src/anglePlot/angleValidation.js';

const acceptAll = () => ({ allowed: true });

test('generateAngleRegion only returns points satisfying A < B and A + B <= 90', async () => {
  const { promise } = generateAngleRegion({ validateCandidate: acceptAll, baseLength: 10 });
  const points = await promise;

  assert.ok(points.length > 0, 'expected at least some valid points with an always-accepting validator');
  for (const { a, b } of points) {
    assert.ok(a < b, `expected A < B, got A=${a} B=${b}`);
    assert.ok(a + b <= OBTUSE_THIRD_ANGLE_LIMIT_DEGREES + ANGLE_EPSILON_DEGREES, `expected A+B <= 90, got A=${a} B=${b} sum=${a + b}`);
    assert.ok(a > 0 && b > 0, `expected strictly positive angles, got A=${a} B=${b}`);
  }
});

test('generateAngleRegion never produces duplicate (A, B) points', async () => {
  const { promise } = generateAngleRegion({ validateCandidate: acceptAll, baseLength: 10 });
  const points = await promise;
  const seen = new Set(points.map((p) => `${p.a}_${p.b}`));
  assert.equal(seen.size, points.length);
});

test('generateAngleRegion respects rejections from the injected app validator', async () => {
  // Simulate the main program only accepting a small window around a
  // "currently selected" pair, the way the real Constrained-mode tower
  // validation only accepts nearby perturbations of the committed shot.
  const windowValidator = ({ a, b }) => ({ allowed: a >= 10 && a <= 12 && b >= 40 && b <= 42 });
  const { promise } = generateAngleRegion({ validateCandidate: windowValidator, baseLength: 10 });
  const points = await promise;

  assert.ok(points.length > 0, 'expected some points inside the allowed window');
  for (const { a, b } of points) {
    assert.ok(a >= 10 && a <= 12, `A=${a} escaped the injected validator's window`);
    assert.ok(b >= 40 && b <= 42, `B=${b} escaped the injected validator's window`);
  }
});

test('generateAngleRegion reports progress and a final done event', async () => {
  const events = [];
  const { promise } = generateAngleRegion({
    validateCandidate: acceptAll,
    baseLength: 10,
    onProgress: (p) => events.push(p),
  });
  const points = await promise;

  assert.ok(events.length > 0, 'expected at least one progress event');
  const last = events[events.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.cancelled, false);
  assert.equal(last.found, points.length);
  assert.equal(last.tested, last.total);
});

test('generateAngleRegion stops promptly when cancelled and reports cancelled:true', async () => {
  const events = [];
  const { promise, cancel } = generateAngleRegion({
    validateCandidate: acceptAll,
    baseLength: 10,
    onProgress: (p) => events.push(p),
  });
  // The sweep runs synchronously up to its first internal yield point
  // before this line executes, so cancelling here reliably stops it after
  // only the first chunk rather than the full sweep.
  cancel();
  await promise;

  const last = events[events.length - 1];
  assert.equal(last.done, true);
  assert.equal(last.cancelled, true);
  assert.ok(last.tested < last.total, 'expected the sweep to stop well before testing every candidate');
});
