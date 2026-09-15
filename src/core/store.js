// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: the shared
// core module. State objects, render(), the engine.js/ribbon-materials.js/
// postfx-gl.js calls, and all 6 live RAF loops (LFO, wander, keyframe, audio,
// camera, preset A/B morph), plus the WS sync protocol -- extracted verbatim
// (behavior unchanged, only location + a bump()/hook wiring added) out of the
// old monolithic main.js so BOTH the phone/Tailscale controller entry
// (src/controller/main.js, raw-served by src-tauri/src/server.rs via
// include_str! -- so this file MUST stay plain relative-import JS, no bare
// package specifiers, nothing that needs a bundler) and the new Vite/React
// desktop entry (src/panel/main.jsx) can read/drive the exact same live
// state. Two separate module instances at runtime (one per JS context, phone
// tab vs desktop webview) -- they are never the same object in memory, they
// stay in sync only via the WS relay below, exactly like today's two copies
// of main.js already did. Only the *location* of this logic changed; every
// function's *behavior* is untouched (house doctrine: premise 1).
import { H } from '../engine.js';
import { PIECES } from '../pieces.js';
import { createPostFxGl } from '../postfx-gl.js';
import { drawRibbonMaterial, RIBBON_MATERIALS } from '../ribbon-materials.js';

export { PIECES, RIBBON_MATERIALS };

// Same detection main.js always used -- Tauri's injected global exists only
// in the real desktop webview, so a phone opening the plain server URL (with
// or without ?controller) is always false here. Recomputed independently in
// this module (not passed in) since each entry gets its own copy of core.
// ?desktop=1 is a dev-only escape hatch for browser-based acceptance testing
// (Chrome automation can't inject window.__TAURI__ before this module loads) --
// never set by the real Tauri webview or the phone controller flow.
export const isController = (!window.__TAURI__ || new URLSearchParams(location.search).has('controller'))
  && !new URLSearchParams(location.search).has('desktop');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const frameStatEl = document.getElementById('frame-stat');
const freqCanvas = document.getElementById('freq-meter');
const freqCtx = freqCanvas ? freqCanvas.getContext('2d') : null;
let W, HGT;

// ============================================================
// The shared mutable model -- a single exported object rather than bare
// module-level `let`s, so both consumer entries (which each get their own
// live-binding view of a `let` export, but can't *reassign* one from outside
// the owning module) can freely read AND reassign fields (active, presetA/B,
// selectedRibbon, multiSelect, presenting, selectedPoint, ...) the same way
// main.js always did with its bare top-level `let`s.
// ============================================================
export const state = {
  active: null,
  selectedRibbon: 0,
  multiSelect: new Set([0]),
  presetA: null,
  presetB: null,
  selectedPoint: null,   // { ribbon, point }
  selectedSegment: null,
  hoverSegment: null,
  drags: new Map(),      // pointerId -> {type:'point'|'handle'|'sketch'|'width', ...}
  sketchMode: { active: false, stroke: [] },
  presenting: false,

  adj: {
    hue: 0, saturation: 0, brightness: 0,
    shadowsTint: '#000000', shadowsAmt: 0,
    midsTint: '#808080', midsAmt: 0,
    highsTint: '#ffffff', highsAmt: 0,
    curveEnabled: false,
    curvePoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    gradientEnabled: false,
    gradientStops: ['#1a1510', '#c9a84c'],
  },
  fx: { opacity: 1, noise: 0, sharpen: 0, bloom: 0, glitch: 0, halftone: 0, chromaticAberration: 0 },
  wander: { enabled: true, amplitude: 0.02, speed: 1 },
  lfos: [
    { enabled: false, waveform: 'sine', period: 2000, phase: 0, hold: false, target: 'tremor', amount: 0.02, target2: 'none', amount2: 0.02 },
    { enabled: false, waveform: 'sine', period: 3000, phase: 0.25, hold: false, target: 'gap', amount: 0.006, target2: 'none', amount2: 0.006 },
  ],
  kf: { param: 'tremor', a: 0, b: 0.05, duration: 2000, interp: 'ease', extend: 'loop', playing: false },
  audioMod: { enabled: false, param: 'tremor', amount: 0.06, base: {} },
  camMod: { enabled: false, param: 'gap', amount: 0.01, base: {} },
};

