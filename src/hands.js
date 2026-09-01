/**
 * Bare-hands ribbon control — the third input after mouse and phone, and the
 * only one that works while performing, hands off the keyboard.
 *
 * SPEC — PL-VJ-STUDIO HAND CONTROL (BARE-HANDS RIBBONS), S218. Built 2026-08-31.
 *
 * ARCHITECTURE: this is a standalone tracker page. It opens the webcam, runs
 * MediaPipe Hands, and drives ribbon params over the SAME ws://<host>:8917/ws
 * relay the phone controller already uses. engine.js is untouched; the desktop
 * app does not know hands exist. Close this page and nothing degrades.
 *
 * Runs wherever you open it — laptop or phone. It is served over the LAN, so
 * the "which camera" question answers itself per session rather than at build.
 *
 * PROTOCOL NOTE (differs from the spec's wording, deliberately): the spec said
 * "sends parameter deltas, never raw landmarks." The relay does not speak
 * deltas — it rebroadcasts whole {active, adj, fx} blobs, last writer wins
 * (see core/store.js). So this mirrors the phone-controller pattern: receive
 * state, apply gesture-derived changes to the selected ribbon, send the blob
 * back. Landmarks still never leave this page, which was the actual intent.
 *
 * NO barehands CODE IS USED HERE. That project is CC BY-NC-SA 4.0 and its
 * ShareAlike is viral. The only thing taken is a stated principle — measure
 * hand shape as ratios, not pixel distances, so gates hold at any camera
 * distance. MediaPipe Hands (Apache 2.0) is the actual dependency.
 */

// ── tunables ────────────────────────────────────────────────────────────────
const WS_PORT = 8917;
const SEND_HZ = 30;            // param sends/sec; the relay coalesces anyway
const DEADZONE = 0.02;         // ignore deltas under 2% of a param's range
const MAX_STEP = 0.08;         // max fraction of range a param may move per frame
const PALM_HOLD_MS = 1000;     // open palm must hold this long to cycle ribbon

// Real ranges, read off the live piece definitions in src/pieces.js.
const RANGE = {
  width:  [0.02, 0.30],
  taper:  [0.01, 0.40],
  tremor: [0.00, 0.60],
  gap:    [0.00, 0.12],
};

// ── one-euro filter ─────────────────────────────────────────────────────────
// Low latency when the hand moves slowly, low jitter when it moves fast — the
// opposite trade a moving average makes, which is the wrong one for performance.
class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.xPrev = null; this.dxPrev = 0; this.tPrev = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.xPrev === null) { this.xPrev = x; this.tPrev = t; return x; }
    const dt = Math.max(1e-3, (t - this.tPrev) / 1000);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuro.alpha(cutoff, dt);
    const xf = a * x + (1 - a) * this.xPrev;
    this.xPrev = xf;
    return xf;
  }
}

// ── geometry helpers (ratios, never pixels) ─────────────────────────────────
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/** Palm width is the scale reference — every ratio below divides by it, which
 *  is what makes the gates hold whether the hand is near or far from the lens. */
function palmSpan(lm) {
  return Math.max(1e-4, dist(lm[5], lm[17]));
}

function pinchRatio(lm) {
  return dist(lm[4], lm[8]) / palmSpan(lm);           // thumb tip ↔ index tip
}

function fingersExtended(lm) {
  // A finger counts as extended when its tip sits further from the wrist than
  // its own middle joint — orientation-free, so it survives a tilted hand.
  const w = lm[0];
  return [[8, 6], [12, 10], [16, 14], [20, 18]]
    .filter(([tip, pip]) => dist(lm[tip], w) > dist(lm[pip], w) * 1.05).length;
}

const isFist = (lm) => fingersExtended(lm) === 0 && pinchRatio(lm) < 0.9;
const isOpenPalm = (lm) => fingersExtended(lm) === 4;

/** Roll from the index→pinky knuckle vector. Reads as "disturbance," which is
 *  what tremor is. Normalised 0..1 across roughly ±60°. */
function rollNorm(lm) {
  const ang = Math.atan2(lm[17].y - lm[5].y, lm[17].x - lm[5].x);
  return Math.min(1, Math.max(0, (ang / (Math.PI / 3) + 1) / 2));
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toParam = (norm, key) => {
  const [lo, hi] = RANGE[key];
  return lo + clamp01(norm) * (hi - lo);
};

// ── state ───────────────────────────────────────────────────────────────────
let ws = null;
let mirror = null;          // last full {active, adj, fx} blob seen from the relay
let lastSentJSON = null;
let selected = 0;
let frozen = false;
let palmSince = 0;
let tracking = false;
let lastSend = 0;

const filters = {
  width: new OneEuro(),
  taper: new OneEuro(),
  tremor: new OneEuro(),
  gap: new OneEuro(),
};

const els = {};
const setStatus = (t, cls) => {
  if (!els.status) return;
  els.status.textContent = t;
  els.status.className = `status ${cls || ''}`;
};

// ── relay ───────────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(`ws://${location.hostname}:${WS_PORT}/ws`);
  ws.addEventListener('message', (ev) => {
    if (ev.data === lastSentJSON) return;                 // our own echo
    try {
      const p = JSON.parse(ev.data);
      if (p.active) mirror = p;                           // keep the whole blob
    } catch { /* partial frame — drop it */ }
  });
  ws.addEventListener('open', () => setStatus('relay connected — show a hand', 'ok'));
  ws.addEventListener('close', () => { ws = null; setStatus('relay lost — retrying', 'warn'); setTimeout(connectWS, 1500); });
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* already closing */ } });
}

