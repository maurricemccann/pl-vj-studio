// WebGL post-effects composite pass (SPEC — PL THIRD EYE VJ STUDIO REBUILD, Phase 1).
//
// Replaces postFX()'s per-effect full-canvas JS pixel loops (the measured
// lag source when multiple effects/adjustments stack) with ONE combined
// GPU fragment shader pass. Ribbon drawing and editor-chrome drawing are
// completely untouched -- this only intercepts the step between "ribbons
// finished drawing on the visible 2D canvas" and "chrome draws on top of
// it": upload the 2D canvas as a texture, run one shader, draw the result
// back onto the same 2D canvas via drawImage. Chrome then draws on top
// exactly as it always has.
//
// Kept as its own module so postFX() in main.js stays a thin call site --
// the shader is the whole complexity, not something to inline into the
// 1500-line main file.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const MAX_GLITCH_BANDS = 12;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform sampler2D uCurveLUT;   // 256x1, R channel only meaningful
uniform vec2 uTexel;           // 1/width, 1/height, in source-texture space

// tone adjust
uniform float uHue, uSaturation, uBrightness;
uniform vec3 uShadowTint, uMidTint, uHighTint;
uniform float uShadowAmt, uMidAmt, uHighAmt;
uniform bool uCurveEnabled;
uniform bool uGradientEnabled;
uniform vec3 uGradA, uGradB;
uniform float uNoiseAmt, uNoiseSeed;

// effects
uniform float uChromaticAberration; // px, source-texture space
uniform float uSharpen;             // 0..1 amount
uniform float uBloomAmt;            // 0..1
uniform float uHalftoneAmt;         // 0..1 (0 = off)
uniform float uOpacity;             // 1 = fully visible ribbons
uniform vec3 uGroundColor;

uniform int uGlitchBandCount;
uniform vec4 uGlitchBands[${MAX_GLITCH_BANDS}]; // x=yNorm0, y=yNorm1, z=xOffsetNorm, w unused

vec3 rgb2hsl(vec3 c) {
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;
  float h = 0.0, s = 0.0;
  if (d > 0.0001) {
    s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
    if (maxc == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s <= 0.0001) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0/3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0/3.0));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// source lookup that honors an active glitch band's x-shift (row-copy
// displacement, same algorithm as the original ctx.drawImage band-copy).
vec2 glitchedUv(vec2 uv) {
  for (int i = 0; i < ${MAX_GLITCH_BANDS}; i++) {
    if (i >= uGlitchBandCount) break;
    vec4 band = uGlitchBands[i];
    if (uv.y >= band.x && uv.y <= band.y) {
      uv.x -= band.z; // shift the SOURCE sample the opposite way the band was drawn
      break;
    }
  }
  return uv;
}

