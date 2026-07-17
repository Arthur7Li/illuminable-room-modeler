// VisibleAnglePointGenerator: the adaptive, zoom-aware counterpart to
// generateAngleRegion.js's exact full/bounded sweep, used only when the
// user's Angle Step is below EXACT_MODE_STEP_THRESHOLD (angleStep.js) — see
// AnglePlotWindow.jsx for the exact/adaptive mode switch.
//
// Where generateAngleRegion.js tests every single point on the user's exact
// Angle Step grid inside a region, this module walks a *coarser* grid (an
// exact whole-number stride over that grid — see renderSamplingPolicy.js's
// calculateSamplingStride) and, for each coarse cell, searches a small,
// deterministic, capped set of the user's real grid points near that cell's
// center for one that is actually valid (see findValidPointInCell). This is
// what keeps "zoom out to look at a 0.0000003-degree Angle Step" from ever
// requiring billions of validateCandidate calls: the number of *cells*
// checked is capped (MAX_VISIBLE_SAMPLE_CELLS), and each cell only tests up
// to MAX_CANDIDATES_PER_CELL real grid points before giving up on that cell.
//
// Determinism: the per-cell search order is a fixed expanding Chebyshev
// ring (center, then ring 1, ring 2, ...), so the same viewport/step/
// constraints always produce the same rendered points.
//
// Validity: every returned point is a real point that passed
// isValidAnglePair (the same check generateAngleRegion.js uses) on the
// user's exact grid. The cell-search never invents or interpolates a point
// — it only decides *where to look* for a real one.

import { isValidAnglePair, ANGLE_EPSILON_DEGREES } from './angleValidation.js';
import { computeSweepRange } from './angleStep.js';
import {
  MAX_CANDIDATES_PER_CELL, MAX_VISIBLE_RENDER_POINTS, VIEW_PRELOAD_MARGIN_STEPS, POINT_DEDUP_PIXEL_SPACING,
  DEBUG_ADAPTIVE_RENDERING, calculateSamplingStride, isWithinRenderCell,
} from './renderSamplingPolicy.js';

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
const CELL_TIME_BUDGET_MS = 12;
const MIN_CELLS_PER_CHUNK = 50;
const MAX_CELLS_PER_CHUNK = 4000;

/**
 * Deterministic, capped, Chebyshev-ring search for a valid point near a
 * coarse cell's center, tested only on the user's exact Angle Step grid.
 * Returns { point: {a,b}, tested } with point === null if nothing valid
 * was found within the candidate cap.
 */
export const findValidPointInCell = ({
  centerAUnits, centerBUnits, userStepUnits, unitToDegrees, ringLimit,
  validateCandidate, baseLength, epsilon, domainLimitUnits,
}) => {
  let tested = 0;
  for (let r = 0; r <= ringLimit; r++) {
    for (let ddA = -r; ddA <= r; ddA++) {
      for (let ddB = -r; ddB <= r; ddB++) {
        if (Math.max(Math.abs(ddA), Math.abs(ddB)) !== r) continue; // only the new ring, not cells already tested at a smaller r
        if (tested >= MAX_CANDIDATES_PER_CELL) return { point: null, tested };
        tested++;
        const aUnits = centerAUnits + BigInt(ddA) * userStepUnits;
        const bUnits = centerBUnits + BigInt(ddB) * userStepUnits;
        if (aUnits <= 0n || bUnits <= 0n || aUnits + bUnits > domainLimitUnits) continue;
        const angleA = Number(aUnits) / unitToDegrees;
        const angleB = Number(bUnits) / unitToDegrees;
        if (isValidAnglePair(angleA, angleB, { validateCandidate, baseLength, epsilon })) {
          return { point: { a: angleA, b: angleB }, tested };
        }
      }
    }
  }
  return { point: null, tested };
};

/**
 * Screen-space deduplication using the Chebyshev/square test above: keeps
 * at most one point per (cellSizeA x cellSizeB) world-space cell, checking
 * the 3x3 neighborhood of spatial-hash buckets so points that land just
 * across a bucket boundary are still caught.
 */
