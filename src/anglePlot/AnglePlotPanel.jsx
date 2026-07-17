import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { formatAngleDegrees } from './AnglePair.js';
import { MIN_CELL_SIZE_PX, MAX_CELL_SIZE_PX, MIN_VISIBLE_GRID_STEPS, ABSOLUTE_MAX_ZOOM_PX_PER_DEGREE } from './renderSamplingPolicy.js';

// AnglePlotPanel: draws the scatter of valid (A, B) points and owns all
// zoom/pan/hover interaction for the graph. Implemented with a plain
// <canvas> instead of SVG because the region can contain on the order of
// 10^5 points (the full permitted A/B grid at a fine step) — rendering
// that many individual SVG DOM nodes would be far slower than letting the
// canvas rasterize them directly. No charting library exists in this
// project (checked package.json before writing this), so this is the
// "lightweight custom panel" option rather than adding a dependency.

// Zoom/pan model mirrors the main triangle canvas in App.jsx: `zoom` is
// screen pixels per degree (the same value is used for both axes so the
// A/B region is never stretched into a misleading shape), and `pan` is the
// (A, B) point currently centered in the viewport.
const MIN_ZOOM = 2;
const WHEEL_ZOOM_FACTOR = 1.15;
const POINT_HIT_RADIUS_PX = 7;
// Individual-point marker radius used in POINTS mode (see pickRenderMode
// below) — the "normal" size referenced throughout this file, including for
// the orange current-point marker, which always uses this radius regardless
// of which mode the blue region is currently drawn in.
const POINT_RADIUS_PX = 2.4;

// The view "Reset View" restores — a fixed overview of the whole permitted
// triangle, independent of whatever is currently plotted. Also used as the
// very first view before any generation has completed.
const DEFAULT_ZOOM = 6;
const DEFAULT_PAN = { a: 45, b: 45 };

// zoomLevel is always *derived* from `zoom` (zoom / DEFAULT_ZOOM), never
// stored independently, so it can never disagree with the actual visible
// bounds. Exported for diagnostics/tests.
export const MIN_ZOOM_LEVEL = MIN_ZOOM / DEFAULT_ZOOM;

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

// The maximum zoom (px/degree) this panel allows, tied to the user's actual
// Angle Step rather than an arbitrary pixel constant: zooming in further
// than MIN_VISIBLE_GRID_STEPS worth of that step across the viewport cannot
// reveal any additional real detail (every point on screen would already be
// adjacent grid points), so there is nothing gained by allowing it. Falls
// back to the absolute sanity ceiling when no valid Angle Step is known yet
// (e.g. before the field has been parsed once).
const getMaxZoomPxPerDegree = (userStepDegrees, viewportWidthPx) => {
  if (!Number.isFinite(userStepDegrees) || userStepDegrees <= 0) return ABSOLUTE_MAX_ZOOM_PX_PER_DEGREE;
  const minVisibleWidth = userStepDegrees * MIN_VISIBLE_GRID_STEPS;
  const dynamicMax = Math.max(viewportWidthPx, 1) / Math.max(minVisibleWidth, 1e-12);
  return Math.min(dynamicMax, ABSOLUTE_MAX_ZOOM_PX_PER_DEGREE);
};

const computeFitView = (points, currentPoint, width, height, maxZoom) => {
  const all = currentPoint ? [...points, currentPoint] : points;
  if (all.length === 0) return { zoom: DEFAULT_ZOOM, pan: DEFAULT_PAN };
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
    maxZoom
  );
  return { zoom, pan: { a: (minA + maxA) / 2, b: (minB + maxB) / 2 } };
};

// Level-of-detail mode, chosen from how many screen pixels separate
// adjacent sampled grid points (see pickRenderMode): plenty of room draws
// individually-distinguishable circles; a tight-but-not-subpixel spacing
// draws touching/slightly-overlapping markers sized to the gap so the
// region reads as continuous; sub-pixel spacing switches to filled
// rectangles ("occupancy cells") sized to the sampling cell so the region
// reads as a solid raster instead of a sparse dot lattice with visible gaps.
const RENDER_MODE = { POINTS: 'points', DENSE: 'dense', OCCUPANCY: 'occupancy' };
const pickRenderMode = (projectedSpacingPx) => {
  if (projectedSpacingPx >= 6) return RENDER_MODE.POINTS;
  if (projectedSpacingPx >= 2) return RENDER_MODE.DENSE;
  return RENDER_MODE.OCCUPANCY;
};

