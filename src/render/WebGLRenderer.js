// Optional WebGL render path for Super Midio World.
//
// SAFETY CONTRACT:
//   - NEVER calls getContext('webgl*') on the main #stage canvas. That would
//     permanently steal the 2D context and kill the Canvas Renderer (which is
//     how the whole show is drawn).
//   - Scene composition always goes through the existing Canvas 2D Renderer.
//   - When WebGL is available, a transparent sibling canvas receives a cheap
//     energy-driven post-FX pass (fullscreen tint / vignette). When WebGL is
//     missing or fails to init, draw() is a pure Canvas passthrough — MIDI
//     drag/upload and gameplay are unaffected.
//
// Toggle with ?renderer=webgl (or createRenderer(canvas, 'webgl')).

import { Renderer } from './Renderer.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform float u_time;
uniform float u_energy;
uniform float u_hue;
out vec4 outColor;
void main() {
  vec2 c = v_uv - 0.5;
  float r = length(c);
  float vig = smoothstep(0.95, 0.25, r);
  float pulse = 0.55 + 0.45 * sin(u_time * 2.4 + r * 6.0);
  float a = (0.04 + 0.12 * u_energy) * vig * pulse;
  // Soft hue wash — additive feel via low alpha over the canvas below.
  float h = u_hue / 360.0;
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
  outColor = vec4(col, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(info || 'shader compile failed');
  }
  return sh;
}

function link(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(info || 'program link failed');
  }
  return prog;
}

/**
 * @param {HTMLCanvasElement} canvas main #stage (must stay Canvas 2D)
 * @param {{ preferWebGL?: boolean }} [opts]
 */
export class WebGLRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.canvasRenderer = new Renderer(canvas);
    this.preferWebGL = opts.preferWebGL !== false;
    this.glCanvas = null;
    this.gl = null;
    this.program = null;
    this.backend = 'canvas'; // 'webgl' | 'canvas' | 'canvas-fallback'
    this._energy = 0;
    this._hue = 210;
    this._disposed = false;

    if (this.preferWebGL) this._tryInitWebGL();
  }

  get enabled() {
    return this.backend === 'webgl';
  }

  _tryInitWebGL() {
    if (typeof document === 'undefined') {
      this.backend = 'canvas-fallback';
      return;
    }
    try {
      const parent = this.canvas.parentElement;
      if (!parent) {
        this.backend = 'canvas-fallback';
        return;
      }

      const glCanvas = document.createElement('canvas');
      glCanvas.id = 'stage-webgl';
      glCanvas.setAttribute('aria-hidden', 'true');
      glCanvas.width = this.canvas.width;
      glCanvas.height = this.canvas.height;

      // Match Stage model CSS sizing so the overlay letterboxes with #stage.
      const cs = getComputedStyle(this.canvas);
      glCanvas.style.cssText = [
        'position:absolute',
        'inset:0',
        'width:100%',
        'height:100%',
        'object-fit:contain',
        'pointer-events:none',
        'z-index:2',
        'display:block',
        'background:transparent',
      ].join(';');

      const gl = glCanvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
      });
      if (!gl) {
        this.backend = 'canvas-fallback';
        return;
      }

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      const program = link(gl, vs, fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]), gl.STATIC_DRAW);

      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      this.glCanvas = glCanvas;
      this.gl = gl;
      this.program = program;
      this._uTime = gl.getUniformLocation(program, 'u_time');
      this._uEnergy = gl.getUniformLocation(program, 'u_energy');
      this._uHue = gl.getUniformLocation(program, 'u_hue');
      this.backend = 'webgl';

      // Insert after stage so it paints on top without intercepting input.
      if (this.canvas.nextSibling) parent.insertBefore(glCanvas, this.canvas.nextSibling);
      else parent.appendChild(glCanvas);
    } catch (err) {
      console.warn('[WebGLRenderer] init failed, using Canvas only:', err?.message || err);
      this._teardownGL();
      this.backend = 'canvas-fallback';
    }
  }

  _syncSize() {
    if (!this.glCanvas || !this.gl) return;
    if (this.glCanvas.width !== this.canvas.width || this.glCanvas.height !== this.canvas.height) {
      this.glCanvas.width = this.canvas.width;
      this.glCanvas.height = this.canvas.height;
      this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    }
  }

  _sampleEnergy(sim) {
    let e = 0;
    if (sim?.hype) e = Math.max(e, sim.hype.fast || 0, sim.hype.slam || 0, (sim.hype.surge || 0) * 0.8);
    if (sim?.vibe) e = Math.max(e, sim.vibe.epic || 0);
    if (sim?.energyCurves && typeof sim.energyCurves.sample === 'function') {
      try {
        let sum = 0;
        for (let b = 0; b < 7; b++) sum += sim.energyCurves.sample(b, sim.timeMs || 0) || 0;
        e = Math.max(e, sum / 7);
      } catch { /* ignore */ }
    }
    this._energy += 0.15 * (Math.max(0, Math.min(1, e)) - this._energy);

    // Halo hue from active biome when available.
    if (sim?.biomes?.currentHaloColor) {
      const hex = sim.biomes.currentHaloColor();
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (m) {
        const n = parseInt(m[1], 16);
        const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 1e-6) {
          if (max === r) h = ((g - b) / d) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h *= 60;
          if (h < 0) h += 360;
          this._hue = h;
        }
      }
    }
  }

  /** Same interface as Renderer.draw — always draws the Canvas scene first. */
  draw(sim, alpha) {
    this.canvasRenderer.draw(sim, alpha);
    if (this.backend !== 'webgl' || !this.gl || this._disposed) return;

    this._syncSize();
    this._sampleEnergy(sim);

    const gl = this.gl;
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this._uTime, (sim?.timeMs || 0) / 1000);
    gl.uniform1f(this._uEnergy, this._energy);
    gl.uniform1f(this._uHue, this._hue);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _teardownGL() {
    if (this.glCanvas?.parentElement) this.glCanvas.parentElement.removeChild(this.glCanvas);
    if (this.gl && this.program) {
      try { this.gl.deleteProgram(this.program); } catch { /* ignore */ }
    }
    this.glCanvas = null;
    this.gl = null;
    this.program = null;
  }

  dispose() {
    this._disposed = true;
    this._teardownGL();
  }
}

/**
 * Factory used by main.js. mode: 'canvas' | 'webgl'
 * Canvas mode returns the stock Renderer; webgl mode returns WebGLRenderer
 * (which itself falls back to Canvas scene drawing if GL is unavailable).
 */
export function createRenderer(canvas, mode = 'canvas') {
  if (mode === 'webgl') return new WebGLRenderer(canvas, { preferWebGL: true });
  return new Renderer(canvas);
}

/** Resolve renderer mode from URL (?renderer=webgl) or explicit override. */
export function resolveRendererMode(search = (typeof location !== 'undefined' ? location.search : '')) {
  try {
    const raw = search || '';
    const q = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    const m = (q.get('renderer') || 'canvas').toLowerCase();
    return m === 'webgl' ? 'webgl' : 'canvas';
  } catch {
    return 'canvas';
  }
}
