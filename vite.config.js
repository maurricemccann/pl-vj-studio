import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPEC — PL THIRD EYE VJ STUDIO SETTINGS PANEL REDESIGN, Phase A: the new
// desktop build pipeline. Vite owns the desktop app only -- the phone/
// Tailscale controller keeps loading raw, unbundled files straight from
// src/ via src-tauri/src/server.rs's include_str! routes (unaffected by
// this config). Port 1420 is the standard Tauri+Vite convention (matches
// src-tauri/tauri.conf.json's devUrl); strictPort so a silent port bump
// never desyncs the two.
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
