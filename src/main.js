// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: this file
// is now the phone/Tailscale controller entry specifically -- still the
// exact file src-tauri/src/server.rs embeds via include_str! and serves raw
// to a phone opening ?controller (or a bare Tailscale/LAN URL), unchanged in
// that role. The desktop app no longer loads this file at all: tauri.conf.json
// now points frontendDist at the Vite build of src/panel/main.jsx, which
// imports the same core/store.js + core/interactions.js this file does, so
// both surfaces read/drive one shared state model (Phase A's load-bearing
// constraint -- see the SPEC's "phone/Tailscale controller conflict" note).
//
// Vendored into src/ (not imported from node_modules) -- Tauri's asset
// server only serves files inside frontendDist ("../src"), so a path that
// escapes it 404s silently and the whole module throws on import.
import { Pane } from './vendor/tweakpane.js';
import {
  state, PIECES, RIBBON_MATERIALS, BLEND_MODES, NUMERIC_DEFAULTS, SKIP_KEYS,
  isController, loadPiece, render, setPrimaryRibbon, scheduleSync,
  shuffleSelected, snapshotPreset, morphTo, kfPlay, kfStop,
  startAudio, startCamera, connectWS, setPaneRefreshHook, setRemoteApplyHook,
  buildCurveLUT, lfoBase,
} from './core/store.js';
import { initInteractions, drawCurveGraph } from './core/interactions.js';

const pieceSelect = document.getElementById('piece-select');
const ribbonListEl = document.getElementById('ribbon-list');

if (isController) document.body.classList.add('controller-mode');

let pane = null;
let ribbonIndexObj = { value: 0 };

// ============================================================
// Ribbon list -- the group-selection UI (plain DOM, not Tweakpane). The
// phone/controller keeps this exact lightweight list (SPEC load-bearing
// premise 3); the desktop React entry replaces it with RibbonList.jsx.
// ============================================================
function renderRibbonList() {
  if (!state.active) return;
  ribbonListEl.innerHTML = '';
  state.active.ribbons.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'ribbon-row' + (i === state.selectedRibbon ? ' primary' : '') + (state.multiSelect.has(i) ? ' in-group' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.multiSelect.has(i);
    cb.title = 'Include in the batch-edit group';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) state.multiSelect.add(i);
      else if (state.multiSelect.size > 1) state.multiSelect.delete(i);
      else cb.checked = true;
      renderRibbonList();
      buildRibbonFolder();
    });
    const swatch = document.createElement('span');
    swatch.className = 'ribbon-swatch';
    swatch.style.background = r.ink;
    const label = document.createElement('span');
    label.className = 'ribbon-label';
    label.textContent = `Ribbon ${i + 1}`;
    row.append(cb, swatch, label);
    row.addEventListener('click', () => { setPrimaryRibbon(i); onSelectionChanged(); });
    ribbonListEl.appendChild(row);
  });
}
function onSelectionChanged() {
  if (pane) { ribbonIndexObj.value = state.selectedRibbon; pane.refresh(); }
  buildRibbonFolder();
  renderRibbonList();
}
document.getElementById('ribbon-select-all').addEventListener('click', () => {
  state.multiSelect = new Set(state.active.ribbons.map((_, i) => i));
  renderRibbonList();
  buildRibbonFolder();
});
document.getElementById('ribbon-select-one').addEventListener('click', () => {
  state.multiSelect = new Set([state.selectedRibbon]);
  renderRibbonList();
  buildRibbonFolder();
});

