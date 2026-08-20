import {
  state, RIBBON_MATERIALS, BLEND_MODES, setRibbonAbsolute, setRibbonNumeric,
  autoNumericKeys, numericFieldRange,
} from '../../core/store.js';
import { Slider } from '../controls/Slider.jsx';
import { ColorField } from '../controls/ColorField.jsx';
import { Dropdown } from '../controls/Dropdown.jsx';

function fieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: the Ribbon
// tab, fully real. Every control from Tweakpane's old "Ribbon params" folder
// (material, width, taper, tremor, gap, outlineWidth, ink, outlineColor,
// blend, core, glow) is here, using the new Slider/ColorField/Dropdown
// primitives -- same fixed non-numeric order + the same autoNumericKeys
// auto-discovery convenience the phone's Tweakpane pane still uses (AT5:
// any numeric ribbon field not explicitly named -- materialAmount,
// materialSpeed -- still gets a slider for free).
export function RibbonPanel({ search }) {
  const r = state.active.ribbons[state.selectedRibbon];
  const n = state.multiSelect.size;
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);
  const numericKeys = autoNumericKeys(r);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">
        {n > 1 ? `Ribbon params (${n} selected)` : `Ribbon ${state.selectedRibbon + 1} params`}
      </div>

      {show('Material') && (
        <Dropdown
          label="Material"
          value={r.material}
          options={RIBBON_MATERIALS}
          onChange={(v) => setRibbonAbsolute('material', v)}
        />
      )}

      {numericKeys.map((key) => {
        const label = fieldLabel(key);
        if (!show(label)) return null;
        const { min, max, step } = numericFieldRange(r, key);
        return (
          <Slider
            key={key}
            label={label}
            value={r[key]}
            min={min}
            max={max}
            step={step}
            onChange={(v) => setRibbonNumeric(key, v, { min, max })}
          />
        );
      })}

      {show('Ink') && <ColorField label="Ink" value={r.ink} onChange={(v) => setRibbonAbsolute('ink', v)} />}

      {r.core !== undefined && show('Core') && (
        <ColorField label="Core" value={r.core} onChange={(v) => setRibbonAbsolute('core', v, (rr) => rr.core !== undefined)} />
      )}

      {r.glow !== undefined && show('Glow') && (
        <label className="pl-checkbox-row">
          <span className="pl-slider-label">Glow</span>
          <input
            type="checkbox"
            checked={!!r.glow}
            onChange={(e) => setRibbonAbsolute('glow', e.target.checked, (rr) => rr.glow !== undefined)}
          />
        </label>
      )}

      {show('Outline color') && (
        <ColorField label="Outline color" value={r.outlineColor} onChange={(v) => setRibbonAbsolute('outlineColor', v)} />
      )}

      {show('Blend mode') && (
        <Dropdown label="Blend mode" value={r.blend} options={BLEND_MODES} onChange={(v) => setRibbonAbsolute('blend', v)} />
      )}
    </div>
  );
}