// forwardRef exposes imperative view controls (zoomIn/zoomOut/fitToPoints/
// resetToDefaultView) to AnglePlotWindow's toolbar buttons, since "multiply
// whatever the current zoom happens to be" can't be expressed as a plain
// prop the way a one-shot "reset to X" signal can.
//
// `onViewChange` is called (undebounced) every time zoom, pan, or the
// measured canvas size changes, reporting the current world bounds,
// zoomLevel, and viewport pixel size. AnglePlotWindow owns the actual
// debounce/regeneration decision (see RENDER_DEBOUNCE_MS in
// renderSamplingPolicy.js) — this panel stays a "dumb" reporter of its own
// viewport state so that policy lives in exactly one place.
//
// `gridStepDegrees` is the world-space spacing of the *current* point set
// (the user's exact Angle Step in exact mode, or the adaptive render step
// in adaptive mode) — used only to choose the level-of-detail draw mode
// above, never to decide what to generate (that's AnglePlotWindow's job).
// `userStepDegrees` is used only for the Angle-Step-aware zoom cap.
const AnglePlotPanel = forwardRef(function AnglePlotPanel({ points, currentPoint, theme, isLocked, displayScale, onViewChange, gridStepDegrees, userStepDegrees }, ref) {
  const palette = CANVAS_PALETTES[theme] || CANVAS_PALETTES.dark;
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 420 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState(DEFAULT_PAN);
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

  const maxZoom = getMaxZoomPxPerDegree(userStepDegrees, size.width);
  const clampZoom = useCallback((value) => Math.max(MIN_ZOOM, Math.min(value, maxZoom)), [maxZoom]);

  // Fit the viewport to every generated point plus the currently selected
  // A/B pair on mount, and again any time the panel's real measured size
  // changes (the initial size is a placeholder until ResizeObserver reports
  // the actual box). This adjusts state during render (React's documented
  // pattern for "reset state when a value changes") rather than in a
  // useEffect, because the reset must happen before the first paint at
  // this size and must not cascade through an extra render cycle. Explicit
  // re-fits after that go through the fitToPoints() imperative method below
  // (the "Fit" button), which does not touch this signature.
  const sizeSignature = `${size.width}x${size.height}`;
  const [appliedSizeSignature, setAppliedSizeSignature] = useState(null);
  if (sizeSignature !== appliedSizeSignature) {
    setAppliedSizeSignature(sizeSignature);
    const fit = computeFitView(points, currentPoint, size.width, size.height, maxZoom);
    setZoom(fit.zoom);
    setPan(fit.pan);
  }

  const toScreenX = useCallback((a) => size.width / 2 + (a - pan.a) * zoom, [size.width, pan.a, zoom]);
  const toScreenY = useCallback((b) => size.height / 2 - (b - pan.b) * zoom, [size.height, pan.b, zoom]);
  const toDataA = useCallback((x) => pan.a + (x - size.width / 2) / zoom, [size.width, pan.a, zoom]);
  const toDataB = useCallback((y) => pan.b - (y - size.height / 2) / zoom, [size.height, pan.b, zoom]);

  // Imperative view controls used by AnglePlotWindow's Zoom In / Zoom Out /
  // Fit / Reset View buttons. Locking the view (the "Fix" button) disables
  // all four here too, as a second line of defense beyond the toolbar
  // buttons themselves being disabled while locked.
  useImperativeHandle(ref, () => ({
    zoomIn: () => { if (!isLocked) setZoom((z) => clampZoom(z * WHEEL_ZOOM_FACTOR)); },
    zoomOut: () => { if (!isLocked) setZoom((z) => clampZoom(z / WHEEL_ZOOM_FACTOR)); },
    fitToPoints: () => {
      if (isLocked) return;
      const fit = computeFitView(points, currentPoint, size.width, size.height, maxZoom);
      setZoom(fit.zoom);
      setPan(fit.pan);
    },
    resetToDefaultView: () => {
      if (isLocked) return;
      setZoom(DEFAULT_ZOOM);
      setPan(DEFAULT_PAN);
    },
    // The data-space rectangle currently visible in the canvas, used by
    // AnglePlotWindow's adaptive renderer so it only ever considers points
    // that could actually be seen right now.
    getViewBounds: () => ({
      minA: toDataA(0),
      maxA: toDataA(size.width),
      minB: toDataB(size.height),
      maxB: toDataB(0),
    }),
  }), [isLocked, points, currentPoint, size, maxZoom, clampZoom, toDataA, toDataB]);

  // Report every zoom/pan/size change (including the very first one, once
  // the real measured canvas size is known) so AnglePlotWindow can debounce
  // a regeneration around it. This effect only *reports* — it never itself
  // decides whether/when to regenerate, keeping that policy in one place.
  //
  // `onViewChange` is read through a ref (updated every render, below)
  // rather than listed in this effect's own dependency array. AnglePlotWindow
  // rebuilds that callback whenever its own `validateCandidate`/`baseLength`
  // props change identity — which, in this app, is on nearly every parent
  // render — and calling it lands a state update back in AnglePlotWindow.
  // If the effect depended on the callback's identity directly, that state
  // update would produce a new callback reference, re-running this effect,
  // calling it again, and so on forever. Depending only on the actual
  // viewport numbers below breaks that cycle: the effect re-fires on a real
  // zoom/pan/size change, and always invokes whatever the latest callback is.
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.({
      bounds: { minA: toDataA(0), maxA: toDataA(size.width), minB: toDataB(size.height), maxB: toDataB(0) },
      zoomLevel: zoom / DEFAULT_ZOOM,
      viewportSize: { width: size.width, height: size.height },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, pan.a, pan.b, size.width, size.height]);

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

    // Grid lines + tick labels, precise enough to represent the current step.
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
      ctx.fillText(formatAngleDegrees(a, displayScale), x + 2, size.height - 14);
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
      ctx.fillText(formatAngleDegrees(b, displayScale), 4, y - 12);
    }

    // Valid region scatter. The draw mode is picked from how many screen
    // pixels separate adjacent *sampled* grid points (gridStepDegrees x
    // zoom, the actual px/degree) — not from the point count — so a sparse
    // exact-mode result at low zoom and a dense adaptive result at high
    // zoom both pick the mode that actually matches what's distinguishable
    // on screen right now. See the RENDER_MODE comment above.
    const projectedSpacingPx = Number.isFinite(gridStepDegrees) && gridStepDegrees > 0 ? gridStepDegrees * zoom : Infinity;
    const mode = pickRenderMode(projectedSpacingPx);
    ctx.fillStyle = palette.point;
    if (mode === RENDER_MODE.OCCUPANCY) {
      // Filled squares sized to the sampling cell (with a hair of overlap
      // so pixel rounding never leaves a one-pixel crack between
      // neighbors), not large circles over a coarse grid — a solid raster
      // built only from cells that actually contain a real valid point.
      const cellPx = Math.min(MAX_CELL_SIZE_PX, Math.max(MIN_CELL_SIZE_PX, projectedSpacingPx));
      const half = cellPx / 2 + 0.5;
      points.forEach((p) => {
        const x = toScreenX(p.a);
        const y = toScreenY(p.b);
        if (x < -half || x > size.width + half || y < -half || y > size.height + half) return;
        ctx.fillRect(x - half, y - half, cellPx + 1, cellPx + 1);
      });
    } else if (mode === RENDER_MODE.DENSE) {
      // Markers sized to touch/slightly overlap their neighbors instead of
      // leaving the fixed small POINTS-mode radius floating in visible gaps.
      const radius = Math.min(MAX_CELL_SIZE_PX / 2, Math.max(MIN_CELL_SIZE_PX / 2, projectedSpacingPx / 2 + 0.5));
      points.forEach((p) => {
        const x = toScreenX(p.a);
        const y = toScreenY(p.b);
        if (x < -radius - 5 || x > size.width + radius + 5 || y < -radius - 5 || y > size.height + radius + 5) return;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      points.forEach((p) => {
        const x = toScreenX(p.a);
        const y = toScreenY(p.b);
        if (x < -5 || x > size.width + 5 || y < -5 || y > size.height + 5) return;
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Currently committed A/B pair: always the normal individual-point
    // radius (never enlarged/shrunk by the region's current LOD mode) and
    // always drawn after the blue region so it is never hidden inside an
    // occupancy cell — only the orange fill color sets it apart.
    if (currentPoint) {
      const x = toScreenX(currentPoint.a);
      const y = toScreenY(currentPoint.b);
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(x, y, POINT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
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
  }, [points, currentPoint, size, zoom, pan, hoverPoint, pinnedPoint, toScreenX, toScreenY, toDataA, toDataB, palette, displayScale, gridStepDegrees]);

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
      // Locking the view disables mouse-wheel zoom entirely.
      if (isLocked) return;
      const direction = e.deltaY > 0 ? -1 : 1;
      setZoom((prev) => clampZoom(prev * (direction > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR)));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isLocked, clampZoom]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    // Locking the view disables drag-to-pan entirely.
    if (isLocked) return;
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
        <div ref={containerRef} className="relative flex-1 min-w-0 min-h-0 border border-white/10 rounded-md overflow-hidden" style={{ cursor: isLocked ? 'not-allowed' : isDragging ? 'grabbing' : 'grab' }}
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
              <div>A = {formatAngleDegrees(tooltipPoint.a, displayScale)}&deg;</div>
              <div>B = {formatAngleDegrees(tooltipPoint.b, displayScale)}&deg;</div>
              <div className="text-slate-400">A+B = {formatAngleDegrees(tooltipPoint.a + tooltipPoint.b, displayScale)}&deg;</div>
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
});

export default AnglePlotPanel;