// ============================================================
// Panel (Tweakpane) -- the phone/controller's lightweight surface, unchanged.
// ============================================================
function buildPane() {
  if (pane) pane.dispose();
  pane = new Pane({ title: state.active.name, container: document.getElementById('panel') });

  pane.addBinding(state.active, 'ground', { label: 'Ground' }).on('change', () => { render(); scheduleSync(); });

  const ribbonNames = state.active.ribbons.map((_, i) => `Ribbon ${i + 1}`);
  ribbonIndexObj.value = state.selectedRibbon;
  pane.addBinding(ribbonIndexObj, 'value', {
    label: 'Editing', options: Object.fromEntries(ribbonNames.map((n, i) => [n, i])),
  }).on('change', (ev) => { setPrimaryRibbon(ev.value); onSelectionChanged(); });

  buildRibbonFolder();
  if (!isController) buildCurveFolder();
  if (!isController) buildAnimationFolder();
  if (!isController) buildModulationFolder();
  buildAdjustmentsFolder();
  buildEffectsFolder();

  const exportBtn = pane.addButton({ title: 'Copy tuned values as JSON' });
  exportBtn.on('click', () => {
    const json = JSON.stringify(state.active, null, 2);
    navigator.clipboard.writeText(json);
    exportBtn.title = 'Copied!';
    setTimeout(() => (exportBtn.title = 'Copy tuned values as JSON'), 1200);
  });
}

function bindMultiNumeric(folder, key, opts) {
  const r = state.active.ribbons[state.selectedRibbon];
  const proxy = { [key]: r[key] };
  let last = r[key];
  folder.addBinding(proxy, key, opts).on('change', (ev) => {
    const delta = ev.value - last;
    last = ev.value;
    state.multiSelect.forEach((idx) => {
      const rr = state.active.ribbons[idx];
      if (!rr || typeof rr[key] !== 'number') return;
      const nv = rr[key] + delta;
      rr[key] = opts.min !== undefined ? Math.max(opts.min, Math.min(opts.max, nv)) : nv;
    });
    render();
    scheduleSync();
  });
}
function bindMultiAbsolute(folder, key, opts, guard) {
  const r = state.active.ribbons[state.selectedRibbon];
  const proxy = { [key]: r[key] };
  folder.addBinding(proxy, key, opts).on('change', (ev) => {
    state.multiSelect.forEach((idx) => {
      const rr = state.active.ribbons[idx];
      if (!rr) return;
      if (guard && !guard(rr)) return;
      rr[key] = ev.value;
    });
    render();
    scheduleSync();
  });
}
function autoBindNumeric(folder, obj) {
  Object.keys(obj).forEach((key) => {
    if (SKIP_KEYS.has(key) || key.endsWith('Min') || key.endsWith('Max') || key.endsWith('Step')) return;
    if (typeof obj[key] !== 'number') return;
    const hasRange = obj[key + 'Min'] !== undefined && obj[key + 'Max'] !== undefined;
    const [defMin, defMax, defStep] = NUMERIC_DEFAULTS[key] || [0, 1, 0.01];
    const min = hasRange ? obj[key + 'Min'] : defMin;
    const max = hasRange ? obj[key + 'Max'] : defMax;
    const step = obj[key + 'Step'] !== undefined ? obj[key + 'Step'] : defStep;
    bindMultiNumeric(folder, key, { min, max, step });
  });
}

let ribbonFolder = null;
function buildRibbonFolder() {
  if (ribbonFolder) ribbonFolder.dispose();
  const r = state.active.ribbons[state.selectedRibbon];
  const n = state.multiSelect.size;
  ribbonFolder = pane.addFolder({ title: n > 1 ? `Ribbon params (${n} selected)` : `Ribbon ${state.selectedRibbon + 1} params` });
  bindMultiAbsolute(ribbonFolder, 'material', { label: 'Material', options: RIBBON_MATERIALS });
  autoBindNumeric(ribbonFolder, r);
  bindMultiAbsolute(ribbonFolder, 'ink', { view: 'color' });
  if (r.core !== undefined) bindMultiAbsolute(ribbonFolder, 'core', { view: 'color' }, (rr) => rr.core !== undefined);
  if (r.glow !== undefined) bindMultiAbsolute(ribbonFolder, 'glow', {}, (rr) => rr.glow !== undefined);
  bindMultiAbsolute(ribbonFolder, 'outlineColor', { view: 'color', label: 'Outline color' });
  bindMultiAbsolute(ribbonFolder, 'blend', { label: 'Blend mode', options: BLEND_MODES });
}