export const dedupPointsByCell = (points, cellSizeA, cellSizeB) => {
  if (points.length === 0) return points;
  const halfA = cellSizeA / 2;
  const halfB = cellSizeB / 2;
  const buckets = new Map();
  const kept = [];
  for (const p of points) {
    const bx = Math.floor(p.a / cellSizeA);
    const by = Math.floor(p.b / cellSizeB);
    let collided = false;
    for (let dx = -1; dx <= 1 && !collided; dx++) {
      for (let dy = -1; dy <= 1 && !collided; dy++) {
        const existing = buckets.get(`${bx + dx}:${by + dy}`);
        if (existing && isWithinRenderCell(p.a, p.b, existing.a, existing.b, halfA, halfB)) {
          collided = true;
        }
      }
    }
    if (!collided) {
      buckets.set(`${bx}:${by}`, p);
      kept.push(p);
    }
  }
  return kept;
};

/**
 * Starts a cancellable, chunked, adaptive sweep: only the (margin-padded)
 * visible region is considered, sampled at a zoom-derived stride over the
 * user's exact Angle Step grid (see renderSamplingPolicy.js).
 *
 * @param {object} options
 * @param {(candidate: {a:number,b:number,length:number}) => {allowed:boolean}} options.validateCandidate
 * @param {number} options.baseLength
 * @param {number} options.scale - decimal places in the user's Angle Step (from parseAngleStep).
 * @param {bigint} options.stepUnits - the user's exact Angle Step, as an integer at `scale`.
 * @param {{minA:number,maxA:number,minB:number,maxB:number}} options.viewBounds - current visible world bounds (no margin applied yet).
 * @param {{width:number,height:number}} options.viewportSize
 * @param {number} options.zoomLevel - diagnostic-only (DEBUG_ADAPTIVE_RENDERING logging); does not affect stride selection, since viewBounds/viewportSize already fully determine it (see calculateSamplingStride's own comment).
 * @param {{a:number,b:number}} [options.excludePoint] - typically the current orange A/B pair; suppressed from the blue point list so the two markers never coincide.
 * @param {(progress: {cellsChecked:number, found:number, done:boolean, cancelled:boolean}) => void} [options.onProgress]
 * @returns {{ promise: Promise<{points:{a:number,b:number}[], effectiveStepDegrees:number, stride:number, budgetLimited:boolean, cellsChecked:number, candidatesTested:number, durationMs:number}>, cancel: () => void }}
 */
