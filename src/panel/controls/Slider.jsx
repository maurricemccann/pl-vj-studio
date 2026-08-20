import { useRef, useState } from 'react';

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Design section 2:
// custom slider -- per-parameter sensitivity (drag delta scaled by the
// param's own range, not a raw 1:1 pixel mapping), Shift+drag = fine-adjust
// (sensitivity / 8), double-click the number = type an exact value,
// scroll-wheel nudges by one step, live numeric readout during drag.
const CLICK_THRESHOLD_PX = 4;

function clampStep(v, min, max, step) {
  const snapped = Math.round((v - min) / step) * step + min;
  return Math.max(min, Math.min(max, snapped));
}
function fmt(v, step) {
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 3 : 0;
  return Number(v).toFixed(Math.min(decimals, 4));
}

export function Slider({ label, value, min, max, step = 0.01, onChange }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));

  function onPointerDown(e) {
    if (editing) return;
    trackRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startValue: value, moved: false };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < CLICK_THRESHOLD_PX) return;
    d.moved = true;
    const sensitivity = (max - min) / (e.shiftKey ? 2400 : 300); // Shift = fine-adjust
    const nv = clampStep(d.startValue + dx * sensitivity, min, max, step);
    onChange(nv);
  }
  function onPointerUp(e) {
    trackRef.current.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  }
  function onWheel(e) {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    onChange(clampStep(value + dir * step, min, max, step));
  }
  function startEdit() {
    setEditValue(String(value));
    setEditing(true);
  }
  function commitEdit() {
    const n = parseFloat(editValue);
    if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
    setEditing(false);
  }

  return (
    <div className="pl-slider-row">
      <span className="pl-slider-label">{label}</span>
      <div
        className={'pl-slider-track' + (dragging ? ' dragging' : '')}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <div className="pl-slider-fill" style={{ width: (pct * 100) + '%' }} />
      </div>
      {editing ? (
        <input
          className="pl-slider-input"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            else if (e.key === 'Escape') setEditing(false);
          }}
          onFocus={(e) => e.target.select()}
        />
      ) : (
        <span className="pl-slider-value" onDoubleClick={startEdit} title="Double-click to type an exact value">
          {fmt(value, step)}
        </span>
      )}
    </div>
  );
}