function buildCurveFolder() {
  const cf = pane.addFolder({ title: 'Curve editing', expanded: false });
  const r = state.active.ribbons[state.selectedRibbon];
  r.closed = !!r.closed;
  bindMultiAbsolute(cf, 'closed', { label: 'Closed loop' });
  const sketchBtn = cf.addButton({ title: state.sketchMode.active ? 'Stop sketching' : 'Sketch new ribbon' });
  sketchBtn.on('click', () => {
    state.sketchMode.active = !state.sketchMode.active;
    state.sketchMode.stroke = [];
    sketchBtn.title = state.sketchMode.active ? 'Stop sketching' : 'Sketch new ribbon';
  });
  cf.addBinding({ hint: 'H: toggle handles - K: align - T: tied/untied' }, 'hint', { readonly: true, label: '' });
}

function buildAnimationFolder() {
  const animFolder = pane.addFolder({ title: 'Animation', expanded: false });

  animFolder.addButton({ title: 'Shuffle selected group' }).on('click', shuffleSelected);

  const wanderFolder = animFolder.addFolder({ title: 'Ambient wander (all ribbons)' });
  wanderFolder.addBinding(state.wander, 'enabled');
  wanderFolder.addBinding(state.wander, 'amplitude', { min: 0, max: 0.08, step: 0.002 });
  wanderFolder.addBinding(state.wander, 'speed', { min: 0.2, max: 3, step: 0.1 });

  const morphState = { duration: 1200, ease: true };
  const presetFolder = animFolder.addFolder({ title: 'Preset A / B morph' });
  presetFolder.addButton({ title: 'Save current as A' }).on('click', () => { state.presetA = snapshotPreset(); });
  presetFolder.addButton({ title: 'Save current as B' }).on('click', () => { state.presetB = snapshotPreset(); });
  presetFolder.addBinding(morphState, 'duration', { min: 100, max: 6000, step: 100, label: 'Duration (ms)' });
  presetFolder.addBinding(morphState, 'ease', { label: 'Ease' });
  presetFolder.addButton({ title: 'Morph -> B' }).on('click', () => morphTo(state.presetB, morphState.duration, morphState.ease));
  presetFolder.addButton({ title: 'Morph -> A' }).on('click', () => morphTo(state.presetA, morphState.duration, morphState.ease));

  const kfFolder = animFolder.addFolder({ title: 'Keyframe (one parameter)' });
  kfFolder.addBinding(state.kf, 'param', { label: 'Parameter', options: { width: 'width', taper: 'taper', tremor: 'tremor', gap: 'gap' } });
  kfFolder.addBinding(state.kf, 'a', { label: 'Value A', min: 0, max: 0.3, step: 0.005 });
  kfFolder.addBinding(state.kf, 'b', { label: 'Value B', min: 0, max: 0.3, step: 0.005 });
  kfFolder.addBinding(state.kf, 'duration', { label: 'Duration (ms)', min: 200, max: 8000, step: 100 });
  kfFolder.addBinding(state.kf, 'interp', { label: 'Interpolation', options: { linear: 'linear', ease: 'ease' } });
  kfFolder.addBinding(state.kf, 'extend', { label: 'Extend', options: { hold: 'hold', loop: 'loop', mirror: 'mirror' } });
  const playBtn = kfFolder.addButton({ title: 'Play' });
  playBtn.on('click', () => {
    if (state.kf.playing) { kfStop(); playBtn.title = 'Play'; }
    else { kfPlay(); playBtn.title = 'Stop'; }
  });
}

