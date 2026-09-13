// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase C AT4
// resolution (S241·b6e2 founder ruling): the phone/Tailscale controller's
// own lightweight React entry, reading the SAME shared-core live state the
// desktop panel does -- no logic changes to core/store.js, only a new UI
// surface. This is what src/main.js (Tweakpane) used to be; that file and
// src/vendor/tweakpane.js are deleted in this same commit (delete-on-
// replace, house rule).
//
// Plain JS, no JSX, no bundler: like core/store.js, this file is
// include_str!'d raw by src-tauri/src/server.rs and served unbundled to
// whatever browser opens the controller URL, so it can't go through Vite's
// JSX transform. React/ReactDOM are loaded beforehand as plain (non-module)
// <script> tags from src/vendor/react.js + react-dom.js (production UMD
// builds -- both already-declared package.json dependencies, just vendored
// for the no-bundler path the same way tweakpane.js was), so `window.React`/
// `window.ReactDOM` exist as globals by the time this module runs.
//
// Parity bar (founder ruling): the CURRENT phone panel's real surface --
// Ribbon params / Ground / Adjustments / Effects. Animation + Modulation
// stay desktop-only (standing v1 ruling: those are live per-device timers).
// Not the desktop's fancy drag-precision Slider/ColorField/Dropdown --
// native <input type=range/color> and <select>, same "lightweight" look
// the phone always had, reusing the SAME #ribbon-list/#panel DOM ids (and
// their existing styles.css rules) index.html already provided for Tweakpane.
import {
  state, PIECES, RIBBON_MATERIALS, BLEND_MODES,
  isController, loadPiece, render, setPrimaryRibbon, scheduleSync, subscribe, getVersion, bump,
  setRibbonAbsolute, setRibbonNumeric, autoNumericKeys, numericFieldRange,
  connectWS, buildCurveLUT,
} from '../core/store.js';
import { initInteractions, drawCurveGraph } from '../core/interactions.js';

const h = React.createElement;
const pieceSelect = document.getElementById('piece-select');

if (isController) document.body.classList.add('controller-mode');

function fieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// ---- Native controls (no drag-precision physics -- lightweight, same as
// the old Tweakpane sliders/pickers this replaces) ----
function NumberRow({ label, value, min, max, step, onChange }) {
  return h('div', { className: 'ctl-row' },
    h('label', null, label),
    h('input', {
      type: 'range', min, max, step, value,
      onChange: (e) => onChange(parseFloat(e.target.value)),
    }),
    h('span', { className: 'ctl-value' }, typeof value === 'number' ? value.toFixed(3) : value),
  );
}
function ColorRow({ label, value, onChange }) {
  return h('div', { className: 'ctl-row' },
    h('label', null, label),
    h('input', { type: 'color', value, onChange: (e) => onChange(e.target.value) }),
  );
}
function SelectRow({ label, value, options, onChange }) {
  return h('div', { className: 'ctl-row' },
    h('label', null, label),
    h('select', { value, onChange: (e) => onChange(e.target.value) },
      Object.entries(options).map(([lbl, v]) => h('option', { key: lbl, value: v }, lbl))),
  );
}
function CheckRow({ label, checked, onChange }) {
  return h('div', { className: 'ctl-row' },
    h('label', null, label),
    h('input', { type: 'checkbox', checked: !!checked, onChange: (e) => onChange(e.target.checked) }),
  );
}
function Folder({ title, children }) {
  return h('div', { className: 'module ctl-folder' }, h('div', { className: 'ctl-folder-title' }, title), children);
}

// ---- Ribbon params (parity with RibbonPanel.jsx: fixed fields + AT5
// auto-discovery for any other numeric ribbon field) ----
function RibbonFolder() {
  const r = state.active.ribbons[state.selectedRibbon];
  const n = state.multiSelect.size;
  const numericKeys = autoNumericKeys(r);
  return h(Folder, { title: n > 1 ? `Ribbon params (${n} selected)` : `Ribbon ${state.selectedRibbon + 1} params` },
    h(SelectRow, { label: 'Material', value: r.material, options: RIBBON_MATERIALS, onChange: (v) => setRibbonAbsolute('material', v) }),
    numericKeys.map((key) => {
      const { min, max, step } = numericFieldRange(r, key);
      return h(NumberRow, {
        key, label: fieldLabel(key), value: r[key], min, max, step,
        onChange: (v) => setRibbonNumeric(key, v, { min, max }),
      });
    }),
    h(ColorRow, { label: 'Ink', value: r.ink, onChange: (v) => setRibbonAbsolute('ink', v) }),
    r.core !== undefined && h(ColorRow, { key: 'core', label: 'Core', value: r.core, onChange: (v) => setRibbonAbsolute('core', v, (rr) => rr.core !== undefined) }),
    r.glow !== undefined && h(CheckRow, { key: 'glow', label: 'Glow', checked: r.glow, onChange: (v) => setRibbonAbsolute('glow', v, (rr) => rr.glow !== undefined) }),
    h(ColorRow, { label: 'Outline color', value: r.outlineColor, onChange: (v) => setRibbonAbsolute('outlineColor', v) }),
    h(SelectRow, { label: 'Blend mode', value: r.blend, options: BLEND_MODES, onChange: (v) => setRibbonAbsolute('blend', v) }),
  );
}

