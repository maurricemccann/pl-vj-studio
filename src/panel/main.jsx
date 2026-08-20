// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: the new
// desktop bootstrap. Vite-bundled, loaded by the real Tauri webview (per
// tauri.conf.json's frontendDist now pointing at the Vite build output).
// Imports the exact same core/store.js + core/interactions.js the phone/
// controller's main.js does -- this is the load-bearing shared-core split:
// canvas rendering, all 6 RAF loops, and WS sync run identically on both
// surfaces; only the sidebar UI differs (React here, Tweakpane there).
import { createRoot } from 'react-dom/client';
import {
  PIECES, loadPiece, connectWS, buildCurveLUT,
} from '../core/store.js';
import { initInteractions } from '../core/interactions.js';
import { App } from './App.jsx';

const pieceSelect = document.getElementById('piece-select');

initInteractions(buildCurveLUT);
connectWS();

if (window.__TAURI__) {
  window.__TAURI__.core.invoke('controller_url').then((url) => {
    const el = document.getElementById('controller-url');
    if (el) el.textContent = `Phone: ${url}?controller`;
  }).catch(() => {});
}

PIECES.forEach((p) => {
  const opt = document.createElement('option');
  opt.value = p.id; opt.textContent = p.name;
  pieceSelect.appendChild(opt);
});
pieceSelect.addEventListener('change', () => loadPiece(pieceSelect.value));

loadPiece(PIECES[0].id);

createRoot(document.getElementById('react-root')).render(<App />);