function buildModulationFolder() {
  const mf = pane.addFolder({ title: 'Modulation', expanded: false });
  const paramOpts = { width: 'width', taper: 'taper', tremor: 'tremor', gap: 'gap' };

  const audioUI = { enabled: state.audioMod.enabled, param: state.audioMod.param, amount: state.audioMod.amount };
  mf.addButton({ title: 'Enable microphone' }).on('click', async (ev) => {
    try { await startAudio(); ev.target.title = 'Microphone live'; } catch { ev.target.title = 'Mic denied/unavailable'; }
  });
  mf.addBinding(audioUI, 'enabled', { label: 'Audio drives param' }).on('change', (ev) => {
    state.audioMod.enabled = ev.value;
    if (ev.value) state.multiSelect.forEach((idx) => { state.audioMod.base[idx + ':' + audioUI.param] = state.active.ribbons[idx][audioUI.param]; });
  });
  mf.addBinding(audioUI, 'param', { label: 'Audio target', options: paramOpts }).on('change', (ev) => {
    state.audioMod.param = ev.value;
    state.multiSelect.forEach((idx) => { state.audioMod.base[idx + ':' + ev.value] = state.active.ribbons[idx][ev.value]; });
  });
  mf.addBinding(audioUI, 'amount', { label: 'Audio amount', min: 0, max: 0.15, step: 0.005 }).on('change', (ev) => { state.audioMod.amount = ev.value; });

  const camUI = { enabled: state.camMod.enabled, param: state.camMod.param, amount: state.camMod.amount };
  mf.addButton({ title: 'Enable camera' }).on('click', async (ev) => {
    try { await startCamera(); ev.target.title = 'Camera live'; } catch { ev.target.title = 'Camera denied/unavailable'; }
  });
  mf.addBinding(camUI, 'enabled', { label: 'Camera drives param' }).on('change', (ev) => {
    state.camMod.enabled = ev.value;
    if (ev.value) state.multiSelect.forEach((idx) => { state.camMod.base[idx + ':' + camUI.param] = state.active.ribbons[idx][camUI.param]; });
  });
  mf.addBinding(camUI, 'param', { label: 'Camera target', options: paramOpts }).on('change', (ev) => {
    state.camMod.param = ev.value;
    state.multiSelect.forEach((idx) => { state.camMod.base[idx + ':' + ev.value] = state.active.ribbons[idx][ev.value]; });
  });
  mf.addBinding(camUI, 'amount', { label: 'Camera amount', min: 0, max: 0.05, step: 0.002 }).on('change', (ev) => { state.camMod.amount = ev.value; });

  const target2Opts = { '— none —': 'none', ...paramOpts };
  const captureLfoBase = (lfo) => {
    state.multiSelect.forEach((idx) => {
      lfoBase[idx + ':' + lfo.target] = state.active.ribbons[idx][lfo.target];
      if (lfo.target2 && lfo.target2 !== 'none') lfoBase[idx + ':' + lfo.target2] = state.active.ribbons[idx][lfo.target2];
    });
  };
  state.lfos.forEach((lfo, idx) => {
    const lf = mf.addFolder({ title: `LFO ${idx + 1}`, expanded: false });
    lf.addBinding(lfo, 'enabled').on('change', () => captureLfoBase(lfo));
    lf.addBinding(lfo, 'waveform', { options: { sine: 'sine', square: 'square', triangle: 'triangle' } });
    lf.addBinding(lfo, 'period', { label: 'Period (ms)', min: 200, max: 8000, step: 100 });
    lf.addBinding(lfo, 'phase', { min: 0, max: 1, step: 0.01 });
    lf.addBinding(lfo, 'hold', { label: 'Hold (freeze)' });
    lf.addBinding(lfo, 'amount', { min: 0, max: 0.08, step: 0.002 });
    lf.addBinding(lfo, 'target', { options: paramOpts }).on('change', () => captureLfoBase(lfo));
    lf.addBinding(lfo, 'target2', { label: 'Also drives', options: target2Opts }).on('change', () => captureLfoBase(lfo));
    lf.addBinding(lfo, 'amount2', { label: 'Amount 2', min: 0, max: 0.08, step: 0.002 });
  });
}

