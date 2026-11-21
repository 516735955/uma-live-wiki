import {
  DARING_TACT_HERO_CONFIG,
  getDaringTactCrowned,
  setDaringTactCrowned,
  syncDaringTactBodyTheme,
  triggerDaringTactTransition,
} from "/uma_tools/frontend/hero-campaign.js";
import {
  VERT_QUAD,
  FRAG_FLOW,
  FRAG_MAIN,
  createGlyphAtlasCanvas,
  createLoreAtlasCanvas,
  createProgram,
  createTexture,
  createFlowFbo,
} from "/uma_tools/frontend/campaigns/daring-tact-shaders.js";
import {
  createDaringTactParticles,
  stepDaringTactParticles,
} from "/uma_tools/frontend/campaigns/daring-tact-particles.js";

let activeHeroInstances = 0;

const TRIPLE_TIARA_STARS = Object.freeze([
  { id: "ouka", step: 1, name: "樱花赏", year: "2020年4月", label: "樱花赏　2020年4月" },
  { id: "oaks", step: 2, name: "优骏牝马", year: "2020年5月", label: "优骏牝马　2020年5月" },
  { id: "shuuka", step: 3, name: "秋华赏", year: "2020年10月", label: "秋华赏　2020年10月" },
]);

export const DaringTactHero = {
  name: "DaringTactHero",
  props: {
    mode: { type: String, default: "hero" },
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
    this._particles = createDaringTactParticles(this.isBanner);

    this.initRenderer();
    if (!this.isBanner) this.loadStandeeProgressive();
    else this.imageReady = true;
    this.bindEvents();
    this.startLoop();
  },
  beforeUnmount() {
    this._destroyed = true;
    activeHeroInstances = Math.max(0, activeHeroInstances - 1);
    if (activeHeroInstances === 0) syncDaringTactBodyTheme("none");
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
    isStarLit(index) { return index < this.litCount; },
    isStarNext(index) { return !this.crowned && index === this.litCount; },
    isStarLocked(index) { return index > this.litCount; },

    bindEvents() {
      this._onResize = () => this.resizeCanvases();
      this._onKeyDown = (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = (event.target && event.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const key = (event.key || "").toLowerCase();
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
      if (this._gl) this._gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      else if (this._fallbackCtx && this._loadedImage && !this.isBanner) this.renderCanvas2DFallback();
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
      const ramp = " .:∶-+×◇◈✧✦❖★";
      const cellW = w / cols;
      const cellH = h / rows;
      ctx.font = `700 ${Math.max(8, Math.floor(cellH * 0.92))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = (y * cols + x) * 4;
          if (data[i + 3] / 255 < 0.18) continue;
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
          const ch = ramp[Math.min(ramp.length - 1, Math.floor(lum * (ramp.length - 1)) + 1)];
          ctx.fillStyle = this.crowned
            ? (lum > 0.72 ? "#fff8e4" : lum > 0.42 ? "#f5c556" : "#3a5eb0")
            : (lum > 0.72 ? "#f2fbff" : lum > 0.42 ? "#79c6db" : "#24437a");
          ctx.fillText(ch, (x + 0.5) * cellW, (y + 0.5) * cellH);
        }
      }
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
      if (this.audioPlaying !== playing) this.audioPlaying = playing;
      const targetEnergy = playing
        ? 0.42 + 0.32 * Math.sin(trackTime * 6.28318 * 1.95) * Math.sin(trackTime * 6.28318 * 0.48) + 0.16 * Math.cos(trackTime * 11.4)
        : 0;
      this._audioEnergy += (Math.max(0, targetEnergy) - this._audioEnergy) * 0.08;
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
          stage.style.setProperty("--dt-px", ((this._mouse.x - 0.5) * -14).toFixed(2) + "px");
          stage.style.setProperty("--dt-py", ((0.5 - this._mouse.y) * -10).toFixed(2) + "px");
        }

        if (!this.isBanner && this.imageReady && this._reveal < 1) {
          const elapsed = (now - this._revealStart) / 1150;
          this._reveal = this._reducedMotion ? 1 : Math.min(1, 1 - Math.pow(1 - Math.min(1, elapsed), 2.4));
        }

        const targetCrowned = this.crowned ? 1 : 0;
        this._crownedMix += (targetCrowned - this._crownedMix) * Math.min(1, dt * 2.8);
        if (this._pulse.amp > 0.001) this._pulse.amp = Math.max(0, this._pulse.amp - dt * 1.1);
        if (this._regaliaWave > 0.001) this._regaliaWave = Math.max(0, this._regaliaWave - dt * 0.36);
        if (this._easterFlurry > 0.001) this._easterFlurry = Math.max(0, this._easterFlurry - dt * 0.22);

        if (this._gl) this.renderWebGL(nowSec);
        stepDaringTactParticles(this.$refs.particlesCanvas, this._particles, {
          dpr: (this._stageRect && this._stageRect.dpr) || 1,
          reducedMotion: this._reducedMotion,
          mouse: this._mouse,
          litCount: this.litCount,
          crowned: this.crowned,
          crownedMix: this._crownedMix,
          regaliaWave: this._regaliaWave,
          audioEnergy: this._audioEnergy,
          easterFlurry: this._easterFlurry,
        }, dt, nowSec);
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
      this._mouse.tx = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
      this._mouse.ty = Math.max(0, Math.min(1, 1.0 - (event.clientY - rect.top) / Math.max(rect.height, 1)));
      this._mouse.active = 1.0;
    },

    onPointerDown(event) {
      if (this.isBanner || event.button !== 0) return;
      this.pointerDownPos = { x: event.clientX, y: event.clientY };
    },

    onStageClick(event) {
      if (this.isBanner || event.target.closest(".dt-constellation")) return;
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
      if (!this.isStarLocked(index)) this.emitStarPulse(event, 0.36);
    },

    onStarLeave() { this.hoveredStar = null; },

    resetTripleTiara(event) {
      if (!this.crowned && this.litCount === 0) return;
      this.litCount = 0;
      this.crowned = false;
      setDaringTactCrowned(false);
      this._regaliaWave = 0;
      this.emitStarPulse(event, 0.75);
      if (this._fallbackCtx && this._loadedImage) this.renderCanvas2DFallback();
    },

    onStarClick(star, index, event) {
      if (this.crowned) {
        this.resetTripleTiara(event);
        return;
      }
      if (index !== this.litCount) {
        if (index > this.litCount) {
          this.shakeStarId = star.id;
          clearTimeout(this._shakeTimer);
          this._shakeTimer = setTimeout(() => { this.shakeStarId = null; }, 420);
        }
        return;
      }
      this.litCount = index + 1;
      this.emitStarPulse(event, 0.92);
      if (this.litCount >= this.stars.length) {
        this.crowned = true;
        setDaringTactCrowned(true);
        this._regaliaWave = 1.0;
        if (this._fallbackCtx && this._loadedImage) this.renderCanvas2DFallback();
      }
    },

    emitStarPulse(event, strength) {
      const stage = this.$refs.stage;
      if (!stage || !event) return;
      const rect = stage.getBoundingClientRect();
      this._pulse = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1))),
        y: Math.max(0, Math.min(1, 1.0 - (event.clientY - rect.top) / Math.max(rect.height, 1))),
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
          <span v-if="audioPlaying" class="dt-audio-eq"><span></span><span></span><span></span></span>
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
          <div
            class="dt-constellation-label"
            :class="{ 'is-resettable': crowned }"
            :title="crowned ? '点击可重置回初始状态' : ''"
            @click.stop="crowned && resetTripleTiara($event)"
          >{{ activeStarText }}</div>
        </div>
      </template>
    </div>
  `,
};
