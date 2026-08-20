// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A/B out-of-
// scope: Curve/Modulation/Adjustments/Effects tabs get their real content in
// a later phase. Placeholder only, desktop-side -- the phone/controller's
// Tweakpane folders for these are untouched and still fully functional.
// Animation shipped Phase B, no longer routed here (see App.jsx's PANELS map).
const LABELS = {
  curve: 'Curve',
  modulation: 'Modulation',
  adjustments: 'Adjustments',
  effects: 'Effects',
};

export function Placeholder({ tab }) {
  return (
    <div className="pl-panel pl-placeholder">
      <div className="pl-panel-title">{LABELS[tab] || tab}</div>
      <p>Coming in a later phase of the settings-panel redesign.</p>
      <p className="pl-placeholder-note">These controls still work from the phone controller in the meantime.</p>
    </div>
  );
}
