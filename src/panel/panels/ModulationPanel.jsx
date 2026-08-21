import { useState } from 'react';
import { state, startAudio, startCamera, lfoBase, render } from '../../core/store.js';
import { Slider } from '../controls/Slider.jsx';
import { Dropdown } from '../controls/Dropdown.jsx';

const PARAM_OPTS = { Width: 'width', Taper: 'taper', Tremor: 'tremor', Gap: 'gap' };
const TARGET2_OPTS = { '— none —': 'none', ...PARAM_OPTS };
const WAVEFORM_OPTS = { Sine: 'sine', Square: 'square', Triangle: 'triangle' };

// Same base-capture contract main.js's captureLfoBase used: snapshot each
// selected ribbon's current value for an LFO's target(s) the moment it's
// enabled or retargeted, so modulation offsets from that base instead of
// wherever the value happened to be mid-cycle.
function captureLfoBase(lfo) {
  state.multiSelect.forEach((idx) => {
    lfoBase[idx + ':' + lfo.target] = state.active.ribbons[idx][lfo.target];
    if (lfo.target2 && lfo.target2 !== 'none') lfoBase[idx + ':' + lfo.target2] = state.active.ribbons[idx][lfo.target2];
  });
}
function captureModBase(mod, param) {
  state.multiSelect.forEach((idx) => { mod.base[idx + ':' + param] = state.active.ribbons[idx][param]; });
}

function MicButton() {
  const [label, setLabel] = useState('Enable microphone');
  return (
    <div className="pl-action-row">
      <button
        type="button"
        onClick={async () => {
          try { await startAudio(); setLabel('Microphone live'); }
          catch { setLabel('Mic denied/unavailable'); }
        }}
      >
        {label}
      </button>
    </div>
  );
}
function CameraButton() {
  const [label, setLabel] = useState('Enable camera');
  return (
    <div className="pl-action-row">
      <button
        type="button"
        onClick={async () => {
          try { await startCamera(); setLabel('Camera live'); }
          catch { setLabel('Camera denied/unavailable'); }
        }}
      >
        {label}
      </button>
    </div>
  );
}

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase C: the
// Modulation tab. Audio-reactive + camera-reactive (each a start button,
// an enable toggle, a param target, and an amount slider) plus both LFOs
// with the Phase 3 target2/amount2 two-parameter drive.
export function ModulationPanel({ search }) {
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">Modulation</div>

      {show('Audio') && (
        <>
          <div className="pl-panel-section">Audio-reactive</div>
          <MicButton />
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Audio drives param</span>
            <input
              type="checkbox"
              checked={!!state.audioMod.enabled}
              onChange={(e) => {
                state.audioMod.enabled = e.target.checked;
                if (e.target.checked) captureModBase(state.audioMod, state.audioMod.param);
                render();
              }}
            />
          </label>
          <Dropdown
            label="Audio target"
            value={state.audioMod.param}
            options={PARAM_OPTS}
            onChange={(v) => { state.audioMod.param = v; captureModBase(state.audioMod, v); render(); }}
          />
          <Slider label="Audio amount" value={state.audioMod.amount} min={0} max={0.15} step={0.005} onChange={(v) => { state.audioMod.amount = v; render(); }} />
        </>
      )}

      {show('Camera') && (
        <>
          <div className="pl-panel-section">Camera-reactive</div>
          <CameraButton />
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Camera drives param</span>
            <input
              type="checkbox"
              checked={!!state.camMod.enabled}
              onChange={(e) => {
                state.camMod.enabled = e.target.checked;
                if (e.target.checked) captureModBase(state.camMod, state.camMod.param);
                render();
              }}
            />
          </label>
          <Dropdown
            label="Camera target"
            value={state.camMod.param}
            options={PARAM_OPTS}
            onChange={(v) => { state.camMod.param = v; captureModBase(state.camMod, v); render(); }}
          />
          <Slider label="Camera amount" value={state.camMod.amount} min={0} max={0.05} step={0.002} onChange={(v) => { state.camMod.amount = v; render(); }} />
        </>
      )}

      {state.lfos.map((lfo, i) => (
        show(`LFO ${i + 1}`) && (
          <div key={i}>
            <div className="pl-panel-section">LFO {i + 1}</div>
            <label className="pl-checkbox-row">
              <span className="pl-slider-label">Enabled</span>
              <input
                type="checkbox"
                checked={!!lfo.enabled}
                onChange={(e) => { lfo.enabled = e.target.checked; captureLfoBase(lfo); render(); }}
              />
            </label>
            <Dropdown label="Waveform" value={lfo.waveform} options={WAVEFORM_OPTS} onChange={(v) => { lfo.waveform = v; render(); }} />
            <Slider label="Period (ms)" value={lfo.period} min={200} max={8000} step={100} onChange={(v) => { lfo.period = v; render(); }} />
            <Slider label="Phase" value={lfo.phase} min={0} max={1} step={0.01} onChange={(v) => { lfo.phase = v; render(); }} />
            <label className="pl-checkbox-row">
              <span className="pl-slider-label">Hold (freeze)</span>
              <input type="checkbox" checked={!!lfo.hold} onChange={(e) => { lfo.hold = e.target.checked; render(); }} />
            </label>
            <Slider label="Amount" value={lfo.amount} min={0} max={0.08} step={0.002} onChange={(v) => { lfo.amount = v; render(); }} />
            <Dropdown label="Target" value={lfo.target} options={PARAM_OPTS} onChange={(v) => { lfo.target = v; captureLfoBase(lfo); render(); }} />
            <Dropdown label="Also drives" value={lfo.target2} options={TARGET2_OPTS} onChange={(v) => { lfo.target2 = v; captureLfoBase(lfo); render(); }} />
            <Slider label="Amount 2" value={lfo.amount2} min={0} max={0.08} step={0.002} onChange={(v) => { lfo.amount2 = v; render(); }} />
          </div>
        )
      ))}
    </div>
  );
}
