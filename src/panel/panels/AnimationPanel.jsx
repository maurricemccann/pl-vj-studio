import { useState } from 'react';
import {
  state, snapshotPreset, morphTo, shuffleSelected, kfPlay, kfStop, render,
} from '../../core/store.js';
import { Slider } from '../controls/Slider.jsx';
import { Dropdown } from '../controls/Dropdown.jsx';

const KF_PARAMS = { Width: 'width', Taper: 'taper', Tremor: 'tremor', Gap: 'gap' };
const KF_INTERP = { Linear: 'linear', Ease: 'ease' };
const KF_EXTEND = { Hold: 'hold', Loop: 'loop', Mirror: 'mirror' };

function setWander(key, value) {
  state.wander[key] = value;
  render();
}
function setKf(key, value) {
  state.kf[key] = value;
  render();
}

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase B: the
// Animation tab, fully real. Founder ruling 2026-08-20: full parity with
// the old Tweakpane "Animation" folder, not just the ratified acceptance
// test's wander+keyframe pair — Shuffle and Preset A/B morph included too,
// same as the folder they're replacing. Preset morph's duration/ease were
// always local UI-only state in the old panel (never part of shared core),
// kept that way here.
export function AnimationPanel({ search }) {
  const [morphDuration, setMorphDuration] = useState(1200);
  const [morphEase, setMorphEase] = useState(true);
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">Animation</div>

      {show('Shuffle selected group') && (
        <div className="pl-action-row">
          <button type="button" onClick={shuffleSelected}>Shuffle selected group</button>
        </div>
      )}

      {show('Ambient wander') && (
        <>
          <div className="pl-panel-section">Ambient wander (all ribbons)</div>
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Enabled</span>
            <input
              type="checkbox"
              checked={!!state.wander.enabled}
              onChange={(e) => setWander('enabled', e.target.checked)}
            />
          </label>
          <Slider label="Amplitude" value={state.wander.amplitude} min={0} max={0.08} step={0.002} onChange={(v) => setWander('amplitude', v)} />
          <Slider label="Speed" value={state.wander.speed} min={0.2} max={3} step={0.1} onChange={(v) => setWander('speed', v)} />
        </>
      )}

      {show('Preset A/B morph') && (
        <>
          <div className="pl-panel-section">Preset A / B morph</div>
          <div className="pl-action-row">
            <button type="button" onClick={() => { state.presetA = snapshotPreset(); render(); }}>Save current as A</button>
            <button type="button" onClick={() => { state.presetB = snapshotPreset(); render(); }}>Save current as B</button>
          </div>
          <Slider label="Duration (ms)" value={morphDuration} min={100} max={6000} step={100} onChange={setMorphDuration} />
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Ease</span>
            <input type="checkbox" checked={morphEase} onChange={(e) => setMorphEase(e.target.checked)} />
          </label>
          <div className="pl-action-row">
            <button type="button" disabled={!state.presetB} onClick={() => morphTo(state.presetB, morphDuration, morphEase)}>Morph → B</button>
            <button type="button" disabled={!state.presetA} onClick={() => morphTo(state.presetA, morphDuration, morphEase)}>Morph → A</button>
          </div>
        </>
      )}

      {show('Keyframe') && (
        <>
          <div className="pl-panel-section">Keyframe (one parameter)</div>
          <Dropdown label="Parameter" value={state.kf.param} options={KF_PARAMS} onChange={(v) => setKf('param', v)} />
          <Slider label="Value A" value={state.kf.a} min={0} max={0.3} step={0.005} onChange={(v) => setKf('a', v)} />
          <Slider label="Value B" value={state.kf.b} min={0} max={0.3} step={0.005} onChange={(v) => setKf('b', v)} />
          <Slider label="Duration (ms)" value={state.kf.duration} min={200} max={8000} step={100} onChange={(v) => setKf('duration', v)} />
          <Dropdown label="Interpolation" value={state.kf.interp} options={KF_INTERP} onChange={(v) => setKf('interp', v)} />
          <Dropdown label="Extend" value={state.kf.extend} options={KF_EXTEND} onChange={(v) => setKf('extend', v)} />
          <div className="pl-action-row">
            <button
              type="button"
              onClick={() => { if (state.kf.playing) kfStop(); else kfPlay(); render(); }}
            >
              {state.kf.playing ? 'Stop' : 'Play'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