// ============================================================
// useSyncExternalStore contract (2nd review-pass fix): the snapshot React
// reads is this primitive version counter, never the raw mutable `state`
// object (mutating in place never changes reference identity, so React would
// never have re-rendered on it). bump() is called once, from inside render()
// -- render() already runs after every mutation across the whole app (every
// control on both the desktop React panel and the phone controller, every
// pointer handler, all 6 RAF loops, remote-state apply), so tapping that one
// existing choke point is both correct and the minimal-risk way to wire
// every mutation site without hunting each one by hand. (Tweakpane's own
// pane.refresh()/rebuild hooks -- setPaneRefreshHook/setRemoteApplyHook --
// were removed when Tweakpane was: this version counter already covered
// every one of their call sites.)
// ============================================================
let version = 0;
const listeners = new Set();
export function bump() { version++; listeners.forEach((l) => l()); }
export function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getVersion() { return version; }

// ============================================================
// Resize / postFX-GL lifecycle (verbatim from old main.js)
// ============================================================
let postFxGl = null;
let postFxGlTried = false;
let postFxGlError = null;

export function resize() {
  const dpr = window.devicePixelRatio || 1;
  if (isController) { W = 4; HGT = 4; } // no canvas UI on the phone -- keep the backing store trivial
  else W = state.presenting ? window.innerWidth : window.innerWidth - 280; // leave room for the panel
  if (!isController) HGT = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = HGT * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = HGT + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!isController) {
    if (!postFxGlTried) {
      postFxGlTried = true;
      try { postFxGl = createPostFxGl(canvas.width, canvas.height); }
      catch (e) {
        console.error('postfx-gl init failed, falling back to CPU postFX:', e);
        postFxGl = null;
        postFxGlError = e.message || String(e);
      }
    } else if (postFxGl) {
      postFxGl.resize(canvas.width, canvas.height);
    }
  }
}
window.addEventListener('resize', resize);
resize(); // same ordering as the old main.js -- W/HGT must be set before the first loadPiece()/render()

export function setPresenting(on) {
  state.presenting = on;
  document.body.classList.toggle('presenting', on);
  resize();
  render();
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && state.presenting) setPresenting(false);
});

// ============================================================
// Piece loading
// ============================================================
export function loadPiece(id) {
  kfStop();
  if (morphRaf) cancelAnimationFrame(morphRaf);
  state.presetA = null; state.presetB = null;
  state.selectedPoint = null; state.selectedSegment = null; state.hoverSegment = null;
  state.sketchMode.active = false; state.sketchMode.stroke = [];
  state.drags.clear();
  const src = PIECES.find((p) => p.id === id);
  state.active = JSON.parse(JSON.stringify(src));
  state.active.ribbons.forEach((r) => {
    r.outlineWidth = r.outlineWidth ?? 0;
    r.outlineColor = r.outlineColor || '#1a1510';
    r.blend = r.blend || 'source-over';
    r.closed = !!r.closed;
    r.material = r.material || 'ribbon';
    if (r.materialAmount === undefined) r.materialAmount = 0.5;
    if (r.materialSpeed === undefined) r.materialSpeed = 0.5;
  });
  state.selectedRibbon = 0;
  state.multiSelect = new Set([0]);
  render();
  scheduleSync();
}

