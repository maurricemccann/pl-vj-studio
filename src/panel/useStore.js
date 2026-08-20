import { useSyncExternalStore } from 'react';
import { subscribe, getVersion } from '../core/store.js';

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: the
// useSyncExternalStore contract fix from the 2nd review pass. The snapshot
// is this primitive version counter, never the raw mutable state object --
// components call this once, then re-read the live `state.xxx` objects
// fresh on every render (they are NOT memoized here), so a version bump
// always shows current values.
export function useStoreVersion() {
  return useSyncExternalStore(subscribe, getVersion);
}
