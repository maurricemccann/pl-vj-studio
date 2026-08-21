import { state, render } from '../../core/store.js';
import { drawCurveGraph } from '../../core/interactions.js';
import { Slider } from '../controls/Slider.jsx';
import { ColorField } from '../controls/ColorField.jsx';

function setAdj(key, value) {
  state.adj[key] = value;
  render();
}

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase C: the
// Adjustments tab. Hue/saturation/brightness, shadows/mids/highs tint+
// amount, curve LUT enable+reset (the drag-to-shape canvas itself is the
// permanent, always-visible sidebar element below #react-root -- Phase A
// out-of-scope, untouched here), and the 2-stop gradient map.
export function AdjustmentsPanel({ search }) {
  const adj = state.adj;
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">Adjustments</div>

      {show('Hue') && <Slider label="Hue" value={adj.hue} min={-180} max={180} step={1} onChange={(v) => setAdj('hue', v)} />}
      {show('Saturation') && <Slider label="Saturation" value={adj.saturation} min={-100} max={100} step={1} onChange={(v) => setAdj('saturation', v)} />}
      {show('Brightness') && <Slider label="Brightness" value={adj.brightness} min={-100} max={100} step={1} onChange={(v) => setAdj('brightness', v)} />}

      {show('Color balance') && (
        <>
          <div className="pl-panel-section">Color Balance</div>
          <ColorField label="Shadows" value={adj.shadowsTint} onChange={(v) => setAdj('shadowsTint', v)} />
          <Slider label="Shadows amt" value={adj.shadowsAmt} min={0} max={100} step={1} onChange={(v) => setAdj('shadowsAmt', v)} />
          <ColorField label="Midtones" value={adj.midsTint} onChange={(v) => setAdj('midsTint', v)} />
          <Slider label="Midtones amt" value={adj.midsAmt} min={0} max={100} step={1} onChange={(v) => setAdj('midsAmt', v)} />
          <ColorField label="Highlights" value={adj.highsTint} onChange={(v) => setAdj('highsTint', v)} />
          <Slider label="Highlights amt" value={adj.highsAmt} min={0} max={100} step={1} onChange={(v) => setAdj('highsAmt', v)} />
        </>
      )}

      {show('Curves') && (
        <>
          <div className="pl-panel-section">Curves</div>
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Enable (drag the graph below)</span>
            <input type="checkbox" checked={!!adj.curveEnabled} onChange={(e) => setAdj('curveEnabled', e.target.checked)} />
          </label>
          <div className="pl-action-row">
            <button
              type="button"
              onClick={() => {
                adj.curvePoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
                drawCurveGraph();
                render();
              }}
            >
              Reset curve
            </button>
          </div>
        </>
      )}

      {show('Gradient map') && (
        <>
          <div className="pl-panel-section">Gradient Map</div>
          <label className="pl-checkbox-row">
            <span className="pl-slider-label">Enable</span>
            <input type="checkbox" checked={!!adj.gradientEnabled} onChange={(e) => setAdj('gradientEnabled', e.target.checked)} />
          </label>
          <ColorField label="Shadow color" value={adj.gradientStops[0]} onChange={(v) => { adj.gradientStops[0] = v; render(); }} />
          <ColorField label="Highlight color" value={adj.gradientStops[1]} onChange={(v) => { adj.gradientStops[1] = v; render(); }} />
        </>
      )}
    </div>
  );
}
