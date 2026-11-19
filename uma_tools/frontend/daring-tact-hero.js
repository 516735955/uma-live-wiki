import {
  DARING_TACT_HERO_CONFIG,
  getDaringTactCrowned,
  setDaringTactCrowned,
  syncDaringTactBodyTheme,
  triggerDaringTactTransition,
} from "/uma_tools/frontend/hero-campaign.js";

let activeHeroInstances = 0;

// Strict chronological Triple Tiara sequence aligned with site Simplified Chinese terminology
const TRIPLE_TIARA_STARS = Object.freeze([
  {
    id: "ouka",
    step: 1,
    name: "樱花赏",
    year: "2020年4月",
    label: "樱花赏　2020年4月",
  },
  {
    id: "oaks",
    step: 2,
    name: "优骏牝马",
    year: "2020年5月",
    label: "优骏牝马　2020年5月",
  },
  {
    id: "shuuka",
    step: 3,
    name: "秋华赏",
    year: "2020年10月",
    label: "秋华赏　2020年10月",
  },
]);

const VERT_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Pass 1: Smooth Fluid Light-Wake Flowmap (drives background prism refraction & light bloom, NOT face melting)
const FRAG_FLOW = `
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

  // Gentle Erimo wind drift
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

// Pass 2: High-Contrast Editorial Print Bayer 8x8 + Parametric GPU ASCII + Architectural Glass Light
// Key principle: Zero uncanny face warping — portrait stays structurally dignified while fluid light,
// fluted glass refraction, ASCII typography, and dramatic uncrowned->crowned color shifts elevate the art.
const FRAG_MAIN = `
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
  float scaleY = aspect < 0.85 ? 0.76 : 0.92;
  float centerX = aspect < 0.85 ? 0.50 : 0.54;
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

  // Architectural fluted-glass vertical refraction ONLY for the background light field (zero face melting!)
  float flutePhase = vUv.x * 92.0 + uTime * 0.45 * motion;
  float flute = sin(flutePhase) * (0.004 + wake * 0.012 + uCrownedMix * 0.005);
  vec2 bgRefractUv = vUv - vel * (0.022 + wake * 0.018) - vec2(flute, 0.0);

  // Expanding golden-white Regalia shockwave when 3/3 Triple Tiara is achieved
  vec2 regaliaOrigin = vec2(0.84, 0.14);
  vec2 rDiff = vUv - regaliaOrigin;
  rDiff.x *= aspect;
  float rDist = length(rDiff);
  float regaliaRing = 0.0;
  if (uRegaliaWave > 0.001) {
    float waveRadius = (1.0 - uRegaliaWave) * 1.9;
    regaliaRing = exp(-pow((rDist - waveRadius) * 9.0, 2.0)) * uRegaliaWave;
  }

  // ===== PALETTE: DRAMATIC BEFORE (OBSIDIAN × ICE CYAN) vs AFTER (ROYAL COBALT × REGALIA GOLD) =====
  vec3 colBaseDark   = mix(vec3(0.020, 0.032, 0.072), vec3(0.045, 0.075, 0.185), uCrownedMix);
  vec3 colBaseMid    = mix(vec3(0.055, 0.105, 0.215), vec3(0.115, 0.205, 0.445), uCrownedMix);
  vec3 colAccent     = mix(vec3(0.475, 0.776, 0.859), vec3(0.965, 0.792, 0.388), uCrownedMix); // #79c6db -> Regalia Gold
  vec3 colSecondary  = mix(vec3(0.720, 0.930, 0.990), vec3(1.000, 0.945, 0.780), uCrownedMix);
  vec3 colPaperWhite = vec3(0.955, 0.985, 1.000);
  vec3 colTrueGold   = vec3(0.975, 0.815, 0.415);

  // ===== 1. EDITORIAL BACKGROUND: HIGH-CONTRAST NORMANDY PRISM + BAYER 8x8 + LORE ASCII =====
  vec2 centerDiff = bgRefractUv - vec2(aspect < 0.85 ? 0.50 : 0.54, 0.48);
  centerDiff.x *= aspect;
  float radialDist = length(centerDiff);

  // Diagonal Normandy silk bands + fluted glass light columns
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

  // Background hidden Simplified-Chinese & English Daring Tact Lore ASCII Matrix
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

  // If banner mode (character detail page continuation), output atmospheric editorial shader directly
  if (uBannerMode > 0.5) {
    float bannerVig = smoothstep(1.35, 0.25, radialDist);
    vec3 bCol = bgColor * mix(0.76, 1.08, bannerVig);
    bCol += colTrueGold * regaliaRing * 0.65;
    gl_FragColor = vec4(clamp(bCol, 0.0, 1.0), 1.0);
    return;
  }

  // ===== 2. DARING TACT EDITORIAL PORTRAIT: ROCK-SOLID GEOMETRY, ZERO UNCANNY FACE WARP =====
  vec2 pointerOffset = (uMouse - 0.5) * vec2(-0.016, 0.010) * motion;
  float breathe = sin(uTime * 0.95 * motion) * 0.003;
  vec2 parallax = pointerOffset + vec2(0.0, breathe);

  // Ultra-fine cell grid so face & expression read with crisp editorial print clarity
  float cellSize = max(6.0, floor(min(uResolution.x, uResolution.y) / 128.0));
  vec2 cellCenterUv = ((floor(fragPx / cellSize) + 0.5) * cellSize) / uResolution;
  vec2 localUv = fract(fragPx / cellSize);
  vec2 cellId = floor(fragPx / cellSize);

  // Portrait UVs do NOT get melted by fluid velocity! Only a tiny subtle prism edge shimmer at high wake.
  vec2 pUvFine = portraitUv(vUv, parallax);
  vec2 pUvCell = portraitUv(cellCenterUv, parallax);

  vec4 rawFine = samplePortraitSafe(pUvFine);
  vec4 rawCell = samplePortraitSafe(pUvCell);

  // 1.15s Progressive Bayer Dither Decode Sweep on image load
  float revealWave = clamp((uReveal * 1.32) - (vUv.y * 0.42 + radialDist * 0.20), 0.0, 1.0);
  float revealMask = step(bayerVal * 0.85, revealWave);
  float revealRidge = exp(-pow((revealWave - 0.5) * 9.5, 2.0)) * step(0.02, uReveal) * step(uReveal, 0.99);

  float alphaFine = smoothstep(0.15, 0.55, rawFine.a) * revealMask;
  float alphaCell = smoothstep(0.15, 0.55, rawCell.a) * revealMask;

  // OUTER SILHOUETTE RIM ONLY (alpha-channel gradient — zero creepy inner-face neon lines!)
  vec2 eStep = vec2(2.0 / 512.0);
  float aL = samplePortraitSafe(pUvFine + vec2(-eStep.x, 0.0)).a;
  float aR = samplePortraitSafe(pUvFine + vec2( eStep.x, 0.0)).a;
  float aU = samplePortraitSafe(pUvFine + vec2(0.0, -eStep.y)).a;
  float aD = samplePortraitSafe(pUvFine + vec2(0.0,  eStep.y)).a;
  float silhouetteRim = clamp((abs(aR - aL) + abs(aD - aU)) * 1.15, 0.0, 1.0) * revealMask;

  // Chromatic prism rim ONLY along outer silhouette when mouse wake passes near
  float prismShift = (0.002 + wake * 0.007 + regaliaRing * 0.012);
  float aShiftL = samplePortraitSafe(portraitUv(vUv - vec2(prismShift, 0.0), parallax)).a;
  float aShiftR = samplePortraitSafe(portraitUv(vUv + vec2(prismShift, 0.0), parallax)).a;
  float prismRim = clamp(abs(aShiftL - aShiftR), 0.0, 1.0) * revealMask;

  // Clean tonal & feature extraction
  float fineLum = luma(rawFine.rgb);
  float cellLum = luma(rawCell.rgb);
  float maxC = max(rawFine.r, max(rawFine.g, rawFine.b));
  float minC = min(rawFine.r, min(rawFine.g, rawFine.b));
  float sat = maxC - minC;

  // Signature cyan eyes & Normandy ribbons
  float cyanFeature = clamp(((rawFine.b * 0.95 + rawFine.g * 0.72) - rawFine.r * 1.48) * 1.9, 0.0, 1.0) * smoothstep(0.10, 0.28, sat);
  // True golden 3-star hairpin & collar trim
  float goldFeature = smoothstep(0.24, 0.44, rawFine.r - rawFine.b) * smoothstep(0.18, 0.36, rawFine.g - rawFine.b) * smoothstep(0.30, 0.54, sat);

  // High-contrast Editorial Risograph-Bayer 6-stop quantization (sculptural, crisp, zero muddiness)
  float boostedLum = clamp(pow(fineLum, 0.94) * 1.06 + wake * 0.08 + uAudio * 0.03, 0.0, 0.999);
  float ditherStep = floor(boostedLum * 6.0 + (bayerVal - 0.5) * 0.85) / 6.0;

  // Geometric/astral ASCII glyph layer (clean, crisp, never turns face into harsh blocks)
  float glyphIdx = clamp(pow(cellLum, 0.92) * 11.5 + 1.5, 1.0, 13.0);
  float densityGlyph = sampleGlyph(glyphIdx, localUv);

  // Secret lore ASCII shines gently inside bright coat regions & cursor light-prism wake!
  float loreGlyph = sampleLoreGlyph(cellId, localUv, floor(uTime * 0.28 * motion));
  float wakeZone = smoothstep(0.12, 0.52, wake);
  float asciiMix = mix(densityGlyph, max(densityGlyph * 0.55, loreGlyph), clamp(wakeZone * 0.75 + regaliaRing * 0.85, 0.0, 0.9));

  // Editorial duotone/tritone print palette (Uncrowned: Ink/Cyan/White -> Crowned: Royal/Gold/Pure White)
  vec3 figTone = mix(colBaseDark * 1.35, colBaseMid * 1.55, smoothstep(0.0, 0.34, ditherStep));
  figTone = mix(figTone, colAccent * 1.08, smoothstep(0.26, 0.64, ditherStep));
  figTone = mix(figTone, colPaperWhite, smoothstep(0.62, 0.98, ditherStep));

  // Preserve luminous cyan eyes & ribbons (shifted subtly warmer-diamond when crowned)
  vec3 eyeCyan = mix(vec3(0.42, 0.95, 1.00), vec3(0.62, 0.98, 1.00), uCrownedMix);
  figTone = mix(figTone, eyeCyan, clamp(cyanFeature * 1.85, 0.0, 0.95));
  // Preserve golden 3-star hairpin & gold trim (always radiates true gold!)
  figTone = mix(figTone, colTrueGold * 1.08, clamp(goldFeature * 1.9, 0.0, 0.98));

  // Blend crisp Bayer tonal sculpture (62%) with razor-sharp ASCII texture (38% -> boosted to 60% in cursor light-prism wake!)
  float asciiWeight = mix(0.32, 0.58, clamp(wakeZone + regaliaRing, 0.0, 1.0));
  vec3 stylizedFigure = mix(figTone * 0.36, figTone * 1.12, mix(ditherStep * 0.35 + 0.65, asciiMix, asciiWeight));

  // Luminous light-prism sheen across her figure where cursor glides (pure light, zero distortion!)
  float lightSheen = wake * (0.18 + 0.14 * sin(vUv.x * 68.0 - uTime * 2.2 * motion));
  stylizedFigure += mix(colSecondary, colTrueGold, uCrownedMix * 0.75) * lightSheen;

  // Clean outer silhouette rim-light + subtle glass prism fringe
  vec3 rimColor = mix(colAccent * 1.2, colTrueGold * 1.25, clamp(uCrownedMix * 0.88 + regaliaRing * 1.2 + wake * 0.35, 0.0, 1.0));
  stylizedFigure += rimColor * silhouetteRim * (0.55 + uCrownedMix * 0.35 + wake * 0.30);

  vec3 color = mix(bgColor, stylizedFigure, max(alphaFine * 0.95, alphaCell * 0.72));

  // Outer silhouette glass-prism chromatic fringe
  color += colAccent * prismRim * (0.45 + wake * 0.65);
  color += colTrueGold * prismRim * (uCrownedMix * 0.65 + regaliaRing * 0.95);

  // Decode scanline sweep on load
  color += mix(colAccent, colPaperWhite, 0.55) * revealRidge * alphaFine * 1.15;

  // Dramatic full-screen golden-white Regalia shockwave when 3/3 is unlocked
  if (regaliaRing > 0.002) {
    color += mix(colTrueGold, colPaperWhite, 0.45) * regaliaRing * (0.55 + asciiMix * 0.65);
  }

  // Editorial contrast vignette
  float vig = smoothstep(1.42, 0.32, radialDist);
  color *= mix(0.68, 1.04, vig);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function createGlyphAtlasCanvas() {
  const glyphs = [" ", "·", ":", "∶", "-", "+", "×", "╱", "◇", "◈", "✧", "✦", "❖", "★", "▓", "█"];
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
    const cx = idx * tile + tile * 0.5;
    const cy = tile * 0.52;
    ctx.font = "700 42px sans-serif";
    ctx.fillText(ch, cx, cy);
  });
  return canvas;
}