void main() {
  vec2 uv = glitchedUv(vUv);
  vec3 col = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;

  // chromatic aberration -- sample R/B from opposite x-shifted positions,
  // same as the original's per-pixel row shift.
  if (uChromaticAberration > 0.0) {
    float shift = uChromaticAberration * uTexel.x;
    col.r = texture(uSrc, clamp(vec2(uv.x + shift, uv.y), 0.0, 1.0)).r;
    col.b = texture(uSrc, clamp(vec2(uv.x - shift, uv.y), 0.0, 1.0)).b;
  }

  if (uHue != 0.0 || uSaturation != 0.0 || uBrightness != 0.0) {
    vec3 hsl = rgb2hsl(col);
    hsl.x = mod(hsl.x + uHue / 360.0, 1.0);
    hsl.y = clamp(hsl.y + uSaturation / 100.0, 0.0, 1.0);
    hsl.z = clamp(hsl.z + uBrightness / 200.0, 0.0, 1.0);
    col = hsl2rgb(hsl);
  }

  if (uShadowAmt > 0.0 || uMidAmt > 0.0 || uHighAmt > 0.0) {
    float lum = (col.r + col.g + col.b) / 3.0;
    float wShadow = max(0.0, 1.0 - lum * 2.0);
    float wHigh = max(0.0, lum * 2.0 - 1.0);
    float wMid = 1.0 - wShadow - wHigh;
    col += (uShadowTint - 0.5) * wShadow * uShadowAmt
         + (uMidTint - 0.5) * wMid * uMidAmt
         + (uHighTint - 0.5) * wHigh * uHighAmt;
  }

  if (uCurveEnabled) {
    col.r = texture(uCurveLUT, vec2(col.r, 0.5)).r;
    col.g = texture(uCurveLUT, vec2(col.g, 0.5)).r;
    col.b = texture(uCurveLUT, vec2(col.b, 0.5)).r;
  }

  if (uGradientEnabled) {
    float lum = (col.r + col.g + col.b) / 3.0;
    col = mix(uGradA, uGradB, lum);
  }

  if (uNoiseAmt > 0.0) {
    float n = (hash(vUv * 4096.0 + uNoiseSeed) * 2.0 - 1.0) * uNoiseAmt;
    col += n;
  }

  // sharpen -- discrete Laplacian on the 4-neighborhood, same kernel as the
  // original CPU pass, sampled post-adjust-chain so it sharpens the same
  // image the rest of the shader already produced.
  if (uSharpen > 0.0) {
    vec3 up    = texture(uSrc, clamp(uv + vec2(0.0, -uTexel.y), 0.0, 1.0)).rgb;
    vec3 down  = texture(uSrc, clamp(uv + vec2(0.0,  uTexel.y), 0.0, 1.0)).rgb;
    vec3 left  = texture(uSrc, clamp(uv + vec2(-uTexel.x, 0.0), 0.0, 1.0)).rgb;
    vec3 right = texture(uSrc, clamp(uv + vec2( uTexel.x, 0.0), 0.0, 1.0)).rgb;
    vec3 lap = col * 4.0 - up - down - left - right;
    col += lap * uSharpen;
  }

  // bloom -- small-kernel blur of the source, additively blended (same
  // 'lighter' composite intent as the original filter:blur + globalAlpha).
  if (uBloomAmt > 0.0) {
    float r = uBloomAmt * 20.0 * uTexel.x;
    vec3 blur = vec3(0.0);
    const int TAPS = 8;
    for (int i = 0; i < TAPS; i++) {
      float a = float(i) / float(TAPS) * 6.2831853;
      blur += texture(uSrc, clamp(uv + vec2(cos(a), sin(a)) * r, 0.0, 1.0)).rgb;
    }
    blur /= float(TAPS);
    col += blur * uBloomAmt * 0.5;
  }

  // halftone -- replaces the whole frame with a dot grid sized by cell
  // luminance, same as the original's ground-fill + per-cell circle fill.
  if (uHalftoneAmt > 0.0) {
    float cell = max(4.0, 24.0 * (1.0 - uHalftoneAmt) + 4.0) * uTexel.x;
    vec2 cellUv = (floor(vUv / cell) + 0.5) * cell;
    float lum = (texture(uSrc, cellUv).r + texture(uSrc, cellUv).g + texture(uSrc, cellUv).b) / 3.0;
    float rad = (1.0 - lum) * cell * 0.5;
    float d = length((vUv - cellUv) / uTexel * uTexel.x); // keep circular in non-square aspect
    float dot = 1.0 - smoothstep(rad - uTexel.x, rad, d);
    col = mix(uGroundColor, vec3(0.102, 0.082, 0.063), dot); // #1a1510, the original's fixed dot color
  }

  if (uOpacity < 1.0) {
    col = mix(uGroundColor, col, uOpacity);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('postfx-gl shader compile failed: ' + log);
  }
  return sh;
}

