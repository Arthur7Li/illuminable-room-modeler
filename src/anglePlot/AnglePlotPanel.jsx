import { useEffect, useRef, useState, useCallback } from 'react';
import { formatAngleDegrees } from './AnglePair.js';

// AnglePlotPanel: draws the scatter of valid (A, B) points and owns all
// zoom/pan/hover interaction for the graph. Implemented with a plain
// <canvas> instead of SVG because the region can contain on the order of
// 10^5 points (the full permitted A/B grid at 0.1 degree spacing) —
// rendering that many individual SVG DOM nodes would be far slower than
// letting the canvas rasterize them directly. No charting library exists
// in this project (checked package.json before writing this), so this is
// the "lightweight custom panel" option rather than adding a dependency.

// Zoom/pan model mirrors the main triangle canvas in App.jsx: `zoom` is
// screen pixels per degree (the same value is used for both axes so the
// A/B region is never stretched into a misleading shape), and `pan` is the
// (A, B) point currently centered in the viewport.
const MIN_ZOOM = 2;
const MAX_ZOOM = 400;
const WHEEL_ZOOM_FACTOR = 1.15;
const POINT_HIT_RADIUS_PX = 7;
// Above this many points, draw 1px dots instead of full circles — much
// cheaper per point and still reads as a filled region at that density.
const DENSE_POINT_THRESHOLD = 20000;

// Mirrors the light/dark values the main triangle canvas already uses
// (THEME_PALETTES in App.jsx) so the two canvases stay visually consistent
// instead of this one always rendering dark regardless of the app's theme
// toggle.
const CANVAS_PALETTES = {
  light: { background: '#f8fafc', gridLine: 'rgba(15,23,42,0.08)', gridAxis: 'rgba(8,145,178,0.45)', tickText: '#64748b', point: 'rgba(8,145,178,0.85)' },
  dark: { background: '#070b10', gridLine: 'rgba(255,255,255,0.08)', gridAxis: 'rgba(56,189,248,0.45)', tickText: '#64748b', point: 'rgba(56,189,248,0.85)' },
};

const niceGridStepDegrees = (zoom) => {
  // Finer grid spacing as the user zooms in, mirroring the main canvas's tiering.
  if (zoom > 220) return 1;
  if (zoom > 90) return 2;
  if (zoom > 35) return 5;
  return 10;
};

const computeFitView = (points, currentPoint, width, height) => {
  const all = currentPoint ? [...points, currentPoint] : points;
  if (all.length === 0) return { zoom: 6, pan: { a: 45, b: 45 } };
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  all.forEach((p) => {
    if (p.a < minA) minA = p.a;
    if (p.a > maxA) maxA = p.a;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  });
  const spanA = Math.max(maxA - minA, 1);
  const spanB = Math.max(maxB - minB, 1);
  const padding = 60; // px of breathing room around the data
  const zoom = Math.min(
    Math.max((width - padding) / spanA, MIN_ZOOM),
    Math.max((height - padding) / spanB, MIN_ZOOM),
    MAX_ZOOM
  );
  return { zoom, pan: { a: (minA + maxA) / 2, b: (minB + maxB) / 2 } };
};

