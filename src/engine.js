// The house ribbon engine, ported verbatim from pl-curves-gallery's pieces-ai.js
// (window.__PLH). Same math, same behavior — this is the exact engine dir-01,
// dir-02, and the VJ Coder test pieces this session all used.
export const H = (() => {
  function spline(pts, samples) {
    const out = [];
    const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
      const n = Math.max(2, Math.round(samples / (pts.length - 1)));
      for (let i = 0; i < n; i++) {
        const t = i / n, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push({ x: P(pts.length - 1).x, y: P(pts.length - 1).y });
    return out;
  }
  // Wraps neighbor lookups for closed curves, clamps for open ones -- same
  // indexing rule spline()/splineHandles() use, kept in sync deliberately.
  function neighborIndex(i, n, closed, dir) {
    return closed ? ((i + dir) % n + n) % n : Math.max(0, Math.min(n - 1, i + dir));
  }
  // Adds real bezier handles on top of the original Catmull-Rom spline(),
  // without changing spline()'s own behavior -- every existing piece (no
  // handle data) renders byte-identical through the Catmull-Rom branch below.
  // pts[i].hOut / pts[i+1].hIn (both truthy) switch that one segment to an
  // explicit cubic bezier; closed=true wraps point indices instead of
  // clamping, so the last point connects back to the first.
  function splineHandles(pts, samples, closed) {
    const n = pts.length;
    const segCount = closed ? n : n - 1;
    const out = [];
    for (let s = 0; s < segCount; s++) {
      const i0 = neighborIndex(s, n, closed, 0);
      const i1 = neighborIndex(s, n, closed, 1);
      const p0pt = pts[i0], p1pt = pts[i1];
      const perSeg = Math.max(2, Math.round(samples / segCount));
      if (p0pt.hOut && p1pt.hIn) {
        const P0 = p0pt, P1 = p0pt.hOut, P2 = p1pt.hIn, P3 = p1pt;
        for (let i = 0; i < perSeg; i++) {
          const t = i / perSeg, mt = 1 - t;
          const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
          out.push({ x: a * P0.x + b * P1.x + c * P2.x + d * P3.x, y: a * P0.y + b * P1.y + c * P2.y + d * P3.y });
        }
      } else {
        const p0 = pts[neighborIndex(s, n, closed, -1)], p1 = p0pt, p2 = p1pt, p3 = pts[neighborIndex(s, n, closed, 2)];
        for (let i = 0; i < perSeg; i++) {
          const t = i / perSeg, t2 = t * t, t3 = t2 * t;
          out.push({
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
          });
        }
      }
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return out;
  }
  function ribbonPath(ctx, pl, wFn, grow, tremor, closed) {
    const n = pl.length;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pl[i];
      const q = closed ? pl[(i + 1) % n] : pl[Math.min(n - 1, i + 1)];
      const r = closed ? pl[(i - 1 + n) % n] : pl[Math.max(0, i - 1)];
      let tx = q.x - r.x, ty = q.y - r.y;
      const m = Math.hypot(tx, ty) || 1;
      tx /= m; ty /= m;
      const nx = -ty, ny = tx;
      const w = wFn(i / (pl.length - 1));
      const tr = tremor ? Math.sin(i * 1.7) * tremor * w + Math.sin(i * 4.3) * tremor * 0.5 * w : 0;
      const hw = (w + grow) / 2;
      L.push({ x: p.x + nx * (hw + tr), y: p.y + ny * (hw + tr) });
      R.push({ x: p.x - nx * (hw - tr), y: p.y - ny * (hw - tr) });
    }
    ctx.beginPath();
    ctx.moveTo(L[0].x, L[0].y);
    for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
    for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
    ctx.closePath();
  }
  function widthAt(u, w, taper, supIn, supOut) {
    const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    const a = ease(Math.min(1, u / taper)) * (1 - (supIn ? 0.62 : 0.10)) + (supIn ? 0.62 : 0.10);
    const b = ease(Math.min(1, (1 - u) / taper)) * (1 - (supOut ? 0.62 : 0.10)) + (supOut ? 0.62 : 0.10);
    return w * Math.min(a, b);
  }
  return { spline, splineHandles, ribbonPath, widthAt };
})();
