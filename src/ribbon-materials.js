// SPEC — PL THIRD EYE VJ STUDIO REBUILD, Phase 2: per-ribbon effect
// materials. Each function takes the same centerline (`pl`, already
// spline-sampled by H.splineHandles) and width envelope (`wFn`) that
// H.ribbonPath already uses for the literal-ribbon fill in main.js's
// render() -- every material shares the same underlying curve geometry,
// only the paint technique differs. Canvas2D throughout, same rendering
// world the ribbons already draw in; Phase 1's WebGL compositor is a
// separate, whole-canvas concern this never touches (founder's own
// correction, S221: "effects should be only on the curves, not the
// whole screen" -- these only ever paint inside a ribbon's own shape).

function tangentAt(pl, i, closed) {
  const n = pl.length;
  const q = closed ? pl[(i + 1) % n] : pl[Math.min(n - 1, i + 1)];
  const r = closed ? pl[(i - 1 + n) % n] : pl[Math.max(0, i - 1)];
  let tx = q.x - r.x, ty = q.y - r.y;
  const m = Math.hypot(tx, ty) || 1;
  return { tx: tx / m, ty: ty / m, nx: -ty / m, ny: tx / m };
}

// Cheap smooth pseudo-noise -- layered sines at non-integer frequency ratios
// so it doesn't read as periodic. No texture lookup, no per-pixel cost --
// this is sampled once per centerline point, same cost class as the
// existing tremor calculation in H.ribbonPath.
function flowNoise(x, t) {
  return Math.sin(x * 2.13 + t) * 0.6 + Math.sin(x * 5.07 - t * 1.3) * 0.3 + Math.sin(x * 11.3 + t * 0.7) * 0.1;
}
// Deterministic per-index pseudo-random in [-1, 1], reseeded slowly by
// `tSeed` so scatter/stamp patterns drift instead of freezing or (the
// alternative) re-rolling every single frame, which would read as noise
// rather than paint.
function hash1(i, salt, tSeed) {
  const v = Math.sin(i * 12.9898 + salt * 78.233 + tSeed * 37.719) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

// founder S221: "the curve went blank" after picking a material -- this dict
// was {storedValue: DisplayLabel}, backwards from Tweakpane's actual
// convention ({DisplayLabel: storedValue}, confirmed by this same file's own
// BLEND_MODES). Selecting "Painterly" stored the label string 'Painterly'
// (capital P) into r.material, which matches nothing in DRAW_FNS -- material
// dispatch silently no-op'd and the plain-ribbon fill was never reached
// either, so nothing drew at all. My own tests never caught this because
// they set r.material directly in JS, bypassing the dropdown/options
// mapping entirely.
export const RIBBON_MATERIALS = {
  'Ribbon (satin)': 'ribbon',
  'Painterly': 'painterly',
  'Spray-paint': 'spray',
  'Paintbrush': 'brush',
  'Fabric': 'fabric',
};

// painterly -- several offset, low-alpha passes of the same ribbon-strip
// shape, each warped along its normal by a slow flow-field. Animated via
// r.materialSpeed (flow drift rate); r.materialAmount sets warp reach.
export function drawPainterly(ctx, pl, wFn, r, tremor, closed) {
  const t = performance.now() / 1000 * (r.materialSpeed ?? 0.4);
  const warpAmt = (r.materialAmount ?? 0.5) * (wFn(0.5) || 10) * 0.6;
  const PASSES = 4;
  ctx.save();
  ctx.globalCompositeOperation = r.blend || 'source-over';
  ctx.fillStyle = r.ink;
  for (let s = 0; s < PASSES; s++) {
    const phase = s * 1.7 + t;
    const L = [], R = [];
    for (let i = 0; i < pl.length; i++) {
      const { nx, ny } = tangentAt(pl, i, closed);
      const w = wFn(i / (pl.length - 1)) * (0.6 + 0.4 * (s / PASSES));
      const warp = flowNoise(i * 0.08 + s * 3.1, phase) * warpAmt;
      const trOff = tremor ? Math.sin(i * 1.7) * tremor * w : 0;
      const hw = w / 2;
      L.push({ x: pl[i].x + nx * (hw + trOff + warp), y: pl[i].y + ny * (hw + trOff + warp) });
      R.push({ x: pl[i].x - nx * (hw - trOff - warp), y: pl[i].y - ny * (hw - trOff - warp) });
    }
    ctx.beginPath();
    ctx.moveTo(L[0].x, L[0].y);
    for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
    for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
    ctx.closePath();
    ctx.globalAlpha = 1.5 / PASSES;
    ctx.fill();
  }
  ctx.restore();
}

// spray-paint -- a scattered field of small dots perpendicular to the
// curve, alpha falling off toward the ribbon's edge. Animated via
// r.materialSpeed (how often the scatter reseeds/drifts); r.materialAmount
// sets dot density.
export function drawSpray(ctx, pl, wFn, r, tremor, closed) {
  const tSeed = Math.floor(performance.now() / 1000 * (r.materialSpeed ?? 0.5) * 6);
  const density = 1 + (r.materialAmount ?? 0.5) * 3;
  const step = Math.max(1, Math.round(4 / density));
  ctx.save();
  ctx.globalCompositeOperation = r.blend || 'source-over';
  ctx.fillStyle = r.ink;
  for (let i = 0; i < pl.length; i += step) {
    const { nx, ny } = tangentAt(pl, i, closed);
    const w = wFn(i / (pl.length - 1));
    const hw = w / 2;
    const dotsHere = Math.max(1, Math.round(density));
    for (let d = 0; d < dotsHere; d++) {
      const rnd = hash1(i, d * 2.3, tSeed);
      const rnd2 = hash1(i, d * 2.3 + 1.1, tSeed);
      const off = rnd * hw; // perpendicular position within the ribbon's width
      const edgeFalloff = 1 - Math.abs(rnd) * 0.7; // denser toward the center
      const alpha = (0.12 + Math.abs(rnd2) * 0.22) * edgeFalloff;
      const radius = 0.5 + Math.abs(rnd2) * 1.6;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.beginPath();
      ctx.arc(pl[i].x + nx * off, pl[i].y + ny * off, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// paintbrush -- rotated capsule stamps tiled along arc-length, following
// the local tangent, with a per-stamp jitter so it reads hand-brushed
// rather than mechanically repeated. Animated via r.materialSpeed (marching
// phase along the ribbon); r.materialAmount sets stamp density.
export function drawBrush(ctx, pl, wFn, r, tremor, closed) {
  const t = performance.now() / 1000 * (r.materialSpeed ?? 0.3);
  const spacing = Math.max(3, 12 - (r.materialAmount ?? 0.5) * 8);
  const phase = ((t * 6) % spacing + spacing) % spacing;
  ctx.save();
  ctx.globalCompositeOperation = r.blend || 'source-over';
  ctx.fillStyle = r.ink;
  for (let i = phase; i < pl.length - 1; i += spacing) {
    const idx = Math.floor(i);
    const { tx, ty } = tangentAt(pl, idx, closed);
    const w = wFn(idx / (pl.length - 1));
    const ang = Math.atan2(ty, tx);
    const jitter = hash1(idx, 0, 0) * 0.35;
    ctx.save();
    ctx.translate(pl[idx].x, pl[idx].y);
    ctx.rotate(ang + jitter);
    ctx.globalAlpha = 0.5 + Math.abs(hash1(idx, 1, 0)) * 0.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, spacing * 0.85, Math.max(0.5, w * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// fabric -- the literal-ribbon fill (same technique as H.ribbonPath) plus a
// clipped directional highlight band that sweeps across the ribbon's width
// over time, simulating light catching a woven surface as it moves.
// Animated via r.materialSpeed (sweep rate); r.materialAmount sets
// highlight visibility.
export function drawFabric(ctx, pl, wFn, r, tremor, closed) {
  const t = performance.now() / 1000 * (r.materialSpeed ?? 0.25);
  ctx.save();
  ctx.globalCompositeOperation = r.blend || 'source-over';
  ctx.fillStyle = r.ink;
  const L = [], R = [];
  for (let i = 0; i < pl.length; i++) {
    const { nx, ny } = tangentAt(pl, i, closed);
    const w = wFn(i / (pl.length - 1));
    const trOff = tremor ? Math.sin(i * 1.7) * tremor * w : 0;
    const hw = w / 2;
    L.push({ x: pl[i].x + nx * (hw + trOff), y: pl[i].y + ny * (hw + trOff) });
    R.push({ x: pl[i].x - nx * (hw - trOff), y: pl[i].y - ny * (hw - trOff) });
  }
  ctx.beginPath();
  ctx.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();
  const weave = r.materialAmount ?? 0.5;
  const highlightPos = Math.sin(t) * 0.9; // -1..1 across the ribbon's width
  ctx.globalAlpha = 0.3 * weave;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < pl.length; i += 3) {
    const { nx, ny } = tangentAt(pl, i, closed);
    const w = wFn(i / (pl.length - 1));
    const localPos = Math.sin(i * 0.15) * 0.9; // a gentle across-width weave line per sample
    if (Math.abs(localPos - highlightPos) > 0.18) continue;
    const hw = w / 2;
    ctx.beginPath();
    ctx.moveTo(pl[i].x - nx * hw, pl[i].y - ny * hw);
    ctx.lineTo(pl[i].x + nx * hw, pl[i].y + ny * hw);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

const DRAW_FNS = { painterly: drawPainterly, spray: drawSpray, brush: drawBrush, fabric: drawFabric };

// Dispatches by r.material. 'ribbon' (the default/literal look) is NOT
// handled here -- main.js's render() keeps its existing direct fill for
// that case (custom-blend-mode support, outline-stroke sharing the same
// path, etc.) untouched; this only intercepts the 4 new materials.
export function drawRibbonMaterial(ctx, pl, wFn, r, tremor, closed) {
  const fn = DRAW_FNS[r.material];
  if (fn) fn(ctx, pl, wFn, r, tremor, closed);
}
