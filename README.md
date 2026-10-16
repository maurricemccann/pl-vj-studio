# PL Third Eye VJ Studio

A desktop VJ instrument for drawing and performing ribbon curves live. Built with
Tauri 2: a Rust shell, a Vite and React control panel, and a Canvas 2D renderer with a
WebGL post-effects pass. A phone on the same network can drive it from
a browser, with nothing to install.

## Features

- **Ribbon engine.** Spline ribbons with width, taper, gap, tremor and per-point width
  handles. Catmull-Rom by default, with optional bezier handles per point and closed
  curves.
- **Direct editing on the canvas.** Drag points, add or remove them with the wheel,
  reshape with handles, and select any ribbon by clicking its curve.
- **Ribbon materials.** Satin ribbon, painterly, spray-paint, paintbrush and fabric,
  each painted only inside the ribbon's own shape.
- **Post effects in one shader pass.** Hue, saturation, brightness, shadow, mid and
  highlight tints, a tone curve, gradient map, noise, chromatic aberration, sharpen,
  bloom, halftone and glitch bands.
- **Modulation.** LFOs, wander, keyframes, preset A/B morphing, microphone audio
  (frequency analysis) and webcam input can each drive ribbon parameters.
- **Three ways to control it.**
  - The desktop panel (tabs: Ribbon, Curve, Animation, Modulation, Adjustments, Effects).
  - A phone controller served by the app on port 8917, installable to the home screen.
    It covers ribbon, ground, adjustment and effect controls; animation and modulation
    stay on the desktop.
  - A bare-hands tracker page (`/hands.html`) that runs MediaPipe Hands on a webcam and
    sends ribbon changes over the same relay.
- **Presentation mode** for clean output and recording, with a frame-time readout.

## Keyboard

| Key | Action |
|---|---|
| F | toggle presentation mode (Esc leaves it) |
| H | bezier handles on the selected point |
| K | align handles |
| T | toggle tied or untied handles |
| W | reset the point's width handle |

## Requirements

- Node.js and npm
- Rust (stable) and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
  for your platform
- A webcam and microphone only if you use camera, audio or hand control
- The hands page loads MediaPipe Hands from jsDelivr, so it needs internet access

## Run it

```bash
npm install
npm run tauri dev       # starts Vite on :1420 and opens the desktop app
```

On launch the app starts its controller server on port 8917 and shows the LAN address
to open on a phone (same network or Tailscale).

## Build

```bash
npm run tauri build     # bundles the desktop app for the current platform
```

## How it works

```
desktop webview (Vite + React panel)          phone browser / hands page
        |                                              |
        +--------- ws://<host>:8917/ws ----------------+
                  Rust relay in src-tauri/src/server.rs
```

- `src-tauri/src/server.rs` is an axum HTTP and WebSocket server. It serves the phone
  controller's files, which are compiled into the binary with `include_str!`, and relays
  state. Each message is the full `{active, adj, fx}` state blob; the server caches the
  latest one for new clients and rebroadcasts it. Last write wins.
- `src/core/store.js` is the shared core: state, render, the animation loops and the
  sync protocol. Both the desktop panel and the unbundled phone controller import it, so
  it stays plain relative-import JavaScript.
- `src/postfx-gl.js` uploads the finished 2D canvas as a texture and runs one combined
  fragment shader, replacing per-effect JavaScript pixel loops.

## Project structure

```
src/
  engine.js            ribbon spline and path engine
  pieces.js            starting piece library (normalised points)
  ribbon-materials.js  per-ribbon paint techniques
  postfx-gl.js         WebGL post-effects pass
  core/                shared state, render loop, pointer and keyboard interaction
  panel/               desktop React panel (Vite)
  controller/          phone controller entry (React UMD, no bundler)
  hands.html, hands.js bare-hands tracker
  vendor/              React and ReactDOM UMD builds for the phone controller
src-tauri/
  src/lib.rs           Tauri setup and commands
  src/server.rs        controller server and WebSocket relay
index.html             desktop entry
vite.config.js         desktop build (port 1420)
```

## License

All rights reserved. Public to read; no licence is granted to copy, modify or
redistribute. See [LICENSE](LICENSE). Third-party libraries keep their own licences.

Made by [Psyched Luxuries](https://psychedluxuries.com).
