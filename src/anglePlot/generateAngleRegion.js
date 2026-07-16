// AngleRegionGenerator equivalent: enumerates every (A, B) grid point that
// passes isValidAnglePair, without freezing the caller's JS thread.
//
// Full-range sweep vs. BFS from the current pair
// ------------------------------------------------
// The task description offers two strategies: enumerate the whole permitted
// range, or breadth-first search outward from the currently selected A/B.
// This project's existing candidate check (`validateLockedAngleCandidate` in
// App.jsx, threaded through here as `validateCandidate`) evaluates each
// candidate independently against a *fixed* reference (the currently
// committed code path) — it does not depend on the previous point visited,
// so there is no adjacency/history requirement that would force a BFS walk.
// The permitted range is also small (A, B bounded to roughly a 0-90 degree
// triangle, ~2*10^5 grid points at 0.1 degree spacing), which is cheap for a
// browser to sweep in chunks. A full sweep is therefore both correct
// (BFS could miss a disconnected valid pocket the current point isn't
// connected to) and simple, so that is what this module does.
//
// Not freezing the GUI
// ---------------------
// JavaScript in a browser tab is single-threaded — there is no direct
// equivalent of spinning up a Java worker thread without moving this whole
// validation pipeline (which reaches back into React state via the
// `validateCandidate` closure) into a Web Worker, which would require
// serializing that closure and is a much larger change than this feature
// needs. Instead, this generator time-slices the sweep: it runs a bounded
// chunk of candidate checks, then yields to the event loop with
// `setTimeout(0)` so the browser can paint and handle input before the next
// chunk runs. Because everything still executes on the one JS thread, GUI
// state is only ever touched from that same thread (via the `onProgress`
// callback, which the caller uses to drive React state) — there is no
// separate thread that could touch it from elsewhere.

import { isValidAnglePair, MIN_ANGLE_TENTHS, OBTUSE_THIRD_ANGLE_LIMIT_DEGREES, degreesToTenths, tenthsToDegrees } from './angleValidation.js';

// Number of candidate pairs tested per chunk before yielding to the event
// loop. Large enough to keep timer overhead low, small enough that a chunk
// finishes well within one animation frame.
const CANDIDATES_PER_CHUNK = 1500;

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Starts a cancellable, chunked sweep of the valid A/B grid.
 *
 * @param {object} options
 * @param {(candidate: {a:number,b:number,length:number}) => {allowed:boolean, reason?:string}} options.validateCandidate
 *   The app's existing constraint check, reused as-is (see module comment).
 * @param {number} options.baseLength - current base-triangle length, passed through to validateCandidate.
 * @param {(progress: {tested:number, total:number, found:number, done:boolean, cancelled:boolean}) => void} [options.onProgress]
 * @returns {{ promise: Promise<{a:number,b:number}[]>, cancel: () => void }}
 */
export const generateAngleRegion = ({ validateCandidate, baseLength, onProgress }) => {
  let cancelled = false;

  const limitTenths = degreesToTenths(OBTUSE_THIRD_ANGLE_LIMIT_DEGREES);
  // These loop bounds are a cheap optimization derived from the same
  // OBTUSE_THIRD_ANGLE_LIMIT_DEGREES constant used by isValidAnglePair —
  // they only skip pairs that can never satisfy A < B under that limit.
  // isValidAnglePair remains the single source of truth for the sum-limit
  // comparison itself, so changing <= to < there does not require touching
  // these bounds.
  const maxATenths = limitTenths - MIN_ANGLE_TENTHS - 1;
  let totalCandidates = 0;
  for (let aTenths = MIN_ANGLE_TENTHS; aTenths <= maxATenths; aTenths++) {
    const bMaxTenths = limitTenths - aTenths;
    totalCandidates += Math.max(0, bMaxTenths - aTenths);
  }

  const promise = (async () => {
    const points = [];
    let tested = 0;

    // Each (aTenths, bTenths) integer pair is visited by this nested loop
    // exactly once, so no dedupe/"seen" set is needed: duplicate points from
    // floating-point drift are structurally impossible here (this is the
    // whole reason the sweep walks integer tenths instead of stepping raw
    // degree floats by +0.1 repeatedly).
    outer: for (let aTenths = MIN_ANGLE_TENTHS; aTenths <= maxATenths; aTenths++) {
      const angleA = tenthsToDegrees(aTenths);
      const bMaxTenths = limitTenths - aTenths;
      for (let bTenths = aTenths + 1; bTenths <= bMaxTenths; bTenths++) {
        const angleB = tenthsToDegrees(bTenths);
        tested++;

        if (isValidAnglePair(angleA, angleB, { validateCandidate, baseLength })) {
          points.push({ a: angleA, b: angleB });
        }

        if (tested % CANDIDATES_PER_CHUNK === 0) {
          onProgress?.({ tested, total: totalCandidates, found: points.length, done: false, cancelled: false });
          await yieldToEventLoop();
          if (cancelled) break outer;
        }
      }
    }

    onProgress?.({ tested, total: totalCandidates, found: points.length, done: true, cancelled });
    return points;
  })();

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
};