function createLoreAtlasCanvas() {
  // 6-row authentic Daring Tact + Yomiya Hina lore in Simplified Chinese + English (16 chars/row, zero middle dots)
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
      const cx = colIdx * tile + tile * 0.5;
      const cy = rowIdx * tile + tile * 0.53;
      ctx.font = "700 36px 'PingFang SC', 'Microsoft YaHei', sans-serif";
      ctx.fillText(ch, cx, cy);
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

function createProgram(gl, vertSrc, fragSrc) {
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

function createTexture(gl, source, { linear = true, flipY = false } = {}) {
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
    const empty = new Uint8Array([128, 128, 0, 0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
  }
  return tex;
}

function createFlowFbo(gl, size) {
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
    initData[i + 2] = 0;
    initData[i + 3] = 0;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, initData);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex };
}

export const DaringTactHero = {
  name: "DaringTactHero",
  props: {
    mode: { type: String, default: "hero" }, // "hero" (homepage) | "banner" (character detail continuation)
  },
  emits: ["open-character"],
  data() {
    const restoredCrowned = getDaringTactCrowned();
    return {
      stars: TRIPLE_TIARA_STARS,
      litCount: restoredCrowned ? 3 : 0,
      hoveredStar: null,
      shakeStarId: null,
      imageReady: false,
      audioPlaying: false,
      crowned: restoredCrowned,
      pointerDownPos: null,
    };
  },
  computed: {
    isBanner() {
      return this.mode === "banner";
    },
    activeStarText() {
      if (this.crowned) return "无败牝马三冠";
      if (this.hoveredStar) return this.hoveredStar.label;
      if (this.litCount > 0) return this.stars[this.litCount - 1].label;
      return this.stars[0].name;
    },
  },
  mounted() {
    this._destroyed = false;
    activeHeroInstances += 1;
    syncDaringTactBodyTheme(this.isBanner ? "detail" : "home");
    this._reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this._mouse = { x: 0.54, y: 0.5, tx: 0.54, ty: 0.5, vx: 0, vy: 0, active: 0 };
    this._pulse = { x: 0.54, y: 0.5, amp: 0 };
    this._regaliaWave = 0;
    this._crownedMix = this.crowned ? 1 : 0;
    this._reveal = this.isBanner ? 1 : 0;
    this._revealStart = 0;
    this._audioEnergy = 0;
    this._easterFlurry = 0;
    this._lastFrameTs = performance.now();
    this._particles = [];

    this.initParticles();
    this.initRenderer();
    if (!this.isBanner) {
      this.loadStandeeProgressive();
    } else {
      this.imageReady = true;
    }
    this.bindEvents();
    this.startLoop();
  },
  beforeUnmount() {
    this._destroyed = true;
    activeHeroInstances = Math.max(0, activeHeroInstances - 1);
    if (activeHeroInstances === 0) {
      syncDaringTactBodyTheme("none");
    }
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("keydown", this._onKeyDown);
    if (this._gl) {
      const loseExt = this._gl.getExtension("WEBGL_lose_context");
      if (loseExt) loseExt.loseContext();
    }
  },
  methods: {
    isStarLit(index) {
      return index < this.litCount;
    },
    isStarNext(index) {
      return !this.crowned && index === this.litCount;
    },
    isStarLocked(index) {
      return index > this.litCount;
    },

    bindEvents() {
      this._onResize = () => this.resizeCanvases();
      this._onKeyDown = (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = (event.target && event.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const key = (event.key || "").toLowerCase();
        // Hidden Yomiya Hina (Y) / Runaway Bear (B) sakura & bear starlight flurry easter egg
        if (key === "y" || key === "b") {
          this._easterFlurry = 1.0;
          this._pulse = { x: 0.54, y: 0.48, amp: 0.92 };
        }
      };
      window.addEventListener("resize", this._onResize, { passive: true });
      window.addEventListener("keydown", this._onKeyDown);
      if (typeof ResizeObserver !== "undefined" && this.$refs.stage) {
        this._resizeObserver = new ResizeObserver(() => this.resizeCanvases());
        this._resizeObserver.observe(this.$refs.stage);
      }
      this.resizeCanvases();
    },

    resizeCanvases() {
      const stage = this.$refs.stage;
      const glCanvas = this.$refs.glCanvas;
      const pCanvas = this.$refs.particlesCanvas;
      if (!stage || !glCanvas || !pCanvas) return;

      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

      glCanvas.width = Math.max(1, Math.floor(width * dpr));
      glCanvas.height = Math.max(1, Math.floor(height * dpr));
      pCanvas.width = Math.max(1, Math.floor(width * dpr));
      pCanvas.height = Math.max(1, Math.floor(height * dpr));

      this._stageRect = { width, height, dpr };
      if (this._gl) {
        this._gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      } else if (this._fallbackCtx && this._loadedImage && !this.isBanner) {
        this.renderCanvas2DFallback();
      }
    },

    initRenderer() {
      const canvas = this.$refs.glCanvas;
      if (!canvas) return;
      let gl = null;
      try {
        const opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" };
        gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
      } catch (_) {
        gl = null;
      }

      if (!gl) {
        this._fallbackCtx = canvas.getContext("2d");
        return;
      }

      try {
        this._gl = gl;
        this._flowProg = createProgram(gl, VERT_QUAD, FRAG_FLOW);
        this._mainProg = createProgram(gl, VERT_QUAD, FRAG_MAIN);

        const quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        this._quadBuf = quadBuf;

        this._fboA = createFlowFbo(gl, 128);
        this._fboB = createFlowFbo(gl, 128);
        this._fboPing = true;

        this._portraitTex = createTexture(gl, null, { linear: true });
        this._glyphTex = createTexture(gl, createGlyphAtlasCanvas(), { linear: true });
        this._loreTex = createTexture(gl, createLoreAtlasCanvas(), { linear: true });

        this._flowLoc = {
          aPos: gl.getAttribLocation(this._flowProg, "aPos"),
          uPrev: gl.getUniformLocation(this._flowProg, "uPrev"),
          uMouse: gl.getUniformLocation(this._flowProg, "uMouse"),
          uMouseVel: gl.getUniformLocation(this._flowProg, "uMouseVel"),
          uMouseActive: gl.getUniformLocation(this._flowProg, "uMouseActive"),
          uPulsePos: gl.getUniformLocation(this._flowProg, "uPulsePos"),
          uPulseAmp: gl.getUniformLocation(this._flowProg, "uPulseAmp"),
          uAspect: gl.getUniformLocation(this._flowProg, "uAspect"),
          uTime: gl.getUniformLocation(this._flowProg, "uTime"),
          uAudio: gl.getUniformLocation(this._flowProg, "uAudio"),
        };

        this._mainLoc = {
          aPos: gl.getAttribLocation(this._mainProg, "aPos"),
          uPortrait: gl.getUniformLocation(this._mainProg, "uPortrait"),
          uFlow: gl.getUniformLocation(this._mainProg, "uFlow"),
          uGlyphAtlas: gl.getUniformLocation(this._mainProg, "uGlyphAtlas"),
          uLoreAtlas: gl.getUniformLocation(this._mainProg, "uLoreAtlas"),
          uResolution: gl.getUniformLocation(this._mainProg, "uResolution"),
          uMouse: gl.getUniformLocation(this._mainProg, "uMouse"),
          uTime: gl.getUniformLocation(this._mainProg, "uTime"),
          uImageReady: gl.getUniformLocation(this._mainProg, "uImageReady"),
          uReveal: gl.getUniformLocation(this._mainProg, "uReveal"),
          uAudio: gl.getUniformLocation(this._mainProg, "uAudio"),
          uRegaliaWave: gl.getUniformLocation(this._mainProg, "uRegaliaWave"),
          uCrownedMix: gl.getUniformLocation(this._mainProg, "uCrownedMix"),
          uBannerMode: gl.getUniformLocation(this._mainProg, "uBannerMode"),
          uReducedMotion: gl.getUniformLocation(this._mainProg, "uReducedMotion"),
        };
      } catch (err) {
        console.warn("[DaringTactHero] WebGL fallback activated:", err);
        this._gl = null;
        this._fallbackCtx = canvas.getContext("2d");
      }
    },

    loadStandeeProgressive() {
      const img = new Image();
      img.decoding = "async";
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (this._destroyed) return;
        this._loadedImage = img;
        if (this._gl && this._portraitTex) {
          const gl = this._gl;
          gl.bindTexture(gl.TEXTURE_2D, this._portraitTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } else if (this._fallbackCtx) {
          this.renderCanvas2DFallback();
        }
        this.imageReady = true;
        this._revealStart = performance.now();
        this._pulse = { x: 0.54, y: 0.45, amp: 0.55 };
      };
      img.onerror = () => {
        if (!img.dataset.retried) {
          img.dataset.retried = "1";
          setTimeout(() => {
            if (!this._destroyed) img.src = DARING_TACT_HERO_CONFIG.imageUrl + "?retry=1";
          }, 1200);
        }
      };
      img.src = DARING_TACT_HERO_CONFIG.imageUrl;
    },

    renderCanvas2DFallback() {
      const ctx = this._fallbackCtx;
      const canvas = this.$refs.glCanvas;
      const img = this._loadedImage;
      if (!ctx || !canvas || !img) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = this.crowned ? "#0e1d44" : "#070c1a";
      ctx.fillRect(0, 0, w, h);

      const off = document.createElement("canvas");
      const cols = Math.min(116, Math.max(58, Math.floor(w / 10)));
      const rows = Math.max(38, Math.floor(cols * (h / w) * 0.62));
      off.width = cols;
      off.height = rows;
      const octx = off.getContext("2d");
      const size = Math.min(cols, rows * 1.45);
      octx.drawImage(img, (cols - size) * 0.54, rows - size * 0.96, size, size);
      const data = octx.getImageData(0, 0, cols, rows).data;
      const ramp = " ·:∶-+×◇◈✧✦❖★";
      const cellW = w / cols;
      const cellH = h / rows;
      ctx.font = `700 ${Math.max(8, Math.floor(cellH * 0.92))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = (y * cols + x) * 4;
          const a = data[i + 3] / 255;
          if (a < 0.18) continue;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          const ch = ramp[Math.min(ramp.length - 1, Math.floor(lum * (ramp.length - 1)) + 1)];
          if (this.crowned) {
            ctx.fillStyle = lum > 0.72 ? "#fff8e4" : lum > 0.42 ? "#f5c556" : "#3a5eb0";
          } else {
            ctx.fillStyle = lum > 0.72 ? "#f2fbff" : lum > 0.42 ? "#79c6db" : "#24437a";
          }
          ctx.fillText(ch, (x + 0.5) * cellW, (y + 0.5) * cellH);
        }
      }
    },

    initParticles() {
      const particles = [];
      const starCount = this.isBanner ? 22 : 36;
      const leafCount = this.isBanner ? 8 : 13;
      const petalCount = this.isBanner ? 8 : 14;
      const bearCount = this.isBanner ? 2 : 3;

      for (let i = 0; i < starCount; i += 1) {
        particles.push({
          kind: "star",
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.35) * 0.016,
          vy: -0.008 - Math.random() * 0.015,
          size: 2.0 + Math.random() * 3.8,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.25 + Math.random() * 0.55,
        });
      }
      // Erimo wilderness wind-blown leaves
      for (let i = 0; i < leafCount; i += 1) {
        particles.push({
          kind: "leaf",
          x: Math.random(),
          y: Math.random(),
          vx: 0.014 + Math.random() * 0.020,
          vy: 0.005 + Math.random() * 0.013,
          size: 5.0 + Math.random() * 6.0,
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 1.4,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.22 + Math.random() * 0.32,
        });
      }
      // Pure White Shirotae Sakura petals (unlocks at Star 1 樱花赏 or Y/B flurry)
      for (let i = 0; i < petalCount; i += 1) {
        particles.push({
          kind: "petal",
          x: Math.random(),
          y: Math.random(),
          vx: 0.010 + Math.random() * 0.018,
          vy: 0.012 + Math.random() * 0.016,
          size: 4.5 + Math.random() * 4.5,
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 1.8,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.36 + Math.random() * 0.42,
        });
      }
      // Minimalist Yomiya Hina hand-drawn bear constellation silhouette (unlocks at 3/3 Crowned or Y/B flurry)
      for (let i = 0; i < bearCount; i += 1) {
        particles.push({
          kind: "bear",
          x: 0.12 + Math.random() * 0.76,
          y: 0.15 + Math.random() * 0.65,
          vx: (Math.random() - 0.45) * 0.012,
          vy: -0.006 - Math.random() * 0.008,
          size: 11 + Math.random() * 5,
          angle: (Math.random() - 0.5) * 0.28,
          spin: (Math.random() - 0.5) * 0.25,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.38 + Math.random() * 0.28,
        });
      }
      this._particles = particles;
    },

    sampleAudioState(nowSec) {
      let playing = false;
      let trackTime = nowSec;
      const app = window.__uma_app;
      const pState = app && (app.player || app.audio);
      if (pState && (pState.playing || pState.status === "playing")) {
        playing = true;
        trackTime = Number(pState.currentTime) || nowSec;
      } else {
        const audios = document.querySelectorAll("audio");
        for (let i = 0; i < audios.length; i += 1) {
          if (!audios[i].paused && !audios[i].ended && audios[i].currentTime > 0) {
            playing = true;
            trackTime = audios[i].currentTime;
            break;
          }
        }
      }
      if (this.audioPlaying !== playing) {
        this.audioPlaying = playing;
      }
      const targetEnergy = playing
        ? 0.42 + 0.32 * Math.sin(trackTime * 6.28318 * 1.95) * Math.sin(trackTime * 6.28318 * 0.48) + 0.16 * Math.cos(trackTime * 11.4)
        : 0;
      this._audioEnergy += (Math.max(0, targetEnergy) - this._audioEnergy) * 0.08;
    },

    stepParticles(dt, nowSec) {
      const canvas = this.$refs.particlesCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const dpr = (this._stageRect && this._stageRect.dpr) || 1;
      ctx.clearRect(0, 0, w, h);

      if (this._reducedMotion) return;

      const mx = this._mouse.x;
      const my = 1.0 - this._mouse.y;
      const mvx = this._mouse.vx;
      const mvy = -this._mouse.vy;
      const oaksWind = this.litCount >= 2 ? 0.35 : 0;
      const boost = 1 + oaksWind + this._audioEnergy * 0.85 + this._regaliaWave * 2.4 + this._crownedMix * 0.35 + this._easterFlurry * 1.6;

      for (let i = 0; i < this._particles.length; i += 1) {
        const p = this._particles[i];
        // Gate sakura petals to Star 1 (樱花赏) or Y/B flurry; bear silhouettes to 3/3 Crowned or Y/B flurry
        if (p.kind === "petal" && this.litCount < 1 && this._easterFlurry < 0.05) continue;
        if (p.kind === "bear" && !this.crowned && this._easterFlurry < 0.05) continue;

        const dx = p.x - mx;
        const dy = p.y - my;
        const distSq = dx * dx + dy * dy;
        if (this._mouse.active > 0.2 && distSq < 0.032) {
          const force = (1 - distSq / 0.032) * 0.05;
          p.x += (mvx * 0.20 + dx * force) * dt * 9;
          p.y += (mvy * 0.20 + dy * force) * dt * 9;
        }

        p.x += (p.vx + Math.sin(nowSec * 0.85 + p.phase) * 0.007) * dt * boost;
        p.y += (p.vy + Math.cos(nowSec * 0.65 + p.phase) * 0.005) * dt * boost;
        if (p.kind !== "star") p.angle += p.spin * dt * boost;

        if (p.x > 1.06) p.x = -0.05;
        if (p.x < -0.06) p.x = 1.05;
        if (p.y > 1.06) p.y = -0.05;
        if (p.y < -0.06) p.y = 1.05;

        const px = p.x * w;
        const py = p.y * h;
        const twinkle = 0.55 + 0.45 * Math.sin(nowSec * 2.4 + p.phase);
        const alpha = Math.min(1, p.alpha * twinkle * (1 + this._regaliaWave * 1.1 + this._crownedMix * 0.45 + this._audioEnergy * 0.3 + this._easterFlurry * 0.7));
        const goldMode = this._crownedMix > 0.45 || this._regaliaWave > 0.12;

        ctx.save();
        ctx.translate(px, py);
        if (p.kind === "star") {
          const r = p.size * dpr * (1 + this._crownedMix * 0.35 + this._regaliaWave * 0.55);
          ctx.fillStyle = goldMode
            ? `rgba(255, 224, 138, ${alpha.toFixed(3)})`
            : `rgba(166, 232, 250, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.quadraticCurveTo(0, 0, 0, r);
          ctx.quadraticCurveTo(0, 0, -r, 0);
          ctx.quadraticCurveTo(0, 0, 0, -r);
          ctx.fill();
        } else if (p.kind === "leaf") {
          const len = p.size * dpr * (1 + this._crownedMix * 0.2);
          ctx.rotate(p.angle);
          ctx.strokeStyle = goldMode
            ? `rgba(248, 210, 118, ${(alpha * 0.9).toFixed(3)})`
            : `rgba(121, 198, 219, ${(alpha * 0.78).toFixed(3)})`;
          ctx.fillStyle = goldMode
            ? `rgba(248, 210, 118, ${(alpha * 0.28).toFixed(3)})`
            : `rgba(121, 198, 219, ${(alpha * 0.16).toFixed(3)})`;
          ctx.lineWidth = 1.1 * dpr;
          ctx.beginPath();
          ctx.moveTo(-len, 0);
          ctx.quadraticCurveTo(0, -len * 0.52, len, 0);
          ctx.quadraticCurveTo(0, len * 0.52, -len, 0);
          ctx.fill();
          ctx.stroke();
        } else if (p.kind === "petal") {
          // Pure White Shirotae Sakura petal (纯洁的白妙樱)
          const r = p.size * dpr;
          ctx.rotate(p.angle);
          ctx.fillStyle = goldMode
            ? `rgba(255, 244, 228, ${(alpha * 0.82).toFixed(3)})`
            : `rgba(245, 251, 255, ${(alpha * 0.85).toFixed(3)})`;
          ctx.strokeStyle = `rgba(255, 214, 228, ${(alpha * 0.55).toFixed(3)})`;
          ctx.lineWidth = 0.9 * dpr;
          ctx.beginPath();
          ctx.moveTo(0, r * 0.8);
          ctx.bezierCurveTo(-r * 0.85, r * 0.2, -r * 0.75, -r * 0.85, -r * 0.18, -r * 0.75);
          ctx.lineTo(0, -r * 0.42);
          ctx.lineTo(r * 0.18, -r * 0.75);
          ctx.bezierCurveTo(r * 0.75, -r * 0.85, r * 0.85, r * 0.2, 0, r * 0.8);
          ctx.fill();
          ctx.stroke();
        } else if (p.kind === "bear") {
          // Minimalist calligraphic Yomiya Hina hand-drawn bear silhouette (羊宫小熊 / 逃跑熊)
          const r = p.size * dpr;
          ctx.rotate(Math.sin(nowSec * 1.1 + p.phase) * 0.14 + p.angle);
          ctx.strokeStyle = goldMode
            ? `rgba(255, 228, 156, ${(alpha * 0.88).toFixed(3)})`
            : `rgba(166, 232, 250, ${(alpha * 0.82).toFixed(3)})`;
          ctx.lineWidth = 1.2 * dpr;
          // Left & right round ears
          ctx.beginPath();
          ctx.arc(-r * 0.58, -r * 0.58, r * 0.28, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(r * 0.58, -r * 0.58, r * 0.28, 0, Math.PI * 2);
          ctx.stroke();
          // Head outline
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
          ctx.stroke();
          // Minimal dot eyes & tiny smile
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.arc(-r * 0.24, -r * 0.08, r * 0.08, 0, Math.PI * 2);
          ctx.arc(r * 0.24, -r * 0.08, r * 0.08, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(0, r * 0.14, r * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
        }
        ctx.restore();
      }
    },

    startLoop() {
      const render = (now) => {
        if (this._destroyed) return;
        this._rafId = requestAnimationFrame(render);

        const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameTs) / 1000));
        this._lastFrameTs = now;
        const nowSec = now * 0.001;

        this.sampleAudioState(nowSec);

        const prevX = this._mouse.x;
        const prevY = this._mouse.y;
        this._mouse.x += (this._mouse.tx - this._mouse.x) * 0.12;
        this._mouse.y += (this._mouse.ty - this._mouse.y) * 0.12;
        this._mouse.vx = (this._mouse.x - prevX) * 12.0;
        this._mouse.vy = (this._mouse.y - prevY) * 12.0;
        this._mouse.active = Math.max(0, this._mouse.active - dt * 0.45);

        const stage = this.$refs.stage;
        if (stage && !this._reducedMotion && !this.isBanner) {
          const px = ((this._mouse.x - 0.5) * -14).toFixed(2);
          const py = ((0.5 - this._mouse.y) * -10).toFixed(2);
          stage.style.setProperty("--dt-px", px + "px");
          stage.style.setProperty("--dt-py", py + "px");
        }

        if (!this.isBanner && this.imageReady && this._reveal < 1) {
          const elapsed = (now - this._revealStart) / 1150;
          this._reveal = this._reducedMotion ? 1 : Math.min(1, 1 - Math.pow(1 - Math.min(1, elapsed), 2.4));
        }

        // Smooth dramatic palette transition when 3/3 Triple Tiara is crowned
        const targetCrowned = this.crowned ? 1 : 0;
        this._crownedMix += (targetCrowned - this._crownedMix) * Math.min(1, dt * 2.8);

        if (this._pulse.amp > 0.001) {
          this._pulse.amp = Math.max(0, this._pulse.amp - dt * 1.1);
        }
        if (this._regaliaWave > 0.001) {
          this._regaliaWave = Math.max(0, this._regaliaWave - dt * 0.36);
        }
        if (this._easterFlurry > 0.001) {
          this._easterFlurry = Math.max(0, this._easterFlurry - dt * 0.22);
        }

        if (this._gl) {
          this.renderWebGL(nowSec);
        }
        this.stepParticles(dt, nowSec);
      };
      this._rafId = requestAnimationFrame(render);
    },

    renderWebGL(nowSec) {
      const gl = this._gl;
      const canvas = this.$refs.glCanvas;
      if (!gl || !canvas || canvas.width < 2 || canvas.height < 2) return;

      const aspect = canvas.width / Math.max(canvas.height, 1);
      const readFbo = this._fboPing ? this._fboA : this._fboB;
      const writeFbo = this._fboPing ? this._fboB : this._fboA;

      gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo.fbo);
      gl.viewport(0, 0, 128, 128);
      gl.useProgram(this._flowProg);
      gl.enableVertexAttribArray(this._flowLoc.aPos);
      gl.vertexAttribPointer(this._flowLoc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readFbo.tex);
      gl.uniform1i(this._flowLoc.uPrev, 0);
      gl.uniform2f(this._flowLoc.uMouse, this._mouse.x, this._mouse.y);
      gl.uniform2f(this._flowLoc.uMouseVel, this._mouse.vx, this._mouse.vy);
      gl.uniform1f(this._flowLoc.uMouseActive, this._mouse.active > 0.05 ? 1.0 : 0.0);
      gl.uniform2f(this._flowLoc.uPulsePos, this._pulse.x, this._pulse.y);
      gl.uniform1f(this._flowLoc.uPulseAmp, this._pulse.amp);
      gl.uniform1f(this._flowLoc.uAspect, aspect);
      gl.uniform1f(this._flowLoc.uTime, nowSec);
      gl.uniform1f(this._flowLoc.uAudio, this._audioEnergy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this._fboPing = !this._fboPing;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(this._mainProg);
      gl.enableVertexAttribArray(this._mainLoc.aPos);
      gl.vertexAttribPointer(this._mainLoc.aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._portraitTex);
      gl.uniform1i(this._mainLoc.uPortrait, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, writeFbo.tex);
      gl.uniform1i(this._mainLoc.uFlow, 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this._glyphTex);
      gl.uniform1i(this._mainLoc.uGlyphAtlas, 2);

      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this._loreTex);
      gl.uniform1i(this._mainLoc.uLoreAtlas, 3);

      gl.uniform2f(this._mainLoc.uResolution, canvas.width, canvas.height);
      gl.uniform2f(this._mainLoc.uMouse, this._mouse.x, this._mouse.y);
      gl.uniform1f(this._mainLoc.uTime, nowSec);
      gl.uniform1f(this._mainLoc.uImageReady, this.imageReady ? 1.0 : 0.0);
      gl.uniform1f(this._mainLoc.uReveal, this._reveal);
      gl.uniform1f(this._mainLoc.uAudio, this._audioEnergy);
      gl.uniform1f(this._mainLoc.uRegaliaWave, this._regaliaWave);
      gl.uniform1f(this._mainLoc.uCrownedMix, this._crownedMix);
      gl.uniform1f(this._mainLoc.uBannerMode, this.isBanner ? 1.0 : 0.0);
      gl.uniform1f(this._mainLoc.uReducedMotion, this._reducedMotion ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    onPointerMove(event) {
      const stage = this.$refs.stage;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const ny = 1.0 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      this._mouse.tx = Math.max(0, Math.min(1, nx));
      this._mouse.ty = Math.max(0, Math.min(1, ny));
      this._mouse.active = 1.0;
    },

    onPointerDown(event) {
      if (this.isBanner || event.button !== 0) return;
      this.pointerDownPos = { x: event.clientX, y: event.clientY };
    },

    onStageClick(event) {
      if (this.isBanner) return;
      if (event.target.closest(".dt-constellation")) return;
      if (this.pointerDownPos) {
        const dx = event.clientX - this.pointerDownPos.x;
        const dy = event.clientY - this.pointerDownPos.y;
        this.pointerDownPos = null;
        if (dx * dx + dy * dy > 49) return;
      }
      triggerDaringTactTransition(() => {
        this.$emit("open-character", DARING_TACT_HERO_CONFIG.characterId);
      });
    },

    onStarEnter(star, index, event) {
      this.hoveredStar = star;
      if (!this.isStarLocked(index)) {
        this.emitStarPulse(event, 0.36);
      }
    },

    onStarLeave() {
      this.hoveredStar = null;
    },

    onStarClick(star, index, event) {
      // Strictly enforce chronological order: 樱花赏 (0) -> 优骏牝马 (1) -> 秋华赏 (2)
      if (index !== this.litCount) {
        if (index > this.litCount) {
          this.shakeStarId = star.id;
          clearTimeout(this._shakeTimer);
          this._shakeTimer = setTimeout(() => {
            this.shakeStarId = null;
          }, 420);
        }
        return;
      }

      this.litCount = index + 1;
      this.emitStarPulse(event, 0.92);

      if (this.litCount >= this.stars.length) {
        this.crowned = true;
        setDaringTactCrowned(true);
        this._regaliaWave = 1.0;
        if (this._fallbackCtx && this._loadedImage) {
          this.renderCanvas2DFallback();
        }
      }
    },

    emitStarPulse(event, strength) {
      const stage = this.$refs.stage;
      if (!stage || !event) return;
      const rect = stage.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const ny = 1.0 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      this._pulse = {
        x: Math.max(0, Math.min(1, nx)),
        y: Math.max(0, Math.min(1, ny)),
        amp: strength,
      };
    },
  },
  template: `
    <div
      ref="stage"
      class="dt-hero-stage"
      :class="{ 'is-crowned': crowned, 'is-ready': imageReady, 'is-banner': isBanner }"
      :role="isBanner ? null : 'link'"
      :tabindex="isBanner ? null : 0"
      :aria-label="isBanner ? null : '谋勇兼备实装纪念主视觉，点击进入谋勇兼备角色页'"
      @pointermove="onPointerMove"
      @pointerdown="onPointerDown"
      @click="onStageClick"
      @keydown.enter.self="!isBanner && $emit('open-character', 'daringtact')"
      @keydown.space.self.prevent="!isBanner && $emit('open-character', 'daringtact')"
    >
      <canvas ref="glCanvas" class="dt-hero-gl" aria-hidden="true"></canvas>
      <canvas ref="particlesCanvas" class="dt-hero-particles" aria-hidden="true"></canvas>

      <template v-if="!isBanner">
        <div class="dt-magazine-layer" aria-hidden="true">
          <div class="dt-mag-en">DARING TACT</div>
          <div class="dt-mag-year">2020</div>
          <div class="dt-mag-vertical">谋勇兼备</div>
        </div>

        <div class="dt-editorial-title" aria-hidden="true">
          <span class="dt-ed-zh">谋勇兼备</span>
          <span class="dt-ed-sub">白光之御徽</span>
          <span v-if="audioPlaying" class="dt-audio-eq">
            <span></span><span></span><span></span>
          </span>
        </div>

        <div class="dt-constellation" @click.stop>
          <div class="dt-stars-row" role="group" aria-label="谋勇兼备无败牝马三冠星徽">
            <button
              v-for="(star, index) in stars"
              :key="star.id"
              type="button"
              class="dt-star-node"
              :class="{
                'is-lit': isStarLit(index),
                'is-next': isStarNext(index),
                'is-locked': isStarLocked(index),
                'is-shake': shakeStarId === star.id
              }"
              :aria-label="star.label"
              :aria-pressed="isStarLit(index)"
              :aria-disabled="isStarLocked(index)"
              @mouseenter="onStarEnter(star, index, $event)"
              @mouseleave="onStarLeave"
              @focus="hoveredStar = star"
              @blur="hoveredStar = null"
              @click.stop="onStarClick(star, index, $event)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1.5L14.6 9.4L22.5 12L14.6 14.6L12 22.5L9.4 14.6L1.5 12L9.4 9.4Z" />
              </svg>
            </button>
          </div>
          <div class="dt-constellation-label">{{ activeStarText }}</div>
        </div>
      </template>
    </div>
  `,
};
