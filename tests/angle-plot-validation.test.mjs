import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidAnglePair,
  isWithinObtuseSumLimit,
  degreesToTenths,
  tenthsToDegrees,
  ANGLE_EPSILON_DEGREES,
  OBTUSE_THIRD_ANGLE_LIMIT_DEGREES,
} from '../src/anglePlot/angleValidation.js';

test('isValidAnglePair accepts a normal in-range pair with no app validator wired up', () => {
  assert.equal(isValidAnglePair(15, 50), true);
});

test('isValidAnglePair rejects A >= B', () => {
  assert.equal(isValidAnglePair(45, 45), false);
  assert.equal(isValidAnglePair(50, 45), false);
});

test('isValidAnglePair rejects sums over the obtuse limit', () => {
  assert.equal(isValidAnglePair(40, 51), false);
});

test('isValidAnglePair accepts a sum exactly at the obtuse limit', () => {
  assert.equal(isValidAnglePair(40, 50), true); // 40 + 50 === 90
});

test('isValidAnglePair rejects non-positive angles', () => {
  assert.equal(isValidAnglePair(0, 50), false);
  assert.equal(isValidAnglePair(-5, 50), false);
  assert.equal(isValidAnglePair(15, 0), false);
});

test('isValidAnglePair tolerates floating-point noise around the 90-degree sum boundary', () => {
  // Mirrors the "89.999999999" example from the task: a sum that lands a
  // hair below 90 due to float representation must still read as valid.
  assert.equal(isWithinObtuseSumLimit(44.9, 45 - 1e-10), true);
  // A sum that is genuinely, meaningfully over 90 must still be rejected.
  assert.equal(isWithinObtuseSumLimit(45, 45.01), false);
  assert.ok(ANGLE_EPSILON_DEGREES < 0.01, 'epsilon must be small enough to not mask real violations');
});

test('isValidAnglePair defers to the injected validateCandidate for app-level rules', () => {
  const rejectEverything = () => ({ allowed: false, reason: 'stubbed rejection' });
  assert.equal(isValidAnglePair(15, 50, { validateCandidate: rejectEverything }), false);

  const acceptEverything = () => ({ allowed: true });
  assert.equal(isValidAnglePair(15, 50, { validateCandidate: acceptEverything }), true);

  // A pair that fails the cheap math constraints must never even reach the
  // (expensive, app-specific) validateCandidate callback.
  let called = false;
  const spy = () => { called = true; return { allowed: true }; };
  assert.equal(isValidAnglePair(50, 45, { validateCandidate: spy }), false);
  assert.equal(called, false, 'validateCandidate should not be called for pairs that already fail A < B');
});

test('validateCandidate receives the exact angle values and the supplied base length', () => {
  let received = null;
  const capture = (candidate) => { received = candidate; return { allowed: true }; };
  isValidAnglePair(12.3, 60.4, { validateCandidate: capture, baseLength: 10 });
  assert.deepEqual(received, { a: 12.3, b: 60.4, length: 10 });
});

test('degreesToTenths/tenthsToDegrees round-trip exactly on the 0.1-degree grid', () => {
  for (const degrees of [0.1, 15, 44.9, 45.1, 89.9]) {
    const tenths = degreesToTenths(degrees);
    assert.equal(Number.isInteger(tenths), true);
    assert.equal(tenthsToDegrees(tenths), degrees);
  }
});

test('OBTUSE_THIRD_ANGLE_LIMIT_DEGREES is the single named place governing <=90 vs <90', () => {
  // This is a documentation-style regression test: it pins the constant's
  // current value and the "<=" behavior so a future change to "< 90" (see
  // the comment above isWithinObtuseSumLimit in angleValidation.js) is a
  // deliberate, visible change to this test rather than a silent drift.
  assert.equal(OBTUSE_THIRD_ANGLE_LIMIT_DEGREES, 90);
  assert.equal(isWithinObtuseSumLimit(45, 45), true); // sum === 90 currently allowed
});
