// React supplies state, refs, effects, and memoization for this client-only tool.
import { useState, useRef, useEffect, useMemo } from 'react';
// Lucide supplies recognizable control/status icons without custom SVG code.
import { Maximize, Zap, Settings2, List, Code2, Compass, ChevronRight, Activity, CheckCircle2, XCircle } from 'lucide-react';

// =============================================================================
// App.jsx architecture note
// =============================================================================
// This file intentionally keeps the prototype in one place while the math is
// still evolving. The top-level constants define visual/side conventions. The
// pure helper functions implement Euclidean geometry. The App component then
// proceeds in this order:
// 1. declare user-editable state;
// 2. measure and control the SVG viewport;
// 3. derive the base triangle;
// 4. derive ray-mode or code-mode reflected triangles;
// 5. derive the shot line and fan-side validator;
// 6. render the sidebar and SVG canvas.
// When this grows further, the clean split points are: geometry helpers, code
// parser/unfolder, fan validator, and presentation components.

// Academic color palette: distinct but slightly muted/professional tones.
// The colors intentionally alternate hue families so long unfoldings remain
// visually separable without turning the app into a one-color dark theme.
const COLORS = [
  '#dc2626', '#d97706', '#059669', '#0284c7', '#4f46e5', 
  '#7c3aed', '#c026d3', '#e11d48', '#ea580c', '#65a30d',
  '#0891b2', '#2563eb', '#db2777', '#b45309', '#16a34a'
];

// Mapping triangle edges (0, 1, 2) to their standard Side numbers (1, 2, 3)
// Edge 0 (V0-V1) is opposite V2(C) -> Side 3
// Edge 1 (V1-V2) is opposite V0(A) -> Side 1
// Edge 2 (V2-V0) is opposite V1(B) -> Side 2
const EDGE_TO_SIDE = { 0: 3, 1: 1, 2: 2 };

// ==========================================
// MATHEMATICAL CORE FUNCTIONS (Optimized)
// ==========================================

/**
 * Reflects a point perfectly across a line segment using Linear Algebra (IEEE 754 precision)
 */
const reflectPoint = (p, p1, p2) => {
  // Convert the segment through p1/p2 into implicit line form ax + by + c = 0.
  const a = p2.y - p1.y; 
  // b is the negative x component of the segment direction.
  const b = p1.x - p2.x; 
  // c makes the implicit line pass through both segment endpoints.
  const c = p2.x * p1.y - p1.x * p2.y; 
  
  // The squared normal length is the denominator for projection onto the line normal.
  const denom = a * a + b * b;
  // Degenerate edges cannot define a mirror line; copy the point rather than exploding.
  if (denom === 0) return { ...p }; 
  
  // Twice the signed distance in normal-coordinate units gives the mirror offset.
  const factor = 2 * (a * p.x + b * p.y + c) / denom;
  // Subtract the normal component to land on the reflected point.
  return { x: p.x - a * factor, y: p.y - b * factor };
};

/** Calculates the geometric center of a triangle */
const getCentroid = (tri) => ({
  // Average the three x coordinates.
  x: (tri[0].x + tri[1].x + tri[2].x) / 3,
  // Average the three y coordinates.
  y: (tri[0].y + tri[1].y + tri[2].y) / 3
});

/** Peeks at where a triangle's centroid would end up if it were reflected across a specific edge */
const testCentroid = (tri, edge) => {
  // First endpoint of the candidate mirror edge.
  const p1 = tri[edge];
  // Second endpoint of the candidate mirror edge.
  const p2 = tri[(edge + 1) % 3];
  // Opposite vertex that actually moves under this reflection.
  const p3 = tri[(edge + 2) % 3];
  // Reflect only the opposite vertex, because edge endpoints stay fixed.
  const newP3 = reflectPoint(p3, p1, p2);
  // Return the centroid of the triangle that would result from this reflection.
  return { x: (p1.x + p2.x + newP3.x) / 3, y: (p1.y + p2.y + newP3.y) / 3 };
};

/** Uses Law of Cosines to measure the exact internal radian angle at vertex p2 */
const getAngleAtVertex = (p1, p2, p3) => {
  // Squared distance across the angle, from first adjacent point to second adjacent point.
  const dist13_sq = (p1.x - p3.x)**2 + (p1.y - p3.y)**2;
  // Squared distance from the measured vertex to the first adjacent point.
  const dist12_sq = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
  // Squared distance from the measured vertex to the second adjacent point.
  const dist23_sq = (p3.x - p2.x)**2 + (p3.y - p2.y)**2;
  // Degenerate sides have no meaningful interior angle.
  if (dist12_sq === 0 || dist23_sq === 0) return 0;
  // Law of cosines, clamped before acos to absorb tiny floating-point drift.
  let cosVal = (dist12_sq + dist23_sq - dist13_sq) / (2 * Math.sqrt(dist12_sq) * Math.sqrt(dist23_sq));
  return Math.acos(Math.max(-1, Math.min(1, cosVal))); 
};

/** Calculates global angular trajectory securely in 360 space */
const getGlobalAngle = (startP, endP) => {
  // Horizontal component of the oriented segment.
  const dx = endP.x - startP.x;
  // Vertical component of the oriented segment.
  const dy = endP.y - startP.y;
  // atan2 is robust for vertical lines and chooses the correct quadrant.
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // Normalize the usual [-180, 180] output to [0, 360).
  if (angle < 0) angle += 360; 
  return angle;
};


// ==========================================
// MAIN APPLICATION COMPONENT
// ==========================================

