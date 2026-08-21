import { useRef, useState } from 'react';

// Founder correction, 2026-08-20: the original design (relative drag-delta,
// scaled sensitivity, never jumps to where you click) tested badly in real
// use -- "sliders are too small and I have to type it." Rebuilt as a normal
// click/drag-to-position slider, like every native OS/DAW/design-tool
// slider: click or drag anywhere on the track and the value jumps straight
// there. Shift+drag switches to fine relative-adjust from wherever the drag
// currently is (rolling anchor -- toggling Shift mid-drag never jumps).
// Double-click the number to type an exact value and scroll-wheel nudges by
// one step both stay, unchanged.
function clampStep(v, min, max, step) {
  const snapped = Math.round((v - min) / step) * step + min;
  return Math.max(min, Math.min(max, snapped));
}
function fmt(v, step) {
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 3 : 0;
  return Number(v).toFixed(Math.min(decimals, 4));
}
function valueAtPointer(e, trackEl, min, max, step) {
  const rect = trackEl.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  return clampStep(min + pct * (max - min), min, max, step);
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
    const nv = valueAtPointer(e, trackRef.current, min, max, step);
    onChange(nv);
    dragRef.current = { lastX: e.clientX, lastValue: nv };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    let nv;
    if (e.shiftKey) {
      const sensitivity = (max - min) / 2400; // fine-adjust, relative to wherever the drag is now
      nv = clampStep(d.lastValue + (e.clientX - d.lastX) * sensitivity, min, max, step);
    } else {
      nv = valueAtPointer(e, trackRef.current, min, max, step); // click/drag-to-position, like a native slider
    }
    onChange(nv);
    d.lastX = e.clientX;
    d.lastValue = nv;
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
        <div className="pl-slider-thumb" style={{ left: (pct * 100) + '%' }} />
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
