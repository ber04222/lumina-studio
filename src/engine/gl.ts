// ─── Minimal WebGL2 helpers ──────────────────────────────────────────────────

export interface Program {
  prog: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class GL {
  gl: WebGL2RenderingContext;
  floatOK: boolean;
  maxTex: number;
  private vao: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private pool: Target[] = [];

  canvas: HTMLCanvasElement | OffscreenCanvas;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserve?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  program(key: string, frag: string): Program {
    const hit = this.programs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        throw new Error(`Shader ${key} failed: ${log}`);
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Link ${key}: ${gl.getProgramInfoLog(prog)}`);
    const cache = new Map<string, WebGLUniformLocation | null>();
    const p: Program = {
      prog,
      u: (n) => {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n));
        return cache.get(n)!;
      },
    };
    this.programs.set(key, p);
    return p;
  }

  texture(filter: 'linear' | 'nearest' = 'linear'): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Upload an image-like source into a texture (sRGB 8-bit). */
  upload(tex: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  uploadData(tex: WebGLTexture, w: number, h: number, data: Uint8Array | Uint8ClampedArray, format: 'rgba' | 'r' = 'rgba') {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (format === 'rgba') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  /** Render target; float16 when supported (keeps highlight headroom between passes). */
  target(w: number, h: number, float = true): Target {
    const gl = this.gl;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const useFloat = float && this.floatOK;
    const idx = this.pool.findIndex((t) => t.w === w && t.h === h && (t as Target & { f: boolean }).f === useFloat);
    if (idx >= 0) return this.pool.splice(idx, 1)[0];
    const tex = this.texture('linear');
    if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const t = { tex, fbo, w, h, f: useFloat } as Target & { f: boolean };
    return t;
  }

  /** Return a target to the pool for reuse. */
  release(t: Target | null | undefined) {
    if (!t) return;
    this.pool.push(t);
    // keep the pool bounded
    while (this.pool.length > 24) {
      const old = this.pool.shift()!;
      this.gl.deleteTexture(old.tex);
      this.gl.deleteFramebuffer(old.fbo);
    }
  }

  /** Draw a fullscreen pass into target (or the canvas when null). */
  draw(p: Program, target: Target | null, setup: (u: Program['u']) => void, textures: WebGLTexture[] = [], viewport?: [number, number, number, number]) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (viewport) gl.viewport(...viewport);
    else if (target) gl.viewport(0, 0, target.w, target.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    textures.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    setup(p.u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Read back an RGBA8 copy of a target (top-down rows). */
  read(t: Target, x = 0, y = 0, w = t.w, h = t.h): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const isF = (t as Target & { f: boolean }).f;
    let out: Uint8ClampedArray<ArrayBuffer>;
    if (isF) {
      const f = new Float32Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, f);
      out = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < f.length; i++) out[i] = f[i] * 255 + 0.5;
    } else {
      out = new Uint8ClampedArray(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    }
    // Convention: every texture/target stores the image top row at v=0, so render
    // targets read back top-down without flipping. Only canvas passes flip.
    return out;
  }

  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