export default function App() {
  // --- APP STATE VARIABLES ---
  // Two modes share the same viewer: geometric ray tracing and code unfolding.
  const [simulatorMode, setSimulatorMode] = useState('code'); 
  // The base triangle can be entered as coordinates or as two angles plus length.
  const [baseInputMode, setBaseInputMode] = useState('angles'); 
  // Default angle data is chosen so physical A is the small angle in the prototype.
  const [angleParams, setAngleParams] = useState({ a: 15, b: 50, length: 10 }); 
  // Coordinate defaults create a right-ish triangle for immediate manual testing.
  const [baseCoordsInput, setBaseCoordsInput] = useState([
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 5 } 
  ]);
  
  // --- RAY SIMULATOR SPECIFIC STATE ---
  // Physical vertex index used as the origin in direct ray mode.
  const [rayStartVertex, setRayStartVertex] = useState(0); 
  // Ray-mode angle is stored in degrees because that is what the UI exposes.
  const [rayAngle, setRayAngle] = useState(60); 
  // Ray-mode bounce limit prevents accidental infinite or huge unfoldings.
  const [maxBounces, setMaxBounces] = useState(15); 
  
  // --- CODE UNFOLDER SPECIFIC STATE ---
  // Space-separated integer blocks are parsed into symbolic angle runs.
  const [billiardsCode, setBilliardsCode] = useState("3 1 7 2 6 2 8 2 4 2"); 
  // Persistent labels are useful for debugging dense unfolded fans.
  const [showAllLabels, setShowAllLabels] = useState(false);

  // --- VIEWPORT & INTERACTION STATE ---
  // Ref to the canvas container lets us measure available SVG pixels.
  const containerRef = useRef(null); 
  // SVG size mirrors the measured container and drives viewport math.
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 }); 
  // Pan stores the mathematical coordinate at the center of the canvas.
  const [pan, setPan] = useState({ x: 5, y: 4 }); 
  // Zoom stores pixels per mathematical unit.
  const [zoom, setZoom] = useState(35); 
  
  // Drag state controls panning and cursor feedback.
  const [isDragging, setIsDragging] = useState(false); 
  // The previous mouse point is a ref because it should not cause re-renders.
  const lastMouse = useRef({ x: 0, y: 0 }); 
  // Screen-space mouse position drives hover labels.
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 }); 

  // Mount/Resize observer
  useEffect(() => {
    // Measure lazily so the SVG fills whatever flex space the layout gives it.
    const measure = () => {
      // The ref is null until React mounts the canvas container.
      if (containerRef.current) {
        // Browser layout is authoritative for the final canvas dimensions.
        const { width, height } = containerRef.current.getBoundingClientRect();
        // Store dimensions in React state so grid and transforms recompute.
        setSvgSize({ width, height });
      }
    };
    // Measure immediately after mount.
    measure();
    // Re-measure when the browser viewport changes.
    window.addEventListener('resize', measure);
    // Remove the listener on unmount to avoid stale callbacks.
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Hardware-accelerated zoom block 
  useEffect(() => {
    // The wheel listener must be attached directly so it can prevent default scroll.
    const container = containerRef.current;
    // Skip setup until the DOM node exists.
    if (!container) return;
    // Wheel zoom changes only the scale; it does not recenter around the mouse yet.
    const handleWheel = (e) => {
      // Prevent the page from scrolling while the user zooms the canvas.
      e.preventDefault();
      // Constant multiplicative zoom feels natural over large coordinate ranges.
      const zoomFactor = 1.1;
      // Browser wheel deltas are positive for scroll down, which we treat as zoom out.
      const direction = e.deltaY > 0 ? -1 : 1;
      // Clamp zoom to keep SVG stroke math and interaction usable.
      setZoom(prev => Math.max(0.5, Math.min(prev * (direction > 0 ? zoomFactor : 1 / zoomFactor), 5000)));
    };
    // passive:false is required because handleWheel calls preventDefault.
    container.addEventListener('wheel', handleWheel, { passive: false });
    // Remove the exact listener when dependencies change or the app unmounts.
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);


  // --- DYNAMIC GEOMETRY GENERATION ---
  
  const baseTriangle = useMemo(() => {
    // Local `points` is assigned from exactly one input mode.
    let points;
    // Coordinate mode trusts the three user-editable vertices directly.
    if (baseInputMode === 'coords') {
      // Number() converts text inputs while `|| 0` keeps invalid blanks renderable.
      points = baseCoordsInput.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    } else {
      // Angle mode interprets A and B in degrees and length as side AB.
      const A = Number(angleParams.a) || 0; 
      const B = Number(angleParams.b) || 0; 
      const L = Number(angleParams.length) || 0; 
      // C is determined by the Euclidean triangle angle sum.
      const C = 180 - A - B; 
      
      // Invalid triangles still render a fallback so the UI never goes blank.
      if (A <= 0 || B <= 0 || C <= 0 || L <= 0) {
        points = [{x: 0, y: 0}, {x: Math.max(L, 1), y: 0}, {x: Math.max(L, 1)/2, y: 1}]; 
      } else {
        // Convert degrees to radians for Math.sin/cos.
        const radA = A * Math.PI / 180;
        const radB = B * Math.PI / 180;
        const radC = C * Math.PI / 180;
        // Law of sines computes side AC from the chosen base AB.
        const b = L * (Math.sin(radB) / Math.sin(radC));
        
        // Place A at the origin, B on the x-axis, and C by polar coordinates from A.
        points = [
          { x: 0, y: 0 },
          { x: L, y: 0 },
          { x: b * Math.cos(radA), y: b * Math.sin(radA) }
        ];
      }
    }
    // The base triangle uses a neutral color because it is the fixed anchor.
    return { id: 'T0', name: 'T0 (Base)', points, color: '#e2e8f0' }; 
  }, [baseCoordsInput, baseInputMode, angleParams]);


  const rayData = useMemo(() => {
    // In code mode, skip all ray calculations and expose a harmless empty result.
    if (simulatorMode !== 'ray') return { triangles: [], rayLine: null };

    // Work from the current physical base triangle.
    const T0 = baseTriangle.points;
    // Accumulate reflected copies generated by ray intersections.
    const triangles = [];
    
    // Ray origin is the selected physical vertex.
    const O = { ...T0[rayStartVertex] };
    // Convert the displayed degree angle into a unit direction.
    const rad = (rayAngle * Math.PI) / 180;
    const D = { x: Math.cos(rad), y: Math.sin(rad) };

    // currentTri is the unfolded triangle currently containing the ray segment.
    let currentTri = [...T0];
    // currentRayT is the last accepted parameter along O + tD.
    let currentRayT = 0; 

    // Stop after maxBounces even if geometry would continue further.
    for (let i = 0; i < maxBounces; i++) {
      // bestT tracks the nearest future side intersection.
      let bestT = Infinity; 
      // bestEdge tracks which edge produced bestT.
      let bestEdge = null; 

      // Test the infinite ray against each edge segment of the current triangle.
      for (let e = 0; e < 3; e++) {
        // Segment start.
        const V1 = currentTri[e];
        // Segment end, wrapping around for edge 2.
        const V2 = currentTri[(e + 1) % 3];
        // Segment direction.
        const E = { x: V2.x - V1.x, y: V2.y - V1.y }; 
        
        // 2D cross product denominator for ray/segment intersection.
        const denom = D.x * E.y - D.y * E.x;
        // Parallel lines cannot produce a stable crossing.
        if (Math.abs(denom) < 1e-10) continue; 

        // Difference from ray origin to segment start.
        const diff = { x: V1.x - O.x, y: V1.y - O.y };
        // t parameter along the ray.
        const t = (diff.x * E.y - diff.y * E.x) / denom;
        // u parameter along the segment.
        const u = (diff.x * D.y - diff.y * D.x) / denom;

        // Accept only future ray hits that land on the finite segment.
        if (t > currentRayT + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) {
          // Keep the nearest future hit.
          if (t < bestT) { 
            bestT = t; 
            bestEdge = e; 
          }
        }
      }

      // No future edge was hit, so the unfolded ray leaves the computed region.
      if (bestEdge === null) break; 

      // Convert the winning ray parameter back into coordinates.
      const hitX = O.x + bestT * D.x;
      const hitY = O.y + bestT * D.y;
      // The selected origin vertex is also used as a singular target check.
      const targetVertex = currentTri[rayStartVertex];
      // Squared distance avoids an unnecessary square root.
      const distSq = (hitX - targetVertex.x)**2 + (hitY - targetVertex.y)**2;
      
      // Stop rendering if ray hits a target singularity perfectly
      if (distSq < 1e-10) {
        // Preserve the final parameter for the displayed ray length.
        currentRayT = bestT;
        break;
      }

      // Reflect the triangle across the side the ray crossed.
      const p1 = currentTri[bestEdge];
      const p2 = currentTri[(bestEdge + 1) % 3];
      const p3 = currentTri[(bestEdge + 2) % 3];
      const newP3 = reflectPoint(p3, p1, p2);

      // Preserve edge endpoints and replace only the opposite vertex.
      const nextTri = [];
      nextTri[bestEdge] = { ...p1 };
      nextTri[(bestEdge + 1) % 3] = { ...p2 };
      nextTri[(bestEdge + 2) % 3] = { ...newP3 };

      // Record the displayed reflected triangle.
      triangles.push({
        id: `Ray-T${i+1}`,
        points: nextTri,
        color: COLORS[(i) % COLORS.length]
      });

      // Continue intersecting from the reflected triangle.
      currentTri = nextTri;
      // Advance past the side just hit to avoid re-hitting it immediately.
      currentRayT = bestT;
    }

    // If nothing was hit, draw a ray long enough to be visible in the current viewport.
    let finalT = currentRayT === 0 ? Math.max(svgSize.width, svgSize.height) / zoom : currentRayT;
    // Return both the reflected triangle chain and the visible ray segment.
    return {
      triangles,
      rayLine: { x1: O.x, y1: O.y, x2: O.x + finalT * D.x, y2: O.y + finalT * D.y }
    };
  }, [simulatorMode, baseTriangle, rayStartVertex, rayAngle, maxBounces, svgSize, zoom]);


  const codeData = useMemo(() => {
    // Default data keeps downstream rendering simple when code mode is inactive.
    const defaultData = { triangles: [], parsedSequence: [], sideSequence: [], idxToAngle: {0: 'x', 1: 'y', 2: 'z'} };
    // Empty code means no reflected chain should be rendered.
    if (simulatorMode !== 'code' || !billiardsCode.trim()) return defaultData;

    // Parse all whitespace-separated integers and drop malformed tokens.
    const nums = billiardsCode.trim().split(/\s+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    // If every token was malformed, use the same empty default.
    if (nums.length === 0) return defaultData;

    // --- ALGORITHMIC PARSER ---
    // `angles` stores the symbolic angle assigned to each integer run.
    const angles = [];
    // The symbolic angle alphabet is fixed by the conjecture notation.
    const axes = ['x', 'y', 'z'];
    // Historical code convention: the first block starts at y.
    if (nums.length > 0) angles.push('y');
    // Historical code convention: the second block starts at x.
    if (nums.length > 1) angles.push('x');

    // Derive each later symbolic label from parity and the two previous labels.
    for (let i = 2; i < nums.length; i++) {
      // Parity is read from the previous count.
      const currNum = nums[i - 1]; 
      // The previous symbolic angle.
      const currAngle = angles[i - 1];
      // The symbolic angle before that.
      const lastAngle = angles[i - 2];

      // Even previous count repeats the label from two positions back.
      if (currNum % 2 === 0) angles.push(lastAngle); 
      // Odd previous count picks the only remaining symbolic label.
      else angles.push(axes.find(a => a !== currAngle && a !== lastAngle)); 
    }

    // Pair each numeric run with its derived symbolic angle for display and unfolding.
    const parsedSequence = nums.map((n, i) => ({ count: n, angle: angles[i] }));
    
    // --- SMART ANGLE MAPPING ---
    // Track the largest run attached to each symbolic angle.
    const maxBouncesCode = { x: 0, y: 0, z: 0 };
    // A larger run is heuristically associated with a smaller geometric angle.
    parsedSequence.forEach(step => {
      if (step.count > maxBouncesCode[step.angle]) {
        maxBouncesCode[step.angle] = step.count;
      }
    });

    // Physical triangle vertices for angle measurement.
    const pts = baseTriangle.points;
    // Compute physical interior angles and retain their vertex indices.
    const actualAngles = [
      { idx: 0, rad: getAngleAtVertex(pts[2], pts[0], pts[1]) }, 
      { idx: 1, rad: getAngleAtVertex(pts[0], pts[1], pts[2]) }, 
      { idx: 2, rad: getAngleAtVertex(pts[1], pts[2], pts[0]) }  
    ].sort((a, b) => a.rad - b.rad); 

    // Sort symbols by their maximum run, descending, then alphabetically for stability.
    const syms = ['x', 'y', 'z'].sort((a, b) => (maxBouncesCode[b] - maxBouncesCode[a]) || a.localeCompare(b));

    // angleToIdx maps symbolic labels to physical vertex indices.
    const angleToIdx = {}; 
    // idxToAngle maps physical vertex indices back to symbolic labels.
    const idxToAngle = {}; 
    // Largest-run symbol goes to smallest physical angle.
    angleToIdx[syms[0]] = actualAngles[0].idx; idxToAngle[actualAngles[0].idx] = syms[0];
    // Middle-run symbol goes to middle physical angle.
    angleToIdx[syms[1]] = actualAngles[1].idx; idxToAngle[actualAngles[1].idx] = syms[1];
    // Smallest-run symbol goes to largest physical angle.
    angleToIdx[syms[2]] = actualAngles[2].idx; idxToAngle[actualAngles[2].idx] = syms[2];

    // --- SPATIAL MIRRORING ---
    // Reflected triangle copies emitted by the code unfolding.
    const triangles = [];
    // Actual side labels crossed during unfolding, used by the sidebar log.
    const sideSequence = []; 
    // Begin from a mutable copy of the base triangle's points.
    let currentTri = [...baseTriangle.points];
    // The centroid gives a coarse notion of current unfolding direction.
    let currentCentroid = getCentroid(currentTri);
    // Start direction points from physical A to the initial centroid.
    let currentDir = { x: currentCentroid.x - currentTri[0].x, y: currentCentroid.y - currentTri[0].y };

    // Last reflected edge prevents immediately choosing the same side twice within a fan.
    let lastEdge = null; 
    // Count emitted triangles separately from parsed run count.
    let triCount = 0;
    // Hard cap protects the browser if the code input is huge.
    const MAX_TRIS = 3000; 
    
    // A vertex angle is adjacent to exactly two triangle edges.
    const getEdgesForAngle = (idx) => idx === 0 ? [0, 2] : (idx === 1 ? [0, 1] : [1, 2]);

    // Expand every parsed block into repeated side reflections.
    for (const step of parsedSequence) {
      // Convert this symbolic angle to its two physical adjacent edges.
      const edges = getEdgesForAngle(angleToIdx[step.angle]);
      // currentEdge will be chosen either by alternation or forwardness.
      let currentEdge;

      // If we are already alternating within this fan, choose the other adjacent edge.
      if (lastEdge !== null && edges.includes(lastEdge)) {
        currentEdge = edges[0] === lastEdge ? edges[1] : edges[0];
      } else {
        // Otherwise preview both candidate reflections.
        const cA = testCentroid(currentTri, edges[0]);
        const cB = testCentroid(currentTri, edges[1]);
        
        // Dot products compare which candidate better continues the current unfolding direction.
        const dotA = (cA.x - currentCentroid.x) * currentDir.x + (cA.y - currentCentroid.y) * currentDir.y;
        const dotB = (cB.x - currentCentroid.x) * currentDir.x + (cB.y - currentCentroid.y) * currentDir.y;
        // Pick the more forward candidate.
        currentEdge = dotA > dotB ? edges[0] : edges[1];
      }

      // Emit exactly `count` reflected triangles for this symbolic run.
      for (let i = 0; i < step.count; i++) {
        // Stop immediately once the hard cap is reached.
        if (triCount >= MAX_TRIS) break;

        // Log the conventional side number corresponding to the reflected edge.
        sideSequence.push(EDGE_TO_SIDE[currentEdge]);

        // Edge endpoints remain fixed under reflection.
        const p1 = currentTri[currentEdge];
        const p2 = currentTri[(currentEdge + 1) % 3];
        // The opposite vertex is the only point that moves.
        const p3 = currentTri[(currentEdge + 2) % 3];
        // Mirror that opposite vertex across the chosen side.
        const newP3 = reflectPoint(p3, p1, p2);

        // Build the next triangle in the same physical vertex-index order.
        const nextTri = [];
        nextTri[currentEdge] = { ...p1 };
        nextTri[(currentEdge + 1) % 3] = { ...p2 };
        nextTri[(currentEdge + 2) % 3] = { ...newP3 };

        // Store the reflected triangle with a stable id and cycling visual color.
        triangles.push({
          id: `Code-T${triangles.length + 1}`,
          points: nextTri,
          color: COLORS[(triangles.length) % COLORS.length]
        });

        // Update unfolding direction from old centroid to new centroid.
        const nextCentroid = getCentroid(nextTri);
        currentDir = { x: nextCentroid.x - currentCentroid.x, y: nextCentroid.y - currentCentroid.y };
        currentCentroid = nextCentroid;

        // Continue from the newly reflected triangle.
        currentTri = nextTri;
        // Remember the side just used.
        lastEdge = currentEdge;
        // Alternate to the other edge in the same fan for the next bounce.
        currentEdge = currentEdge === edges[0] ? edges[1] : edges[0];
        // Increase the safety counter.
        triCount++;
      }
      // Stop outer loop too if the safety cap was hit.
      if (triCount >= MAX_TRIS) break;
    }

    // Return every code-derived structure consumed by the UI.
    return { triangles, parsedSequence, idxToAngle, sideSequence };
  }, [simulatorMode, billiardsCode, baseTriangle]);


  // --- GEOMETRY ROUTER ---
  // Pick the triangle chain produced by the currently selected mode.
  const activeTriangles = simulatorMode === 'ray' ? rayData.triangles : codeData.triangles;
  // Map physical vertex indices back to symbolic labels for UI and validation.
  const labelsMap = codeData.idxToAngle || {0: 'x', 1: 'y', 2: 'z'};

  // Extracted constants to prevent repeated calculation overhead inside rendering logic
  // Find the physical vertex index carrying a symbolic label under the parser map.
  const getVertexForSymbol = (symbol, fallback) => {
    // Object.entries gives [physicalVertexIndex, symbolicLabel] pairs.
    const match = Object.entries(labelsMap).find(([, label]) => label === symbol);
    // Fall back to the conventional A/B/C index when the code map is absent.
    return match ? Number(match[0]) : fallback;
  };
  // Find the current physical vertex used for symbolic y fan checks.
  const yVertexIdx = getVertexForSymbol('y', 1);
  // Find the current physical vertex used for symbolic z fan checks.
  const zVertexIdx = getVertexForSymbol('z', 2);
  // The shot endpoint is the physical A vertex; in the default code mapping this
  // is the symbolic z vertex, which is why the UI may show it as z/A.
  // Keep this as an explicit constant because it is the central shot convention.
  const shotVertexIdx = 0;
  // Read the symbolic name of physical A so the UI can say "z/A" when relevant.
  const shotSymbol = labelsMap[shotVertexIdx] || 'A';
  // Use the first physical A as the start of the shot line.
  const startShot = baseTriangle.points[shotVertexIdx] || baseTriangle.points[0];
  // Use the last reflected physical A as the end of the shot line.
  const finalShot = activeTriangles.length > 0 ? activeTriangles[activeTriangles.length - 1].points[shotVertexIdx] : startShot;
  // Store the shot vector's x component once for cross-product tests.
  const lineDx = finalShot.x - startShot.x;
  // Store the shot vector's y component once for cross-product tests.
  const lineDy = finalShot.y - startShot.y;
  // Store shot length so tolerance scales with the geometry size.
  const lineLength = Math.hypot(lineDx, lineDy);
  // Keep strict tests numerically sane while still rejecting on-line fan points.
  const lineSideTolerance = Math.max(1e-10, lineLength * Math.max(1, lineLength) * 1e-10);
  // Signed area test: positive means left/above the oriented shot line.
  const getLineSide = (p) => lineDx * (p.y - startShot.y) - lineDy * (p.x - startShot.x);
  // Convert a point and symbolic label into a validator color/status object.
  const getFanPointValidation = (p, symbol) => {
    // Fan validation only applies to code mode with a non-degenerate shot line.
    if (simulatorMode !== 'code' || activeTriangles.length === 0 || lineLength < 1e-12) {
      return null;
    }

    // y is required on the positive side; z is required on the negative side.
    const expectedSide = symbol === 'y' ? 1 : symbol === 'z' ? -1 : 0;
    // Non-fan symbols are ignored by this validator.
    if (expectedSide === 0) return null;

    // Compute the signed side using a cross product, not slope division.
    const side = getLineSide(p);
    // Enforce strict side separation with a tolerance band around the red line.
    const valid = expectedSide > 0
      ? side > lineSideTolerance
      : side < -lineSideTolerance;

    // Return both semantic data and display colors to keep UI logic simple.
    return {
      side,
      valid,
      expected: expectedSide > 0 ? 'above' : 'below',
      color: valid ? '#22c55e' : '#ef4444',
      ring: valid ? '#14532d' : '#7f1d1d'
    };
  };

  const fanValidation = useMemo(() => {
    // Without a code unfolding there are no fan vertices to validate.
    if (simulatorMode !== 'code' || activeTriangles.length === 0) {
      return { status: 'idle', checked: 0, violations: [] };
    }

    // A zero-length endpoint line cannot separate above/below fan vertices.
    if (lineLength < 1e-12) {
      return {
        status: 'invalid',
        checked: 0,
        violations: [{ triId: 'trajectory', symbol: 'x', expected: 'nonzero line', side: 0 }]
      };
    }

    // Validate the base triangle and every reflected copy.
    const allTris = [baseTriangle, ...activeTriangles];
    // These side assignments encode the current prototype convention.
    const expectedVertices = [
      { symbol: 'y', idx: yVertexIdx, side: 1, expected: 'above' },
      { symbol: 'z', idx: zVertexIdx, side: -1, expected: 'below' }
    ];

    // Deduplicate repeated coordinates so shared unfolded vertices count once.
    const seen = new Set();
    // Keep only the first few violations for readable sidebar output.
    const violations = [];
    // Count unique fan vertices checked for the status summary.
    let checked = 0;

    // Walk every triangle copy in unfolded order.
    for (const tri of allTris) {
      // Check each fan symbol expected by the validator.
      for (const expected of expectedVertices) {
        // Pull the current physical vertex for this symbolic fan label.
        const p = tri.points[expected.idx];
        // Skip malformed triangles defensively.
        if (!p) continue;
        // Allow the shot endpoint itself to lie on the line at the beginning/end.
        if (
          expected.idx === shotVertexIdx
          && (tri.id === 'T0' || tri.id === activeTriangles[activeTriangles.length - 1].id)
        ) {
          continue;
        }

        // Round for stable dedup keys without making validation itself rounded.
        const key = `${expected.symbol}:${p.x.toFixed(10)},${p.y.toFixed(10)}`;
        // Skip shared vertices already checked under this symbol.
        if (seen.has(key)) continue;
        // Record this coordinate/symbol pair as checked.
        seen.add(key);

        // Count this unique fan vertex.
        checked++;
        // Use signed area against the shot endpoint line.
        const side = lineDx * (p.y - startShot.y) - lineDy * (p.x - startShot.x);
        // Compare against strict above/below expectation.
        const valid = expected.side > 0
          ? side > lineSideTolerance
          : side < -lineSideTolerance;

        // Store enough context for the sidebar if this fan vertex fails.
        if (!valid && violations.length < 12) {
          violations.push({
            triId: tri.id,
            symbol: expected.symbol,
            expected: expected.expected,
            side,
            point: p
          });
        }
      }
    }

    // The shot is valid exactly when every required fan vertex passes.
    return {
      status: violations.length === 0 ? 'valid' : 'invalid',
      checked,
      violations
    };
  }, [
    simulatorMode,
    activeTriangles,
    baseTriangle,
    yVertexIdx,
    zVertexIdx,
    shotVertexIdx,
    lineLength,
    lineSideTolerance,
    lineDx,
    lineDy,
    startShot.x,
    startShot.y
  ]);

  // --- INTERACTION HANDLERS ---
  const handleMouseDown = (e) => {
    // Only left-click drags should pan the mathematical viewport.
    if (e.button !== 0) return; 
    // Enter dragging mode so mousemove updates pan instead of hover labels.
    setIsDragging(true);
    // Remember the starting screen point for delta calculations.
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  
  const handleMouseMove = (e) => {
    // During drag, translate screen-pixel deltas back into math-unit deltas.
    if (isDragging) {
      // Divide by zoom because zoom is pixels per math unit.
      const dx = (e.clientX - lastMouse.current.x) / zoom;
      // SVG screen y grows downward while math y grows upward.
      const dy = (e.clientY - lastMouse.current.y) / zoom;
      // Move the center opposite the drag direction for natural canvas panning.
      setPan(prev => ({ x: prev.x - dx, y: prev.y + dy }));
      // Update the previous mouse point for the next delta.
      lastMouse.current = { x: e.clientX, y: e.clientY };
    } else {
      // Hover labels use screen coordinates and are disabled when all labels are pinned.
      if (containerRef.current && !showAllLabels) {
        // Convert page coordinates into coordinates relative to the SVG container.
        const rect = containerRef.current.getBoundingClientRect();
        setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }
  };
  
  // Any mouse release or canvas leave ends pan mode.
  const handleMouseUp = () => setIsDragging(false);

  const handleFitScreen = () => {
    // Include the base triangle and whatever reflected chain is active.
    const allTris = [baseTriangle, ...activeTriangles];
    // Defensive guard: there is normally always at least the base triangle.
    if (allTris.length === 0) return;
    
    // Initialize bounds so the first point always expands them.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Sweep every vertex in mathematical coordinates.
    allTris.forEach(tri => tri.points.forEach(p => {
        // Expand left bound.
        if (p.x < minX) minX = p.x;
        // Expand right bound.
        if (p.x > maxX) maxX = p.x;
        // Expand bottom bound.
        if (p.y < minY) minY = p.y;
        // Expand top bound.
        if (p.y > maxY) maxY = p.y;
    }));
    
    // Avoid zero-width fit boxes for degenerate inputs.
    const w = Math.max(maxX - minX, 1);
    // Avoid zero-height fit boxes for degenerate inputs.
    const h = Math.max(maxY - minY, 1);
    // Center the viewport on the geometry bounds.
    setPan({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    // Choose the largest zoom that leaves about 50 px padding per side.
    setZoom(Math.min((svgSize.width - 100) / w, (svgSize.height - 100) / h));
  };

  // --- RENDERING HELPERS ---
  // The SVG group transform maps mathematical coordinates into screen pixels.
  const transformStr = `translate(${svgSize.width / 2}, ${svgSize.height / 2}) scale(${zoom}, ${-zoom}) translate(${-pan.x}, ${-pan.y})`;
  // Convert a math x coordinate to screen-space x for unscaled annotations.
  const toSvgX = (x) => svgSize.width / 2 + (x - pan.x) * zoom;
  // Convert a math y coordinate to screen-space y; sign flips because SVG y points down.
  const toSvgY = (y) => svgSize.height / 2 - (y - pan.y) * zoom; 
  
  const grid = useMemo(() => {
    // Use finer grid spacing as the user zooms in.
    const step = zoom > 150 ? 1 : zoom > 50 ? 2 : zoom > 15 ? 10 : 50;
    
    // Left visible math coordinate.
    const minMathX = pan.x - (svgSize.width / 2) / zoom;
    // Right visible math coordinate.
    const maxMathX = pan.x + (svgSize.width / 2) / zoom;
    // Bottom visible math coordinate.
    const minMathY = pan.y - (svgSize.height / 2) / zoom;
    // Top visible math coordinate.
    const maxMathY = pan.y + (svgSize.height / 2) / zoom;

    // Separate arrays drive vertical and horizontal SVG line generation.
    const linesX = [], linesY = [];
    // Start on the first visible multiple of the chosen step.
    for (let x = Math.floor(minMathX / step) * step; x <= maxMathX; x += step) linesX.push(x);
    // Do the same for horizontal grid coordinates.
    for (let y = Math.floor(minMathY / step) * step; y <= maxMathY; y += step) linesY.push(y);
    // Return both line coordinates and visible bounds for SVG line endpoints.
    return { linesX, linesY, minMathX, maxMathX, minMathY, maxMathY };
  }, [pan, zoom, svgSize]);


  return (
    <div className="flex h-screen w-full min-w-0 bg-[#080b0f] text-slate-200 font-sans overflow-hidden">
      
      {/* LEFT PANEL - CONTROLS & INSPECTOR */}
      <div className="w-[340px] 2xl:w-[360px] border-r border-white/10 flex flex-col bg-[#10151c] shadow-[12px_0_36px_rgba(0,0,0,0.32)] z-10 overflow-hidden shrink-0">
        
        {/* App Header & Tabs */}
        <div className="pt-8 pb-0 px-5 border-b border-white/10 bg-[#0c1117] shrink-0">
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2 mb-1">
            <Activity className="w-5 h-5 text-cyan-300" /> Unfolding Viewer
          </h1>
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-widest mb-5">Invisible Point Workbench</p>
          
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-[#070b10] p-1">
            <button 
              onClick={() => setSimulatorMode('ray')}
              title="Shoot one ray from a selected vertex."
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${simulatorMode === 'ray' ? 'bg-amber-300/15 text-amber-100 shadow-sm' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Zap className="w-4 h-4"/> Trace Ray
            </button>
            <button 
              onClick={() => setSimulatorMode('code')}
              title="Unfold a space-separated integer code."
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${simulatorMode === 'code' ? 'bg-cyan-300/15 text-cyan-100 shadow-sm' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Code2 className="w-4 h-4"/> Unfold Code
            </button>
          </div>
        </div>

        {/* Scrollable Inspector Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0f141a]">
          
          {/* BASE GEOMETRY CONFIG */}
          <div className="p-4 bg-[#151c24] m-3 rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.28)] border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5"/> Base Geometry
              </h2>
              <div className="flex bg-[#0b1016] p-0.5 rounded-md border border-white/10">
                <button
                  onClick={() => setBaseInputMode('coords')}
                  title="Enter all three triangle vertices as coordinates."
                  className={`px-2 py-1 text-[10px] font-bold rounded ${baseInputMode === 'coords' ? 'bg-cyan-400/15 text-cyan-100 shadow-sm' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  Coordinates
                </button>
                <button
                  onClick={() => setBaseInputMode('angles')}
                  title="Enter two angles and a base length."
                  className={`px-2 py-1 text-[10px] font-bold rounded ${baseInputMode === 'angles' ? 'bg-cyan-400/15 text-cyan-100 shadow-sm' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  Angles
                </button>
              </div>
            </div>

            {baseInputMode === 'coords' ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-500 w-12 text-right mr-1">{['A', 'B', 'C'][i]} (V{i})</span>
                    <input type="text" value={baseCoordsInput[i].x} onChange={e => {
                      const newCoords = [...baseCoordsInput];
                      newCoords[i].x = e.target.value;
                      setBaseCoordsInput(newCoords);
                    }} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2.5 py-1.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono text-slate-100 placeholder:text-slate-600 transition-all" placeholder="x" />
                    <input type="text" value={baseCoordsInput[i].y} onChange={e => {
                      const newCoords = [...baseCoordsInput];
                      newCoords[i].y = e.target.value;
                      setBaseCoordsInput(newCoords);
                    }} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2.5 py-1.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono text-slate-100 placeholder:text-slate-600 transition-all" placeholder="y" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 w-16 text-right mr-1">Base Length</span>
                  <input type="number" step="0.1" value={angleParams.length} onChange={e => setAngleParams({...angleParams, length: e.target.value})} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2.5 py-1.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono text-slate-100 transition-all" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 w-16 text-right mr-1">Angle A</span>
                  <div className="relative w-full">
                    <input type="number" step="0.1" value={angleParams.a} onChange={e => setAngleParams({...angleParams, a: e.target.value})} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2.5 py-1.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono text-slate-100 transition-all pr-6" />
                    <span className="absolute right-2 top-1.5 text-slate-500 font-mono text-xs">&deg;</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 w-16 text-right mr-1">Angle B</span>
                  <div className="relative w-full">
                    <input type="number" step="0.1" value={angleParams.b} onChange={e => setAngleParams({...angleParams, b: e.target.value})} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2.5 py-1.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono text-slate-100 transition-all pr-6" />
                    <span className="absolute right-2 top-1.5 text-slate-500 font-mono text-xs">&deg;</span>
                  </div>
                </div>
                {(Number(angleParams.a) + Number(angleParams.b) >= 180) && (
                  <div className="text-[10px] text-red-200 mt-1 pl-16 text-center font-medium bg-red-500/10 rounded py-1 border border-red-400/20">Angles must sum &lt; 180&deg;</div>
                )}
              </div>
            )}
          </div>

          {/* SIMULATOR PARAMETERS */}
          {simulatorMode === 'ray' ? (
            <div className="p-4 bg-[#151c24] m-3 rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.28)] border border-white/10">
              <h2 className="text-xs uppercase tracking-wider font-bold text-amber-200 mb-4 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Simulation Rules
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 flex justify-between mb-1.5"><span>Origin Vertex</span></label>
                  <div className="flex gap-2">
                    {[0, 1, 2].map(v => (
                      <button
                        key={v}
                        onClick={() => setRayStartVertex(v)}
                        title={`Start the ray at vertex ${['A', 'B', 'C'][v]}.`}
                        className={`flex-1 py-1.5 text-xs rounded-md font-bold border transition-colors ${rayStartVertex === v ? 'bg-amber-300/15 border-amber-300/40 text-amber-100' : 'bg-[#0b1016] border-white/10 text-slate-500 hover:text-slate-200 hover:border-slate-500/50'}`}
                      >
                        Start {['A', 'B', 'C'][v]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 flex justify-between mb-1.5"><span>Trajectory Angle</span></label>
                  <div className="flex gap-3 items-center">
                    <input type="range" min="0" max="360" step="0.1" value={rayAngle} onChange={e => setRayAngle(parseFloat(e.target.value))} className="flex-1 accent-amber-600" />
                    <div className="relative w-20">
                      <input type="number" value={rayAngle} onChange={e => setRayAngle(parseFloat(e.target.value))} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-2 py-1.5 text-xs text-center focus:bg-[#101923] focus:border-amber-300 focus:ring-1 focus:ring-amber-300 outline-none font-mono text-slate-100" />
                      <span className="absolute right-1.5 top-1.5 text-slate-500 font-mono text-xs">&deg;</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1.5">Max Bounces</label>
                  <input type="number" min="0" max="1000" step="1" value={maxBounces} onChange={e => setMaxBounces(parseInt(e.target.value))} className="w-full bg-[#0b1016] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:bg-[#101923] focus:border-amber-300 focus:ring-1 focus:ring-amber-300 outline-none font-mono text-slate-100" />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-[#151c24] m-3 rounded-lg shadow-[0_8px_28px_rgba(0,0,0,0.28)] border border-white/10">
              <h2 className="text-xs uppercase tracking-wider font-bold text-cyan-200 mb-2 flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" /> Sequence Parser
              </h2>
              <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                Space-separated bounce-block counts, parsed into symbolic angle runs.
              </p>
              <textarea 
                value={billiardsCode}
                onChange={e => setBilliardsCode(e.target.value)}
                className="w-full bg-[#0b1016] border border-white/10 rounded-md p-2.5 text-sm focus:bg-[#101923] focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 outline-none font-mono resize-none h-20 text-slate-100 shadow-inner placeholder:text-slate-600"
                placeholder="e.g. 1 5 16 5 1 2 3 6"
              />
            </div>
          )}

          {/* ANALYTICS & DATA LOGS */}
          <div className="px-3 pb-8">
            
            {/* Code-mode shot line, matching the red endpoint segment drawn on the canvas. */}
            {simulatorMode === 'code' && activeTriangles.length > 0 && (
              <div className="mb-3 bg-[#151c24] p-4 rounded-lg border border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-3 flex items-center gap-1.5">
                  <Compass className="w-3 h-3 text-cyan-300"/> Shot Line ({shotSymbol}/A)
                </h3>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b border-white/10 pb-2">
                    <span className="text-[11px] text-slate-500 font-medium">Final endpoint</span>
                    <span className="text-xs font-mono text-slate-100 font-semibold bg-[#0b1016] px-2 py-0.5 rounded border border-white/10">
                      {finalShot.x.toFixed(4)}, {finalShot.y.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500 font-medium">Global Angle <span className="font-mono text-[9px] text-slate-600 ml-1">atan2</span></span>
                    <span className="text-xs font-mono text-cyan-100 font-bold bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-300/20">
                      {getGlobalAngle(startShot, finalShot).toFixed(6)}&deg;
                    </span>
                  </div>
                </div>
              </div>
            )}

            {simulatorMode === 'code' && activeTriangles.length > 0 && (
              <div className={`mb-3 p-4 rounded-lg border shadow-[0_8px_28px_rgba(0,0,0,0.22)] ${fanValidation.status === 'valid' ? 'bg-emerald-500/10 border-emerald-300/25' : 'bg-red-500/10 border-red-300/25'}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                    {fanValidation.status === 'valid' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-300" />
                    )}
                    Fan Validator
                  </h3>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${fanValidation.status === 'valid' ? 'text-emerald-100 border-emerald-300/25 bg-emerald-400/10' : 'text-red-100 border-red-300/25 bg-red-400/10'}`}>
                    {fanValidation.status === 'valid' ? 'VALID' : 'INVALID'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Checked <span className="font-mono text-slate-200">{fanValidation.checked}</span> unique fan vertices:
                  <span className="font-mono text-emerald-300"> y above</span>,
                  <span className="font-mono text-emerald-300"> z below</span>.
                  <div className="mt-1 text-[10px] text-slate-500">
                    Red line: <span className="font-mono text-slate-300">first {shotSymbol}/A to final {shotSymbol}/A</span>
                  </div>
                </div>
                {fanValidation.violations.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {fanValidation.violations.slice(0, 3).map((violation, idx) => (
                      <div key={`${violation.triId}-${violation.symbol}-${idx}`} className="rounded-md border border-red-300/20 bg-[#0b1016]/80 px-2 py-1.5 text-[10px] text-red-100">
                        <span className="font-mono font-bold">{violation.triId}</span>
                        <span className="font-mono"> {violation.symbol}</span> expected {violation.expected}; side =
                        <span className="font-mono"> {violation.side.toExponential(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SEQUENCE LOGS (Code Sim Only) */}
            {simulatorMode === 'code' && codeData.parsedSequence.length > 0 && (
              <div className="mb-3 bg-[#151c24] p-4 rounded-lg border border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3" /> Unfolded Sequence
                </h3>
                <div className="bg-[#0b1016] p-2 rounded-md border border-white/10 max-h-24 overflow-y-auto flex flex-wrap gap-1.5 custom-scrollbar shadow-inner">
                  {codeData.parsedSequence.map((step, idx) => (
                    <span key={idx} className="bg-[#17212b] text-slate-200 text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 shadow-sm flex items-center">
                      {step.count}<span className="text-cyan-300 font-bold ml-0.5">{step.angle}</span>
                    </span>
                  ))}
                </div>
                
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-4 mb-2 flex items-center gap-1.5">
                  <ChevronRight className="w-3 h-3" /> Boundary Intersections
                </h3>
                <div className="bg-[#0b1016] p-2.5 rounded-md border border-white/10 max-h-24 overflow-y-auto font-mono text-[11px] font-medium text-slate-300 custom-scrollbar break-words leading-relaxed shadow-inner tracking-widest">
                  {codeData.sideSequence?.join(' ')}
                </div>
              </div>
            )}

            {/* VERTEX LOGS */}
            <div className="bg-[#151c24] p-4 rounded-lg border border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
              <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                <h2 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
                  <List className="w-3 h-3"/> Vertices Log
                </h2>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 cursor-pointer hover:text-cyan-200 transition-colors">
                  <input type="checkbox" checked={showAllLabels} onChange={e => setShowAllLabels(e.target.checked)} className="accent-cyan-400 w-3 h-3" />
                  PERSIST LABELS
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-mono bg-[#0b1016] p-2.5 rounded-md border border-white/10 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-300" />
                  <div className="font-bold mb-1.5 text-slate-200 ml-1">{baseTriangle.name}</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-500 ml-1">
                    <div>A ({labelsMap[0]}): <span className="text-slate-200 font-medium">{baseTriangle.points[0].x.toFixed(4)}, {baseTriangle.points[0].y.toFixed(4)}</span></div>
                    <div>B ({labelsMap[1]}): <span className="text-slate-200 font-medium">{baseTriangle.points[1].x.toFixed(4)}, {baseTriangle.points[1].y.toFixed(4)}</span></div>
                    <div className="col-span-2">C ({labelsMap[2]}): <span className="text-slate-200 font-medium">{baseTriangle.points[2].x.toFixed(4)}, {baseTriangle.points[2].y.toFixed(4)}</span></div>
                  </div>
                </div>

                {activeTriangles.slice(0, 50).map(tri => (
                  <div key={tri.id} className="text-[11px] font-mono bg-[#111821] p-2 rounded-md border border-white/10 shadow-sm relative overflow-hidden hover:bg-[#18222c] transition-colors">
                    <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: tri.color }} />
                    <div className="font-bold mb-1 text-slate-300 ml-1.5">{tri.id}</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-500 ml-1.5">
                      <div>A: <span className="text-slate-300">{tri.points[0].x.toFixed(4)}, {tri.points[0].y.toFixed(4)}</span></div>
                      <div>B: <span className="text-slate-300">{tri.points[1].x.toFixed(4)}, {tri.points[1].y.toFixed(4)}</span></div>
                      <div className="col-span-2">C: <span className="text-slate-300">{tri.points[2].x.toFixed(4)}, {tri.points[2].y.toFixed(4)}</span></div>
                    </div>
                  </div>
                ))}
                {activeTriangles.length > 50 && <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center py-2 bg-[#0b1016] rounded-md border border-white/10">...and {activeTriangles.length - 50} more</div>}
              </div>
            </div>
            
          </div>
        </div>
      </div>

      {/* RIGHT PANEL - SVG CANVAS */}
      <div className="flex-1 min-w-0 relative bg-[#070b10] overflow-hidden">
        
        {/* Floating Canvas Toolbar */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
           {simulatorMode === 'code' && (
             <div className="bg-[#101820]/95 text-slate-400 px-3 py-2 text-[11px] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.32)] border border-white/10 font-mono font-bold flex items-center backdrop-blur">
                GENERATED: <span className="text-cyan-200 ml-2">{activeTriangles.length}</span>
             </div>
           )}
          <button onClick={handleFitScreen} className="bg-[#101820]/95 hover:bg-[#172230] text-slate-300 hover:text-cyan-200 px-3 py-2.5 rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.32)] border border-white/10 transition-colors backdrop-blur flex items-center gap-2 text-xs font-bold" title="Fit all generated triangles to the canvas.">
            <Maximize className="w-4 h-4" />
            Fit
          </button>
        </div>
        
        {/* Interactive SVG Area */}
        <div 
          ref={containerRef}
          className={`w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg width="100%" height="100%" className="block bg-[#070b10]">
            
            {/* HARDWARE ACCELERATED RENDER LAYER */}
            <g transform={transformStr}>
              
              {/* Academic Graph Paper Grid */}
              <g opacity="1">
                {grid.linesX.map(x => <line key={`gx-${x}`} x1={x} y1={grid.minMathY} x2={x} y2={grid.maxMathY} stroke={x === 0 ? "#334155" : "#182231"} strokeWidth={(x === 0 ? 2 : 1) / zoom} />)}
                {grid.linesY.map(y => <line key={`gy-${y}`} x1={grid.minMathX} y1={y} x2={grid.maxMathX} y2={y} stroke={y === 0 ? "#334155" : "#182231"} strokeWidth={(y === 0 ? 2 : 1) / zoom} />)}
              </g>

              {/* Generated Reflections - Glassy geometry look */}
              {activeTriangles.map(tri => (
                <polygon
                  key={tri.id}
                  points={`${tri.points[0].x},${tri.points[0].y} ${tri.points[1].x},${tri.points[1].y} ${tri.points[2].x},${tri.points[2].y}`}
                  fill={tri.color}
                  fillOpacity="0.1"
                  stroke={tri.color}
                  strokeWidth={2.2 / zoom} 
                  strokeLinejoin="round"
                />
              ))}

              {/* Base Triangle - Prominent Anchor */}
              <polygon
                points={`${baseTriangle.points[0].x},${baseTriangle.points[0].y} ${baseTriangle.points[1].x},${baseTriangle.points[1].y} ${baseTriangle.points[2].x},${baseTriangle.points[2].y}`}
                fill={baseTriangle.color}
                fillOpacity="0.08"
                stroke={baseTriangle.color}
                strokeWidth={3 / zoom}
                strokeLinejoin="round"
              />

              {/* Glowing Ray Vector / Visual Analysis Ray Line */}
              {simulatorMode === 'ray' && rayData.rayLine && (
                <g pointerEvents="none">
                  <line
                    x1={rayData.rayLine.x1} y1={rayData.rayLine.y1}
                    x2={rayData.rayLine.x2} y2={rayData.rayLine.y2}
                    stroke="#ea580c" strokeWidth={2.5 / zoom} strokeLinecap="round"
                  />
                  <circle cx={rayData.rayLine.x1} cy={rayData.rayLine.y1} r={4 / zoom} fill="#ea580c" />
                </g>
              )}
              {simulatorMode === 'code' && activeTriangles.length > 0 && (
                <g pointerEvents="none">
                  <line
                    x1={startShot.x} y1={startShot.y}
                    x2={finalShot.x} y2={finalShot.y}
                    stroke="#dc2626" strokeWidth={2.5 / zoom} strokeDasharray={`${8 / zoom},${8 / zoom}`} strokeLinecap="round"
                  />
                  <circle cx={startShot.x} cy={startShot.y} r={5 / zoom} fill="#22c55e" stroke="#dc2626" strokeWidth={1.5 / zoom} />
                  <circle cx={finalShot.x} cy={finalShot.y} r={5 / zoom} fill="#22c55e" stroke="#dc2626" strokeWidth={1.5 / zoom} />
                </g>
              )}
            </g>

            {/* UNSCALED SCREEN-SPACE ANNOTATIONS */}
            <g pointerEvents="none">
              {simulatorMode === 'code' && activeTriangles.length > 0 && (() => {
                const markers = [];
                const seen = new Set();
                const allTris = [baseTriangle, ...activeTriangles];

                for (const tri of allTris) {
                  for (const vertexIdx of [yVertexIdx, zVertexIdx]) {
                    const symbol = labelsMap[vertexIdx];
                    const p = tri.points[vertexIdx];
                    if (!p || (symbol !== 'y' && symbol !== 'z')) continue;
                    if (
                      vertexIdx === shotVertexIdx
                      && (tri.id === 'T0' || tri.id === activeTriangles[activeTriangles.length - 1].id)
                    ) {
                      continue;
                    }

                    const key = `${symbol}:${p.x.toFixed(10)},${p.y.toFixed(10)}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const validation = getFanPointValidation(p, symbol);
                    if (!validation) continue;

                    const cx = toSvgX(p.x);
                    const cy = toSvgY(p.y);
                    const radius = validation.valid ? 4 : 6;

                    markers.push(
                      <g key={`fan-mark-${key}`}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius + 2}
                          fill={validation.ring}
                          opacity={validation.valid ? 0.45 : 0.85}
                        />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius}
                          fill={validation.color}
                          opacity={validation.valid ? 0.78 : 1}
                        />
                        {!validation.valid && (
                          <text
                            x={cx}
                            y={cy + 0.5}
                            fill="#fff1f2"
                            fontSize="8"
                            fontWeight="900"
                            textAnchor="middle"
                            alignmentBaseline="middle"
                            className="font-mono"
                          >
                            {symbol}
                          </text>
                        )}
                      </g>
                    );
                  }
                }

                return markers;
              })()}
              
              {/* Base Triangle Corner Variables (x, y, z) dynamically mapped */}
              {(() => {
                const bPoints = baseTriangle.points;
                const mathCentroidX = (bPoints[0].x + bPoints[1].x + bPoints[2].x) / 3;
                const mathCentroidY = (bPoints[0].y + bPoints[1].y + bPoints[2].y) / 3;
                const svgCentroidX = toSvgX(mathCentroidX);
                const svgCentroidY = toSvgY(mathCentroidY);

                return [0, 1, 2].map((vertexIdx) => {
                  const angleLabel = labelsMap[vertexIdx];
                  const p = bPoints[vertexIdx];
                  const cx = toSvgX(p.x);
                  const cy = toSvgY(p.y);
                  
                  const vx = svgCentroidX - cx;
                  const vy = svgCentroidY - cy;
                  const dist = Math.sqrt(vx*vx + vy*vy) || 1;
                  
                  const offsetPx = Math.min(22, dist * 0.4); 
                  const labelX = cx + (vx / dist) * offsetPx;
                  const labelY = cy + (vy / dist) * offsetPx;

                  return (
                    <text 
                      key={`angle-lbl-${vertexIdx}`}
                      x={labelX} 
                      y={labelY} 
                      fill="#cbd5e1" 
                      fontSize="14" 
                      fontWeight="700"
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      className="font-mono" 
                      style={{ 
                        textShadow: '0 0 5px #070b10, 0 0 5px #070b10, 0 0 8px #070b10',
                        fontStyle: 'italic'
                      }}
                    >
                      {angleLabel}
                    </text>
                  );
                });
              })()}

              {/* Dynamic Annotation Engine (Proximity Hover & Vertex Coloring) */}
              {(() => {
                const labelsToRender = [];
                const renderedCoords = new Set();
                const renderedMidpoints = new Set();

                const processTriangles = (triangles, isDerived) => {
                  for (const tri of triangles) {
                    let triHovered = showAllLabels;
                    
                    if (!triHovered && !isDragging) {
                      for (const p of tri.points) {
                        const cx = toSvgX(p.x); 
                        const cy = toSvgY(p.y); 
                        if ((cx - mousePos.x)**2 + (cy - mousePos.y)**2 < 900) {
                          triHovered = true;
                          break;
                        }
                      }
                    }

                    if (triHovered) {
                      // 1. Vertex Coordinates Annotation
                      for (let i = 0; i < 3; i++) {
                        const p = tri.points[i];
                        const cx = toSvgX(p.x);
                        const cy = toSvgY(p.y);
                        const coordKey = `${p.x.toFixed(5)},${p.y.toFixed(5)}`;

                        if (!renderedCoords.has(coordKey)) {
                          renderedCoords.add(coordKey);
                          const vertexName = ['A', 'B', 'C'][i];
                          
                          // Dynamic vertex coloring logic based on the fan-side validator
                          let vColor = isDerived ? tri.color : '#e2e8f0';
                          let isStartOrFinal = false;

                          if (activeTriangles.length > 0) {
                            const isStartShot = tri.id === 'T0' && i === shotVertexIdx;
                            const isFinalShot = tri.id === activeTriangles[activeTriangles.length - 1].id && i === shotVertexIdx;
                            const symbol = labelsMap[i];
                            const fanPointValidation = getFanPointValidation(p, symbol);
                            
                            if (isStartShot || isFinalShot) {
                              vColor = '#22c55e'; // Green for the actual shot endpoints
                              isStartOrFinal = true;
                            } else if (fanPointValidation) {
                              vColor = fanPointValidation.color;
                            } else {
                              const side = getLineSide(p);
                              if (side > lineSideTolerance) vColor = '#38bdf8';
                              else if (side < -lineSideTolerance) vColor = '#e5e7eb';
                              else vColor = '#facc15';
                            }
                          }

                          labelsToRender.push(
                            <g key={`lbl-${isDerived ? 'derived-' : ''}${tri.id}-${i}`}>
                              <circle cx={cx} cy={cy} r={isStartOrFinal ? 6 : (isDerived ? 4 : 5)} fill={vColor} opacity={1} />
                              <text 
                                x={cx + 8} 
                                y={cy - 6} 
                                fill={vColor} 
                                fontSize="11" 
                                fontWeight="700"
                                className="font-mono tracking-tight" 
                                style={{ textShadow: '0 0 5px #070b10, 0 0 5px #070b10, 0 0 8px #070b10' }}
                              >
                                {vertexName}: ({p.x.toFixed(4)}, {p.y.toFixed(4)})
                              </text>
                            </g>
                          );
                        }
                      }

                      // 2. Edge Midpoints Annotation (Sides 1, 2, 3)
                      for (let e = 0; e < 3; e++) {
                        const p1 = tri.points[e];
                        const p2 = tri.points[(e + 1) % 3];
                        
                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2;
                        const midKey = `${midX.toFixed(5)},${midY.toFixed(5)}`;

                        if (!renderedMidpoints.has(midKey)) {
                          renderedMidpoints.add(midKey);
                          const cx = toSvgX(midX);
                          const cy = toSvgY(midY);
                          const sideName = EDGE_TO_SIDE[e].toString();

                          labelsToRender.push(
                            <g key={`elbl-${isDerived ? 'derived-' : ''}${tri.id}-${e}`}>
                              <circle cx={cx} cy={cy} r={9} fill="#0b1016" stroke={isDerived ? tri.color : "#cbd5e1"} strokeWidth={1.5} opacity={0.95} />
                              <text
                                x={cx}
                                y={cy}
                                fill={isDerived ? tri.color : "#e2e8f0"}
                                fontSize="10"
                                fontWeight="800"
                                textAnchor="middle"
                                alignmentBaseline="central"
                                className="font-mono"
                              >
                                {sideName}
                              </text>
                            </g>
                          );
                        }
                      }
                    }
                  }
                };

                processTriangles([baseTriangle], false);
                processTriangles(activeTriangles, true);
                
                return labelsToRender;
              })()}
            </g>
          </svg>
        </div>
      </div>
      
      {/* Dark Theme Scrollbar Styling */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #64748b; }
      `}</style>
    </div>
  );
}