/** Write the gesture-derived params onto the selected ribbon and push the blob.
 *  Rate-limited and deadzoned so a tracking glitch cannot snap a param across
 *  its whole range, and so a resting hand sends nothing at all. */
function pushParams(next) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !mirror?.active?.ribbons?.length) return;
  const now = performance.now();
  if (now - lastSend < 1000 / SEND_HZ) return;

  const idx = Math.min(selected, mirror.active.ribbons.length - 1);
  const r = mirror.active.ribbons[idx];
  let changed = false;

  for (const [key, target] of Object.entries(next)) {
    if (target === null || target === undefined) continue;
    const [lo, hi] = RANGE[key];
    const span = hi - lo;
    const cur = typeof r[key] === 'number' ? r[key] : lo;
    if (Math.abs(target - cur) < DEADZONE * span) continue;      // deadzone
    const step = Math.max(-MAX_STEP * span, Math.min(MAX_STEP * span, target - cur));
    r[key] = Math.min(hi, Math.max(lo, cur + step));             // rate limit
    changed = true;
  }
  if (!changed) return;

  lastSend = now;
  lastSentJSON = JSON.stringify(mirror);
  ws.send(lastSentJSON);
  if (els.readout) {
    els.readout.textContent =
      `ribbon ${idx + 1}/${mirror.active.ribbons.length} · ` +
      ['width', 'taper', 'tremor', 'gap'].map((k) => `${k} ${(r[k] ?? 0).toFixed(3)}`).join(' · ');
  }
}

// ── per-frame gesture read ──────────────────────────────────────────────────
function onResults(res) {
  const hands = res.multiHandLandmarks || [];
  const t = performance.now();

  if (hands.length === 0) {
    // TRACK-LOSS HOLD: never spring to zero. Walking out of frame must not
    // blank the piece — it holds exactly where it was left.
    if (tracking) { tracking = false; setStatus('hand lost — holding last state', 'warn'); }
    return;
  }
  if (!tracking) { tracking = true; setStatus(frozen ? 'frozen (fist) — open hand to resume' : 'tracking', 'ok'); }

  const lm = hands[0];

  // FIST = freeze. The safety gesture: drop your hands without the piece drifting.
  if (isFist(lm)) {
    if (!frozen) { frozen = true; setStatus('frozen (fist) — open hand to resume', 'warn'); }
    return;
  }
  if (frozen) {
    // Resume from where it froze — the filters keep their last value, so there
    // is no jump back to wherever the hand happens to be now.
    frozen = false;
    setStatus('tracking', 'ok');
  }

  // OPEN PALM held 1s = cycle the selected ribbon. Deliberately slow, so it
  // cannot fight the continuous controls.
  if (isOpenPalm(lm)) {
    if (!palmSince) palmSince = t;
    else if (t - palmSince > PALM_HOLD_MS) {
      palmSince = 0;
      const n = mirror?.active?.ribbons?.length || 1;
      selected = (selected + 1) % n;
      setStatus(`ribbon ${selected + 1}/${n}`, 'ok');
    }
    return;                                   // palm is a mode gesture, not a value
  }
  palmSince = 0;

  // Pinch → width. The primary continuous control.
  const pinch = clamp01((pinchRatio(lm) - 0.15) / 1.15);
  // Wrist height → taper. Vertical is the steadiest single axis on a webcam.
  const height = clamp01(1 - lm[0].y);
  // Roll → tremor.
  const roll = rollNorm(lm);

  const next = {
    width: toParam(filters.width.filter(pinch, t), 'width'),
    taper: toParam(filters.taper.filter(height, t), 'taper'),
    tremor: toParam(filters.tremor.filter(roll, t), 'tremor'),
  };

  // Two-hand spread → gap. Only when a second hand is actually present.
  if (hands.length > 1) {
    const spread = clamp01((dist(lm[0], hands[1][0]) - 0.15) / 0.55);
    next.gap = toParam(filters.gap.filter(spread, t), 'gap');
  }

  pushParams(next);
}

// ── boot ────────────────────────────────────────────────────────────────────
async function start() {
  els.status = document.getElementById('status');
  els.readout = document.getElementById('readout');
  const video = document.getElementById('cam');

  connectWS();

  if (!window.Hands) {
    setStatus('MediaPipe failed to load — check the network', 'err');
    return;
  }
  const hands = new window.Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,          // lite model — latency matters more than precision here
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  hands.onResults(onResults);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    video.srcObject = stream;
    await video.play();
  } catch {
    setStatus('camera denied — allow it and reload', 'err');
    return;
  }

  const pump = async () => {
    if (video.readyState >= 2) await hands.send({ image: video });
    requestAnimationFrame(pump);
  };
  pump();
}

document.addEventListener('DOMContentLoaded', start);
