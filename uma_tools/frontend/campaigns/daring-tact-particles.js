// Particle field engine: ice-cyan starlight, Erimo wilderness leaves, Shirotae sakura petals, and Yomiya bear silhouettes.

export function createDaringTactParticles(isBanner) {
  const particles = [];
  const starCount = isBanner ? 22 : 36;
  const leafCount = isBanner ? 8 : 13;
  const petalCount = isBanner ? 8 : 14;
  const bearCount = isBanner ? 2 : 3;

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
  return particles;
}

export function stepDaringTactParticles(canvas, particles, state, dt, nowSec) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const dpr = state.dpr || 1;
  ctx.clearRect(0, 0, w, h);
  if (state.reducedMotion) return;

  const mx = state.mouse.x;
  const my = 1.0 - state.mouse.y;
  const mvx = state.mouse.vx;
  const mvy = -state.mouse.vy;
  const oaksWind = state.litCount >= 2 ? 0.35 : 0;
  const boost = 1 + oaksWind + state.audioEnergy * 0.85 + state.regaliaWave * 2.4 + state.crownedMix * 0.35 + state.easterFlurry * 1.6;
  const goldMode = state.crownedMix > 0.45 || state.regaliaWave > 0.12;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    if (p.kind === "petal" && state.litCount < 1 && state.easterFlurry < 0.05) continue;
    if (p.kind === "bear" && !state.crowned && state.easterFlurry < 0.05) continue;

    const dx = p.x - mx;
    const dy = p.y - my;
    const distSq = dx * dx + dy * dy;
    if (state.mouse.active > 0.2 && distSq < 0.032) {
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
    const alpha = Math.min(1, p.alpha * twinkle * (1 + state.regaliaWave * 1.1 + state.crownedMix * 0.45 + state.audioEnergy * 0.3 + state.easterFlurry * 0.7));

    ctx.save();
    ctx.translate(px, py);
    if (p.kind === "star") {
      const r = p.size * dpr * (1 + state.crownedMix * 0.35 + state.regaliaWave * 0.55);
      ctx.fillStyle = goldMode ? `rgba(255, 224, 138, ${alpha.toFixed(3)})` : `rgba(166, 232, 250, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
    } else if (p.kind === "leaf") {
      const len = p.size * dpr * (1 + state.crownedMix * 0.2);
      ctx.rotate(p.angle);
      ctx.strokeStyle = goldMode ? `rgba(248, 210, 118, ${(alpha * 0.9).toFixed(3)})` : `rgba(121, 198, 219, ${(alpha * 0.78).toFixed(3)})`;
      ctx.fillStyle = goldMode ? `rgba(248, 210, 118, ${(alpha * 0.28).toFixed(3)})` : `rgba(121, 198, 219, ${(alpha * 0.16).toFixed(3)})`;
      ctx.lineWidth = 1.1 * dpr;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.quadraticCurveTo(0, -len * 0.52, len, 0);
      ctx.quadraticCurveTo(0, len * 0.52, -len, 0);
      ctx.fill();
      ctx.stroke();
    } else if (p.kind === "petal") {
      const r = p.size * dpr;
      ctx.rotate(p.angle);
      ctx.fillStyle = goldMode ? `rgba(255, 244, 228, ${(alpha * 0.82).toFixed(3)})` : `rgba(245, 251, 255, ${(alpha * 0.85).toFixed(3)})`;
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
      const r = p.size * dpr;
      ctx.rotate(Math.sin(nowSec * 1.1 + p.phase) * 0.14 + p.angle);
      ctx.strokeStyle = goldMode ? `rgba(255, 228, 156, ${(alpha * 0.88).toFixed(3)})` : `rgba(166, 232, 250, ${(alpha * 0.82).toFixed(3)})`;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(-r * 0.58, -r * 0.58, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.58, -r * 0.58, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
      ctx.stroke();
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
}