export const generateVisibleAnglePoints = ({
  validateCandidate, baseLength, scale, stepUnits: userStepUnits, viewBounds, viewportSize, zoomLevel, excludePoint, onProgress,
}) => {
  let cancelled = false;
  const unitToDegrees = 10 ** scale;
  const userStepDegrees = Number(userStepUnits) / unitToDegrees;
  const epsilon = Math.min(ANGLE_EPSILON_DEGREES, userStepDegrees / 1000);

  const { stride, desiredStride, budgetLimited } = calculateSamplingStride({
    userStepDegrees, visibleWorldBounds: viewBounds, viewportSize,
  });
  const effectiveStepUnits = userStepUnits * BigInt(stride);
  const effectiveStepDegrees = Number(effectiveStepUnits) / unitToDegrees;
  const requestedStepDegrees = userStepDegrees * desiredStride;

  const marginDegrees = VIEW_PRELOAD_MARGIN_STEPS * effectiveStepDegrees;
  const paddedBounds = {
    minA: Math.max(0, viewBounds.minA - marginDegrees),
    maxA: Math.min(90, viewBounds.maxA + marginDegrees),
    minB: Math.max(0, viewBounds.minB - marginDegrees),
    maxB: Math.min(90, viewBounds.maxB + marginDegrees),
  };

  const { limitUnits, startAUnits, endAUnits, minBUnits, maxBUnitsCap } = computeSweepRange(scale, effectiveStepUnits, paddedBounds);

  // How far (in the user's exact grid units) the per-cell search is allowed
  // to range from a coarse cell's center — roughly half the coarse cell, so
  // neighboring cells' searches don't redundantly cover the same ground.
  // At stride 1 this still searches ring 1 (the immediate 8 neighbors),
  // which is harmless overlap with neighboring cells' own searches, not a
  // correctness issue — it just makes single-precision cells extra robust.
  const ringLimit = Math.max(1, Math.min(6, Math.round(stride / 2)));

  const dedupCellA = POINT_DEDUP_PIXEL_SPACING / Math.max(viewportSize.width, 1) * (viewBounds.maxA - viewBounds.minA || 1);
  const dedupCellB = POINT_DEDUP_PIXEL_SPACING / Math.max(viewportSize.height, 1) * (viewBounds.maxB - viewBounds.minB || 1);

  const promise = (async () => {
    const startedAt = performance.now();
    const points = [];
    let cellsChecked = 0;
    let candidatesTested = 0;
    let chunkTarget = MIN_CELLS_PER_CHUNK;
    let sinceYield = 0;
    let chunkStart = performance.now();

    outer: for (let aUnits = startAUnits; aUnits <= endAUnits; aUnits += effectiveStepUnits) {
      const domainBMaxUnits = limitUnits - aUnits;
      const bMaxUnits = maxBUnitsCap !== null && maxBUnitsCap < domainBMaxUnits ? maxBUnitsCap : domainBMaxUnits;
      const bMinCandidateUnits = aUnits + effectiveStepUnits;
      const bStartUnits = minBUnits !== null && minBUnits > bMinCandidateUnits ? minBUnits : bMinCandidateUnits;

      for (let bUnits = bStartUnits; bUnits <= bMaxUnits; bUnits += effectiveStepUnits) {
        cellsChecked++;
        sinceYield++;
        const { point, tested } = findValidPointInCell({
          centerAUnits: aUnits, centerBUnits: bUnits, userStepUnits, unitToDegrees, ringLimit,
          validateCandidate, baseLength, epsilon, domainLimitUnits: limitUnits,
        });
        candidatesTested += tested;
        if (point) points.push(point);

        if (sinceYield >= chunkTarget) {
          const elapsedMs = performance.now() - chunkStart;
          onProgress?.({ cellsChecked, found: points.length, done: false, cancelled: false });
          await yieldToEventLoop();
          if (cancelled) break outer;
          if (elapsedMs > 0) {
            const rescaled = Math.round(chunkTarget * (CELL_TIME_BUDGET_MS / elapsedMs));
            chunkTarget = Math.min(MAX_CELLS_PER_CHUNK, Math.max(MIN_CELLS_PER_CHUNK, rescaled));
          }
          sinceYield = 0;
          chunkStart = performance.now();
        }
      }
    }

    let result = dedupPointsByCell(points, dedupCellA, dedupCellB);
    // Independent of the cell budget above: if an unusually large fraction
    // of checked cells turned out valid (e.g. zoomed into the interior of a
    // large valid region), the found-point count could still exceed
    // MAX_VISIBLE_RENDER_POINTS. One extra, larger-celled dedup pass brings
    // it back under budget without an unbounded loop.
    if (result.length > MAX_VISIBLE_RENDER_POINTS) {
      const scaleFactor = Math.sqrt(result.length / MAX_VISIBLE_RENDER_POINTS);
      result = dedupPointsByCell(result, dedupCellA * scaleFactor, dedupCellB * scaleFactor);
    }

    if (excludePoint) {
      const halfA = dedupCellA / 2;
      const halfB = dedupCellB / 2;
      result = result.filter((p) => !isWithinRenderCell(p.a, p.b, excludePoint.a, excludePoint.b, halfA, halfB));
    }

    const durationMs = performance.now() - startedAt;
    if (DEBUG_ADAPTIVE_RENDERING) {
      // eslint-disable-next-line no-console
      console.log('[AdaptiveRender]', {
        zoomLevel, effectiveStepDegrees, requestedStepDegrees, stride, desiredStride, budgetLimited,
        viewportSize, cellsChecked, candidatesTested, pointsDrawn: result.length, durationMs: Math.round(durationMs), cancelled,
      });
    }

    onProgress?.({ cellsChecked, found: result.length, done: true, cancelled });
    return {
      points: result, effectiveStepDegrees, requestedStepDegrees, stride, budgetLimited,
      cellsChecked, candidatesTested, durationMs,
    };
  })();

  return { promise, cancel: () => { cancelled = true; } };
};
