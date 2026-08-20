// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: canvas/
// curve-graph/pad pointer + keyboard interaction, extracted out of the old
// monolithic main.js alongside core/store.js. Desktop's canvas stays
// imperative/non-React per the ratified architecture ("Vite + React own the
// desktop sidebar only") -- so this is the second half of the shared core the
// new desktop entry needs, reused verbatim rather than duplicated, since it's
// plain relative-import JS with zero bundler-only dependencies (same
// raw-serve constraint as store.js -- see that file's header comment).
import {
  state, render, setPresenting, widthHandlePos,
  getW, getH, setPrimaryRibbon, scheduleSync,
} from './store.js';

const canvas = document.getElementById('canvas');
let lastHandleSide = 'hOut';
// founder S221, Phase 3 AT1: pointer travel under this, between down and up,
// counts as a click (select only) not a drag (moves the point).
const CLICK_THRESHOLD_PX = 5;

function addDefaultHandles(r, i) {
  const n = r.points.length;
  const prev = r.points[r.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const next = r.points[r.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const pt = r.points[i];
  let dx = next.x - prev.x, dy = next.y - prev.y;
  const m = Math.hypot(dx, dy) || 1;
  dx /= m; dy /= m;
  const len = 0.045;
  pt.hOut = { x: pt.x + dx * len, y: pt.y + dy * len };
  pt.hIn = { x: pt.x - dx * len, y: pt.y - dy * len };
  pt.tied = true;
}
function alignSelectedPoint() {
  if (!state.selectedPoint) return;
  const r = state.active.ribbons[state.selectedPoint.ribbon];
  const pt = r.points[state.selectedPoint.point];
  if (!pt.hOut || !pt.hIn) return;
  const src = lastHandleSide, dst = src === 'hOut' ? 'hIn' : 'hOut';
  const dx = pt[src].x - pt.x, dy = pt[src].y - pt.y;
  pt[dst] = { x: pt.x - dx, y: pt.y - dy };
  render();
}
function updateHandleDrag(ribbon, point, side, mx, my, dx, dy) {
  const r = state.active.ribbons[ribbon];
  const pt = r.points[point];
  pt[side] = { x: (mx + dx) / getW(), y: (my + dy) / getH() };
  lastHandleSide = side;
  if (pt.tied !== false) {
    const other = side === 'hOut' ? 'hIn' : 'hOut';
    if (pt[other]) {
      const ddx = pt[side].x - pt.x, ddy = pt[side].y - pt.y;
      pt[other] = { x: pt.x - ddx, y: pt.y - ddy };
    }
  }
  render();
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}
function hitTestPoint(mx, my, ribbon) {
  const r = state.active.ribbons[ribbon];
  const W = getW(), HGT = getH();
  for (let i = 0; i < r.points.length; i++) {
    const px = r.points[i].x * W, py = r.points[i].y * HGT;
    if (Math.hypot(mx - px, my - py) < 10) return i;
  }
  return -1;
}
function hitTestHandle(mx, my) {
  if (!state.selectedPoint || state.selectedPoint.ribbon !== state.selectedRibbon) return null;
  const pt = state.active.ribbons[state.selectedRibbon].points[state.selectedPoint.point];
  const W = getW(), HGT = getH();
  for (const side of ['hOut', 'hIn']) {
    if (!pt[side]) continue;
    const hx = pt[side].x * W, hy = pt[side].y * HGT;
    if (Math.hypot(mx - hx, my - hy) < 8) return side;
  }
  return null;
}
function hitTestSegment(mx, my, ribbonIdx = state.selectedRibbon) {
  const r = state.active.ribbons[ribbonIdx];
  const W = getW(), HGT = getH();
  const spts = r.points.map((p) => ({ x: p.x * W, y: p.y * HGT }));
  const segCount = r.closed ? spts.length : spts.length - 1;
  let best = -1, bestD = 14;
  for (let i = 0; i < segCount; i++) {
    const d = distToSegment(mx, my, spts[i], spts[(i + 1) % spts.length]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function hitTestWidthHandle(mx, my) {
  if (!state.selectedPoint || state.selectedPoint.ribbon !== state.selectedRibbon) return false;
  const r = state.active.ribbons[state.selectedRibbon];
  const { x, y } = widthHandlePos(r, state.selectedPoint.point);
  return Math.hypot(mx - x, my - y) < 8;
}

function finalizeSketch() {
  const stroke = state.sketchMode.stroke;
  state.sketchMode.active = false;
  state.sketchMode.stroke = [];
  if (stroke.length < 2) { render(); return; }
  const W = getW(), HGT = getH();
  const targetCount = 8;
  const pts = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * (stroke.length - 1) / (targetCount - 1));
    pts.push({ x: stroke[idx].x / W, y: stroke[idx].y / HGT });
  }
  state.active.ribbons.push({ points: pts, width: 0.05, taper: 0.1, tremor: 0.01, gap: 0.008, ink: '#c9a84c' });
  setPrimaryRibbon(state.active.ribbons.length - 1);
}

// ============================================================
// Real draggable tone-curve graph -- click empty space to add a point
// (max 8), drag any point, points stay sorted by x.
// ============================================================
function wireCurveGraph() {
  const curveCanvas = document.getElementById('curve-graph');
  if (!curveCanvas) return () => {};
  const curveCtx = curveCanvas.getContext('2d');
  let curveDrag = null;
  let curveDragDx = 0, curveDragDy = 0;

  function draw() {
    const w = curveCanvas.width, h = curveCanvas.height;
    curveCtx.fillStyle = '#f5efe2';
    curveCtx.fillRect(0, 0, w, h);
    curveCtx.strokeStyle = 'rgba(160,140,110,0.3)';
    curveCtx.lineWidth = 1;
    curveCtx.beginPath(); curveCtx.moveTo(0, h); curveCtx.lineTo(w, 0); curveCtx.stroke();

    // Local re-import avoided: buildCurveLUT lives in store.js.
    const lut = curveLUTRef(state.adj.curvePoints);
    curveCtx.beginPath();
    for (let x = 0; x < w; x++) {
      const i = Math.min(255, Math.round((x / w) * 255));
      const y = h - (lut[i] / 255) * h;
      if (x === 0) curveCtx.moveTo(x, y); else curveCtx.lineTo(x, y);
    }
    curveCtx.strokeStyle = '#c9a84c';
    curveCtx.lineWidth = 2;
    curveCtx.stroke();

    state.adj.curvePoints.forEach((p, i) => {
      curveCtx.beginPath();
      curveCtx.arc(p.x * w, h - p.y * h, 5, 0, Math.PI * 2);
      curveCtx.fillStyle = curveDrag === i ? '#ff4d4d' : '#1a1510';
      curveCtx.fill();
    });
  }
  function pointAt(mx, my) {
    const w = curveCanvas.width, h = curveCanvas.height;
    let best = -1, bestD = 12;
    state.adj.curvePoints.forEach((p, i) => {
      const d = Math.hypot(mx - p.x * w, my - (h - p.y * h));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  curveCanvas.addEventListener('pointerdown', (e) => {
    const rect = curveCanvas.getBoundingClientRect();
    const scaleX = curveCanvas.width / rect.width, scaleY = curveCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    const hit = pointAt(mx, my);
    if (hit >= 0) {
      curveDrag = hit;
      const gp = state.adj.curvePoints[hit];
      curveDragDx = gp.x * curveCanvas.width - mx;
      curveDragDy = (curveCanvas.height - gp.y * curveCanvas.height) - my;
      curveCanvas.setPointerCapture(e.pointerId);
    } else if (state.adj.curvePoints.length < 8) {
      const nx = Math.max(0, Math.min(1, mx / curveCanvas.width));
      const ny = Math.max(0, Math.min(1, 1 - my / curveCanvas.height));
      state.adj.curvePoints.push({ x: nx, y: ny });
      state.adj.curvePoints.sort((a, b) => a.x - b.x);
      draw();
      render();
      scheduleSync();
    }
  });
  curveCanvas.addEventListener('pointermove', (e) => {
    if (curveDrag === null) return;
    const rect = curveCanvas.getBoundingClientRect();
    const scaleX = curveCanvas.width / rect.width, scaleY = curveCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
    const nx = Math.max(0, Math.min(1, (mx + curveDragDx) / curveCanvas.width));
    const ny = Math.max(0, Math.min(1, 1 - (my + curveDragDy) / curveCanvas.height));
    state.adj.curvePoints[curveDrag] = { x: nx, y: ny };
    draw();
    render();
    scheduleSync();
  });
  window.addEventListener('pointerup', () => {
    if (curveDrag === null) return;
    state.adj.curvePoints.sort((a, b) => a.x - b.x);
    curveDrag = null;
    draw();
    scheduleSync();
  });
  draw();
  return draw;
}
// buildCurveLUT lives in store.js -- set once by initInteractions() to avoid
// a circular import at module-eval time (store.js doesn't need interactions.js).
let curveLUTRef = () => new Uint8ClampedArray(256);

function wirePads() {
  function wirePad(padEl, paramX, paramY, rangeX, rangeY) {
    if (!padEl) return;
    const dot = padEl.querySelector('.pad-dot');
    function setFromEvent(e) {
      const rect = padEl.getBoundingClientRect();
      const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const r = state.active.ribbons[state.selectedRibbon];
      r[paramX] = rangeX[0] + rx * (rangeX[1] - rangeX[0]);
      r[paramY] = rangeY[0] + ry * (rangeY[1] - rangeY[0]);
      dot.style.left = (rx * 100) + '%';
      dot.style.top = (ry * 100) + '%';
      render();
      scheduleSync();
    }
    padEl.addEventListener('pointerdown', (e) => { padEl.setPointerCapture(e.pointerId); setFromEvent(e); });
    padEl.addEventListener('pointermove', (e) => { if (e.buttons) setFromEvent(e); });
  }
  wirePad(document.getElementById('pad-width-taper'), 'width', 'taper', [0.01, 0.2], [0.02, 0.3]);
  wirePad(document.getElementById('pad-gap-tremor'), 'gap', 'tremor', [0, 0.03], [0, 0.1]);
}

function wireCanvasPointer() {
  const drags = state.drags;

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = getW(), HGT = getH();

    if (state.sketchMode.active) {
      state.sketchMode.stroke = [{ x: mx, y: my }];
      drags.set(e.pointerId, { type: 'sketch' });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const handleSide = hitTestHandle(mx, my);
    if (handleSide) {
      const gp = state.active.ribbons[state.selectedRibbon].points[state.selectedPoint.point][handleSide];
      drags.set(e.pointerId, {
        type: 'handle', ribbon: state.selectedRibbon, point: state.selectedPoint.point, side: handleSide,
        dx: gp.x * W - mx, dy: gp.y * HGT - my,
      });
      lastHandleSide = handleSide;
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (hitTestWidthHandle(mx, my)) {
      drags.set(e.pointerId, { type: 'width', ribbon: state.selectedRibbon, point: state.selectedPoint.point });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    let pi = hitTestPoint(mx, my, state.selectedRibbon);
    let targetRibbon = state.selectedRibbon;
    if (pi < 0) {
      for (let idx = 0; idx < state.active.ribbons.length; idx++) {
        if (idx === state.selectedRibbon) continue;
        const hit = hitTestPoint(mx, my, idx);
        if (hit >= 0) { targetRibbon = idx; pi = hit; break; }
      }
    }
    if (pi >= 0) {
      if (targetRibbon !== state.selectedRibbon) setPrimaryRibbon(targetRibbon);
      state.selectedPoint = { ribbon: targetRibbon, point: pi };
      const gp = state.active.ribbons[targetRibbon].points[pi];
      drags.set(e.pointerId, {
        type: 'point', ribbon: targetRibbon, point: pi,
        dx: gp.x * W - mx, dy: gp.y * HGT - my,
        downX: mx, downY: my, moved: false,
      });
      canvas.setPointerCapture(e.pointerId);
      render();
      return;
    }

    let si = hitTestSegment(mx, my, state.selectedRibbon);
    let segRibbon = state.selectedRibbon;
    if (si < 0) {
      for (let idx = 0; idx < state.active.ribbons.length; idx++) {
        if (idx === state.selectedRibbon) continue;
        const hit = hitTestSegment(mx, my, idx);
        if (hit >= 0) { segRibbon = idx; si = hit; break; }
      }
    }
    if (si >= 0 && segRibbon !== state.selectedRibbon) setPrimaryRibbon(segRibbon);
    state.selectedSegment = si >= 0 ? si : null;
    if (si < 0) state.selectedPoint = null;
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const W = getW(), HGT = getH();
    const d = drags.get(e.pointerId);

    if (d && d.type === 'sketch') {
      const last = state.sketchMode.stroke[state.sketchMode.stroke.length - 1];
      if (!last || Math.hypot(mx - last.x, my - last.y) > 8) state.sketchMode.stroke.push({ x: mx, y: my });
      render();
      return;
    }
    if (d && d.type === 'point') {
      if (!d.moved && Math.hypot(mx - d.downX, my - d.downY) < CLICK_THRESHOLD_PX) return;
      d.moved = true;
      state.active.ribbons[d.ribbon].points[d.point].x = (mx + d.dx) / W;
      state.active.ribbons[d.ribbon].points[d.point].y = (my + d.dy) / HGT;
      render();
      return;
    }
    if (d && d.type === 'handle') {
      updateHandleDrag(d.ribbon, d.point, d.side, mx, my, d.dx, d.dy);
      return;
    }
    if (d && d.type === 'width') {
      const r = state.active.ribbons[d.ribbon];
      const { base, nrm } = widthHandlePos(r, d.point);
      const proj = (mx - base.x) * nrm.x + (my - base.y) * nrm.y;
      r.points[d.point].widthMult = Math.max(0.15, Math.min(3, (proj - 14) / 18));
      render();
      return;
    }
    if (!d) {
      const si = hitTestSegment(mx, my, state.selectedRibbon);
      if (si !== state.hoverSegment) { state.hoverSegment = si; render(); }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    const d = drags.get(e.pointerId);
    if (d && d.type === 'sketch') finalizeSketch();
    drags.delete(e.pointerId);
    render();
  });
  canvas.addEventListener('pointercancel', (e) => { drags.delete(e.pointerId); });

  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    let pi = hitTestPoint(mx, my, state.selectedRibbon);
    let targetRibbon = state.selectedRibbon;
    if (pi < 0) {
      for (let idx = 0; idx < state.active.ribbons.length; idx++) {
        if (idx === state.selectedRibbon) continue;
        const hit = hitTestPoint(mx, my, idx);
        if (hit >= 0) { targetRibbon = idx; pi = hit; break; }
      }
    }
    if (pi >= 0) {
      if (targetRibbon !== state.selectedRibbon) setPrimaryRibbon(targetRibbon);
      state.selectedPoint = { ribbon: targetRibbon, point: pi };
      render();
      return;
    }

    let si = hitTestSegment(mx, my, state.selectedRibbon);
    let segRibbon = state.selectedRibbon;
    if (si < 0) {
      for (let idx = 0; idx < state.active.ribbons.length; idx++) {
        if (idx === state.selectedRibbon) continue;
        const hit = hitTestSegment(mx, my, idx);
        if (hit >= 0) { segRibbon = idx; si = hit; break; }
      }
    }
    if (si >= 0) {
      if (segRibbon !== state.selectedRibbon) setPrimaryRibbon(segRibbon);
      state.selectedSegment = si;
      render();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    if (state.selectedSegment === null) return;
    e.preventDefault();
    const r = state.active.ribbons[state.selectedRibbon];
    const n = r.points.length;
    if (e.deltaY < 0) {
      const a = r.points[state.selectedSegment], b = r.points[(state.selectedSegment + 1) % n];
      r.points.splice(state.selectedSegment + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (n > 3) {
      r.points.splice((state.selectedSegment + 1) % n, 1);
      state.selectedSegment = Math.min(state.selectedSegment, r.points.length - (r.closed ? 1 : 2));
    }
    render();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!state.selectedPoint || state.selectedPoint.ribbon !== state.selectedRibbon) return;
    const r = state.active.ribbons[state.selectedRibbon];
    const pt = r.points[state.selectedPoint.point];
    if (e.key === 'h' || e.key === 'H') {
      if (pt.hOut || pt.hIn) { delete pt.hOut; delete pt.hIn; }
      else addDefaultHandles(r, state.selectedPoint.point);
      render();
    } else if (e.key === 'k' || e.key === 'K') {
      alignSelectedPoint();
    } else if (e.key === 't' || e.key === 'T') {
      pt.tied = pt.tied === false ? true : false;
    } else if (e.key === 'w' || e.key === 'W') {
      delete pt.widthMult;
      render();
    }
  });
}

function wirePresentationToggle() {
  const presentToggle = document.getElementById('present-toggle');
  if (presentToggle) presentToggle.addEventListener('click', () => setPresenting(!state.presenting));
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'f' || e.key === 'F') setPresenting(!state.presenting);
    else if (e.key === 'Escape' && state.presenting) setPresenting(false);
  });
}

let curveGraphDraw = null;
export function drawCurveGraph() { if (curveGraphDraw) curveGraphDraw(); }

// Called once by each entry (main.js for the phone/controller, and the new
// desktop Vite entry) after loadPiece() so canvas dimensions are already
// known. Idempotent risk: only ever called once per module instance, exactly
// like the old main.js's top-level listener wiring.
export function initInteractions(buildCurveLUTFn) {
  curveLUTRef = buildCurveLUTFn;
  wireCanvasPointer();
  wirePads();
  curveGraphDraw = wireCurveGraph();
  wirePresentationToggle();
}
