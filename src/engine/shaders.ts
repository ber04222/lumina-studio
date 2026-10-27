// ─── GLSL sources for the Lumina GPU pipeline ───────────────────────────────
// Convention: every texture stores the image top row at v = 0.

const COMMON = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c) { return dot(c, LUMA); }
vec3 s2l(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
vec3 toOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = cbrt(l); m = cbrt(m); s = cbrt(s);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 fromOklab(vec3 L) {
  float l = L.x + 0.3963377774 * L.y + 0.2158037573 * L.z;
  float m = L.x - 0.1055613458 * L.y - 0.0638541728 * L.z;
  float s = L.x - 0.0894841775 * L.y - 1.2914855480 * L.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float bell(float x, float c, float w) { float t = (x - c) / w; return exp(-t * t); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// 1-D lookup table texture (R32F, 1024 wide). Rows:
// 0 tone (domain 0..2) · 1 red · 2 green · 3 blue · 4 master · 5 match-L
const LUT1D = `
uniform highp sampler2D uLut1;
float lut1(float x, int row, float domain) {
  float f = clamp(x / domain, 0.0, 1.0) * 1023.0;
  int i = int(floor(f));
  int j = min(i + 1, 1023);
  float a = texelFetch(uLut1, ivec2(i, row), 0).r;
  float b = texelFetch(uLut1, ivec2(j, row), 0).r;
  return mix(a, b, f - float(i));
}
`;

export const DEVELOP_FS = `${COMMON}${LUT1D}
uniform sampler2D uSrc;
uniform sampler2D uBase; uniform float uLocalOn;
uniform sampler3D uLut3;
uniform float uLutAmt; uniform float uLutSize;
uniform vec3 uWB; uniform float uExpo;
uniform float uDehaze; uniform vec3 uAir;
uniform float uToneOn; uniform float uToneMix;
uniform float uCurvesOn;
uniform float uHslOn; uniform vec3 uHsl[8]; uniform float uHslHue[8];
uniform float uSat; uniform float uVib;
uniform float uGradOn; uniform vec3 uGS; uniform vec3 uGM; uniform vec3 uGH; uniform vec3 uGG;
uniform float uPivot; uniform float uWidth;
uniform float uMatchOn; uniform float uMColor; uniform float uMTone;
uniform vec2 uMSrc[3]; uniform vec2 uMRef[3]; uniform vec2 uMStd;
uniform sampler3D uMLut; uniform float uMLutOn;

vec3 toneRGB(vec3 g) {
  float Y = luma(g);
  float Yt = lut1(Y, 0, 2.0);
  vec3 ratio = g * (Yt / max(Y, 1e-4));
  vec3 add = g + (Yt - Y);
  vec3 r1 = mix(add, ratio, smoothstep(0.0, 0.06, Y));
  vec3 r2 = vec3(lut1(g.r, 0, 2.0), lut1(g.g, 0, 2.0), lut1(g.b, 0, 2.0));
  return mix(r1, r2, uToneMix);
}

void main() {
  vec3 src = texture(uSrc, vUv).rgb;
  vec3 lin = s2l(src);

  // Colour Match (statistical transfer in Oklab, by tonal zone)
  if (uMatchOn > 0.5) {
    vec3 lab = toOklab(lin);
    float L = lab.x;
    float ws = 1.0 - smoothstep(0.2, 0.55, L);
    float wh = smoothstep(0.45, 0.82, L);
    float wm = clamp(1.0 - ws - wh, 0.0, 1.0);
    vec2 ms = ws * uMSrc[0] + wm * uMSrc[1] + wh * uMSrc[2];
    vec2 mr = ws * uMRef[0] + wm * uMRef[1] + wh * uMRef[2];
    if (uMLutOn > 0.5) {
      // full-distribution transfer baked into a 3D LUT (per-hue, per-tone remapping)
      vec3 c = clamp(l2s(lin), 0.0, 1.0) * (32.0 / 33.0) + 0.5 / 33.0;
      vec3 d = toOklab(max(s2l(texture(uMLut, c).rgb), 0.0)) - lab;
      lab.yz += d.yz * uMColor;
      lab.x += d.x * uMTone;
    } else {
      vec2 ab = (lab.yz - ms) * uMStd + mr;
      lab.yz = mix(lab.yz, ab, uMColor);
      lab.x = mix(L, lut1(L, 5, 1.0), uMTone);
    }
    lin = max(fromOklab(lab), 0.0);
  }

  lin *= uWB;
  lin *= uExpo;

  if (uDehaze > 0.0) {
    float k = uDehaze * 0.14;
    lin = max(lin - uAir * k, 0.0) / max(1.0 - k * luma(uAir), 0.3);
  } else if (uDehaze < 0.0) {
    lin = mix(lin, uAir, -uDehaze * 0.35);
  }

  vec3 g = l2s(lin);
  if (uLocalOn > 0.5) {
    // local tone mapping: gain computed on a blurred base layer, so texture/local contrast survive
    vec3 bl = s2l(texture(uBase, vUv).rgb) * uWB * uExpo;
    float Yb = l2s(vec3(luma(bl))).x;
    float Yg = luma(g);
    float Ym = mix(Yg, Yb, 0.72);
    float gain = lut1(Ym, 6, 2.0) / max(Ym, 1e-3);
    g *= mix(1.0, gain, smoothstep(0.0, 0.02, Ym));
    g += (lut1(0.0, 6, 2.0)) * (1.0 - smoothstep(0.0, 0.02, Ym));
  }
  if (uToneOn > 0.5) g = toneRGB(g);
  g = clamp(g, 0.0, 1.0);

  if (uCurvesOn > 0.5) {
    g = vec3(lut1(g.r, 4, 1.0), lut1(g.g, 4, 1.0), lut1(g.b, 4, 1.0));
    g = vec3(lut1(g.r, 1, 1.0), lut1(g.g, 2, 1.0), lut1(g.b, 3, 1.0));
  }

  if (uHslOn > 0.5) {
    vec3 hsv = rgb2hsv(g);
    float h = hsv.x * 360.0;
    float sw = smoothstep(0.03, 0.25, hsv.y);
    vec3 acc = vec3(0.0);
    // tent weights between neighbouring hue centres → every hue is covered
    for (int k = 0; k < 8; k++) {
      int n = k == 7 ? 0 : k + 1;
      float c0 = uHslHue[k];
      float c1 = k == 7 ? uHslHue[0] + 360.0 : uHslHue[n];
      if (h >= c0 && h < c1) {
        float t = (h - c0) / (c1 - c0);
        t = t * t * (3.0 - 2.0 * t);
        acc = uHsl[k] * (1.0 - t) + uHsl[n] * t;
      }
    }
    hsv.x = fract((h + acc.x * 30.0 * sw) / 360.0 + 1.0);
    hsv.y = clamp(hsv.y * max(0.0, 1.0 + acc.y), 0.0, 1.0);
    hsv.z = hsv.z * (1.0 + acc.z * 0.55 * sw);
    g = hsv2rgb(hsv);
  }

  vec3 lab = toOklab(s2l(g));
  float C = length(lab.yz);
  if (uSat != 0.0 || uVib != 0.0 || uDehaze > 0.0) {
    float skin = smoothstep(0.35, 0.0, abs(atan(lab.z, lab.y) - 0.95)) * step(0.0, lab.y);
    float vib = uVib * (1.0 - smoothstep(0.0, 0.22, C)) * (uVib > 0.0 ? 1.0 - 0.6 * skin : 1.0);
    float k = max(0.0, 1.0 + uSat + vib + max(uDehaze, 0.0) * 0.25);
    lab.yz *= k;
  }
  if (uGradOn > 0.5) {
    float L = lab.x;
    float ws = 1.0 - smoothstep(uPivot - uWidth, uPivot, L);
    float wh = smoothstep(uPivot, uPivot + uWidth, L);
    float wm = clamp(1.0 - ws - wh, 0.0, 1.0);
    lab.yz += ws * uGS.xy + wm * uGM.xy + wh * uGH.xy + uGG.xy;
    lab.x += ws * uGS.z + wm * uGM.z + wh * uGH.z + uGG.z;
  }
  g = clamp(l2s(fromOklab(lab)), 0.0, 1.0);

  if (uLutAmt > 0.0) {
    vec3 coord = g * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    g = mix(g, texture(uLut3, coord).rgb, uLutAmt);
  }
  outColor = vec4(g, 1.0);
}`;

/** Separable gaussian blur. */
export const BLUR_FS = `${COMMON}
uniform sampler2D uTex;
uniform vec2 uDir; // texel step * direction
uniform float uSigma;
void main() {
  float sigma = max(uSigma, 0.3);
  int n = int(min(ceil(sigma * 3.0), 24.0));
  vec3 acc = texture(uTex, vUv).rgb;
  float wsum = 1.0;
  for (int i = 1; i <= 24; i++) {
    if (i > n) break;
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    acc += (texture(uTex, vUv + uDir * float(i)).rgb + texture(uTex, vUv - uDir * float(i)).rgb) * w;
    wsum += 2.0 * w;
  }
  outColor = vec4(acc / wsum, 1.0);
}`;

/** 2x box downsample (4 bilinear taps = 4x4 box). */
export const DOWN_FS = `${COMMON}
uniform sampler2D uTex;
uniform vec2 uTexel; // source texel size
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`;

/** Detail (NR, texture, clarity, sharpen, defringe) + Lightroom-style local masks. */
export const FINISH_FS = `${COMMON}
uniform sampler2D uDev; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3;
uniform sampler2D uMaskA; uniform sampler2D uMaskB;
uniform float uTexture; uniform float uClarity;
uniform float uSharp; uniform float uSharpDetail; uniform float uSharpMask;
uniform float uNrL; uniform float uNrC; uniform float uDefringe;
uniform int uMaskCount;
uniform float uMOp[8];
uniform vec4 uL0[8]; // temp, tint, exposure, contrast
uniform vec4 uL1[8]; // highlights, shadows, whites, blacks
uniform vec4 uL2[8]; // texture, clarity, dehaze, hue(rad)
uniform vec4 uL3[8]; // saturation, sharpness, noise, colorAmt
uniform vec2 uL4[8]; // colour tint direction (oklab ab)

vec3 wbGain(float t, float u) {
  vec3 g = vec3(exp2(t * 0.55), exp2(-u * 0.35), exp2(-t * 0.55));
  return g / dot(g, LUMA);
}

vec3 local(vec3 c, vec3 b1, vec3 b2, vec3 b3, int i) {
  vec4 l0 = uL0[i]; vec4 l1 = uL1[i]; vec4 l2 = uL2[i]; vec4 l3 = uL3[i];
  // negative sharpness → blur (lens-blur look on backgrounds)
  if (l3.y < 0.0) {
    float k = -l3.y;
    vec3 soft = mix(b2, b3, clamp(k * 1.6 - 0.4, 0.0, 1.0));
    c = mix(c, soft, clamp(k * 1.8, 0.0, 1.0));
  }
  vec3 lin = s2l(c) * wbGain(l0.x, l0.y) * exp2(l0.z);
  if (l2.z > 0.0) lin = max(lin - vec3(0.06 * l2.z), 0.0) / (1.0 - 0.06 * l2.z);
  else if (l2.z < 0.0) lin = mix(lin, vec3(0.6), -l2.z * 0.3);
  vec3 g = l2s(lin);
  float Y = luma(g);
  float Yt = Y + l1.x * 0.22 * bell(Y, 0.78, 0.22) + l1.y * 0.22 * bell(Y, 0.22, 0.2)
               + l1.z * 0.15 * bell(Y, 1.0, 0.18) + l1.w * 0.12 * bell(Y, 0.0, 0.14);
  float z = clamp(Yt, 0.0, 1.0);
  float ex = l0.w >= 0.0 ? 1.0 + 1.1 * l0.w : 1.0 / (1.0 - 1.1 * l0.w);
  z = z < 0.5 ? 0.5 * pow(2.0 * z, ex) : 1.0 - 0.5 * pow(2.0 * (1.0 - z), ex);
  g = g * (z / max(Y, 1e-4));
  float Yb1 = luma(b1), Yb2 = luma(b2), Yb3 = luma(b3);
  float mid = 1.0 - abs(Y - 0.5) * 1.4;
  float d = l2.x * (Yb1 - Yb2) * 1.4 + l2.y * (Yb2 - Yb3) * (0.4 + 0.6 * mid) * 1.2;
  if (l3.y > 0.0) d += l3.y * clamp(Y - Yb1, -0.08, 0.08) * 3.0;
  if (l3.z > 0.0) d += (Yb1 - Y) * l3.z;
  g += d;
  vec3 lab = toOklab(s2l(max(g, 0.0)));
  float ca = cos(l2.w), sa = sin(l2.w);
  lab.yz = mat2(ca, sa, -sa, ca) * lab.yz;
  lab.yz *= max(0.0, 1.0 + l3.x + max(l2.z, 0.0) * 0.2);
  lab.yz += uL4[i] * l3.w;
  return clamp(l2s(fromOklab(lab)), 0.0, 1.0);
}

void main() {
  vec3 c = texture(uDev, vUv).rgb;
  vec3 b1 = texture(uB1, vUv).rgb;
  vec3 b2 = texture(uB2, vUv).rgb;
  vec3 b3 = texture(uB3, vUv).rgb;
  float Y = luma(c), Y1 = luma(b1), Y2 = luma(b2), Y3 = luma(b3);

  if (uNrL > 0.0) {
    float diff = abs(Y - Y1);
    float w = uNrL * (1.0 - smoothstep(0.012, 0.07, diff));
    float target = mix(Y1, Y2, clamp(uNrL - 0.5, 0.0, 0.5) * (1.0 - smoothstep(0.02, 0.1, abs(Y1 - Y2))));
    c += (target - Y) * w;
  }
  if (uNrC > 0.0) {
    vec3 lab = toOklab(s2l(c));
    vec3 lb = toOklab(s2l(b2));
    lab.yz = mix(lab.yz, lb.yz, uNrC);
    c = l2s(fromOklab(lab));
  }
  if (uDefringe > 0.0) {
    float edge = smoothstep(0.03, 0.15, length(c - b1) + abs(Y1 - Y2));
    vec3 lab = toOklab(s2l(c));
    float hue = atan(lab.z, lab.y);
    float purple = smoothstep(0.6, 0.0, abs(hue + 0.9)) + smoothstep(0.6, 0.0, abs(hue - 2.4));
    lab.yz *= 1.0 - clamp(purple * edge * uDefringe, 0.0, 0.9);
    c = l2s(fromOklab(lab));
  }
  Y = luma(c);
  float detail = 0.0;
  if (uTexture != 0.0) detail += uTexture * (Y1 - Y2) * 1.4;
  if (uClarity != 0.0) {
    float mid = 1.0 - abs(Y - 0.5) * 1.4;
    detail += uClarity * (Y2 - Y3) * (0.4 + 0.6 * mid) * 1.2;
  }
  if (uSharp > 0.0) {
    float e = Y - Y1;
    float lim = 0.015 + uSharpDetail * 0.12;
    e = clamp(e, -lim, lim);
    float m = uSharpMask > 0.0 ? smoothstep(uSharpMask * 0.08, uSharpMask * 0.08 + 0.02, abs(Y1 - Y2)) : 1.0;
    detail += uSharp * 2.6 * e * m;
  }
  c = clamp(c + detail, 0.0, 1.0);

  for (int i = 0; i < 8; i++) {
    if (i >= uMaskCount) break;
    float m = i < 4 ? texture(uMaskA, vUv)[i] : texture(uMaskB, vUv)[i - 4];
    m *= uMOp[i];
    if (m > 0.002) c = mix(c, local(c, b1, b2, b3, i), m);
  }
  outColor = vec4(c, 1.0);
}`;

/**
 * Geometry (crop, straighten, rotate, flip, distortion) + post-crop effects
 * (vignette, grain) + optional mask overlay / clipping warnings.
 */
export const PRESENT_FS = `${COMMON}
uniform sampler2D uImg;
uniform sampler2D uOverlay; uniform int uOverlayCh; uniform float uOverlayOn; uniform vec3 uOverlayColor;
uniform float uFlipY;
uniform vec4 uCrop;      // x, y, w, h in straightened frame (normalised)
uniform vec2 uFrame;     // frame size (after 90° rotation), px
uniform vec2 uSrcSize;   // source size, px
uniform float uAngle;    // straighten (rad)
uniform int uRot;        // 0..3 quarter turns
uniform vec2 uFlip;      // -1 or 1
uniform float uDistort;
uniform float uVigAmt; uniform float uVigMid; uniform float uVigRound; uniform float uVigFeather; uniform float uVigHi;
uniform float uGrain; uniform float uGrainSize; uniform float uGrainRough; uniform vec2 uOutSize; uniform float uSeed;
uniform float uClip;
uniform float uEffects;

vec2 toSource(vec2 uv) {
  vec2 q = uCrop.xy + uv * uCrop.zw;
  // lens distortion around crop centre
  if (uDistort != 0.0) {
    vec2 cc = uCrop.xy + 0.5 * uCrop.zw;
    vec2 d = (q - cc) * uFrame / max(uFrame.x, uFrame.y);
    float r2 = dot(d, d);
    q = cc + (q - cc) * (1.0 + uDistort * r2 * 1.2);
  }
  vec2 p = (q - 0.5) * uFrame;
  float ca = cos(-uAngle), sa = sin(-uAngle);
  p = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
  // undo quarter rotation (clockwise rot k → apply counter-clockwise k)
  for (int i = 0; i < 4; i++) {
    if (i >= uRot) break;
    p = vec2(p.y, -p.x);
  }
  p *= uFlip;
  return p / uSrcSize + 0.5;
}

void main() {
  vec2 uv = vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec2 s = toSource(uv);
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c = texture(uImg, s).rgb;

  if (uEffects > 0.5) {
    if (uVigAmt != 0.0) {
      vec2 d = (uv - 0.5) * 2.0;
      vec2 nrm = uOutSize / max(uOutSize.x, uOutSize.y);
      float rt = clamp(uVigRound * 0.5 + 0.5, 0.0, 1.0);
      vec2 e = mix(d, d * nrm, rt);
      float r = length(e) / length(mix(vec2(1.0), nrm, rt));
      float v = smoothstep(uVigMid, uVigMid + max(uVigFeather, 0.02), r);
      if (uVigAmt < 0.0) {
        float Y = luma(c);
        float protect = uVigHi * smoothstep(0.6, 1.0, Y);
        c *= 1.0 + uVigAmt * v * (1.0 - protect);
      } else {
        c = mix(c, vec3(1.0), uVigAmt * v * 0.85);
      }
    }
    if (uGrain > 0.0) {
      float scale = 900.0 / (0.6 + uGrainSize * 2.4);
      vec2 gp = uv * vec2(scale * uOutSize.x / max(uOutSize.x, uOutSize.y), scale * uOutSize.y / max(uOutSize.x, uOutSize.y)) + uSeed;
      float n = vnoise(gp) - 0.5;
      float n2 = vnoise(gp * 2.7 + 17.0) - 0.5;
      n = mix(n, n2, uGrainRough * 0.6) * 2.0;
      float Y = luma(c);
      c += n * uGrain * 0.16 * (0.35 + 0.65 * (1.0 - abs(Y - 0.45) * 1.6));
    }
  }
  c = clamp(c, 0.0, 1.0);
  if (uOverlayOn > 0.5) {
    float m = texture(uOverlay, s)[uOverlayCh];
    c = mix(c, uOverlayColor, m * 0.55);
  }
  if (uClip > 0.5) {
    if (max(c.r, max(c.g, c.b)) >= 0.995) c = vec3(1.0, 0.15, 0.2);
    else if (min(c.r, min(c.g, c.b)) <= 0.005) c = vec3(0.1, 0.35, 1.0);
  }
  outColor = vec4(c, 1.0);
}`;

/** Viewer: draws an image target into the canvas with zoom/pan and before/after split. */
export const VIEW_FS = `${COMMON}
uniform sampler2D uTex; uniform sampler2D uBefore;
uniform vec4 uRect;   // image rect in canvas px (x, y, w, h), top-left origin
uniform vec2 uCanvas; // canvas px
uniform float uSplit; // <0 = off, else split x in canvas px
uniform float uBeforeOnly;
uniform vec3 uBg;
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uCanvas;
  vec2 t = (px - uRect.xy) / uRect.zw;
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) { outColor = vec4(uBg, 1.0); return; }
  bool before = uBeforeOnly > 0.5 || (uSplit >= 0.0 && px.x < uSplit);
  vec3 c = before ? texture(uBefore, t).rgb : texture(uTex, t).rgb;
  if (uSplit >= 0.0 && abs(px.x - uSplit) < 1.0) c = vec3(1.0);
  outColor = vec4(c, 1.0);
}`;

/** Video compositor: places up to two graded clip layers into the frame with a transition. */
export const COMPOSITE_FS = `${COMMON}
uniform sampler2D uA; uniform sampler2D uB;
uniform vec4 uRA; uniform vec4 uRB; // layer rects in output uv (x, y, w, h)
uniform float uHasA;
uniform int uMode; uniform float uP;
uniform float uFlipY;
uniform vec3 uBgColor;
vec4 layer(sampler2D t, vec4 r, vec2 uv) {
  vec2 q = (uv - r.xy) / r.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(uBgColor, 0.0);
  return vec4(texture(t, q).rgb, 1.0);
}
void main() {
  vec2 uv = vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 b = layer(uB, uRB, uv);
  vec3 cb = b.a > 0.0 ? b.rgb : uBgColor;
  if (uHasA < 0.5 || uMode == 0) { outColor = vec4(cb, 1.0); return; }
  float p = clamp(uP, 0.0, 1.0);
  vec4 a = layer(uA, uRA, uv);
  vec3 ca = a.a > 0.0 ? a.rgb : uBgColor;
  vec3 c = cb;
  if (uMode == 1) c = mix(ca, cb, p);
  else if (uMode == 2) c = p < 0.5 ? mix(ca, vec3(0.0), p * 2.0) : mix(vec3(0.0), cb, p * 2.0 - 1.0);
  else if (uMode == 3) c = p < 0.5 ? mix(ca, vec3(1.0), p * 2.0) : mix(vec3(1.0), cb, p * 2.0 - 1.0);
  else if (uMode == 4) c = mix(ca, cb, smoothstep(p - 0.02, p + 0.02, 1.0 - uv.x) );
  else if (uMode == 5) {
    float e = p * p * (3.0 - 2.0 * p);
    vec4 aa = layer(uA, vec4(uRA.x - e, uRA.yzw), uv);
    vec4 bb = layer(uB, vec4(uRB.x + 1.0 - e, uRB.yzw), uv);
    c = bb.a > 0.0 ? bb.rgb : (aa.a > 0.0 ? aa.rgb : uBgColor);
  } else if (uMode == 6) {
    float z = 1.0 + p * 0.35;
    vec4 aa = layer(uA, vec4(0.5 + (uRA.xy - 0.5) * z, uRA.zw * z), uv);
    vec3 cz = aa.a > 0.0 ? aa.rgb : uBgColor;
    c = mix(cz, cb, smoothstep(0.2, 1.0, p));
  }
  outColor = vec4(c, 1.0);
}`;

/** Plain copy with optional flip (used for thumbnails/readback). */
export const COPY_FS = `${COMMON}
uniform sampler2D uTex; uniform float uFlipY;
void main() { vec2 uv = vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y); outColor = vec4(texture(uTex, uv).rgb, 1.0); }`;
