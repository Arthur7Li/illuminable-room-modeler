import { useEffect, useRef, useState, useCallback } from 'react';
import { X, RotateCcw, RefreshCw, Loader2, GripHorizontal, ZoomIn, ZoomOut, Maximize, Lock, Unlock, AlertTriangle } from 'lucide-react';
import AnglePlotPanel from './AnglePlotPanel.jsx';
import { generateAngleRegion } from './generateAngleRegion.js';
import { generateVisibleAnglePoints } from './visibleAnglePointGenerator.js';
import { parseAngleStep, displayScaleForStep, isExactModeStep, estimateAngleGridIterations, MAX_ANGLE_GRID_ITERATIONS } from './angleStep.js';
import { RENDER_DEBOUNCE_MS } from './renderSamplingPolicy.js';
import { formatAngleDegrees } from './AnglePair.js';

// AnglePlotWindow: the pop-up "Valid Angle A-B Region" graph. This project
// is a browser React app, not a desktop toolkit, so there is no native OS
// window to reuse — the closest equivalent that still satisfies "drag by a
// title bar", "resize", and "does not block the rest of the program" is a
// non-modal, absolutely-positioned panel with its own draggable title bar
// and a manual resize grip, which is what this component implements.
//
// "Fix" button semantics
// -----------------------
// The main app already has an unrelated "Fix" button (App.jsx's
// isZoomLocked) that only disables mouse-wheel zoom on the *main triangle
// canvas*. This is a separate, independently-scoped lock for *this* plot
// window's own view, and — per this feature's spec — is intentionally more
// complete: while locked it disables wheel-zoom, drag-to-pan, and the Zoom
// In/Zoom Out/Fit buttons all together, not just the wheel. The two don't
// interact or share state; they just happen to share a name because they
// serve the same purpose ("stop the view from moving") in two different
// views.
//
// Exact vs. adaptive rendering
// ------------------------------
// Two generation strategies, switched automatically on the user's Angle
// Step (see isExactModeStep / EXACT_MODE_STEP_THRESHOLD in angleStep.js):
//
// - Exact mode (Angle Step >= 0.1): generateAngleRegion.js's full-domain
//   exact sweep. Generated once (mount, Angle Step/constraint change, or
//   explicit Refresh) and then reused as-is while the user zooms/pans —
//   zoom and pan never trigger regeneration in this mode, matching "the
//   mathematical dataset does not change just because the viewport did".
//   Guarded by the same MAX_ANGLE_GRID_ITERATIONS safety dialog the
//   original brute-force version of this feature used.
//
// - Adaptive mode (Angle Step < 0.1): visibleAnglePointGenerator.js's
//   visible-region, zoom-scaled cell sampling. Regenerates (debounced,
//   RENDER_DEBOUNCE_MS) on every zoom/pan/resize/Angle-Step/constraint
//   change, since what's tractable to compute depends on what's on screen.
//
// Both paths funnel through the same requestId/task-cancellation guard
// below so a slow superseded render can never overwrite a newer one, and
// both report into the same `points`/`status`/`progress`/`renderInfo`
// state so AnglePlotPanel and the status line don't need to know which
// mode produced what they're displaying.

const DEFAULT_SIZE = { width: 640, height: 480 };
const MIN_SIZE = { width: 380, height: 320 };

