import { state, render } from '../../core/store.js';
import { Slider } from '../controls/Slider.jsx';

function setFx(key, value) {
  state.fx[key] = value;
  render();
}

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase C: the
// Effects tab. All 7 post-process sliders, still dispatching through
// Phase 1's WebGL compositor (postfx-gl.js) unchanged -- this tab only
// moves the UI, same as every other panel in this redesign.
export function EffectsPanel({ search }) {
  const fx = state.fx;
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">Effects</div>
      {show('Opacity') && <Slider label="Opacity" value={fx.opacity} min={0} max={1} step={0.01} onChange={(v) => setFx('opacity', v)} />}
      {show('Noise') && <Slider label="Noise" value={fx.noise} min={0} max={1} step={0.01} onChange={(v) => setFx('noise', v)} />}
      {show('Sharpen') && <Slider label="Sharpen" value={fx.sharpen} min={0} max={1} step={0.01} onChange={(v) => setFx('sharpen', v)} />}
      {show('Bloom') && <Slider label="Bloom" value={fx.bloom} min={0} max={1} step={0.01} onChange={(v) => setFx('bloom', v)} />}
      {show('Glitch') && <Slider label="Glitch" value={fx.glitch} min={0} max={1} step={0.01} onChange={(v) => setFx('glitch', v)} />}
      {show('Halftone') && <Slider label="Halftone" value={fx.halftone} min={0} max={1} step={0.01} onChange={(v) => setFx('halftone', v)} />}
      {show('Chromatic aberration') && <Slider label="Chromatic aberration" value={fx.chromaticAberration} min={0} max={1} step={0.01} onChange={(v) => setFx('chromaticAberration', v)} />}
    </div>
  );
}
