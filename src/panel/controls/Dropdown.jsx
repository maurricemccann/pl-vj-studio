import { useEffect, useRef, useState } from 'react';

// Design section 2: "custom-styled menu, not the raw browser <select>."
// options is a {label: value} map -- same convention RIBBON_MATERIALS and
// BLEND_MODES already use for Tweakpane's options binding, reused as-is.
export function Dropdown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const entries = Object.entries(options);
  const current = entries.find(([, v]) => v === value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('pointerdown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pl-dropdown-row" ref={ref}>
      <span className="pl-slider-label">{label}</span>
      <div className="pl-dropdown">
        <button type="button" className="pl-dropdown-trigger" onClick={() => setOpen((o) => !o)}>
          <span>{current ? current[0] : String(value)}</span>
          <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {open && (
          <div className="pl-dropdown-menu">
            {entries.map(([lbl, v]) => (
              <div
                key={lbl}
                className={'pl-dropdown-item' + (v === value ? ' selected' : '')}
                onClick={() => { onChange(v); setOpen(false); }}
              >
                {lbl}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
