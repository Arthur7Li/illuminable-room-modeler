import { useEffect, useRef, useState, useCallback } from 'react';
import { X, RotateCcw, RefreshCw, Loader2, GripHorizontal, ZoomIn, ZoomOut, Maximize, Lock, Unlock, AlertTriangle } from 'lucide-react';
import AnglePlotPanel from './AnglePlotPanel.jsx';
import { generateAngleRegion } from './generateAngleRegion.js';
import { parseAngleStep, estimateAngleGridIterations, displayScaleForStep, MAX_ANGLE_GRID_ITERATIONS } from './angleStep.js';

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

const DEFAULT_SIZE = { width: 640, height: 480 };
const MIN_SIZE = { width: 380, height: 320 };

export default function AnglePlotWindow({ angleParams, baseLength, validateCandidate, refreshToken, onClose, theme, angleStepInput }) {
  const [pos, setPos] = useState({ x: 96, y: 72 });
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragOffset = useRef(null);
  const resizeStart = useRef(null);

  const [points, setPoints] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done | cancelled
  const [progress, setProgress] = useState({ tested: 0, total: 0, found: 0 });
  const [stepError, setStepError] = useState(null);
  const [pendingLargeSweep, setPendingLargeSweep] = useState(null); // { scale, stepUnits, stepDegrees, estimatedIterations, viewBounds } | null
  const [isViewLocked, setIsViewLocked] = useState(false);
  // When on, Generate/Refresh only sweeps the region currently visible in
  // the panel instead of the full 0-90 domain — the practical way to use a
  // very fine Angle Step (e.g. 0.001): zoom into the area of interest first,
  // then a fine step only has to cover that small area rather than testing
  // billions of candidates across the whole permitted triangle.
  const [scopeToView, setScopeToView] = useState(false);
  const taskRef = useRef(null);
  const panelRef = useRef(null);

  const currentPoint = { a: Number(angleParams.a), b: Number(angleParams.b) };
  // Falls back to whole-degree display (matches the historical 0.1-step
  // behavior's precision) if a sweep hasn't successfully validated a step yet.
  const [displayScale, setDisplayScale] = useState(1);

  const startSweep = useCallback((parsedStep, viewBounds) => {
    // Cancel any sweep still in flight before starting a new one so two
    // generations can never race and overwrite each other's results.
    taskRef.current?.cancel();
    setStatus('running');
    setProgress({ tested: 0, total: 0, found: 0 });
    setDisplayScale(displayScaleForStep(parsedStep.scale));
    const task = generateAngleRegion({
      validateCandidate,
      baseLength,
      scale: parsedStep.scale,
      stepUnits: parsedStep.stepUnits,
      viewBounds,
      onProgress: (p) => {
        setProgress(p);
        if (p.done) setStatus(p.cancelled ? 'cancelled' : 'done');
      },
    });
    taskRef.current = task;
    task.promise.then((result) => {
      if (taskRef.current === task) setPoints(result);
    });
  }, [validateCandidate, baseLength]);

  // Validates the Angle Step field and either starts the sweep immediately,
  // reports a clear validation error, or — if the step is so small the
  // sweep would be enormous — pauses for explicit confirmation instead of
  // silently freezing or capping the step behind the user's back. When
  // "scope to view" is on, the current panel viewport narrows the sweep (and
  // therefore the estimate) before that safety check even runs.
  const runGeneration = useCallback(() => {
    setStepError(null);
    setPendingLargeSweep(null);
    const parsed = parseAngleStep(angleStepInput);
    if (!parsed.valid) {
      setStepError(parsed.error);
      setStatus('idle');
      return;
    }
    const viewBounds = scopeToView ? panelRef.current?.getViewBounds() : undefined;
    const estimatedIterations = estimateAngleGridIterations(parsed.scale, parsed.stepUnits, viewBounds);
    if (estimatedIterations > BigInt(MAX_ANGLE_GRID_ITERATIONS)) {
      setPendingLargeSweep({ ...parsed, estimatedIterations, viewBounds });
      setStatus('idle');
      return;
    }
    startSweep(parsed, viewBounds);
  }, [angleStepInput, scopeToView, startSweep]);

  const confirmLargeSweep = () => {
    if (!pendingLargeSweep) return;
    const { viewBounds, ...parsed } = pendingLargeSweep;
    setPendingLargeSweep(null);
    startSweep(parsed, viewBounds);
  };

  // Regenerate whenever the parent asks for a fresh plot (Plot Valid Angle
  // Region button) and once on mount. The kickoff is deferred a tick so the
  // setState calls inside runGeneration happen from a callback rather than
  // synchronously in the effect body (the "Generate/Refresh Plot" button
  // below calls runGeneration directly and gets the immediate synchronous
  // feedback; this path just needs to not fire on every render). Cancel
  // in-flight work on unmount so a closed window never calls setState after
  // it stops existing.
  useEffect(() => {
    const timeoutId = setTimeout(runGeneration, 0);
    return () => {
      clearTimeout(timeoutId);
      taskRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

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

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.tested / progress.total) * 100)) : 0;
  const viewButtonClass = "flex items-center gap-1.5 bg-[#101820]/95 hover:bg-[#172230] disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 px-2.5 py-1.5 rounded-md text-[11px] font-bold";

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

      {/* Controls + status. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={runGeneration}
          disabled={status === 'running'}
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
        <label
          className="flex items-center gap-1.5 bg-[#101820]/95 px-2.5 py-1.5 rounded-md text-[11px] font-bold text-slate-200 cursor-pointer select-none"
          title="Only sweep the region currently visible in the graph below, instead of the full 0-90 degree domain. Zoom into an area first, then use a very fine Angle Step to inspect it in detail without testing the whole triangle."
        >
          <input
            type="checkbox"
            checked={scopeToView}
            onChange={(e) => setScopeToView(e.target.checked)}
            className="accent-cyan-400"
          />
          Scope to current view
        </label>
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
        <div className="ml-auto text-[11px] font-mono text-slate-400 text-right">
          {status === 'running' ? (
            <span>Testing&hellip; {progress.tested.toLocaleString()} / {progress.total.toLocaleString()} ({percent}%)</span>
          ) : (
            <span>{points.length.toLocaleString()} valid point{points.length === 1 ? '' : 's'} found{status === 'cancelled' ? ' (cancelled)' : ''}</span>
          )}
        </div>
      </div>
      {status === 'running' && (
        <div className="h-1 bg-[#0c1117] shrink-0">
          <div className="h-full bg-cyan-400/70 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}

      {stepError && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-red-400/30 bg-red-500/10 text-[11px] text-red-200 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Angle Step error: {stepError} Fix the Angle Step field in the main panel, then click Generate/Refresh Plot.</span>
        </div>
      )}

      {pendingLargeSweep && (
        <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-amber-400/30 bg-amber-500/10 text-[11px] text-amber-100 shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Step {pendingLargeSweep.stepDegrees} would require testing an estimated {pendingLargeSweep.estimatedIterations.toLocaleString()} angle
              combinations, which is over the {MAX_ANGLE_GRID_ITERATIONS.toLocaleString()}-combination safety limit and could take a very long time.
              {!scopeToView && ' Zoom into the area you care about and enable "Scope to current view" to sweep only that region at this step.'}
            </span>
          </div>
          <div className="flex gap-2 pl-5">
            <button type="button" onClick={confirmLargeSweep} className="bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 px-2.5 py-1 rounded-md font-bold">
              Generate Anyway
            </button>
            <button type="button" onClick={() => setPendingLargeSweep(null)} className="bg-[#101820]/95 hover:bg-[#172230] text-slate-200 px-2.5 py-1 rounded-md font-bold">
              Cancel (use a larger step)
            </button>
          </div>
        </div>
      )}

      {/* Graph. */}
      <div className="flex-1 min-h-0 min-w-0 p-3">
        <AnglePlotPanel ref={panelRef} points={points} currentPoint={currentPoint} theme={theme} isLocked={isViewLocked} displayScale={displayScale} />
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