// ============================================================
// Animation core (Group A): shared lerp/color helpers used by preset
// morphing, the keyframe demo, shuffle, and modulation.
// ============================================================
export function lerp(a, b, t) { return a + (b - a) * t; }
export function easeInOut(t) { return t * t * (3 - 2 * t); }
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function lerpColor(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  return rgbToHex(lerp(pa.r, pb.r, t), lerp(pa.g, pb.g, t), lerp(pa.b, pb.b, t));
}
export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// ---- Preset A/B morph (RAF loop #6) ----
let morphRaf = null;
export function snapshotPreset() { return JSON.parse(JSON.stringify(state.active.ribbons)); }
export function morphTo(target, durationMs, useEase) {
  if (!target) return;
  if (morphRaf) cancelAnimationFrame(morphRaf);
  const start = snapshotPreset();
  const t0 = performance.now();
  function tick(now) {
    const raw = Math.min(1, (now - t0) / durationMs);
    const t = useEase ? easeInOut(raw) : raw;
    state.active.ribbons.forEach((r, i) => {
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
    if (raw < 1) morphRaf = requestAnimationFrame(tick);
  }
  morphRaf = requestAnimationFrame(tick);
}

// ---- Shuffle ----
export function randomColor() { return hslToHex(Math.random() * 360, 55 + Math.random() * 25, 40 + Math.random() * 20); }
export function shuffleSelected() {
  const jitter = (v, amt, min, max) => Math.max(min, Math.min(max, v + (Math.random() * 2 - 1) * amt));
  state.multiSelect.forEach((idx) => {
    const r = state.active.ribbons[idx];
    if (!r) return;
    r.width = jitter(r.width, 0.03, 0.01, 0.2);
    r.taper = jitter(r.taper, 0.04, 0.02, 0.3);
    r.tremor = jitter(r.tremor, 0.015, 0, 0.1);
    r.gap = jitter(r.gap, 0.004, 0, 0.03);
    r.ink = randomColor();
  });
  render();
}

// ---- Keyframe demo (RAF loop #3) ----
export function kfExtendedT(elapsed, duration, mode) {
  const raw = elapsed / duration;
  if (mode === 'hold') return Math.min(1, raw);
  if (mode === 'loop') return raw % 1;
  const cyc = raw % 2;
  return cyc <= 1 ? cyc : 2 - cyc;
}
let kfRaf = null, kfStart = 0;
function kfTick(now) {
  const elapsed = now - kfStart;
  let t = kfExtendedT(elapsed, state.kf.duration, state.kf.extend);
  if (state.kf.interp === 'ease') t = easeInOut(t);
  const v = lerp(state.kf.a, state.kf.b, t);
  state.multiSelect.forEach((idx) => { state.active.ribbons[idx][state.kf.param] = v; });
  render();
  if (state.kf.playing) kfRaf = requestAnimationFrame(kfTick);
}
export function kfPlay() {
  if (state.kf.playing) return;
  state.kf.playing = true;
  kfStart = performance.now();
  kfRaf = requestAnimationFrame(kfTick);
}
export function kfStop() {
  state.kf.playing = false;
  if (kfRaf) cancelAnimationFrame(kfRaf);
}

// ============================================================
// Modulation (Group C): audio-FFT, camera luminance, dual LFOs (RAF loops
// #4 audio, #5 camera, #1 LFO).
// ============================================================
let audioCtx = null, analyser = null, audioBins = null;
export async function startAudio() {
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
  if (!audioBins || !freqCtx) return;
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
  if (state.audioMod.enabled) {
    const avg = audioBins.reduce((a, b) => a + b, 0) / audioBins.length / 255;
    state.multiSelect.forEach((idx) => {
      const key = idx + ':' + state.audioMod.param;
      const base = state.audioMod.base[key] ?? state.active.ribbons[idx][state.audioMod.param];
      state.active.ribbons[idx][state.audioMod.param] = Math.max(0, base + avg * state.audioMod.amount);
    });
    render();
  }
  requestAnimationFrame(audioTick);
}

let camVideo = null, camSampleCtx = null;
export async function startCamera() {
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
    if (state.camMod.enabled) {
      state.multiSelect.forEach((idx) => {
        const key = idx + ':' + state.camMod.param;
        const base = state.camMod.base[key] ?? state.active.ribbons[idx][state.camMod.param];
        state.active.ribbons[idx][state.camMod.param] = Math.max(0, base + avg * state.camMod.amount);
      });
      render();
    }
  }
  requestAnimationFrame(camTick);
}

function lfoWaveValue(lfo, tMs) {
  if (lfo.hold) return 0;
  const phase = ((tMs / lfo.period) + lfo.phase) % 1;
  if (lfo.waveform === 'square') return phase < 0.5 ? 1 : -1;
  if (lfo.waveform === 'triangle') return phase < 0.5 ? (phase * 4 - 1) : (3 - phase * 4);
  return Math.sin(phase * Math.PI * 2);
}
export const lfoBase = {};
function lfoTick(now) {
  let any = false;
  state.lfos.forEach((lfo) => {
    if (!lfo.enabled) return;
    any = true;
    const v = lfoWaveValue(lfo, now);
    state.multiSelect.forEach((idx) => {
      const key = idx + ':' + lfo.target;
      const base = lfoBase[key] ?? state.active.ribbons[idx][lfo.target];
      state.active.ribbons[idx][lfo.target] = Math.max(0, base + v * lfo.amount);
    });
    if (lfo.target2 && lfo.target2 !== 'none') {
      state.multiSelect.forEach((idx) => {
        const key2 = idx + ':' + lfo.target2;
        const base2 = lfoBase[key2] ?? state.active.ribbons[idx][lfo.target2];
        state.active.ribbons[idx][lfo.target2] = Math.max(0, base2 + v * lfo.amount2);
      });
    }
  });
  if (any) render();
  requestAnimationFrame(lfoTick);
}
requestAnimationFrame(lfoTick);

// ---- Ambient wander (RAF loop #2) ----
let wanderT = 0;
function wanderOffset(pointIndex, ribbonIndex, axis) {
  const freq = 0.3 + ((pointIndex * 7 + ribbonIndex * 13 + (axis === 'y' ? 5 : 0)) % 17) / 10;
  const phase = pointIndex * 2.1 + ribbonIndex * 0.7 + (axis === 'y' ? 1.57 : 0);
  return Math.sin(wanderT * 0.008 * state.wander.speed * freq + phase) * state.wander.amplitude;
}
function wanderTick() {
  if (state.wander.enabled) { wanderT++; render(); }
  requestAnimationFrame(wanderTick);
}
requestAnimationFrame(wanderTick);

// ============================================================
// Adjustments + Effects post-process pass
// ============================================================
export const BLEND_MODES = {
  Normal: 'source-over', Multiply: 'multiply', Darken: 'darken', Lighten: 'lighten', Screen: 'screen',
  'Color Dodge': 'color-dodge', 'Color Burn': 'color-burn', 'Hard Light': 'hard-light', 'Soft Light': 'soft-light',
  Difference: 'difference', Exclusion: 'exclusion', Hue: 'hue', Saturation: 'saturation', Color: 'color', Luminosity: 'luminosity',
};

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
// draggable tone-curve graph -- unchanged from the pre-Phase-A ceiling.
export function buildCurveLUT(points) {
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
export function hexToRgbArr(hex) { const c = hexToRgb(hex); return [c.r, c.g, c.b]; }

let lastPostFxMs = 0, lastPostFxMode = null;
let lastMaterialError = null;
function postFX() {
  const adj = state.adj, fx = state.fx;
  const anyAdj = adj.hue || adj.saturation || adj.brightness || adj.shadowsAmt || adj.midsAmt || adj.highsAmt || adj.curveEnabled || adj.gradientEnabled;
  const anyFx = fx.noise || fx.sharpen || fx.bloom || fx.glitch || fx.halftone || fx.opacity < 1 || fx.chromaticAberration;
  if (!anyAdj && !anyFx) { lastPostFxMode = null; return; }

  const t0 = performance.now();

  if (postFxGl) {
    const curveLUT = adj.curveEnabled ? buildCurveLUT(adj.curvePoints) : null;
    postFxGl.render(canvas, adj, fx, curveLUT, state.active.ground, hexToRgbArr);
    ctx.drawImage(postFxGl.canvas, 0, 0);
  } else {
    postFXCpu();
  }

  lastPostFxMs = performance.now() - t0;
  lastPostFxMode = postFxGl ? 'GL' : (postFxGlError ? `CPU fallback: ${postFxGlError}` : 'CPU');
}

function postFXCpu() {
  const adj = state.adj, fx = state.fx;
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
    ctx.fillStyle = state.active.ground;
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
    ctx.fillStyle = state.active.ground;
    ctx.fillRect(0, 0, W, HGT);
    ctx.restore();
  }
}

// ---- Per-point width (used by render()'s chrome + interactions.js's width-handle drag) ----
export function widthMultAt(r, u) {
  const pts = r.points;
  const n = pts.length;
  const segCount = r.closed ? n : n - 1;
  const segF = Math.max(0, Math.min(segCount - 1e-6, u * segCount));
  const segIdx = Math.floor(segF);
  const t = segF - segIdx;
  const i0 = r.closed ? segIdx % n : segIdx;
  const i1 = r.closed ? (segIdx + 1) % n : Math.min(n - 1, segIdx + 1);
  const w0 = pts[i0].widthMult ?? 1;
  const w1 = pts[i1].widthMult ?? 1;
  return w0 + (w1 - w0) * t;
}
export function pointNormalScreen(spts, i, closed) {
  const n = spts.length;
  const prev = spts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const next = spts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const dx = next.x - prev.x, dy = next.y - prev.y;
  const m = Math.hypot(dx, dy) || 1;
  return { x: -dy / m, y: dx / m };
}
export const WIDTH_HANDLE_BASE = 14, WIDTH_HANDLE_SCALE = 18;
export function widthHandlePos(r, i) {
  const spts = r.points.map((p) => ({ x: p.x * W, y: p.y * HGT }));
  const base = spts[i];
  const nrm = pointNormalScreen(spts, i, r.closed);
  const wm = r.points[i].widthMult ?? 1;
  const dist = WIDTH_HANDLE_BASE + wm * WIDTH_HANDLE_SCALE;
  return { x: base.x + nrm.x * dist, y: base.y + nrm.y * dist, base, nrm };
}

// ============================================================
// The 11 Procreate blend modes with no native Canvas2D equivalent.
// ============================================================
export const CUSTOM_BLEND_NAMES = new Set([
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

// ============================================================
// Render
// ============================================================
export function render() {
  const _renderT0 = performance.now();
  const active = state.active;
  ctx.fillStyle = active.ground;
  ctx.fillRect(0, 0, W, HGT);

  active.ribbons.forEach((r, ribbonIdx) => {
    r.closed = !!r.closed;
    const pts = r.points.map((p, pi) => {
      const wx = state.wander.enabled ? wanderOffset(pi, ribbonIdx, 'x') : 0;
      const wy = state.wander.enabled ? wanderOffset(pi, ribbonIdx, 'y') : 0;
      const tp = { x: (p.x + wx) * W, y: (p.y + wy) * HGT };
      if (p.hOut) tp.hOut = { x: p.hOut.x * W, y: p.hOut.y * HGT };
      if (p.hIn) tp.hIn = { x: p.hIn.x * W, y: p.hIn.y * HGT };
      return tp;
    });
    const pl = H.splineHandles(pts, 220, r.closed);
    const minDim = Math.min(W, HGT);
    const wFn = (u) => H.widthAt(u, r.width * minDim, r.taper, false, false) * widthMultAt(r, u);
    const gapPx = Math.max(3, r.gap * minDim);

    if (r.glow) { ctx.save(); ctx.shadowColor = r.ink; ctx.shadowBlur = 24; }

    ctx.fillStyle = active.ground;
    H.ribbonPath(ctx, pl, wFn, gapPx * 2, r.tremor, r.closed);
    ctx.fill();

    const isCustomBlend = CUSTOM_BLEND_NAMES.has(r.blend);
    if (r.material && r.material !== 'ribbon') {
      try {
        drawRibbonMaterial(ctx, pl, wFn, r, r.tremor, r.closed);
      } catch (e) {
        console.error('ribbon material draw failed:', r.material, e);
        lastMaterialError = `${r.material}: ${e.message || e}`;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = r.ink;
      H.ribbonPath(ctx, pl, wFn, 0, r.tremor, r.closed);
    } else if (isCustomBlend) {
      applyCustomBlendRibbon(r.blend, (sctx) => {
        sctx.fillStyle = r.ink;
        H.ribbonPath(sctx, pl, wFn, 0, r.tremor, r.closed);
        sctx.fill();
      });
      ctx.fillStyle = r.ink;
      H.ribbonPath(ctx, pl, wFn, 0, r.tremor, r.closed);
    } else {
      ctx.globalCompositeOperation = r.blend || 'source-over';
      ctx.fillStyle = r.ink;
      H.ribbonPath(ctx, pl, wFn, 0, r.tremor, r.closed);
      ctx.fill();
    }
    if (r.outlineWidth > 0) {
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

  if (!state.presenting) {
    const sel = active.ribbons[state.selectedRibbon];
    const spts = sel.points.map((p) => ({ x: p.x * W, y: p.y * HGT }));
    const segCount = sel.closed ? spts.length : spts.length - 1;
    for (let i = 0; i < segCount; i++) {
      if (i !== state.hoverSegment && i !== state.selectedSegment) continue;
      const a = spts[i], b = spts[(i + 1) % spts.length];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = i === state.selectedSegment ? '#ff4d4d' : '#c9a84c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    spts.forEach((p, i) => {
      const isDragging = [...state.drags.values()].some((d) => d.type === 'point' && d.point === i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? '#ff4d4d' : (state.selectedPoint && state.selectedPoint.point === i ? '#c9a84c' : '#ffffff');
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    if (state.selectedPoint && state.selectedPoint.ribbon === state.selectedRibbon) {
      const pt = sel.points[state.selectedPoint.point];
      const base = spts[state.selectedPoint.point];
      ['hOut', 'hIn'].forEach((k) => {
        if (!pt[k]) return;
        const hx = pt[k].x * W, hy = pt[k].y * HGT;
        const isHandleDragging = [...state.drags.values()].some((d) => d.type === 'handle' && d.point === state.selectedPoint.point && d.side === k);
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(hx, hy);
        ctx.strokeStyle = '#5f93a3'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = isHandleDragging ? '#ff4d4d' : '#5f93a3';
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
      });

      const wh = widthHandlePos(sel, state.selectedPoint.point);
      const isWidthDragging = [...state.drags.values()].some((d) => d.type === 'width' && d.point === state.selectedPoint.point);
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(wh.x, wh.y);
      ctx.strokeStyle = '#c9744d'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(wh.x, wh.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = isWidthDragging ? '#ff4d4d' : '#c9744d';
      ctx.fill();
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 1; ctx.stroke();
    }

    if (state.sketchMode.active && state.sketchMode.stroke.length > 1) {
      ctx.beginPath();
      ctx.moveTo(state.sketchMode.stroke[0].x, state.sketchMode.stroke[0].y);
      state.sketchMode.stroke.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (frameStatEl) {
    const totalMs = performance.now() - _renderT0;
    const postFxPart = lastPostFxMode ? ` · postFX ${lastPostFxMs.toFixed(1)}ms (${lastPostFxMode})` : '';
    const errPart = lastMaterialError ? ` · ⚠ material error: ${lastMaterialError}` : '';
    frameStatEl.textContent = `render ${totalMs.toFixed(1)}ms${postFxPart}${totalMs > 16.6 ? ' ⚠' : ''}${errPart}`;
  }

  bump();
}

// Screen-space W/HGT accessors -- interactions.js and the React panel need
// these for hit-testing/canvas math without reaching into module-private state.
export function getW() { return W; }
export function getH() { return HGT; }

// ============================================================
// Ribbon selection
// ============================================================
export function setPrimaryRibbon(idx, { resetGroup = true } = {}) {
  if (!state.active || idx < 0 || idx >= state.active.ribbons.length) return;
  state.selectedRibbon = idx;
  if (resetGroup) state.multiSelect = new Set([idx]);
  else state.multiSelect.add(idx);
  state.selectedPoint = null; state.selectedSegment = null; state.hoverSegment = null;
  render();
}

// Group-edit mutation helpers -- the same delta-numeric / absolute-set
// semantics as old main.js's bindMultiNumeric/bindMultiAbsolute (Design
// section 2 + Tweakpane's own group-edit contract), exposed as plain
// functions so the new React Slider/ColorField/Dropdown primitives can drive
// the model without any Tweakpane coupling.
export function setRibbonNumeric(key, newValue, opts) {
  const r = state.active.ribbons[state.selectedRibbon];
  if (!r || typeof r[key] !== 'number') return;
  const delta = newValue - r[key];
  state.multiSelect.forEach((idx) => {
    const rr = state.active.ribbons[idx];
    if (!rr || typeof rr[key] !== 'number') return;
    const nv = rr[key] + delta;
    rr[key] = opts && opts.min !== undefined ? Math.max(opts.min, Math.min(opts.max, nv)) : nv;
  });
  render();
  scheduleSync();
}
export function setRibbonAbsolute(key, value, guard) {
  state.multiSelect.forEach((idx) => {
    const rr = state.active.ribbons[idx];
    if (!rr) return;
    if (guard && !guard(rr)) return;
    rr[key] = value;
  });
  render();
  scheduleSync();
}

// #19 auto-discovery convenience: a numeric key with sibling <key>Min/<key>Max
// gets that range; otherwise falls back to a small known-parameter default
// table. Shared by main.js's Tweakpane autoBindNumeric (phone/controller) AND
// RibbonPanel.jsx's auto-generated sliders (desktop React) -- one table, two
// consumers, so a new numeric ribbon field in pieces.js gets a working slider
// on BOTH surfaces with zero new code (Phase A AT5).
export const NUMERIC_DEFAULTS = { width: [0.01, 0.2, 0.005], taper: [0.02, 0.3, 0.005], tremor: [0, 0.1, 0.002], gap: [0, 0.03, 0.001], outlineWidth: [0, 0.03, 0.001] };
export const SKIP_KEYS = new Set(['points', 'ink', 'core', 'glow', 'closed']);
export function numericFieldRange(obj, key) {
  const hasRange = obj[key + 'Min'] !== undefined && obj[key + 'Max'] !== undefined;
  const [defMin, defMax, defStep] = NUMERIC_DEFAULTS[key] || [0, 1, 0.01];
  const min = hasRange ? obj[key + 'Min'] : defMin;
  const max = hasRange ? obj[key + 'Max'] : defMax;
  const step = obj[key + 'Step'] !== undefined ? obj[key + 'Step'] : defStep;
  return { min, max, step };
}
export function autoNumericKeys(obj) {
  return Object.keys(obj).filter((key) => {
    if (SKIP_KEYS.has(key) || key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Step')) return false;
    return typeof obj[key] === 'number';
  });
}

// ============================================================
// Wireless controller networking. Both the desktop app and a phone opening
// ?controller connect to the same embedded WS relay
// (src-tauri/src/server.rs, port 8917 -- desktop always via 127.0.0.1 since
// the server runs in-process; the phone via whatever LAN/Tailscale host it
// typed in). The relay does no interpretation: whoever last sent a
// `{active, adj, fx}` blob wins, rebroadcast to every other connected client.
// ============================================================
let ws = null;
let lastSentJSON = null;
let syncTimer = null;
export function sendState() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state.active) return;
  const payload = JSON.stringify({ active: state.active, adj: state.adj, fx: state.fx });
  lastSentJSON = payload;
  ws.send(payload);
}
export function scheduleSync() {
  if (syncTimer) return;
  syncTimer = setTimeout(() => { syncTimer = null; sendState(); }, 60);
}
function applyRemoteState(payload) {
  if (payload.active) {
    state.active = payload.active;
    state.selectedRibbon = Math.min(state.selectedRibbon, state.active.ribbons.length - 1);
    state.multiSelect = new Set([...state.multiSelect].filter((i) => i < state.active.ribbons.length));
    if (state.multiSelect.size === 0) state.multiSelect.add(state.selectedRibbon);
  }
  if (payload.adj) Object.assign(state.adj, payload.adj);
  if (payload.fx) Object.assign(state.fx, payload.fx);
  render();
}
export function connectWS() {
  const host = isController ? location.hostname : '127.0.0.1';
  ws = new WebSocket(`ws://${host}:8917/ws`);
  ws.addEventListener('message', (ev) => {
    if (ev.data === lastSentJSON) return; // ignore our own echo
    try { applyRemoteState(JSON.parse(ev.data)); } catch { /* malformed/partial frame -- drop it */ }
  });
  ws.addEventListener('close', () => { ws = null; setTimeout(connectWS, 1500); });
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
  if (!isController) ws.addEventListener('open', () => sendState(), { once: true });
}
