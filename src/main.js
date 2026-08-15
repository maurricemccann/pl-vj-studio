// Vendored into src/ (not imported from node_modules) -- Tauri's asset
// server only serves files inside frontendDist ("../src"), so a path that
// escapes it 404s silently and the whole module throws on import.
import { Pane } from './vendor/tweakpane.js';
import { H } from './engine.js';
import { PIECES } from './pieces.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const pieceSelect = document.getElementById('piece-select');
const freqCanvas = document.getElementById('freq-meter');
const freqCtx = freqCanvas.getContext('2d');
let W, HGT;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth - 280; // leave room for the panel
  HGT = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = HGT * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = HGT + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Deep-clone the active piece so edits (dragging, sliders) never mutate the
// source library -- "reset" just re-clones from PIECES.
let active = null;
let selectedRibbon = 0;
let pane = null;

// Curve-editing selection state (Group B) -- persists across mouse-up so a
// point/segment stays addressable for keyboard shortcuts and the wheel.
let selectedPoint = null;   // { ribbon, point }
let selectedSegment = null; // index into the control polygon
let hoverSegment = null;
let lastHandleSide = 'hOut';
const drags = new Map();    // pointerId -> {type:'point'|'handle'|'sketch', ...} -- multi-touch (Group D #21)
const sketchMode = { active: false, stroke: [] };

function loadPiece(id) {
  kfStop();
  if (morphRaf) cancelAnimationFrame(morphRaf);
  presetA = null; presetB = null;
  selectedPoint = null; selectedSegment = null; hoverSegment = null;
  sketchMode.active = false; sketchMode.stroke = [];
  drags.clear();
  const src = PIECES.find(p => p.id === id);
  active = JSON.parse(JSON.stringify(src));
  selectedRibbon = 0;
  buildPane();
  render();
}