function setAdj(key, value) { state.adj[key] = value; render(); scheduleSync(); }
function AdjustmentsFolder() {
  const adj = state.adj;
  return h(Folder, { title: 'Adjustments' },
    h(NumberRow, { label: 'Hue', value: adj.hue, min: -180, max: 180, step: 1, onChange: (v) => setAdj('hue', v) }),
    h(NumberRow, { label: 'Saturation', value: adj.saturation, min: -100, max: 100, step: 1, onChange: (v) => setAdj('saturation', v) }),
    h(NumberRow, { label: 'Brightness', value: adj.brightness, min: -100, max: 100, step: 1, onChange: (v) => setAdj('brightness', v) }),
    h(ColorRow, { label: 'Shadows', value: adj.shadowsTint, onChange: (v) => setAdj('shadowsTint', v) }),
    h(NumberRow, { label: 'Shadows amt', value: adj.shadowsAmt, min: 0, max: 100, step: 1, onChange: (v) => setAdj('shadowsAmt', v) }),
    h(ColorRow, { label: 'Midtones', value: adj.midsTint, onChange: (v) => setAdj('midsTint', v) }),
    h(NumberRow, { label: 'Midtones amt', value: adj.midsAmt, min: 0, max: 100, step: 1, onChange: (v) => setAdj('midsAmt', v) }),
    h(ColorRow, { label: 'Highlights', value: adj.highsTint, onChange: (v) => setAdj('highsTint', v) }),
    h(NumberRow, { label: 'Highlights amt', value: adj.highsAmt, min: 0, max: 100, step: 1, onChange: (v) => setAdj('highsAmt', v) }),
    h(CheckRow, { label: 'Curve LUT enabled', checked: adj.curveEnabled, onChange: (v) => setAdj('curveEnabled', v) }),
    h('div', { className: 'ctl-action-row' },
      h('button', {
        type: 'button',
        onClick: () => { adj.curvePoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; drawCurveGraph(); render(); },
      }, 'Reset curve')),
    h(CheckRow, { label: 'Gradient map', checked: adj.gradientEnabled, onChange: (v) => setAdj('gradientEnabled', v) }),
    h(ColorRow, { label: 'Shadow color', value: adj.gradientStops[0], onChange: (v) => { adj.gradientStops[0] = v; render(); scheduleSync(); } }),
    h(ColorRow, { label: 'Highlight color', value: adj.gradientStops[1], onChange: (v) => { adj.gradientStops[1] = v; render(); scheduleSync(); } }),
  );
}

function setFx(key, value) { state.fx[key] = value; render(); scheduleSync(); }
function EffectsFolder() {
  const fx = state.fx;
  const fields = ['opacity', 'noise', 'sharpen', 'bloom', 'glitch', 'halftone', 'chromaticAberration'];
  return h(Folder, { title: 'Effects' },
    fields.map((key) => h(NumberRow, {
      key, label: fieldLabel(key), value: fx[key], min: 0, max: 1, step: 0.01, onChange: (v) => setFx(key, v),
    })));
}

// ---- Ribbon list (Blender-outliner role, same DOM shape + CSS classes
// index.html/styles.css already defined for this) ----
function RibbonList() {
  React.useSyncExternalStore(subscribe, getVersion);
  const ribbons = state.active ? state.active.ribbons : [];
  function toggle(i, checked) {
    if (checked) state.multiSelect.add(i);
    else if (state.multiSelect.size > 1) state.multiSelect.delete(i);
    bump();
  }
  return h(React.Fragment, null,
    ribbons.map((r, i) => h('div', {
      key: i,
      className: 'ribbon-row' + (i === state.selectedRibbon ? ' primary' : '') + (state.multiSelect.has(i) ? ' in-group' : ''),
      onClick: () => setPrimaryRibbon(i),
    },
      h('input', {
        type: 'checkbox', checked: state.multiSelect.has(i), title: 'Include in the batch-edit group',
        onClick: (e) => e.stopPropagation(),
        onChange: (e) => toggle(i, e.target.checked),
      }),
      h('span', { className: 'ribbon-swatch', style: { background: r.ink } }),
      h('span', { className: 'ribbon-label' }, `Ribbon ${i + 1}`),
    )));
}

function App() {
  React.useSyncExternalStore(subscribe, getVersion);
  if (!state.active) return null; // loadPiece() hasn't run yet (first paint)
  return h(React.Fragment, null,
    h(CheckRow, { label: 'Ground', checked: state.active.ground, onChange: (v) => { state.active.ground = v; render(); scheduleSync(); } }),
    h(RibbonFolder),
    h(AdjustmentsFolder),
    h(EffectsFolder),
  );
}

// Two roots, each independently subscribed via useSyncExternalStore --
// mounted once; React re-renders each on every core state bump() from then on.
ReactDOM.createRoot(document.getElementById('ribbon-list')).render(h(RibbonList));
ReactDOM.createRoot(document.getElementById('panel')).render(h(App));

document.getElementById('ribbon-select-all').addEventListener('click', () => {
  state.multiSelect = new Set(state.active.ribbons.map((_, i) => i));
  bump();
});
document.getElementById('ribbon-select-one').addEventListener('click', () => {
  state.multiSelect = new Set([state.selectedRibbon]);
  bump();
});

initInteractions(buildCurveLUT);
connectWS();

// ---- Piece switcher ----
PIECES.forEach((p) => {
  const opt = document.createElement('option');
  opt.value = p.id; opt.textContent = p.name;
  pieceSelect.appendChild(opt);
});
pieceSelect.addEventListener('change', () => loadPiece(pieceSelect.value));

loadPiece(PIECES[0].id);
drawCurveGraph();
