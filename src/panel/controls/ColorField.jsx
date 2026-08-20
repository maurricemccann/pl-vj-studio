import { useEffect, useState } from 'react';

// Design section 2: keep the native color picker as the trigger (accessible,
// zero extra code) restyled to match the card language, plus a hex text field.
export function ColorField({ label, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  return (
    <div className="pl-color-row">
      <span className="pl-slider-label">{label}</span>
      <input
        className="pl-color-swatch"
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="pl-color-hex"
        type="text"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}