// ============================================================
// Animation core (Group A): shared lerp/color helpers used by
// preset morphing, the keyframe demo, shuffle, and modulation.
// ============================================================
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t * t * (3 - 2 * t); }
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lerpColor(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  return rgbToHex(lerp(pa.r, pb.r, t), lerp(pa.g, pb.g, t), lerp(pa.b, pb.b, t));
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// ---- Preset A/B morph (#2) ----
let presetA = null, presetB = null, morphRaf = null;
function snapshotPreset() { return JSON.parse(JSON.stringify(active.ribbons)); }
function morphTo(target, durationMs, useEase) {
  if (!target) return;
  if (morphRaf) cancelAnimationFrame(morphRaf);
  const start = snapshotPreset();
  const t0 = performance.now();
  function tick(now) {
    const raw = Math.min(1, (now - t0) / durationMs);
    const t = useEase ? easeInOut(raw) : raw;
    active.ribbons.forEach((r, i) => {
      const s = start[i], e = target[i];
      if (!e) return;
      r.width = lerp(s.width, e.width, t);
      r.taper = lerp(s.taper, e.taper, t);
      r.tremor = lerp(s.tremor, e.tremor, t);
      r.gap = lerp(s.gap, e.gap, t);
      r.ink = lerpColor(s.ink, e.ink, t);
      if (s.core && e.core) r.core = lerpColor(s.core, e.core, t);
    });
    render();
    if (pane) pane.refresh();
    if (raw < 1) morphRaf = requestAnimationFrame(tick);
  }
  morphRaf = requestAnimationFrame(tick);
}

// ---- Shuffle (#5) ----
function randomColor() { return hslToHex(Math.random() * 360, 55 + Math.random() * 25, 40 + Math.random() * 20); }
function shuffleSelected() {
  const r = active.ribbons[selectedRibbon];
  const jitter = (v, amt, min, max) => Math.max(min, Math.min(max, v + (Math.random() * 2 - 1) * amt));
  r.width = jitter(r.width, 0.03, 0.01, 0.2);
  r.taper = jitter(r.taper, 0.04, 0.02, 0.3);
  r.tremor = jitter(r.tremor, 0.015, 0, 0.1);
  r.gap = jitter(r.gap, 0.004, 0, 0.03);
  r.ink = randomColor();
  render();
  if (pane) pane.refresh();
}

// ---- Keyframe demo (#1): one parameter, A/B values, duration,
// interpolation, Extend mode for time outside the keyframed range ----
const kf = { param: 'tremor', a: 0, b: 0.05, duration: 2000, interp: 'ease', extend: 'loop', playing: false };
let kfRaf = null, kfStart = 0;
function kfExtendedT(elapsed, duration, mode) {
  const raw = elapsed / duration;
  if (mode === 'hold') return Math.min(1, raw);
  if (mode === 'loop') return raw % 1;
  const cyc = raw % 2; // mirror: triangle wave 0->1->0
  return cyc <= 1 ? cyc : 2 - cyc;
}
function kfTick(now) {
  const elapsed = now - kfStart;
  let t = kfExtendedT(elapsed, kf.duration, kf.extend);
  if (kf.interp === 'ease') t = easeInOut(t);
  active.ribbons[selectedRibbon][kf.param] = lerp(kf.a, kf.b, t);
  render();
  if (pane) pane.refresh();
  if (kf.playing) kfRaf = requestAnimationFrame(kfTick);
}
function kfPlay() {
  if (kf.playing) return;
  kf.playing = true;
  kfStart = performance.now();
  kfRaf = requestAnimationFrame(kfTick);
}
function kfStop() {
  kf.playing = false;
  if (kfRaf) cancelAnimationFrame(kfRaf);
}

// ============================================================
// Modulation (Group C): audio-FFT (#14/#15), camera luminance (#18),
// dual LFOs (#17) -- each drives one ribbon parameter on the selected
// ribbon, modulating around a captured base value.
// ============================================================
const audioMod = { enabled: false, param: 'tremor', amount: 0.06, base: {} };
let audioCtx = null, analyser = null, audioBins = null;
async function startAudio() {
  if (audioCtx) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  audioBins = new Uint8Array(analyser.frequencyBinCount);
  requestAnimationFrame(audioTick);
}
function drawFreqMeter() {
  if (!audioBins) return;
  freqCtx.clearRect(0, 0, freqCanvas.width, freqCanvas.height);
  freqCtx.fillStyle = '#c9a84c';
  const barW = freqCanvas.width / audioBins.length;
  for (let i = 0; i < audioBins.length; i++) {
    const h = (audioBins[i] / 255) * freqCanvas.height;
    freqCtx.fillRect(i * barW, freqCanvas.height - h, Math.max(1, barW - 1), h);
  }
}
function audioTick() {
  if (!analyser) return;
  analyser.getByteFrequencyData(audioBins);
  drawFreqMeter();
  if (audioMod.enabled) {
    const avg = audioBins.reduce((a, b) => a + b, 0) / audioBins.length / 255;
    const base = audioMod.base[audioMod.param] ?? active.ribbons[selectedRibbon][audioMod.param];
    active.ribbons[selectedRibbon][audioMod.param] = Math.max(0, base + avg * audioMod.amount);
    render();
    if (pane) pane.refresh();
  }
  requestAnimationFrame(audioTick);
}

const camMod = { enabled: false, param: 'gap', amount: 0.01, base: {} };
let camVideo = null, camSampleCtx = null;
async function startCamera() {
  if (camVideo) return;
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  camVideo = document.createElement('video');
  camVideo.srcObject = stream;
  camVideo.muted = true;
  await camVideo.play();
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 16; sampleCanvas.height = 16;
  camSampleCtx = sampleCanvas.getContext('2d');
  requestAnimationFrame(camTick);
}
function camTick() {
  if (!camVideo) return;
  if (camVideo.readyState >= 2) {
    camSampleCtx.drawImage(camVideo, 0, 0, 16, 16);
    const data = camSampleCtx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    const avg = sum / (data.length / 4) / 255;
    if (camMod.enabled) {
      const base = camMod.base[camMod.param] ?? active.ribbons[selectedRibbon][camMod.param];
      active.ribbons[selectedRibbon][camMod.param] = Math.max(0, base + avg * camMod.amount);
      render();
      if (pane) pane.refresh();
    }
  }
  requestAnimationFrame(camTick);
}

const lfos = [
  { enabled: false, waveform: 'sine', period: 2000, phase: 0, hold: false, target: 'tremor', amount: 0.02 },
  { enabled: false, waveform: 'sine', period: 3000, phase: 0.25, hold: false, target: 'gap', amount: 0.006 },
];
const lfoBase = {};
function lfoWaveValue(lfo, tMs) {
  if (lfo.hold) return 0;
  const phase = ((tMs / lfo.period) + lfo.phase) % 1;
  if (lfo.waveform === 'square') return phase < 0.5 ? 1 : -1;
  if (lfo.waveform === 'triangle') return phase < 0.5 ? (phase * 4 - 1) : (3 - phase * 4);
  return Math.sin(phase * Math.PI * 2);
}
function lfoTick(now) {
  let any = false;
  lfos.forEach(lfo => {
    if (!lfo.enabled) return;
    any = true;
    const base = lfoBase[lfo.target] ?? active.ribbons[selectedRibbon][lfo.target];
    const v = lfoWaveValue(lfo, now);
    active.ribbons[selectedRibbon][lfo.target] = Math.max(0, base + v * lfo.amount);
  });
  if (any) { render(); if (pane) pane.refresh(); }
  requestAnimationFrame(lfoTick);
}
requestAnimationFrame(lfoTick);

// ---- Ambient wander -- ported technique from pl-headless's GoldCurves hero
// (components/art/GoldCurves.tsx): each control point drifts around its
// home position via independent sin/cos oscillation, distinct per-point
// frequency + phase so nothing moves in sync, driven by a plain frame
// counter (not delta-time) -- same convention the real hero uses. ----
let wanderT = 0;
const wander = { enabled: true, amplitude: 0.02, speed: 1 };
function wanderOffset(pointIndex, ribbonIndex, axis) {
  const freq = 0.3 + ((pointIndex * 7 + ribbonIndex * 13 + (axis === 'y' ? 5 : 0)) % 17) / 10;
  const phase = pointIndex * 2.1 + ribbonIndex * 0.7 + (axis === 'y' ? 1.57 : 0);
  return Math.sin(wanderT * 0.008 * wander.speed * freq + phase) * wander.amplitude;
}
function wanderTick() {
  if (wander.enabled) { wanderT++; render(); }
  requestAnimationFrame(wanderTick);
}
requestAnimationFrame(wanderTick);

// ============================================================
// Adjustments + Effects (Batch 2): a fixed-order post-process pass over
// the whole rendered frame, run after ribbons draw and before UI chrome
// (segment highlights, point handles) so editor overlays never get
// processed as if they were part of the artwork.
// ============================================================
const BLEND_MODES = {
  Normal: 'source-over', Multiply: 'multiply', Darken: 'darken', Lighten: 'lighten', Screen: 'screen',
  'Color Dodge': 'color-dodge', 'Color Burn': 'color-burn', 'Hard Light': 'hard-light', 'Soft Light': 'soft-light',
  Difference: 'difference', Exclusion: 'exclusion', Hue: 'hue', Saturation: 'saturation', Color: 'color', Luminosity: 'luminosity',
};

const adj = {
  hue: 0, saturation: 0, brightness: 0,
  shadowsTint: '#000000', shadowsAmt: 0,
  midsTint: '#808080', midsAmt: 0,
  highsTint: '#ffffff', highsAmt: 0,
  curveEnabled: false,
  curvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  gradientEnabled: false,
  gradientStops: ['#1a1510', '#c9a84c'],
};
const fx = { opacity: 1, noise: 0, sharpen: 0, bloom: 0, glitch: 0, halftone: 0, chromaticAberration: 0 };

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}
// ponytail: 3-point shadow/mid/highlight sliders stand in for a real
// draggable tone-curve graph -- a full graph is its own curve-editor UI
// (same class of work as Group B's point editor), not built this pass.
function buildCurveLUT(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let a = pts[0], b = pts[pts.length - 1];
    for (let j = 0; j < pts.length - 1; j++) {
      if (x >= pts[j].x && x <= pts[j + 1].x) { a = pts[j]; b = pts[j + 1]; break; }
    }
    const t = (b.x - a.x) ? (x - a.x) / (b.x - a.x) : 0;
    lut[i] = Math.round((a.y + (b.y - a.y) * t) * 255);
  }
  return lut;
}
function hexToRgbArr(hex) { const c = hexToRgb(hex); return [c.r, c.g, c.b]; }

