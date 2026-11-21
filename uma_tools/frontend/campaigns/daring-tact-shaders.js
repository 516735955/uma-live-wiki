// WebGL shaders, procedural glyph/lore atlases, and FBO helpers for Daring Tact Hero.

export const VERT_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAG_FLOW = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uMouse;
uniform vec2 uMouseVel;
uniform float uMouseActive;
uniform vec2 uPulsePos;
uniform float uPulseAmp;
uniform float uAspect;
uniform float uTime;
uniform float uAudio;

void main() {
  vec2 texel = vec2(1.0 / 128.0);
  vec4 c  = texture2D(uPrev, vUv);
  vec4 n  = texture2D(uPrev, vUv + vec2(0.0, texel.y));
  vec4 s  = texture2D(uPrev, vUv - vec2(0.0, texel.y));
  vec4 e  = texture2D(uPrev, vUv + vec2(texel.x, 0.0));
  vec4 w  = texture2D(uPrev, vUv - vec2(texel.x, 0.0));

  vec4 blurred = c * 0.58 + (n + s + e + w) * 0.105;
  vec2 vel = (blurred.rg - 0.5) * 2.0;
  float wake = blurred.b;
  float shock = blurred.a;

  vel *= 0.935;
  wake *= 0.948;
  shock *= 0.915;

  float wind = sin(vUv.y * 4.5 - uTime * 0.55) * (0.003 + uAudio * 0.006);
  vel.x += wind * 0.06;

  if (uMouseActive > 0.5) {
    vec2 diff = vUv - uMouse;
    diff.x *= uAspect;
    float d2 = dot(diff, diff);
    float splat = exp(-d2 * 30.0);
    vel += uMouseVel * splat * 0.95;
    wake = min(1.0, wake + splat * (0.30 + length(uMouseVel) * 1.1));
  }

  if (uPulseAmp > 0.001) {
    vec2 pdiff = vUv - uPulsePos;
    pdiff.x *= uAspect;
    float pdist = length(pdiff);
    float ring = exp(-pow((pdist - (1.0 - uPulseAmp) * 0.62) * 12.0, 2.0));
    vec2 dir = pdist > 0.001 ? pdiff / pdist : vec2(0.0, 1.0);
    vel += dir * ring * uPulseAmp * 0.7;
    shock = min(1.0, shock + ring * uPulseAmp * 0.95);
    wake = min(1.0, wake + ring * uPulseAmp * 0.55);
  }

  vel = clamp(vel, -1.0, 1.0);
  gl_FragColor = vec4(vel * 0.5 + 0.5, clamp(wake, 0.0, 1.0), clamp(shock, 0.0, 1.0));
}
`;

export const FRAG_MAIN = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPortrait;
uniform sampler2D uFlow;
uniform sampler2D uGlyphAtlas;
uniform sampler2D uLoreAtlas;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uTime;
uniform float uImageReady;
uniform float uReveal;
uniform float uAudio;
uniform float uRegaliaWave;
uniform float uCrownedMix;
uniform float uBannerMode;
uniform float uReducedMotion;

float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec2 portraitUv(vec2 uv, vec2 parallax) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float scaleY = aspect < 1.0 ? 0.90 : 0.92;
  float centerX = aspect < 1.0 ? 0.50 : 0.54;
  vec2 p = uv - vec2(centerX, 0.0) + parallax;
  p.x *= aspect;
  p /= scaleY;
  p.x += 0.5;
  p.y = 1.0 - p.y;
  return p;
}

vec4 samplePortraitSafe(vec2 pUv) {
  if (uBannerMode > 0.5 || uImageReady < 0.5 || pUv.x < 0.0 || pUv.x > 1.0 || pUv.y < 0.0 || pUv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(uPortrait, pUv);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float sampleGlyph(float idx, vec2 localUv) {
  float clamped = clamp(floor(idx), 0.0, 15.0);
  vec2 uv = vec2((clamped + clamp(localUv.x, 0.02, 0.98)) / 16.0, 1.0 - clamp(localUv.y, 0.02, 0.98));
  return texture2D(uGlyphAtlas, uv).r;
}

float sampleLoreGlyph(vec2 cellId, vec2 localUv, float scrollShift) {
  float col = mod(cellId.x + floor(scrollShift), 16.0);
  float row = mod(cellId.y, 6.0);
  vec2 uv = vec2(
    (col + clamp(localUv.x, 0.04, 0.96)) / 16.0,
    (row + (1.0 - clamp(localUv.y, 0.04, 0.96))) / 6.0
  );
  return texture2D(uLoreAtlas, uv).r;
}

void main() {
  vec2 fragPx = vUv * uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float motion = 1.0 - uReducedMotion;

  vec4 flow = texture2D(uFlow, vUv);
  vec2 vel = (flow.rg - 0.5) * 2.0;
  float wake = flow.b;
  float shock = flow.a;

  float flutePhase = vUv.x * 92.0 + uTime * 0.45 * motion;
  float flute = sin(flutePhase) * (0.004 + wake * 0.012 + uCrownedMix * 0.005);
  vec2 bgRefractUv = vUv - vel * (0.022 + wake * 0.018) - vec2(flute, 0.0);

  vec2 regaliaOrigin = vec2(0.84, 0.14);
  vec2 rDiff = vUv - regaliaOrigin;
  rDiff.x *= aspect;
  float rDist = length(rDiff);
  float regaliaRing = 0.0;
  if (uRegaliaWave > 0.001) {
    float waveRadius = (1.0 - uRegaliaWave) * 1.9;
    regaliaRing = exp(-pow((rDist - waveRadius) * 9.0, 2.0)) * uRegaliaWave;
  }

  vec3 colBaseDark   = mix(vec3(0.020, 0.032, 0.072), vec3(0.045, 0.075, 0.185), uCrownedMix);
  vec3 colBaseMid    = mix(vec3(0.055, 0.105, 0.215), vec3(0.115, 0.205, 0.445), uCrownedMix);
  vec3 colAccent     = mix(vec3(0.475, 0.776, 0.859), vec3(0.965, 0.792, 0.388), uCrownedMix);
  vec3 colSecondary  = mix(vec3(0.720, 0.930, 0.990), vec3(1.000, 0.945, 0.780), uCrownedMix);
  vec3 colPaperWhite = vec3(0.955, 0.985, 1.000);
  vec3 colTrueGold   = vec3(0.975, 0.815, 0.415);

  vec2 centerDiff = bgRefractUv - vec2(aspect < 0.85 ? 0.50 : 0.54, 0.48);
  centerDiff.x *= aspect;
  float radialDist = length(centerDiff);

  float bandA = sin((bgRefractUv.x * 11.0 + abs(bgRefractUv.y - 0.52) * 8.5) - uTime * 0.32 * motion);
  float bandB = cos((bgRefractUv.x * 5.5 - bgRefractUv.y * 9.0) + uTime * 0.20 * motion);
  float prismBeam = pow(max(0.0, sin(bgRefractUv.x * 24.0 + uTime * 0.28 * motion)), 4.0) * (0.14 + uCrownedMix * 0.26 + wake * 0.28);
  float aura = exp(-radialDist * 1.85) * (0.48 + uAudio * 0.20 + uCrownedMix * 0.32);

  float bgField = aura + (bandA * 0.5 + 0.5) * 0.11 + (bandB * 0.5 + 0.5) * 0.08 + prismBeam + wake * 0.26 + regaliaRing * 0.75;

  float ditherScale = max(1.0, floor(min(uResolution.x, uResolution.y) / 480.0));
  float bayerVal = bayer8(fragPx / (2.0 * ditherScale));
  float bgStep = floor(clamp(bgField, 0.0, 0.999) * 5.0 + bayerVal * 0.90) / 5.0;

  vec3 bgColor = mix(colBaseDark, colBaseMid, smoothstep(0.0, 0.52, bgStep));
  bgColor = mix(bgColor, colAccent * (0.52 + uCrownedMix * 0.32), smoothstep(0.46, 0.96, bgStep));

  float bgCellSize = max(12.0, floor(min(uResolution.x, uResolution.y) / 62.0));
  vec2 bgCellCoord = fragPx - vel * uResolution * 0.015;
  vec2 bgCellId = floor(bgCellCoord / bgCellSize);
  vec2 bgLocalUv = fract(bgCellCoord / bgCellSize);
  float bgScroll = floor(uTime * 0.32 * motion) + mod(bgCellId.y, 4.0) * 4.0;
  float bgLoreMask = sampleLoreGlyph(bgCellId, bgLocalUv, bgScroll);
  float bgLoreVis = clamp(
    0.08 + prismBeam * 0.75 + wake * 0.58 + regaliaRing * 0.95 + uAudio * 0.12 + uCrownedMix * 0.10,
    0.0,
    0.96
  );
  bgColor += mix(colAccent, colPaperWhite, wake * 0.45 + regaliaRing * 0.6) * bgLoreMask * bgLoreVis * 0.62;

  if (uBannerMode > 0.5) {
    float bannerVig = smoothstep(1.35, 0.25, radialDist);
    vec3 bCol = bgColor * mix(0.76, 1.08, bannerVig);
    bCol += colTrueGold * regaliaRing * 0.65;
    gl_FragColor = vec4(clamp(bCol, 0.0, 1.0), 1.0);
    return;
  }

  vec2 pointerOffset = (uMouse - 0.5) * vec2(-0.016, 0.010) * motion;
  float breathe = sin(uTime * 0.95 * motion) * 0.003;
  vec2 parallax = pointerOffset + vec2(0.0, breathe);

  float cellSize = max(6.0, floor(min(uResolution.x, uResolution.y) / 128.0));
  vec2 cellCenterUv = ((floor(fragPx / cellSize) + 0.5) * cellSize) / uResolution;
  vec2 localUv = fract(fragPx / cellSize);
  vec2 cellId = floor(fragPx / cellSize);

  vec2 pUvFine = portraitUv(vUv, parallax);
  vec2 pUvCell = portraitUv(cellCenterUv, parallax);

  vec4 rawFine = samplePortraitSafe(pUvFine);
  vec4 rawCell = samplePortraitSafe(pUvCell);

  float revealWave = clamp((uReveal * 1.32) - (vUv.y * 0.42 + radialDist * 0.20), 0.0, 1.0);
  float revealMask = step(bayerVal * 0.85, revealWave);
  float revealRidge = exp(-pow((revealWave - 0.5) * 9.5, 2.0)) * step(0.02, uReveal) * step(uReveal, 0.99);

  float alphaFine = smoothstep(0.15, 0.55, rawFine.a) * revealMask;
  float alphaCell = smoothstep(0.15, 0.55, rawCell.a) * revealMask;

  vec2 eStep = vec2(2.0 / 512.0);
  float aL = samplePortraitSafe(pUvFine + vec2(-eStep.x, 0.0)).a;
  float aR = samplePortraitSafe(pUvFine + vec2( eStep.x, 0.0)).a;
  float aU = samplePortraitSafe(pUvFine + vec2(0.0, -eStep.y)).a;
  float aD = samplePortraitSafe(pUvFine + vec2(0.0,  eStep.y)).a;
  float silhouetteRim = clamp((abs(aR - aL) + abs(aD - aU)) * 1.15, 0.0, 1.0) * revealMask;

  float prismShift = (0.002 + wake * 0.007 + regaliaRing * 0.012);
  float aShiftL = samplePortraitSafe(portraitUv(vUv - vec2(prismShift, 0.0), parallax)).a;
  float aShiftR = samplePortraitSafe(portraitUv(vUv + vec2(prismShift, 0.0), parallax)).a;
  float prismRim = clamp(abs(aShiftL - aShiftR), 0.0, 1.0) * revealMask;

  float fineLum = luma(rawFine.rgb);
  float cellLum = luma(rawCell.rgb);
  float maxC = max(rawFine.r, max(rawFine.g, rawFine.b));
  float minC = min(rawFine.r, min(rawFine.g, rawFine.b));
  float sat = maxC - minC;

  float cyanFeature = clamp(((rawFine.b * 0.95 + rawFine.g * 0.72) - rawFine.r * 1.48) * 1.9, 0.0, 1.0) * smoothstep(0.10, 0.28, sat);
  float goldFeature = smoothstep(0.24, 0.44, rawFine.r - rawFine.b) * smoothstep(0.18, 0.36, rawFine.g - rawFine.b) * smoothstep(0.30, 0.54, sat);

  float boostedLum = clamp(pow(fineLum, 0.94) * 1.06 + wake * 0.08 + uAudio * 0.03, 0.0, 0.999);
  float ditherStep = floor(boostedLum * 6.0 + (bayerVal - 0.5) * 0.85) / 6.0;

  float glyphIdx = clamp(pow(cellLum, 0.92) * 11.5 + 1.5, 1.0, 13.0);
  float densityGlyph = sampleGlyph(glyphIdx, localUv);

  float loreGlyph = sampleLoreGlyph(cellId, localUv, floor(uTime * 0.28 * motion));
  float wakeZone = smoothstep(0.12, 0.52, wake);
  float asciiMix = mix(densityGlyph, max(densityGlyph * 0.55, loreGlyph), clamp(wakeZone * 0.75 + regaliaRing * 0.85, 0.0, 0.9));

  vec3 figTone = mix(colBaseDark * 1.35, colBaseMid * 1.55, smoothstep(0.0, 0.34, ditherStep));
  figTone = mix(figTone, colAccent * 1.08, smoothstep(0.26, 0.64, ditherStep));
  figTone = mix(figTone, colPaperWhite, smoothstep(0.62, 0.98, ditherStep));

  vec3 eyeCyan = mix(vec3(0.42, 0.95, 1.00), vec3(0.62, 0.98, 1.00), uCrownedMix);
  figTone = mix(figTone, eyeCyan, clamp(cyanFeature * 1.85, 0.0, 0.95));
  figTone = mix(figTone, colTrueGold * 1.08, clamp(goldFeature * 1.9, 0.0, 0.98));

  float asciiWeight = mix(0.32, 0.58, clamp(wakeZone + regaliaRing, 0.0, 1.0));
  vec3 stylizedFigure = mix(figTone * 0.36, figTone * 1.12, mix(ditherStep * 0.35 + 0.65, asciiMix, asciiWeight));

  float lightSheen = wake * (0.18 + 0.14 * sin(vUv.x * 68.0 - uTime * 2.2 * motion));
  stylizedFigure += mix(colSecondary, colTrueGold, uCrownedMix * 0.75) * lightSheen;

  vec3 rimColor = mix(colAccent * 1.2, colTrueGold * 1.25, clamp(uCrownedMix * 0.88 + regaliaRing * 1.2 + wake * 0.35, 0.0, 1.0));
  stylizedFigure += rimColor * silhouetteRim * (0.55 + uCrownedMix * 0.35 + wake * 0.30);

  vec3 color = mix(bgColor, stylizedFigure, max(alphaFine * 0.95, alphaCell * 0.72));

  color += colAccent * prismRim * (0.45 + wake * 0.65);
  color += colTrueGold * prismRim * (uCrownedMix * 0.65 + regaliaRing * 0.95);
  color += mix(colAccent, colPaperWhite, 0.55) * revealRidge * alphaFine * 1.15;

  if (regaliaRing > 0.002) {
    color += mix(colTrueGold, colPaperWhite, 0.45) * regaliaRing * (0.55 + asciiMix * 0.65);
  }

  float vig = smoothstep(1.42, 0.32, radialDist);
  color *= mix(0.68, 1.04, vig);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export function createGlyphAtlasCanvas() {
  const glyphs = [" ", ".", ":", "∶", "-", "+", "×", "╱", "◇", "◈", "✧", "✦", "❖", "★", "▓", "█"];
  const tile = 64;
  const canvas = document.createElement("canvas");
  canvas.width = tile * glyphs.length;
  canvas.height = tile;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  glyphs.forEach((ch, idx) => {
    ctx.font = "700 42px sans-serif";
    ctx.fillText(ch, idx * tile + tile * 0.5, tile * 0.52);
  });
  return canvas;
}

export function createLoreAtlasCanvas() {
  const rows = [
    [..."DARING  TACT    "],
    [..."樱花赏  优骏牝马"],
    [..."秋华赏  无败三冠"],
    [..."襟裳荒野  山中修行"],
    [..."羊宫妃那  逃跑熊✦"],
    [..."勇敢之心  独立独步"],
  ];
  const tile = 64;
  const canvas = document.createElement("canvas");
  canvas.width = tile * 16;
  canvas.height = tile * rows.length;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  rows.forEach((chars, rowIdx) => {
    chars.slice(0, 16).forEach((ch, colIdx) => {
      ctx.font = "700 36px 'PingFang SC', 'Microsoft YaHei', sans-serif";
      ctx.fillText(ch, colIdx * tile + tile * 0.5, rowIdx * tile + tile * 0.53);
    });
  });
  return canvas;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("Shader compile failed: " + err);
  }
  return shader;
}

export function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error("Program link failed: " + err);
  }
  return prog;
}

export function createTexture(gl, source, { linear = true, flipY = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  if (source) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 0, 0]));
  }
  return tex;
}

export function createFlowFbo(gl, size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const initData = new Uint8Array(size * size * 4);
  for (let i = 0; i < initData.length; i += 4) {
    initData[i] = 128;
    initData[i + 1] = 128;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, initData);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex };
}
