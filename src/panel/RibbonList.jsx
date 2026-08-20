import { state, setPrimaryRibbon, bump } from '../core/store.js';

// Design section 1: "persistent Ribbon List (selection scope, applies across
// every tab, same role as Blender's Outliner)" -- the React desktop
// replacement for main.js's old plain-DOM #ribbon-list. Same behavior: click
// a row to make it the primary edit target, check its box to fold it into
// the multi-select batch-edit group.
export function RibbonList() {
  const ribbons = state.active ? state.active.ribbons : [];

  function toggle(i, checked) {
    if (checked) state.multiSelect.add(i);
    else if (state.multiSelect.size > 1) state.multiSelect.delete(i);
    // setPrimaryRibbon already mutates `state` + calls core render()/bump()
    // for selection changes; a multiSelect checkbox toggle alone doesn't
    // move the canvas, but still needs a bump so the list + Ribbon tab
    // reflect the new group immediately.
    bump();
  }

  return (
    <div className="pl-ribbon-list-wrap">
      <div className="pl-ribbon-list">
        {ribbons.map((r, i) => (
          <div
            key={i}
            className={'pl-ribbon-row' + (i === state.selectedRibbon ? ' primary' : '') + (state.multiSelect.has(i) ? ' in-group' : '')}
            onClick={() => setPrimaryRibbon(i)}
          >
            <input
              type="checkbox"
              checked={state.multiSelect.has(i)}
              title="Include in the batch-edit group"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => toggle(i, e.target.checked)}
            />
            <span className="pl-ribbon-swatch" style={{ background: r.ink }} />
            <span className="pl-ribbon-label">Ribbon {i + 1}</span>
          </div>
        ))}
      </div>
      <div className="pl-ribbon-list-actions">
        <button type="button" onClick={() => { state.multiSelect = new Set(ribbons.map((_, i) => i)); bump(); }}>All ribbons</button>
        <button type="button" onClick={() => { state.multiSelect = new Set([state.selectedRibbon]); bump(); }}>Just this one</button>
      </div>
    </div>
  );
}
