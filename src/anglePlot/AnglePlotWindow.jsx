import { useEffect, useRef, useState, useCallback } from 'react';
import { X, RotateCcw, RefreshCw, Loader2, GripHorizontal } from 'lucide-react';
import AnglePlotPanel from './AnglePlotPanel.jsx';
import { generateAngleRegion } from './generateAngleRegion.js';

// AnglePlotWindow: the pop-up "Valid Angle A-B Region" graph. This project
// is a browser React app, not a desktop toolkit, so there is no native OS
// window to reuse — the closest equivalent that still satisfies "drag by a
// title bar", "resize", and "does not block the rest of the program" is a
// non-modal, absolutely-positioned panel with its own draggable title bar
// and a manual resize grip, which is what this component implements.

const DEFAULT_SIZE = { width: 640, height: 480 };
const MIN_SIZE = { width: 380, height: 320 };

export default function AnglePlotWindow({ angleParams, baseLength, validateCandidate, refreshToken, onClose, theme }) {
  const [pos, setPos] = useState({ x: 96, y: 72 });
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragOffset = useRef(null);
  const resizeStart = useRef(null);

  const [points, setPoints] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done | cancelled
  const [progress, setProgress] = useState({ tested: 0, total: 0, found: 0 });
  const [resetToken, setResetToken] = useState(0);
  const taskRef = useRef(null);

  const currentPoint = { a: Number(angleParams.a), b: Number(angleParams.b) };

  const runGeneration = useCallback(() => {
    // Cancel any sweep still in flight before starting a new one so two
    // generations can never race and overwrite each other's results.
    taskRef.current?.cancel();
    setStatus('running');
    setProgress({ tested: 0, total: 0, found: 0 });
    const task = generateAngleRegion({
      validateCandidate,
      baseLength,
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
        <button
          type="button"
          onClick={() => setResetToken((t) => t + 1)}
          className="flex items-center gap-1.5 bg-[#101820]/95 hover:bg-[#172230] text-slate-200 px-2.5 py-1.5 rounded-md text-[11px] font-bold"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset View
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

      {/* Graph. */}
      <div className="flex-1 min-h-0 min-w-0 p-3">
        <AnglePlotPanel points={points} currentPoint={currentPoint} resetToken={resetToken} theme={theme} />
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