export default function AnglePlotWindow({ angleParams, baseLength, validateCandidate, refreshToken, onClose, theme, angleStepInput }) {
  const [pos, setPos] = useState({ x: 96, y: 72 });
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragOffset = useRef(null);
  const resizeStart = useRef(null);

  const [points, setPoints] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done | cancelled
  const [progress, setProgress] = useState({ mode: 'adaptive', cellsChecked: 0, found: 0 });
  const [stepError, setStepError] = useState(null);
  const [isViewLocked, setIsViewLocked] = useState(false);
  const [pendingLargeExactSweep, setPendingLargeExactSweep] = useState(null); // { scale, stepUnits, stepDegrees, estimatedIterations } | null
  // { mode, zoomLevel?, userStepDegrees, gridStepDegrees, requestedStepDegrees?, pointCount, durationMs, budgetLimited } | null
  const [renderInfo, setRenderInfo] = useState(null);
  const taskRef = useRef(null);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const lastViewStateRef = useRef(null); // { bounds, zoomLevel, viewportSize } | null, most recent view AnglePlotPanel reported
  const panelRef = useRef(null);

  const currentPoint = { a: Number(angleParams.a), b: Number(angleParams.b) };
  // Falls back to whole-degree display (matches the historical 0.1-step
  // behavior's precision) if a render hasn't successfully validated a step yet.
  const [displayScale, setDisplayScale] = useState(1);

  // Cheap to recompute per render (string parse + BigInt construction, no
  // generation work) — used to drive AnglePlotPanel's Angle-Step-aware zoom
  // cap immediately as the user types, without waiting for a render to finish.
  const liveParsedStep = parseAngleStep(angleStepInput);

  const startExactSweep = useCallback((parsed) => {
    taskRef.current?.cancel();
    const requestId = ++requestIdRef.current;
    setStatus('running');
    setProgress({ mode: 'exact', tested: 0, total: 0, found: 0 });
    setDisplayScale(displayScaleForStep(parsed.scale));
    const startedAt = performance.now();
    const task = generateAngleRegion({
      validateCandidate, baseLength, scale: parsed.scale, stepUnits: parsed.stepUnits,
      onProgress: (p) => {
        if (requestIdRef.current !== requestId) return;
        setProgress({ mode: 'exact', ...p });
        if (p.done) setStatus(p.cancelled ? 'cancelled' : 'done');
      },
    });
    taskRef.current = task;
    task.promise.then((resultPoints) => {
      if (requestIdRef.current !== requestId) return;
      setPoints(resultPoints);
      setRenderInfo({
        mode: 'exact', userStepDegrees: parsed.stepDegrees, gridStepDegrees: parsed.stepDegrees,
        displayScale: displayScaleForStep(parsed.scale),
        pointCount: resultPoints.length, durationMs: performance.now() - startedAt, budgetLimited: false,
      });
    });
  }, [validateCandidate, baseLength]);

  const runExactRender = useCallback((parsed) => {
    setPendingLargeExactSweep(null);
    const estimatedIterations = estimateAngleGridIterations(parsed.scale, parsed.stepUnits, undefined);
    if (estimatedIterations > BigInt(MAX_ANGLE_GRID_ITERATIONS)) {
      setPendingLargeExactSweep({ ...parsed, estimatedIterations });
      setStatus('idle');
      return;
    }
    startExactSweep(parsed);
  }, [startExactSweep]);

  const confirmLargeExactSweep = () => {
    if (!pendingLargeExactSweep) return;
    const { estimatedIterations, ...parsed } = pendingLargeExactSweep;
    setPendingLargeExactSweep(null);
    startExactSweep(parsed);
  };

  const runAdaptiveRender = useCallback((parsed, viewState) => {
    if (!viewState) return; // AnglePlotPanel hasn't reported a view yet
    taskRef.current?.cancel();
    const requestId = ++requestIdRef.current;
    setStatus('running');
    setProgress({ mode: 'adaptive', cellsChecked: 0, found: 0 });
    setDisplayScale(displayScaleForStep(parsed.scale));
    const startedAt = performance.now();
    const task = generateVisibleAnglePoints({
      validateCandidate, baseLength, scale: parsed.scale, stepUnits: parsed.stepUnits,
      viewBounds: viewState.bounds, viewportSize: viewState.viewportSize, zoomLevel: viewState.zoomLevel,
      excludePoint: currentPoint,
      onProgress: (p) => {
        if (requestIdRef.current !== requestId) return;
        setProgress({ mode: 'adaptive', ...p });
        if (p.done) setStatus(p.cancelled ? 'cancelled' : 'done');
      },
    });
    taskRef.current = task;
    task.promise.then((result) => {
      if (requestIdRef.current !== requestId) return;
      setPoints(result.points);
      setRenderInfo({
        mode: 'adaptive', zoomLevel: viewState.zoomLevel, userStepDegrees: parsed.stepDegrees,
        gridStepDegrees: result.effectiveStepDegrees, requestedStepDegrees: result.requestedStepDegrees,
        displayScale: displayScaleForStep(parsed.scale),
        pointCount: result.points.length, durationMs: performance.now() - startedAt,
        budgetLimited: result.budgetLimited, timeLimited: result.timeLimited,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateCandidate, baseLength, currentPoint.a, currentPoint.b]);

  // Top-level dispatcher: validates the Angle Step and routes to whichever
  // mode it selects. Exact mode ignores `viewState` entirely (full domain,
  // reused across the viewport); adaptive mode requires one to have been
  // reported by AnglePlotPanel yet (silently no-ops otherwise — it will be
  // called again as soon as that first report arrives).
  const runRender = useCallback((viewState) => {
    setStepError(null);
    const parsed = parseAngleStep(angleStepInput);
    if (!parsed.valid) {
      setStepError(parsed.error);
      return;
    }
    if (isExactModeStep(parsed.scale, parsed.stepUnits)) {
      runExactRender(parsed);
    } else {
      runAdaptiveRender(parsed, viewState);
    }
  }, [angleStepInput, runExactRender, runAdaptiveRender]);

  // Debounces the actual (expensive) render behind RENDER_DEBOUNCE_MS of
  // quiet time, so rapid wheel ticks / button clicks / drag movement / typed
  // digits collapse into a single render once things settle. `immediate`
  // skips the wait for the explicit Refresh button and the very first render
  // after opening the window, where waiting would just look like lag.
  const scheduleRender = useCallback((viewState, { immediate = false } = {}) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (immediate) {
      runRender(viewState);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        runRender(viewState);
      }, RENDER_DEBOUNCE_MS);
    }
  }, [runRender]);

  // AnglePlotPanel reports every zoom/pan/resize here, undebounced. In
  // adaptive mode that's routed into a debounced render, exactly as before.
  // In exact mode the dataset doesn't depend on the viewport at all, so the
  // view is still recorded (for the zoom cap and a future mode switch) but
  // does *not* trigger regeneration — AnglePlotPanel redraws the existing
  // exact dataset at the new zoom/pan on its own.
  const handleViewChange = useCallback((viewState) => {
    lastViewStateRef.current = viewState;
    const parsed = parseAngleStep(angleStepInput);
    if (parsed.valid && !isExactModeStep(parsed.scale, parsed.stepUnits)) {
      scheduleRender(viewState);
    }
  }, [angleStepInput, scheduleRender]);

  const runGeneration = useCallback(() => {
    scheduleRender(lastViewStateRef.current, { immediate: true });
  }, [scheduleRender]);

  // Regenerate whenever the parent asks for a fresh plot (Plot Valid Angle
  // Region button), once on mount, and whenever the Angle Step field itself
  // changes (debounced, so typing a new value doesn't fire a render per
  // keystroke, and so a mode switch at the 0.1 threshold settles once
  // typing pauses). The mount/refresh kickoff is deferred a tick so it runs
  // after AnglePlotPanel's own mount-time onViewChange call has populated
  // lastViewStateRef. Cancel in-flight work on unmount so a closed window
  // never calls setState after it stops existing.
  useEffect(() => {
    const timeoutId = setTimeout(() => scheduleRender(lastViewStateRef.current, { immediate: true }), 0);
    return () => {
      clearTimeout(timeoutId);
      taskRef.current?.cancel();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Skips the very first run (mount already triggers its own immediate
  // render above via the [refreshToken] effect) so opening the window
  // doesn't queue a redundant second, debounced render on top of it.
  const isFirstAngleStepRender = useRef(true);
  useEffect(() => {
    if (isFirstAngleStepRender.current) {
      isFirstAngleStepRender.current = false;
      return;
    }
    scheduleRender(lastViewStateRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angleStepInput]);

  // --- Title-bar drag -------------------------------------------------
  const handleTitleMouseDown = (e) => {
    if (e.button !== 0) return;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  useEffect(() => {
    const handleMove = (e) => {
      if (dragOffset.current) {
        setPos({
          x: Math.max(0, e.clientX - dragOffset.current.x),
          y: Math.max(0, e.clientY - dragOffset.current.y),
        });
      }
      if (resizeStart.current) {
        const { startX, startY, startWidth, startHeight } = resizeStart.current;
        setSize({
          width: Math.max(MIN_SIZE.width, startWidth + (e.clientX - startX)),
          height: Math.max(MIN_SIZE.height, startHeight + (e.clientY - startY)),
        });
      }
    };
    const handleUp = () => {
      dragOffset.current = null;
      resizeStart.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [pos]);

  // --- Corner resize ----------------------------------------------------
  const handleResizeMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    resizeStart.current = { startX: e.clientX, startY: e.clientY, startWidth: size.width, startHeight: size.height };
  };

  const viewButtonClass = "flex items-center gap-1.5 bg-[#101820]/95 hover:bg-[#172230] disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 px-2.5 py-1.5 rounded-md text-[11px] font-bold";

  // Status line: mode-aware, and deliberately built from the *last
  // completed* render's info (renderInfo), not the in-flight one, so it
  // doesn't flicker mid-render. See the module comment for why exact vs.
  // adaptive mode is chosen automatically from the Angle Step.
  let statusLine = null;
  let statusTitle = undefined;
  if (renderInfo) {
    // Uses renderInfo's own displayScale (captured alongside the step
    // values it renders, from displayScaleForStep(parsed.scale) at the
    // moment that render completed) rather than a hardcoded decimal count:
    // a fixed "6 decimals" rounds a step like 0.0000003 (7 decimals) to
    // "0°", silently losing the very precision this status line exists to
    // report.
    const scale = renderInfo.displayScale;
    if (renderInfo.mode === 'exact') {
      statusLine = `Exact · Step ${formatAngleDegrees(renderInfo.gridStepDegrees, scale)}° · ${renderInfo.pointCount.toLocaleString()} point${renderInfo.pointCount === 1 ? '' : 's'}`;
    } else {
      const budgetNote = renderInfo.budgetLimited ? ' · budget limited' : '';
      // timeLimited (MAX_ADAPTIVE_RENDER_MS) is the more serious of the two
      // caps: it means the render was cut off before covering its whole
      // budgeted area, so the result may be an incomplete partial view, not
      // just a coarser-than-ideal one — worth a visibly different label.
      const timeNote = renderInfo.timeLimited ? ' · stopped early (partial)' : '';
      statusLine = `Adaptive · Zoom ${renderInfo.zoomLevel.toFixed(2)}× · User step ${formatAngleDegrees(renderInfo.userStepDegrees, scale)}° · Render step ${formatAngleDegrees(renderInfo.gridStepDegrees, scale)}° · ${renderInfo.pointCount.toLocaleString()} point${renderInfo.pointCount === 1 ? '' : 's'}${budgetNote}${timeNote}`;
      statusTitle = renderInfo.timeLimited
        ? `Render was stopped after taking too long for this view and may not cover the whole visible area — try zooming in or panning to a smaller region.`
        : renderInfo.budgetLimited
        ? `Requested render step: ${formatAngleDegrees(renderInfo.requestedStepDegrees, scale)}° · Applied: ${formatAngleDegrees(renderInfo.gridStepDegrees, scale)}° · Reason: sample-cell budget exceeded for this view`
        : statusLine;
    }
  }
  const runningLabel = progress.mode === 'exact'
    ? `Exact · Testing… ${(progress.tested || 0).toLocaleString()} / ${(progress.total || 0).toLocaleString()}, ${(progress.found || 0).toLocaleString()} found`
    : `Adaptive · Testing… ${(progress.cellsChecked || 0).toLocaleString()} checked, ${(progress.found || 0).toLocaleString()} found`;

  return (
    <div
      className="fixed z-50 flex flex-col bg-[#10151c] border border-white/10 rounded-lg shadow-[0_20px_60px_rgba(0,0,0,0.55)] overflow-hidden select-none"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
    >
      {/* Title bar: the "normal title bar" this pop-up is dragged by. */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 bg-[#0c1117] border-b border-white/10 cursor-move shrink-0 select-none"
        onMouseDown={handleTitleMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <span className="text-xs font-bold text-slate-200 truncate">Valid Angle A&ndash;B Region</span>
        </div>
        <button type="button" onClick={onClose} title="Close" className="text-slate-500 hover:text-red-300 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={runGeneration}
          disabled={status === 'running'}
          title="Immediately regenerate using the current view and Angle Step, without waiting for the debounce delay."
          className="flex items-center gap-1.5 bg-[#101820]/95 hover:bg-[#172230] disabled:opacity-50 text-slate-200 px-2.5 py-1.5 rounded-md text-[11px] font-bold"
        >
          {status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Generate/Refresh Plot
        </button>
        <button type="button" onClick={() => panelRef.current?.zoomIn()} disabled={isViewLocked} className={viewButtonClass} title="Zoom in around the center of the current view.">
          <ZoomIn className="w-3.5 h-3.5" />
          Zoom In
        </button>
        <button type="button" onClick={() => panelRef.current?.zoomOut()} disabled={isViewLocked} className={viewButtonClass} title="Zoom out around the center of the current view.">
          <ZoomOut className="w-3.5 h-3.5" />
          Zoom Out
        </button>
        <button type="button" onClick={() => panelRef.current?.fitToPoints()} disabled={isViewLocked} className={viewButtonClass} title="Fit the view to every currently plotted point.">
          <Maximize className="w-3.5 h-3.5" />
          Fit
        </button>
        <button type="button" onClick={() => panelRef.current?.resetToDefaultView()} disabled={isViewLocked} className={viewButtonClass} title="Restore the original default view.">
          <RotateCcw className="w-3.5 h-3.5" />
          Reset View
        </button>
        <button
          type="button"
          onClick={() => setIsViewLocked((locked) => !locked)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold ${isViewLocked ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-200' : 'bg-[#101820]/95 hover:bg-[#172230] text-slate-200 border border-transparent'}`}
          aria-pressed={isViewLocked}
          title={isViewLocked ? 'View is locked: wheel-zoom, drag-to-pan, and the view buttons are disabled. Click to unlock.' : 'Lock this view: disables wheel-zoom, drag-to-pan, and the view buttons above.'}
        >
          {isViewLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          {isViewLocked ? 'Unfix View' : 'Fix View'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 bg-[#101820]/95 hover:bg-[#172230] text-slate-200 px-2.5 py-1.5 rounded-md text-[11px] font-bold"
        >
          Close
        </button>
      </div>

      {/* Status: its own always-mounted, single-line row (whitespace-nowrap,
          not flex-wrap) so its length — which varies a lot between "Exact ·
          Step 0.1° · 5,997 points" and the longer adaptive string — can
          never change this row's height. An earlier version had this text
          inline in the button row above; a longer string could occasionally
          push the buttons onto a second line, shrinking the canvas below by
          a few pixels, firing ResizeObserver, re-fitting the zoom, and
          triggering another render whose status text changed the width
          again — a genuine infinite loop, observed live during testing. */}
      <div
        className="px-3 py-1.5 border-b border-white/10 shrink-0 text-[11px] font-mono text-slate-400 whitespace-nowrap overflow-x-auto"
        title={statusTitle}
      >
        {status === 'running'
          ? runningLabel
          : `${statusLine || `${points.length.toLocaleString()} valid point${points.length === 1 ? '' : 's'} found`}${status === 'cancelled' ? ' (cancelled)' : ''}`}
      </div>
      {/* Always mounted (not conditionally rendered on status==='running')
          for the same reason as the status row above: this must never
          appear/disappear from the layout. */}
      <div className="h-1 bg-[#0c1117] shrink-0 overflow-hidden">
        {status === 'running' && <div className="h-full w-1/3 bg-cyan-400/70 animate-pulse" />}
      </div>

      {stepError && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-red-400/30 bg-red-500/10 text-[11px] text-red-200 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Angle Step error: {stepError} Fix the Angle Step field in the main panel, then click Generate/Refresh Plot.</span>
        </div>
      )}

      {pendingLargeExactSweep && (
        <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-amber-400/30 bg-amber-500/10 text-[11px] text-amber-100 shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Step {pendingLargeExactSweep.stepDegrees} would require testing an estimated {pendingLargeExactSweep.estimatedIterations.toLocaleString()} angle
              combinations in exact mode, which is over the {MAX_ANGLE_GRID_ITERATIONS.toLocaleString()}-combination safety limit and could take a very long time.
            </span>
          </div>
          <div className="flex gap-2 pl-5">
            <button type="button" onClick={confirmLargeExactSweep} className="bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 px-2.5 py-1 rounded-md font-bold">
              Generate Anyway
            </button>
            <button type="button" onClick={() => setPendingLargeExactSweep(null)} className="bg-[#101820]/95 hover:bg-[#172230] text-slate-200 px-2.5 py-1 rounded-md font-bold">
              Cancel (use a larger step)
            </button>
          </div>
        </div>
      )}

      {/* Graph. */}
      <div className="flex-1 min-h-0 min-w-0 p-3">
        <AnglePlotPanel
          ref={panelRef}
          points={points}
          currentPoint={currentPoint}
          theme={theme}
          isLocked={isViewLocked}
          displayScale={displayScale}
          onViewChange={handleViewChange}
          gridStepDegrees={renderInfo?.gridStepDegrees}
          userStepDegrees={liveParsedStep.valid ? liveParsedStep.stepDegrees : renderInfo?.userStepDegrees}
        />
      </div>

      {/* Resize grip. */}
      <div
        className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize"
        onMouseDown={handleResizeMouseDown}
        title="Drag to resize"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-slate-600">
          <path d="M14 2 L2 14 M14 8 L8 14 M14 14 L14 14" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
}