export default function AnglePlotPanel({ points, currentPoint, resetToken, theme }) {
  const palette = CANVAS_PALETTES[theme] || CANVAS_PALETTES.dark;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 420 });
  const [zoom, setZoom] = useState(6);
  const [pan, setPan] = useState({ a: 45, b: 45 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [hoverPoint, setHoverPoint] = useState(null);
  const [pinnedPoint, setPinnedPoint] = useState(null);

  // Track the container's actual pixel size so the canvas drawing buffer
  // (not just its CSS box) stays sharp after the window is resized.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Reset View" (and the initial mount) fits the viewport to every
  // generated point plus the currently selected A/B pair. This adjusts
  // state during render (React's documented pattern for "reset state when
  // a value changes") rather than in a useEffect, because the reset must
  // happen before the first paint at this size and must not cascade
  // through an extra render-then-effect-then-render cycle.
  const fitSignature = `${resetToken}:${size.width}:${size.height}`;
  const [appliedFitSignature, setAppliedFitSignature] = useState(null);
  if (fitSignature !== appliedFitSignature) {
    setAppliedFitSignature(fitSignature);
    const fit = computeFitView(points, currentPoint, size.width, size.height);
    setZoom(fit.zoom);
    setPan(fit.pan);
  }

  const toScreenX = useCallback((a) => size.width / 2 + (a - pan.a) * zoom, [size.width, pan.a, zoom]);
  const toScreenY = useCallback((b) => size.height / 2 - (b - pan.b) * zoom, [size.height, pan.b, zoom]);
  const toDataA = useCallback((x) => pan.a + (x - size.width / 2) / zoom, [size.width, pan.a, zoom]);
  const toDataB = useCallback((y) => pan.b - (y - size.height / 2) / zoom, [size.height, pan.b, zoom]);

  // Redraw whenever the data, viewport, or hover/pin state changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // Background
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, size.width, size.height);

    // Grid lines + tick labels, one decimal place per the spec.
    const step = niceGridStepDegrees(zoom);
    const minA = toDataA(0);
    const maxA = toDataA(size.width);
    const minB = toDataB(size.height);
    const maxB = toDataB(0);
    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';
    for (let a = Math.ceil(minA / step) * step; a <= maxA; a += step) {
      const x = toScreenX(a);
      ctx.strokeStyle = Math.abs(a) < 1e-9 ? palette.gridAxis : palette.gridLine;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
      ctx.fillStyle = palette.tickText;
      ctx.fillText(formatAngleDegrees(a), x + 2, size.height - 14);
    }
    ctx.textBaseline = 'middle';
    for (let b = Math.ceil(minB / step) * step; b <= maxB; b += step) {
      const y = toScreenY(b);
      ctx.strokeStyle = Math.abs(b) < 1e-9 ? palette.gridAxis : palette.gridLine;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
      ctx.fillStyle = palette.tickText;
      ctx.fillText(formatAngleDegrees(b), 4, y - 12);
    }

    // Valid region scatter.
    const dense = points.length > DENSE_POINT_THRESHOLD;
    ctx.fillStyle = palette.point;
    points.forEach((p) => {
      const x = toScreenX(p.a);
      const y = toScreenY(p.b);
      if (x < -5 || x > size.width + 5 || y < -5 || y > size.height + 5) return;
      if (dense) {
        ctx.fillRect(x, y, 1.5, 1.5);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Currently committed A/B pair, highlighted distinctly from generated points.
    if (currentPoint) {
      const x = toScreenX(currentPoint.a);
      const y = toScreenY(currentPoint.b);
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0b1016';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Hovered/pinned point marker.
    const active = hoverPoint || pinnedPoint;
    if (active) {
      const x = toScreenX(active.a);
      const y = toScreenY(active.b);
      ctx.strokeStyle = palette.tickText;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [points, currentPoint, size, zoom, pan, hoverPoint, pinnedPoint, toScreenX, toScreenY, toDataA, toDataB, palette]);

  const findNearestPoint = useCallback((screenX, screenY) => {
    const all = currentPoint ? [...points, currentPoint] : points;
    let nearest = null;
    let nearestDistSq = POINT_HIT_RADIUS_PX * POINT_HIT_RADIUS_PX;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      const dx = toScreenX(p.a) - screenX;
      const dy = toScreenY(p.b) - screenY;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = p;
      }
    }
    return nearest;
  }, [points, currentPoint, toScreenX, toScreenY]);

  // The wheel listener is attached natively (not via React's onWheel prop)
  // because React registers wheel handlers as passive by default, which
  // silently ignores preventDefault() and lets the page scroll underneath
  // the plot. The main triangle canvas in App.jsx hits the same issue and
  // fixes it the same way — see its "passive:false is required" comment.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const handleWheel = (e) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      setZoom((prev) => Math.max(MIN_ZOOM, Math.min(prev * (direction > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR), MAX_ZOOM)));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    if (isDragging) {
      const dx = (e.clientX - dragStart.current.x) / zoom;
      const dy = (e.clientY - dragStart.current.y) / zoom;
      setPan((prev) => ({ a: prev.a - dx, b: prev.b + dy }));
      dragStart.current = { x: e.clientX, y: e.clientY };
    } else {
      setHoverPoint(findNearestPoint(screenX, screenY));
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleClick = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    const found = findNearestPoint(e.clientX - rect.left, e.clientY - rect.top);
    setPinnedPoint(found);
  };

  const tooltipPoint = pinnedPoint || hoverPoint;

  return (
    <div className="flex flex-col h-full w-full min-h-0 min-w-0">
      <div className="flex-1 min-h-0 min-w-0 flex">
        {/* Rotated y-axis label. */}
        <div className="flex items-center justify-center px-1 shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            Angle B (degrees)
          </span>
        </div>
        <div ref={containerRef} className="relative flex-1 min-w-0 min-h-0 border border-white/10 rounded-md overflow-hidden cursor-grab" style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
        >
          <canvas ref={canvasRef} className="block" />
          {tooltipPoint && (
            <div
              className="pointer-events-none absolute bg-[#101820]/95 border border-white/10 rounded-md px-2.5 py-1.5 text-[11px] font-mono text-slate-200 shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
              style={{ left: Math.min(toScreenX(tooltipPoint.a) + 12, size.width - 140), top: Math.max(toScreenY(tooltipPoint.b) - 54, 4) }}
            >
              <div>A = {formatAngleDegrees(tooltipPoint.a)}&deg;</div>
              <div>B = {formatAngleDegrees(tooltipPoint.b)}&deg;</div>
              <div className="text-slate-400">A+B = {formatAngleDegrees(tooltipPoint.a + tooltipPoint.b)}&deg;</div>
            </div>
          )}
        </div>
      </div>
      {/* x-axis label. */}
      <div className="text-center pt-1 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Angle A (degrees)</span>
      </div>
    </div>
  );
}
