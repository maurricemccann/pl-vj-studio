import { useState } from 'react';
import { useStoreVersion } from './useStore.js';
import { state } from '../core/store.js';
import { RibbonList } from './RibbonList.jsx';
import { TabRail } from './TabRail.jsx';
import { RibbonPanel } from './panels/RibbonPanel.jsx';
import { AnimationPanel } from './panels/AnimationPanel.jsx';
import { CurvePanel } from './panels/CurvePanel.jsx';
import { ModulationPanel } from './panels/ModulationPanel.jsx';
import { AdjustmentsPanel } from './panels/AdjustmentsPanel.jsx';
import { EffectsPanel } from './panels/EffectsPanel.jsx';

const PANELS = {
  ribbon: RibbonPanel,
  animation: AnimationPanel,
  curve: CurvePanel,
  modulation: ModulationPanel,
  adjustments: AdjustmentsPanel,
  effects: EffectsPanel,
};

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A + B + C:
// the navigation shell -- persistent Ribbon List -> vertical icon-tab rail
// -> single-category property view with a search box, filling the
// remaining space. All 6 tabs fully real as of Phase C.
export function App() {
  const [tab, setTab] = useState('ribbon');
  const [search, setSearch] = useState('');
  useStoreVersion(); // re-render this whole subtree on every core state bump

  if (!state.active) return null; // loadPiece() hasn't run yet (first paint)

  return (
    <div className="pl-app-root">
      <RibbonList />
      <div className="pl-nav-body">
        <TabRail active={tab} onSelect={setTab} />
        <div className="pl-property-view">
          <input
            className="pl-search"
            type="text"
            placeholder="Search controls…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(() => { const Panel = PANELS[tab]; return <Panel search={search} />; })()}
        </div>
      </div>
    </div>
  );
}
