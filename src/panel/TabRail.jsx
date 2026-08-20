// Design section 1: vertical icon-tab rail -- Ribbon (default/first), Curve,
// Animation, Modulation, Adjustments, Effects. Real drawn icons (house rule:
// no unicode glyphs), simple abstract strokes matching present-toggle's
// existing SVG style in index.html.
const TABS = [
  { id: 'ribbon', label: 'Ribbon', icon: (
    <path d="M3 15c3-6 6 6 9 0s6-6 9 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  ) },
  { id: 'curve', label: 'Curve', icon: (
    <>
      <path d="M4 17c3-9 13-9 16-11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="4" cy="17" r="1.6" fill="currentColor" />
      <circle cx="20" cy="6" r="1.6" fill="currentColor" />
    </>
  ) },
  { id: 'animation', label: 'Animation', icon: (
    <path d="M6 4l14 8-14 8V4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
  ) },
  { id: 'modulation', label: 'Modulation', icon: (
    <path d="M2 12h4l2-7 4 14 4-14 2 7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  ) },
  { id: 'adjustments', label: 'Adjustments', icon: (
    <>
      <path d="M5 4v16M12 4v16M19 4v16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5" cy="9" r="2" fill="currentColor" />
      <circle cx="12" cy="15" r="2" fill="currentColor" />
      <circle cx="19" cy="7" r="2" fill="currentColor" />
    </>
  ) },
  { id: 'effects', label: 'Effects', icon: (
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  ) },
];

export function TabRail({ active, onSelect }) {
  return (
    <div className="pl-tab-rail">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={'pl-tab-btn' + (t.id === active ? ' active' : '')}
          title={t.label}
          onClick={() => onSelect(t.id)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">{t.icon}</svg>
          <span className="pl-tab-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
