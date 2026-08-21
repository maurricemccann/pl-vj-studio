import { state, setRibbonAbsolute, render } from '../../core/store.js';

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase B: the Curve
// tab. The actual curve-graph canvas (drag-to-shape) is a permanent,
// always-visible sidebar element below #react-root (Phase A out-of-scope --
// see index.html's own comment) -- untouched, not re-rendered here. This
// tab is only the closed-loop toggle, sketch-mode button, and the keyboard
// hint text the old Tweakpane folder carried.
export function CurvePanel({ search }) {
  const r = state.active.ribbons[state.selectedRibbon];
  const q = search.trim().toLowerCase();
  const show = (label) => !q || label.toLowerCase().includes(q);

  return (
    <div className="pl-panel">
      <div className="pl-panel-title">Curve editing</div>

      {show('Closed loop') && (
        <label className="pl-checkbox-row">
          <span className="pl-slider-label">Closed loop</span>
          <input
            type="checkbox"
            checked={!!r.closed}
            onChange={(e) => setRibbonAbsolute('closed', e.target.checked)}
          />
        </label>
      )}

      {show('Sketch new ribbon') && (
        <div className="pl-action-row">
          <button
            type="button"
            onClick={() => {
              state.sketchMode.active = !state.sketchMode.active;
              state.sketchMode.stroke = [];
              render();
            }}
          >
            {state.sketchMode.active ? 'Stop sketching' : 'Sketch new ribbon'}
          </button>
        </div>
      )}

      <p className="pl-hint-text">H: toggle handles &middot; K: align &middot; T: tied/untied</p>
    </div>
  );
}