function postFX() {
  const anyAdj = adj.hue || adj.saturation || adj.brightness || adj.shadowsAmt || adj.midsAmt || adj.highsAmt || adj.curveEnabled || adj.gradientEnabled;
  const anyFx = fx.noise || fx.sharpen || fx.bloom || fx.glitch || fx.halftone || fx.opacity < 1 || fx.chromaticAberration;
  if (!anyAdj && !anyFx) return;

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const curveLUT = adj.curveEnabled ? buildCurveLUT(adj.curvePoints) : null;
  const [gs0r, gs0g, gs0b] = adj.gradientEnabled ? hexToRgbArr(adj.gradientStops[0]) : [0, 0, 0];
  const [gs1r, gs1g, gs1b] = adj.gradientEnabled ? hexToRgbArr(adj.gradientStops[1]) : [0, 0, 0];
  const [shR, shG, shB] = hexToRgbArr(adj.shadowsTint);
  const [miR, miG, miB] = hexToRgbArr(adj.midsTint);
  const [hiR, hiG, hiB] = hexToRgbArr(adj.highsTint);

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];

    if (adj.hue || adj.saturation || adj.brightness) {
      let [h, s, l] = rgbToHsl(r, g, b);
      h = (h + adj.hue + 360) % 360;
      s = Math.max(0, Math.min(100, s + adj.saturation));
      l = Math.max(0, Math.min(100, l + adj.brightness / 2));
      [r, g, b] = hslToRgb(h, s, l);
    }

    if (adj.shadowsAmt || adj.midsAmt || adj.highsAmt) {
      const lum = (r + g + b) / 3 / 255;
      const wShadow = Math.max(0, 1 - lum * 2);
      const wHigh = Math.max(0, lum * 2 - 1);
      const wMid = 1 - wShadow - wHigh;
      r += (shR - 128) * wShadow * adj.shadowsAmt / 100 + (miR - 128) * wMid * adj.midsAmt / 100 + (hiR - 128) * wHigh * adj.highsAmt / 100;
      g += (shG - 128) * wShadow * adj.shadowsAmt / 100 + (miG - 128) * wMid * adj.midsAmt / 100 + (hiG - 128) * wHigh * adj.highsAmt / 100;
      b += (shB - 128) * wShadow * adj.shadowsAmt / 100 + (miB - 128) * wMid * adj.midsAmt / 100 + (hiB - 128) * wHigh * adj.highsAmt / 100;
    }

    if (curveLUT) {
      r = curveLUT[Math.max(0, Math.min(255, Math.round(r)))];
      g = curveLUT[Math.max(0, Math.min(255, Math.round(g)))];
      b = curveLUT[Math.max(0, Math.min(255, Math.round(b)))];
    }

    if (adj.gradientEnabled) {
      const lum = (r + g + b) / 3 / 255;
      r = lerp(gs0r, gs1r, lum); g = lerp(gs0g, gs1g, lum); b = lerp(gs0b, gs1b, lum);
    }

    if (fx.noise) {
      const n = (Math.random() * 2 - 1) * fx.noise * 255;
      r += n; g += n; b += n;
    }

    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, g));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }

  if (fx.chromaticAberration > 0) {
    const shift = Math.round(fx.chromaticAberration * 20);
    const orig = new Uint8ClampedArray(d);
    const w = canvas.width, h = canvas.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const rx = Math.min(w - 1, x + shift), bx = Math.max(0, x - shift);
        d[idx] = orig[(y * w + rx) * 4];
        d[idx + 2] = orig[(y * w + bx) * 4 + 2];
      }
    }
  }

  if (fx.sharpen > 0) {
    const w = canvas.width, h = canvas.height;
    const orig = new Uint8ClampedArray(d);
    const amt = fx.sharpen;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const center = orig[idx + c];
          const lap = center * 4 - orig[idx - w * 4 + c] - orig[idx + w * 4 + c] - orig[idx - 4 + c] - orig[idx + 4 + c];
          d[idx + c] = Math.max(0, Math.min(255, center + lap * amt));
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  if (fx.glitch > 0) {
    const bands = Math.round(fx.glitch * 12);
    for (let i = 0; i < bands; i++) {
      const y = Math.random() * canvas.height;
      const bh = 4 + Math.random() * 20;
      const dx = (Math.random() * 2 - 1) * fx.glitch * 40;
      ctx.drawImage(canvas, 0, y, canvas.width, bh, dx, y, canvas.width, bh);
    }
  }

  if (fx.bloom > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fx.bloom * 0.5;
    ctx.filter = `blur(${Math.round(fx.bloom * 20)}px)`;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W, HGT);
    ctx.filter = 'none';
    ctx.restore();
  }

  if (fx.halftone > 0) {
    const cell = Math.max(4, Math.round(24 * (1 - fx.halftone) + 4));
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const dpr = canvas.width / W;
    ctx.fillStyle = active.ground;
    ctx.fillRect(0, 0, W, HGT);
    ctx.fillStyle = '#1a1510';
    for (let y = 0; y < HGT; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const px = Math.min(canvas.width - 1, Math.round(x * dpr));
        const py = Math.min(canvas.height - 1, Math.round(y * dpr));
        const idx = (py * canvas.width + px) * 4;
        const lum = (sample[idx] + sample[idx + 1] + sample[idx + 2]) / 3 / 255;
        const rad = (1 - lum) * cell * 0.5;
        if (rad > 0.5) { ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, rad, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  }

  if (fx.opacity < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - fx.opacity;
    ctx.fillStyle = active.ground;
    ctx.fillRect(0, 0, W, HGT);
    ctx.restore();
  }
}

// ============================================================
// Curve editing (Group B): bezier handles (#8/#10), closed loops (#9),
// segment hover/select + live subdivision (#6/#7), sketch-to-spline (#11).
// ============================================================
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
  if (!selectedPoint) return;
  const r = active.ribbons[selectedPoint.ribbon];
  const pt = r.points[selectedPoint.point];
  if (!pt.hOut || !pt.hIn) return;
  const src = lastHandleSide, dst = src === 'hOut' ? 'hIn' : 'hOut';
  const dx = pt[src].x - pt.x, dy = pt[src].y - pt.y;
  pt[dst] = { x: pt.x - dx, y: pt.y - dy };
  render();
}
function updateHandleDrag(ribbon, point, side, mx, my) {
  const r = active.ribbons[ribbon];
  const pt = r.points[point];
  pt[side] = { x: mx / W, y: my / HGT };
  lastHandleSide = side;
  if (pt.tied !== false) {
    const other = side === 'hOut' ? 'hIn' : 'hOut';
    if (pt[other]) {
      const dx = pt[side].x - pt.x, dy = pt[side].y - pt.y;
      pt[other] = { x: pt.x - dx, y: pt.y - dy };
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
  const r = active.ribbons[ribbon];
  for (let i = 0; i < r.points.length; i++) {
    const px = r.points[i].x * W, py = r.points[i].y * HGT;
    if (Math.hypot(mx - px, my - py) < 10) return i;
  }
  return -1;
}
function hitTestHandle(mx, my) {
  if (!selectedPoint || selectedPoint.ribbon !== selectedRibbon) return null;
  const pt = active.ribbons[selectedRibbon].points[selectedPoint.point];
  for (const side of ['hOut', 'hIn']) {
    if (!pt[side]) continue;
    const hx = pt[side].x * W, hy = pt[side].y * HGT;
    if (Math.hypot(mx - hx, my - hy) < 8) return side;
  }
  return null;
}
function hitTestSegment(mx, my) {
  const r = active.ribbons[selectedRibbon];
  const spts = r.points.map(p => ({ x: p.x * W, y: p.y * HGT }));
  const segCount = r.closed ? spts.length : spts.length - 1;
  let best = -1, bestD = 14;
  for (let i = 0; i < segCount; i++) {
    const d = distToSegment(mx, my, spts[i], spts[(i + 1) % spts.length]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function finalizeSketch() {
  const stroke = sketchMode.stroke;
  sketchMode.active = false;
  sketchMode.stroke = [];
  if (stroke.length < 2) { render(); return; }
  const targetCount = 8;
  const pts = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * (stroke.length - 1) / (targetCount - 1));
    pts.push({ x: stroke[idx].x / W, y: stroke[idx].y / HGT });
  }
  active.ribbons.push({ points: pts, width: 0.05, taper: 0.1, tremor: 0.01, gap: 0.008, ink: '#c9a84c' });
  selectedRibbon = active.ribbons.length - 1;
  selectedPoint = null;
  buildPane();
  render();
}

// ============================================================
// Panel (Tweakpane)
// ============================================================
function buildPane() {
  if (pane) pane.dispose();
  pane = new Pane({ title: active.name, container: document.getElementById('panel') });

  pane.addBinding(active, 'ground', { label: 'Ground' }).on('change', render);

  const ribbonNames = active.ribbons.map((_, i) => `Ribbon ${i + 1}`);
  const ribbonIndex = { value: 0 };
  pane.addBinding(ribbonIndex, 'value', {
    label: 'Editing', options: Object.fromEntries(ribbonNames.map((n, i) => [n, i])),
  }).on('change', (ev) => { selectedRibbon = ev.value; selectedPoint = null; selectedSegment = null; buildRibbonFolder(); render(); });

  buildRibbonFolder();
  buildCurveFolder();
  buildAnimationFolder();
  buildModulationFolder();
  buildAdjustmentsFolder();
  buildEffectsFolder();

  const exportBtn = pane.addButton({ title: 'Copy tuned values as JSON' });
  exportBtn.on('click', () => {
    const json = JSON.stringify(active, null, 2);
    navigator.clipboard.writeText(json);
    exportBtn.title = 'Copied!';
    setTimeout(() => (exportBtn.title = 'Copy tuned values as JSON'), 1200);
  });
}

// #19: auto-generate a widget from the parameter's own type/naming
// convention instead of a hand-wired addBinding per param. A numeric
// key with sibling <key>Min/<key>Max on the object gets that range; a
// key with no siblings falls back to a small known-parameter default
// table -- either way, adding a NEW numeric ribbon field in pieces.js
// gets a working slider with zero new main.js code.
const NUMERIC_DEFAULTS = { width: [0.01, 0.2, 0.005], taper: [0.02, 0.3, 0.005], tremor: [0, 0.1, 0.002], gap: [0, 0.03, 0.001], outlineWidth: [0, 0.03, 0.001] };
const SKIP_KEYS = new Set(['points', 'ink', 'core', 'glow', 'closed']);
function autoBindNumeric(folder, obj, onChange) {
  Object.keys(obj).forEach(key => {
    if (SKIP_KEYS.has(key) || key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Step')) return;
    if (typeof obj[key] !== 'number') return;
    const hasRange = obj[key + 'Min'] !== undefined && obj[key + 'Max'] !== undefined;
    const [defMin, defMax, defStep] = NUMERIC_DEFAULTS[key] || [0, 1, 0.01];
    const min = hasRange ? obj[key + 'Min'] : defMin;
    const max = hasRange ? obj[key + 'Max'] : defMax;
    const step = obj[key + 'Step'] !== undefined ? obj[key + 'Step'] : defStep;
    folder.addBinding(obj, key, { min, max, step }).on('change', onChange);
  });
}

let ribbonFolder = null;
function buildRibbonFolder() {
  if (ribbonFolder) ribbonFolder.dispose();
  const r = active.ribbons[selectedRibbon];
  ribbonFolder = pane.addFolder({ title: `Ribbon ${selectedRibbon + 1} params` });
  r.outlineWidth = r.outlineWidth ?? 0;
  r.outlineColor = r.outlineColor || '#1a1510';
  r.blend = r.blend || 'source-over';
  autoBindNumeric(ribbonFolder, r, render);
  ribbonFolder.addBinding(r, 'ink', { view: 'color' }).on('change', render);
  if (r.core !== undefined) ribbonFolder.addBinding(r, 'core', { view: 'color' }).on('change', render);
  if (r.glow !== undefined) ribbonFolder.addBinding(r, 'glow').on('change', render);
  ribbonFolder.addBinding(r, 'outlineColor', { view: 'color', label: 'Outline color' }).on('change', render);
  ribbonFolder.addBinding(r, 'blend', { label: 'Blend mode', options: BLEND_MODES }).on('change', render);
}

// #9 closed loop toggle + #11 sketch-to-spline, live per selected ribbon.
function buildCurveFolder() {
  const cf = pane.addFolder({ title: 'Curve editing', expanded: false });
  const r = active.ribbons[selectedRibbon];
  r.closed = !!r.closed;
  cf.addBinding(r, 'closed', { label: 'Closed loop' }).on('change', render);
  const sketchBtn = cf.addButton({ title: sketchMode.active ? 'Stop sketching' : 'Sketch new ribbon' });
  sketchBtn.on('click', () => {
    sketchMode.active = !sketchMode.active;
    sketchMode.stroke = [];
    sketchBtn.title = sketchMode.active ? 'Stop sketching' : 'Sketch new ribbon';
  });
  cf.addBinding({ hint: 'H: toggle handles - K: align - T: tied/untied' }, 'hint', { readonly: true, label: '' });
}

function buildAnimationFolder() {
  const animFolder = pane.addFolder({ title: 'Animation', expanded: false });

  animFolder.addButton({ title: 'Shuffle selected ribbon' }).on('click', shuffleSelected);

  const wanderFolder = animFolder.addFolder({ title: 'Ambient wander (all ribbons)' });
  wanderFolder.addBinding(wander, 'enabled');
  wanderFolder.addBinding(wander, 'amplitude', { min: 0, max: 0.08, step: 0.002 });
  wanderFolder.addBinding(wander, 'speed', { min: 0.2, max: 3, step: 0.1 });

  const morphState = { duration: 1200, ease: true };
  const presetFolder = animFolder.addFolder({ title: 'Preset A / B morph' });
  presetFolder.addButton({ title: 'Save current as A' }).on('click', () => { presetA = snapshotPreset(); });
  presetFolder.addButton({ title: 'Save current as B' }).on('click', () => { presetB = snapshotPreset(); });
  presetFolder.addBinding(morphState, 'duration', { min: 100, max: 6000, step: 100, label: 'Duration (ms)' });
  presetFolder.addBinding(morphState, 'ease', { label: 'Ease' });
  presetFolder.addButton({ title: 'Morph -> B' }).on('click', () => morphTo(presetB, morphState.duration, morphState.ease));
  presetFolder.addButton({ title: 'Morph -> A' }).on('click', () => morphTo(presetA, morphState.duration, morphState.ease));

  const kfFolder = animFolder.addFolder({ title: 'Keyframe (one parameter)' });
  kfFolder.addBinding(kf, 'param', { label: 'Parameter', options: { width: 'width', taper: 'taper', tremor: 'tremor', gap: 'gap' } });
  kfFolder.addBinding(kf, 'a', { label: 'Value A', min: 0, max: 0.3, step: 0.005 });
  kfFolder.addBinding(kf, 'b', { label: 'Value B', min: 0, max: 0.3, step: 0.005 });
  kfFolder.addBinding(kf, 'duration', { label: 'Duration (ms)', min: 200, max: 8000, step: 100 });
  kfFolder.addBinding(kf, 'interp', { label: 'Interpolation', options: { linear: 'linear', ease: 'ease' } });
  kfFolder.addBinding(kf, 'extend', { label: 'Extend', options: { hold: 'hold', loop: 'loop', mirror: 'mirror' } });
  const playBtn = kfFolder.addButton({ title: 'Play' });
  playBtn.on('click', () => {
    if (kf.playing) { kfStop(); playBtn.title = 'Play'; }
    else { kfPlay(); playBtn.title = 'Stop'; }
  });
}

function buildModulationFolder() {
  const mf = pane.addFolder({ title: 'Modulation', expanded: false });
  const paramOpts = { width: 'width', taper: 'taper', tremor: 'tremor', gap: 'gap' };

  const audioUI = { enabled: audioMod.enabled, param: audioMod.param, amount: audioMod.amount };
  mf.addButton({ title: 'Enable microphone' }).on('click', async (ev) => {
    try { await startAudio(); ev.target.title = 'Microphone live'; } catch { ev.target.title = 'Mic denied/unavailable'; }
  });
  mf.addBinding(audioUI, 'enabled', { label: 'Audio drives param' }).on('change', (ev) => {
    audioMod.enabled = ev.value;
    if (ev.value) audioMod.base[audioUI.param] = active.ribbons[selectedRibbon][audioUI.param];
  });
  mf.addBinding(audioUI, 'param', { label: 'Audio target', options: paramOpts }).on('change', (ev) => {
    audioMod.param = ev.value;
    audioMod.base[ev.value] = active.ribbons[selectedRibbon][ev.value];
  });
  mf.addBinding(audioUI, 'amount', { label: 'Audio amount', min: 0, max: 0.15, step: 0.005 }).on('change', (ev) => { audioMod.amount = ev.value; });

  const camUI = { enabled: camMod.enabled, param: camMod.param, amount: camMod.amount };
  mf.addButton({ title: 'Enable camera' }).on('click', async (ev) => {
    try { await startCamera(); ev.target.title = 'Camera live'; } catch { ev.target.title = 'Camera denied/unavailable'; }
  });
  mf.addBinding(camUI, 'enabled', { label: 'Camera drives param' }).on('change', (ev) => {
    camMod.enabled = ev.value;
    if (ev.value) camMod.base[camUI.param] = active.ribbons[selectedRibbon][camUI.param];
  });
  mf.addBinding(camUI, 'param', { label: 'Camera target', options: paramOpts }).on('change', (ev) => {
    camMod.param = ev.value;
    camMod.base[ev.value] = active.ribbons[selectedRibbon][ev.value];
  });
  mf.addBinding(camUI, 'amount', { label: 'Camera amount', min: 0, max: 0.05, step: 0.002 }).on('change', (ev) => { camMod.amount = ev.value; });

  lfos.forEach((lfo, idx) => {
    const lf = mf.addFolder({ title: `LFO ${idx + 1}`, expanded: false });
    lf.addBinding(lfo, 'enabled').on('change', () => { lfoBase[lfo.target] = active.ribbons[selectedRibbon][lfo.target]; });
    lf.addBinding(lfo, 'waveform', { options: { sine: 'sine', square: 'square', triangle: 'triangle' } });
    lf.addBinding(lfo, 'period', { label: 'Period (ms)', min: 200, max: 8000, step: 100 });
    lf.addBinding(lfo, 'phase', { min: 0, max: 1, step: 0.01 });
    lf.addBinding(lfo, 'hold', { label: 'Hold (freeze)' });
    lf.addBinding(lfo, 'amount', { min: 0, max: 0.08, step: 0.002 });
    lf.addBinding(lfo, 'target', { options: paramOpts }).on('change', () => { lfoBase[lfo.target] = active.ribbons[selectedRibbon][lfo.target]; });
  });
}

function buildAdjustmentsFolder() {
  const af = pane.addFolder({ title: 'Adjustments', expanded: false });
  af.addBinding(adj, 'hue', { min: -180, max: 180, step: 1 }).on('change', render);
  af.addBinding(adj, 'saturation', { min: -100, max: 100, step: 1 }).on('change', render);
  af.addBinding(adj, 'brightness', { min: -100, max: 100, step: 1 }).on('change', render);

  const cb = af.addFolder({ title: 'Color Balance', expanded: false });
  cb.addBinding(adj, 'shadowsTint', { view: 'color', label: 'Shadows' }).on('change', render);
  cb.addBinding(adj, 'shadowsAmt', { min: 0, max: 100, step: 1, label: 'Shadows amt' }).on('change', render);
  cb.addBinding(adj, 'midsTint', { view: 'color', label: 'Midtones' }).on('change', render);
  cb.addBinding(adj, 'midsAmt', { min: 0, max: 100, step: 1, label: 'Midtones amt' }).on('change', render);
  cb.addBinding(adj, 'highsTint', { view: 'color', label: 'Highlights' }).on('change', render);
  cb.addBinding(adj, 'highsAmt', { min: 0, max: 100, step: 1, label: 'Highlights amt' }).on('change', render);

  const cv = af.addFolder({ title: 'Curves', expanded: false });
  cv.addBinding(adj, 'curveEnabled', { label: 'Enable (drag the graph below)' }).on('change', render);
  cv.addButton({ title: 'Reset curve' }).on('click', () => {
    adj.curvePoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    drawCurveGraph(); render();
  });

  const gm = af.addFolder({ title: 'Gradient Map', expanded: false });
  gm.addBinding(adj, 'gradientEnabled', { label: 'Enable' }).on('change', render);
  gm.addBinding(adj.gradientStops, '0', { view: 'color', label: 'Shadow color' }).on('change', render);
  gm.addBinding(adj.gradientStops, '1', { view: 'color', label: 'Highlight color' }).on('change', render);
}

function buildEffectsFolder() {
  const ef = pane.addFolder({ title: 'Effects', expanded: false });
  ef.addBinding(fx, 'opacity', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'noise', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'sharpen', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'bloom', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'glitch', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'halftone', { min: 0, max: 1, step: 0.01 }).on('change', render);
  ef.addBinding(fx, 'chromaticAberration', { min: 0, max: 1, step: 0.01, label: 'Chromatic aberration' }).on('change', render);
}

// ============================================================
// Render
// ============================================================
function render() {
  ctx.fillStyle = active.ground;
  ctx.fillRect(0, 0, W, HGT);

  active.ribbons.forEach((r, ribbonIdx) => {
    r.closed = !!r.closed;
    const pts = r.points.map((p, pi) => {
      const wx = wander.enabled ? wanderOffset(pi, ribbonIdx, 'x') : 0;
      const wy = wander.enabled ? wanderOffset(pi, ribbonIdx, 'y') : 0;
      const tp = { x: (p.x + wx) * W, y: (p.y + wy) * HGT };
      if (p.hOut) tp.hOut = { x: p.hOut.x * W, y: p.hOut.y * HGT };
      if (p.hIn) tp.hIn = { x: p.hIn.x * W, y: p.hIn.y * HGT };
      return tp;
    });
    const pl = H.splineHandles(pts, 220, r.closed);
    const minDim = Math.min(W, HGT);
    const wFn = (u) => H.widthAt(u, r.width * minDim, r.taper, false, false);
    const gapPx = Math.max(3, r.gap * minDim);

    if (r.glow) { ctx.save(); ctx.shadowColor = r.ink; ctx.shadowBlur = 24; }

    ctx.fillStyle = active.ground;
    H.ribbonPath(ctx, pl, wFn, gapPx * 2, r.tremor, r.closed);
    ctx.fill();

    const isCustomBlend = CUSTOM_BLEND_NAMES.has(r.blend);
    if (isCustomBlend) {
      applyCustomBlendRibbon(r.blend, (sctx) => {
        sctx.fillStyle = r.ink;
        H.ribbonPath(sctx, pl, wFn, 0, r.tremor, r.closed);
        sctx.fill();
      });
      // outline strokes normally on the main canvas -- it's chrome/edge
      // definition, not part of the blend-mode compositing.
      ctx.fillStyle = r.ink;
      H.ribbonPath(ctx, pl, wFn, 0, r.tremor, r.closed);
    } else {
      ctx.globalCompositeOperation = r.blend || 'source-over';
      ctx.fillStyle = r.ink;
      H.ribbonPath(ctx, pl, wFn, 0, r.tremor, r.closed);
      ctx.fill();
    }
    if (r.outlineWidth > 0) {
      // same path is still current -- stroking it right after filling
      // traces the ribbon's outer silhouette, no engine change needed.
      ctx.strokeStyle = r.outlineColor || '#1a1510';
      ctx.lineWidth = Math.max(1, r.outlineWidth * minDim);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (r.glow) {
      ctx.globalCompositeOperation = 'lighter';
      const coreWFn = (u) => H.widthAt(u, r.width * minDim * 0.35, r.taper, false, false);
      H.ribbonPath(ctx, pl, coreWFn, 0, r.tremor, r.closed);
      ctx.fill();
      ctx.restore();
    }

    if (r.core) {
      const coreWFn = (u) => H.widthAt(u, r.width * minDim * 0.16, r.taper, false, false);
      ctx.fillStyle = r.core;
      H.ribbonPath(ctx, pl, coreWFn, 0, r.tremor, r.closed);
      ctx.fill();
    }
  });

  postFX();

  // ---- Control-polygon segment highlight (Group B #6), selected ribbon only ----
  const sel = active.ribbons[selectedRibbon];
  const spts = sel.points.map(p => ({ x: p.x * W, y: p.y * HGT }));
  const segCount = sel.closed ? spts.length : spts.length - 1;
  for (let i = 0; i < segCount; i++) {
    if (i !== hoverSegment && i !== selectedSegment) continue;
    const a = spts[i], b = spts[(i + 1) % spts.length];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = i === selectedSegment ? '#ff4d4d' : '#c9a84c';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // ---- Handles draw in a pass of their own, after every ribbon is filled --
  // drawing them per-ribbon let later ribbons paint over earlier handles
  // wherever paths cross. Only the selected ribbon's points show. ----
  spts.forEach((p, i) => {
    const isDragging = [...drags.values()].some(d => d.type === 'point' && d.point === i);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = isDragging ? '#ff4d4d' : (selectedPoint && selectedPoint.point === i ? '#c9a84c' : '#ffffff');
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // ---- Bezier handle markers (Group B #8/#10), selected point only ----
  if (selectedPoint && selectedPoint.ribbon === selectedRibbon) {
    const pt = sel.points[selectedPoint.point];
    const base = spts[selectedPoint.point];
    ['hOut', 'hIn'].forEach((k) => {
      if (!pt[k]) return;
      const hx = pt[k].x * W, hy = pt[k].y * HGT;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(hx, hy);
      ctx.strokeStyle = '#5f93a3'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#5f93a3';
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    });
  }

  // ---- Sketch-in-progress stroke preview (Group B #11) ----
  if (sketchMode.active && sketchMode.stroke.length > 1) {
    ctx.beginPath();
    ctx.moveTo(sketchMode.stroke[0].x, sketchMode.stroke[0].y);
    sketchMode.stroke.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#c9a84c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ============================================================
// Pointer-driven interaction (canvas) -- Pointer Events, not mouse
// events, so two simultaneous touches each drag a different target
// (Group D #21).
// ============================================================
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (sketchMode.active) {
    sketchMode.stroke = [{ x: mx, y: my }];
    drags.set(e.pointerId, { type: 'sketch' });
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  const handleSide = hitTestHandle(mx, my);
  if (handleSide) {
    drags.set(e.pointerId, { type: 'handle', ribbon: selectedRibbon, point: selectedPoint.point, side: handleSide });
    lastHandleSide = handleSide;
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  const pi = hitTestPoint(mx, my, selectedRibbon);
  if (pi >= 0) {
    selectedPoint = { ribbon: selectedRibbon, point: pi };
    drags.set(e.pointerId, { type: 'point', ribbon: selectedRibbon, point: pi });
    canvas.setPointerCapture(e.pointerId);
    render();
    return;
  }

  const si = hitTestSegment(mx, my);
  selectedSegment = si >= 0 ? si : null;
  if (si < 0) selectedPoint = null;
  render();
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const d = drags.get(e.pointerId);

  if (d && d.type === 'sketch') {
    const last = sketchMode.stroke[sketchMode.stroke.length - 1];
    if (!last || Math.hypot(mx - last.x, my - last.y) > 8) sketchMode.stroke.push({ x: mx, y: my });
    render();
    return;
  }
  if (d && d.type === 'point') {
    active.ribbons[d.ribbon].points[d.point].x = mx / W;
    active.ribbons[d.ribbon].points[d.point].y = my / HGT;
    render();
    return;
  }
  if (d && d.type === 'handle') {
    updateHandleDrag(d.ribbon, d.point, d.side, mx, my);
    return;
  }
  if (!d) {
    const si = hitTestSegment(mx, my);
    if (si !== hoverSegment) { hoverSegment = si; render(); }
  }
});

canvas.addEventListener('pointerup', (e) => {
  const d = drags.get(e.pointerId);
  if (d && d.type === 'sketch') finalizeSketch();
  drags.delete(e.pointerId);
  render();
});
canvas.addEventListener('pointercancel', (e) => { drags.delete(e.pointerId); });

// #7: live subdivision of the selected segment via mouse-wheel.
canvas.addEventListener('wheel', (e) => {
  if (selectedSegment === null) return;
  e.preventDefault();
  const r = active.ribbons[selectedRibbon];
  const n = r.points.length;
  if (e.deltaY < 0) {
    const a = r.points[selectedSegment], b = r.points[(selectedSegment + 1) % n];
    r.points.splice(selectedSegment + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  } else if (n > 3) {
    r.points.splice((selectedSegment + 1) % n, 1);
    selectedSegment = Math.min(selectedSegment, r.points.length - (r.closed ? 1 : 2));
  }
  render();
}, { passive: false });

// #8 align / #10 tied-untied / handle toggle -- act on the selected point.
window.addEventListener('keydown', (e) => {
  if (!selectedPoint || selectedPoint.ribbon !== selectedRibbon) return;
  const r = active.ribbons[selectedRibbon];
  const pt = r.points[selectedPoint.point];
  if (e.key === 'h' || e.key === 'H') {
    if (pt.hOut || pt.hIn) { delete pt.hOut; delete pt.hIn; }
    else addDefaultHandles(r, selectedPoint.point);
    render();
  } else if (e.key === 'k' || e.key === 'K') {
    alignSelectedPoint();
  } else if (e.key === 't' || e.key === 'T') {
    pt.tied = pt.tied === false ? true : false;
  }
});

// ============================================================
// 2D joystick pads (Group D #20) -- pointer events, independent of the
// canvas's own pointer tracking, so a pad drag and a canvas drag can
// run from two different fingers at once.
// ============================================================
function wirePad(padEl, paramX, paramY, rangeX, rangeY) {
  const dot = padEl.querySelector('.pad-dot');
  function setFromEvent(e) {
    const rect = padEl.getBoundingClientRect();
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const r = active.ribbons[selectedRibbon];
    r[paramX] = rangeX[0] + rx * (rangeX[1] - rangeX[0]);
    r[paramY] = rangeY[0] + ry * (rangeY[1] - rangeY[0]);
    dot.style.left = (rx * 100) + '%';
    dot.style.top = (ry * 100) + '%';
    render();
    if (pane) pane.refresh();
  }
  padEl.addEventListener('pointerdown', (e) => { padEl.setPointerCapture(e.pointerId); setFromEvent(e); });
  padEl.addEventListener('pointermove', (e) => { if (e.buttons) setFromEvent(e); });
}
wirePad(document.getElementById('pad-width-taper'), 'width', 'taper', [0.01, 0.2], [0.02, 0.3]);
wirePad(document.getElementById('pad-gap-tremor'), 'gap', 'tremor', [0, 0.03], [0, 0.1]);

// ============================================================
// Real draggable tone-curve graph (replaces the earlier 3-slider stand-in,
// per founder instruction to finish it properly) -- click empty space to
// add a point (max 8), drag any point, points stay sorted by x so the LUT
// build in postFX() always walks a monotonic-in-x point list.
// ============================================================
const curveCanvas = document.getElementById('curve-graph');
const curveCtx = curveCanvas.getContext('2d');
let curveDrag = null;
function drawCurveGraph() {
  const w = curveCanvas.width, h = curveCanvas.height;
  curveCtx.fillStyle = '#f5efe2';
  curveCtx.fillRect(0, 0, w, h);
  curveCtx.strokeStyle = 'rgba(160,140,110,0.3)';
  curveCtx.lineWidth = 1;
  curveCtx.beginPath(); curveCtx.moveTo(0, h); curveCtx.lineTo(w, 0); curveCtx.stroke();

  const lut = buildCurveLUT(adj.curvePoints);
  curveCtx.beginPath();
  for (let x = 0; x < w; x++) {
    const i = Math.min(255, Math.round((x / w) * 255));
    const y = h - (lut[i] / 255) * h;
    if (x === 0) curveCtx.moveTo(x, y); else curveCtx.lineTo(x, y);
  }
  curveCtx.strokeStyle = '#c9a84c';
  curveCtx.lineWidth = 2;
  curveCtx.stroke();

  adj.curvePoints.forEach((p, i) => {
    curveCtx.beginPath();
    curveCtx.arc(p.x * w, h - p.y * h, 5, 0, Math.PI * 2);
    curveCtx.fillStyle = curveDrag === i ? '#ff4d4d' : '#1a1510';
    curveCtx.fill();
  });
}
function curvePointAt(mx, my) {
  const w = curveCanvas.width, h = curveCanvas.height;
  let best = -1, bestD = 12;
  adj.curvePoints.forEach((p, i) => {
    const d = Math.hypot(mx - p.x * w, my - (h - p.y * h));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
curveCanvas.addEventListener('pointerdown', (e) => {
  const rect = curveCanvas.getBoundingClientRect();
  const scaleX = curveCanvas.width / rect.width, scaleY = curveCanvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
  const hit = curvePointAt(mx, my);
  if (hit >= 0) {
    curveDrag = hit;
    curveCanvas.setPointerCapture(e.pointerId);
  } else if (adj.curvePoints.length < 8) {
    const nx = Math.max(0, Math.min(1, mx / curveCanvas.width));
    const ny = Math.max(0, Math.min(1, 1 - my / curveCanvas.height));
    adj.curvePoints.push({ x: nx, y: ny });
    adj.curvePoints.sort((a, b) => a.x - b.x);
    drawCurveGraph();
    render();
  }
});
curveCanvas.addEventListener('pointermove', (e) => {
  if (curveDrag === null) return;
  const rect = curveCanvas.getBoundingClientRect();
  const scaleX = curveCanvas.width / rect.width, scaleY = curveCanvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX, my = (e.clientY - rect.top) * scaleY;
  const nx = Math.max(0, Math.min(1, mx / curveCanvas.width));
  const ny = Math.max(0, Math.min(1, 1 - my / curveCanvas.height));
  adj.curvePoints[curveDrag] = { x: nx, y: ny };
  drawCurveGraph();
  render();
});
window.addEventListener('pointerup', (e) => {
  if (curveDrag === null) return;
  adj.curvePoints.sort((a, b) => a.x - b.x);
  curveDrag = null;
  drawCurveGraph();
});
drawCurveGraph();

// ============================================================
// The 11 Procreate blend modes with no native Canvas2D
// globalCompositeOperation equivalent (Batch 2, "do not hold back" pass).
// Each ribbon using one of these renders its ink shape to an offscreen
// scratch canvas first, then blends it into the main canvas pixel-by-pixel
// with the real formula -- the 14 native modes still use the free,
// fast ctx.globalCompositeOperation path.
// ============================================================
const CUSTOM_BLEND_NAMES = new Set([
  'Shade', 'Add', 'Lighter Color', 'Darker Color', 'Vivid Light',
  'Linear Light', 'Pin Light', 'Hard Mix', 'Linear Burn', 'Subtract', 'Divide',
]);
Object.assign(BLEND_MODES, {
  Shade: 'Shade', Add: 'Add', 'Lighter Color': 'Lighter Color', 'Darker Color': 'Darker Color',
  'Vivid Light': 'Vivid Light', 'Linear Light': 'Linear Light', 'Pin Light': 'Pin Light',
  'Hard Mix': 'Hard Mix', 'Linear Burn': 'Linear Burn', Subtract: 'Subtract', Divide: 'Divide',
});
let blendScratch = null;
function getBlendScratch() {
  if (!blendScratch || blendScratch.width !== canvas.width || blendScratch.height !== canvas.height) {
    blendScratch = document.createElement('canvas');
    blendScratch.width = canvas.width;
    blendScratch.height = canvas.height;
  }
  return blendScratch;
}
function customBlendChannel(mode, b, s) {
  switch (mode) {
    case 'Shade': return Math.min(b, s);
    case 'Add': return Math.min(255, b + s);
    case 'Vivid Light':
      return s < 128
        ? (s === 0 ? 0 : Math.max(0, 255 - Math.min(255, ((255 - b) * 255) / (2 * s))))
        : (s === 255 ? 255 : Math.min(255, (b * 255) / (2 * (255 - s))));
    case 'Linear Light': return Math.max(0, Math.min(255, b + 2 * s - 255));
    case 'Pin Light': return s < 128 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 128));
    case 'Hard Mix': return b + s >= 255 ? 255 : 0;
    case 'Linear Burn': return Math.max(0, b + s - 255);
    case 'Subtract': return Math.max(0, b - s);
    case 'Divide': return s === 0 ? 255 : Math.min(255, (b / s) * 255);
    default: return s;
  }
}
function applyCustomBlendRibbon(mode, drawFn) {
  const scratch = getBlendScratch();
  const sctx = scratch.getContext('2d');
  sctx.clearRect(0, 0, scratch.width, scratch.height);
  drawFn(sctx);

  const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const blend = sctx.getImageData(0, 0, scratch.width, scratch.height);
  const bd = base.data, sd = blend.data;
  const wholePixel = mode === 'Lighter Color' || mode === 'Darker Color';

  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3];
    if (a === 0) continue;
    const sa = a / 255;
    if (wholePixel) {
      const baseLum = bd[i] + bd[i + 1] + bd[i + 2];
      const srcLum = sd[i] + sd[i + 1] + sd[i + 2];
      const pick = mode === 'Lighter Color' ? srcLum > baseLum : srcLum < baseLum;
      if (pick) {
        bd[i] += (sd[i] - bd[i]) * sa;
        bd[i + 1] += (sd[i + 1] - bd[i + 1]) * sa;
        bd[i + 2] += (sd[i + 2] - bd[i + 2]) * sa;
      }
    } else {
      for (let c = 0; c < 3; c++) {
        const blended = customBlendChannel(mode, bd[i + c], sd[i + c]);
        bd[i + c] += (blended - bd[i + c]) * sa;
      }
    }
  }
  ctx.putImageData(base, 0, 0);
}

// ---- Piece switcher ----
PIECES.forEach(p => {
  const opt = document.createElement('option');
  opt.value = p.id; opt.textContent = p.name;
  pieceSelect.appendChild(opt);
});
pieceSelect.addEventListener('change', () => loadPiece(pieceSelect.value));

loadPiece(PIECES[0].id);