export function createPostFxGl(width, height) {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = width;
  glCanvas.height = height;
  const gl = glCanvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false });
  if (!gl) {
    // WebGL2 context creation returning null (no throw) was the actual silent
    // failure a real device hit -- caller's try/catch alone never saw it.
    // Surface a real reason instead of a bare null.
    throw new Error('WebGL2 context unavailable (getContext("webgl2") returned null -- unsupported or disabled on this device/driver)');
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('postfx-gl program link failed: ' + gl.getProgramInfoLog(prog));
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');

  const srcTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const lutTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const U = {};
  for (const name of [
    'uSrc', 'uCurveLUT', 'uTexel', 'uHue', 'uSaturation', 'uBrightness',
    'uShadowTint', 'uMidTint', 'uHighTint', 'uShadowAmt', 'uMidAmt', 'uHighAmt',
    'uCurveEnabled', 'uGradientEnabled', 'uGradA', 'uGradB', 'uNoiseAmt', 'uNoiseSeed',
    'uChromaticAberration', 'uSharpen', 'uBloomAmt', 'uHalftoneAmt', 'uOpacity',
    'uGroundColor', 'uGlitchBandCount', 'uGlitchBands',
  ]) U[name] = gl.getUniformLocation(prog, name);

  let lutDirty = true;
  let lastLutBytes = null;

  return {
    canvas: glCanvas,

    resize(w, h) {
      glCanvas.width = w;
      glCanvas.height = h;
      gl.viewport(0, 0, w, h);
    },

    // src: the visible 2D <canvas> element (or any CanvasImageSource) that
    // just finished drawing ribbons. adj/fx: the same live state objects
    // postFX() already reads. curveLUT: Uint8ClampedArray(256) | null.
    // groundHex: active.ground. Returns nothing -- result is in .canvas,
    // caller drawImage()s it back.
    render(src, adj, fx, curveLUT, groundHex, hexToRgbArr) {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform1i(U.uSrc, 0);

      if (curveLUT && (lutDirty || lastLutBytes !== curveLUT)) {
        const rgba = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) { rgba[i * 4] = curveLUT[i]; rgba[i * 4 + 1] = curveLUT[i]; rgba[i * 4 + 2] = curveLUT[i]; rgba[i * 4 + 3] = 255; }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        lastLutBytes = curveLUT;
        lutDirty = false;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.uniform1i(U.uCurveLUT, 1);

      gl.uniform2f(U.uTexel, 1 / glCanvas.width, 1 / glCanvas.height);
      gl.uniform1f(U.uHue, adj.hue);
      gl.uniform1f(U.uSaturation, adj.saturation);
      gl.uniform1f(U.uBrightness, adj.brightness);
      gl.uniform3fv(U.uShadowTint, hexToRgbArr(adj.shadowsTint).map(v => v / 255));
      gl.uniform3fv(U.uMidTint, hexToRgbArr(adj.midsTint).map(v => v / 255));
      gl.uniform3fv(U.uHighTint, hexToRgbArr(adj.highsTint).map(v => v / 255));
      gl.uniform1f(U.uShadowAmt, adj.shadowsAmt / 100);
      gl.uniform1f(U.uMidAmt, adj.midsAmt / 100);
      gl.uniform1f(U.uHighAmt, adj.highsAmt / 100);
      gl.uniform1i(U.uCurveEnabled, adj.curveEnabled ? 1 : 0);
      gl.uniform1i(U.uGradientEnabled, adj.gradientEnabled ? 1 : 0);
      if (adj.gradientEnabled) {
        gl.uniform3fv(U.uGradA, hexToRgbArr(adj.gradientStops[0]).map(v => v / 255));
        gl.uniform3fv(U.uGradB, hexToRgbArr(adj.gradientStops[1]).map(v => v / 255));
      }
      gl.uniform1f(U.uNoiseAmt, fx.noise);
      gl.uniform1f(U.uNoiseSeed, Math.random() * 1000);
      gl.uniform1f(U.uChromaticAberration, fx.chromaticAberration > 0 ? fx.chromaticAberration * 20 : 0);
      gl.uniform1f(U.uSharpen, fx.sharpen);
      gl.uniform1f(U.uBloomAmt, fx.bloom);
      gl.uniform1f(U.uHalftoneAmt, fx.halftone);
      gl.uniform1f(U.uOpacity, fx.opacity);
      gl.uniform3fv(U.uGroundColor, hexToRgbArr(groundHex).map(v => v / 255));

      // glitch bands -- same random band placement as the original's
      // per-frame loop, computed here on CPU (cheap: at most 12 values)
      // and handed to the shader as a small uniform array.
      const bandCount = Math.min(MAX_GLITCH_BANDS, Math.round(fx.glitch * 12));
      const bandData = new Float32Array(MAX_GLITCH_BANDS * 4);
      for (let i = 0; i < bandCount; i++) {
        const y = Math.random();
        const bh = (4 + Math.random() * 20) / glCanvas.height;
        const dx = (Math.random() * 2 - 1) * fx.glitch * 40 / glCanvas.width;
        bandData[i * 4] = y; bandData[i * 4 + 1] = y + bh; bandData[i * 4 + 2] = dx; bandData[i * 4 + 3] = 0;
      }
      gl.uniform1i(U.uGlitchBandCount, bandCount);
      gl.uniform4fv(U.uGlitchBands, bandData);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