function buildAdjustmentsFolder() {
  const af = pane.addFolder({ title: 'Adjustments', expanded: false });
  const adj = state.adj;
  af.addBinding(adj, 'hue', { min: -180, max: 180, step: 1 }).on('change', () => { render(); scheduleSync(); });
  af.addBinding(adj, 'saturation', { min: -100, max: 100, step: 1 }).on('change', () => { render(); scheduleSync(); });
  af.addBinding(adj, 'brightness', { min: -100, max: 100, step: 1 }).on('change', () => { render(); scheduleSync(); });

  const cb = af.addFolder({ title: 'Color Balance', expanded: false });
  cb.addBinding(adj, 'shadowsTint', { view: 'color', label: 'Shadows' }).on('change', () => { render(); scheduleSync(); });
  cb.addBinding(adj, 'shadowsAmt', { min: 0, max: 100, step: 1, label: 'Shadows amt' }).on('change', () => { render(); scheduleSync(); });
  cb.addBinding(adj, 'midsTint', { view: 'color', label: 'Midtones' }).on('change', () => { render(); scheduleSync(); });
  cb.addBinding(adj, 'midsAmt', { min: 0, max: 100, step: 1, label: 'Midtones amt' }).on('change', () => { render(); scheduleSync(); });
  cb.addBinding(adj, 'highsTint', { view: 'color', label: 'Highlights' }).on('change', () => { render(); scheduleSync(); });
  cb.addBinding(adj, 'highsAmt', { min: 0, max: 100, step: 1, label: 'Highlights amt' }).on('change', () => { render(); scheduleSync(); });

  const cv = af.addFolder({ title: 'Curves', expanded: false });
  cv.addBinding(adj, 'curveEnabled', { label: 'Enable (drag the graph below)' }).on('change', () => { render(); scheduleSync(); });
  cv.addButton({ title: 'Reset curve' }).on('click', () => {
    adj.curvePoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    drawCurveGraph(); render();
  });

  const gm = af.addFolder({ title: 'Gradient Map', expanded: false });
  gm.addBinding(adj, 'gradientEnabled', { label: 'Enable' }).on('change', () => { render(); scheduleSync(); });
  gm.addBinding(adj.gradientStops, '0', { view: 'color', label: 'Shadow color' }).on('change', () => { render(); scheduleSync(); });
  gm.addBinding(adj.gradientStops, '1', { view: 'color', label: 'Highlight color' }).on('change', () => { render(); scheduleSync(); });
}

function buildEffectsFolder() {
  const ef = pane.addFolder({ title: 'Effects', expanded: false });
  const fx = state.fx;
  ef.addBinding(fx, 'opacity', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'noise', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'sharpen', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'bloom', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'glitch', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'halftone', { min: 0, max: 1, step: 0.01 }).on('change', () => { render(); scheduleSync(); });
  ef.addBinding(fx, 'chromaticAberration', { min: 0, max: 1, step: 0.01, label: 'Chromatic aberration' }).on('change', () => { render(); scheduleSync(); });
}

// ============================================================
// Wiring: pane refresh on every render() tick that used to trigger it,
// rebuild-on-remote-state exactly as before -- see core/store.js's
// setPaneRefreshHook/setRemoteApplyHook doc comment.
// ============================================================
setPaneRefreshHook(() => { if (pane) pane.refresh(); });
setRemoteApplyHook(() => {
  if (pane) buildPane();
  renderRibbonList();
  drawCurveGraph();
});

initInteractions(buildCurveLUT);
connectWS();

if (!isController && window.__TAURI__) {
  window.__TAURI__.core.invoke('controller_url').then((url) => {
    const el = document.getElementById('controller-url');
    if (el) el.textContent = `Phone: ${url}?controller`;
  }).catch(() => {});
}

// ---- Piece switcher ----
PIECES.forEach((p) => {
  const opt = document.createElement('option');
  opt.value = p.id; opt.textContent = p.name;
  pieceSelect.appendChild(opt);
});
pieceSelect.addEventListener('change', () => {
  loadPiece(pieceSelect.value);
  buildPane();
  renderRibbonList();
});

loadPiece(PIECES[0].id);
buildPane();
renderRibbonList();
drawCurveGraph();
