// render.js — Canvas 2D drawing of the world: sky, parallax, clouds, terrain, runway, the jet and
// its gear, effects, and the debug force vectors. Reads the sim; never changes it.

import { SPRITE, AIRFRAME, WING, TAIL, GEAR, RUNWAY, CAMERA, TERRAIN, SIM } from './config.js';
import { terrainHeight, noise1 } from './terrain.js';
import { neutralPoint } from './aero.js';
import { clamp, lerp, DEG } from './util.js';

const V = AIRFRAME.visual;
const BAND_FRONT = -0.9, BAND_BACK = 1.5, SKEW = 0.9; // pseudo-3D ground strip, metres
const mix = (a, b, t) => {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], t))).join(',')})`;
};

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, z: 12, ox: 0, oy: 0 };
    this.particles = [];
    this.np = neutralPoint(WING, TAIL);
    this.sprite = null; // drawn once the image has loaded
    const img = new Image();
    img.onload = () => { this.sprite = { img, cgPx: SPRITE.cgPx, ppm: SPRITE.pxPerMeter }; };
    img.src = SPRITE.src;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  }

  // Camera: look ahead along the velocity, zoom out with speed and height above ground.
  follow(sim, dt, snap = false) {
    const b = sim.ac.body, p = b.getPosition(), v = b.getLinearVelocity();
    const C = CAMERA, speed = v.length();
    const agl = Math.max(0, p.y - terrainHeight(p.x));
    const view = clamp(C.minView + C.viewPerSpeed * speed + C.viewPerAlt * agl, C.minView, C.maxView);
    const k = snap ? 1 : 1 - Math.exp(-C.smoothing * dt);
    const cam = this.cam;
    // look ahead along the velocity, but keep the jet well inside the frame
    const halfW = this.W / 2 / cam.z, halfH = this.H / 2 / cam.z;
    const ox = clamp(v.x * C.lookAhead, -Math.min(C.maxLookAhead, halfW * 0.4), Math.min(C.maxLookAhead, halfW * 0.4));
    const oy = clamp(v.y * C.lookAhead * 0.5, -halfH * 0.3, halfH * 0.3);
    cam.ox += (ox - cam.ox) * k; cam.oy += (oy - cam.oy) * k;
    const zT = this.H / view;
    cam.z = Math.exp(Math.log(cam.z) + (Math.log(zT) - Math.log(cam.z)) * k);
    cam.x = p.x + cam.ox;
    // keep the ground between 62% and 85% down the screen while it is in reach, the jet above 15%
    const viewH = this.H / cam.z, h = terrainHeight(cam.x);
    cam.y = clamp(p.y + cam.oy, h + viewH * 0.12, Math.max(h + viewH * 0.12, h + viewH * 0.35));
    cam.y = Math.max(cam.y, p.y - viewH * 0.35);
  }

  sx(x) { return this.W / 2 + (x - this.cam.x) * this.cam.z; }
  sy(y) { return this.H / 2 - (y - this.cam.y) * this.cam.z; }
  worldTransform() {
    const { dpr, cam } = this;
    this.ctx.setTransform(dpr * cam.z, 0, 0, -dpr * cam.z, dpr * (this.W / 2 - cam.x * cam.z), dpr * (this.H / 2 + cam.y * cam.z));
  }
  screenTransform() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  draw(sim, ui, dt) {
    const ctx = this.ctx;
    this.screenTransform();
    this.drawSky();
    this.drawParallax();
    this.worldTransform();
    this.drawClouds();
    this.drawBuildings();
    this.drawTerrain();
    this.drawRunway(sim);
    this.updateParticles(sim, dt);
    this.drawParticles(false);
    this.drawAircraft(sim);
    this.drawParticles(true);
    if (ui.debug) this.drawDebug(sim);
    this.screenTransform();
    this.drawRunwayText();
    ctx.globalAlpha = 1;
  }

  drawSky() {
    const { ctx, W, H, cam } = this;
    const a = clamp(cam.y / 14000, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix('#4f86c6', '#0d1f45', a));
    g.addColorStop(0.65, mix('#a9c8e2', '#3f6aa8', a));
    g.addColorStop(1, mix('#dbe7ef', '#6f93c6', a));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  drawParallax() {
    const { ctx, W, H, cam } = this;
    const layers = [
      { f: 0.02, mpp: 14, amp: 220, wave: 900, base: 0.6, drop: 0.02, color: '#9db6cc', seed: 11 },
      { f: 0.06, mpp: 6, amp: 120, wave: 420, base: 0.66, drop: 0.05, color: '#86a0b4', seed: 23 },
      { f: 0.15, mpp: 3, amp: 60, wave: 180, base: 0.72, drop: 0.1, color: '#6f8b72', seed: 37 },
    ];
    const zoomOut = clamp(Math.log2(12 / cam.z) / 5, 0, 1); // far layers fade when zoomed way out
    for (const L of layers) {
      const baseY = H * L.base + cam.y * L.drop * 0.6;
      if (baseY - L.amp / L.mpp * 4 > H) continue;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let px = 0; px <= W + 8; px += 8) {
        const u = cam.x * L.f + (px - W / 2) * L.mpp;
        const h = L.amp * (0.6 + 0.5 * noise1(u / (L.wave * 6), L.seed) + 0.25 * noise1(u / (L.wave * 2), L.seed + 1));
        ctx.lineTo(px, baseY - h / L.mpp * 3);
      }
      ctx.lineTo(W, H); ctx.closePath();
      ctx.globalAlpha = 1 - zoomOut * 0.5;
      ctx.fillStyle = L.color; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  view() {
    const { W, H, cam } = this;
    return { x0: cam.x - W / 2 / cam.z, x1: cam.x + W / 2 / cam.z, y0: cam.y - H / 2 / cam.z, y1: cam.y + H / 2 / cam.z };
  }

  drawClouds() {
    const { ctx } = this, v = this.view(), cell = 1600;
    for (let i = Math.floor((v.x0 - 800) / cell); i <= Math.floor((v.x1 + 800) / cell); i++) {
      if (noise1(i, 501) < -0.1) continue;
      const w = 260 + 380 * (0.5 + 0.5 * noise1(i, 503));
      const cx = i * cell + 600 * noise1(i, 507), cy = 1500 + 1300 * (0.5 + 0.5 * noise1(i, 509));
      if (cx + w < v.x0 || cx - w > v.x1 || cy - 50 > v.y1 || cy + w * 0.6 < v.y0) continue;
      ctx.fillStyle = 'rgba(205,214,224,0.9)';
      ctx.beginPath(); ctx.ellipse(cx, cy + w * 0.06, w * 0.62, w * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(250,251,253,0.92)';
      for (let k = 0; k < 7; k++) {
        const bx = cx + (k / 6 - 0.5) * w * 1.05, r = w * (0.16 + 0.12 * (0.5 + 0.5 * noise1(i * 7 + k, 511)));
        ctx.beginPath(); ctx.arc(bx, cy + r * 0.85, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawBuildings() {
    const { ctx } = this, v = this.view();
    if (v.x1 < -700 || v.x0 > 0) return;
    const base = BAND_BACK;
    ctx.fillStyle = '#8e969d'; ctx.fillRect(-520, base, 110, 16); // hangar
    ctx.fillStyle = '#767e86'; ctx.beginPath(); ctx.moveTo(-525, base + 16); ctx.quadraticCurveTo(-465, base + 26, -405, base + 16); ctx.fill();
    ctx.fillStyle = '#6a7279'; ctx.fillRect(-505, base, 40, 11);
    ctx.fillStyle = '#9aa1a8'; ctx.fillRect(-330, base, 7, 26); // tower
    ctx.fillStyle = '#3d5a6c'; ctx.fillRect(-333, base + 26, 13, 5);
    ctx.fillStyle = '#7f878e'; ctx.fillRect(-334, base + 31, 15, 1.2);
  }

  terrainStep() { return Math.max(TERRAIN.spacing, Math.ceil(3 / this.cam.z / TERRAIN.spacing) * TERRAIN.spacing); }

  drawTerrain() {
    const { ctx } = this, v = this.view(), step = this.terrainStep();
    const xa = Math.floor(v.x0 / step) * step - step, xb = v.x1 + step * 2;
    const bottom = v.y0 - 50;
    // top strip (the ground receding from the viewer)
    ctx.beginPath();
    for (let x = xa; x <= xb; x += step) ctx.lineTo(x + SKEW, terrainHeight(x) + BAND_BACK);
    for (let x = xb - ((xb - xa) % step); x >= xa; x -= step) ctx.lineTo(x, terrainHeight(x) + BAND_FRONT);
    ctx.closePath();
    ctx.fillStyle = '#8bab5c'; ctx.fill();
    // front face
    ctx.beginPath();
    for (let x = xa; x <= xb; x += step) ctx.lineTo(x, terrainHeight(x) + BAND_FRONT);
    ctx.lineTo(xb, bottom); ctx.lineTo(xa, bottom); ctx.closePath();
    const g = ctx.createLinearGradient(0, this.cam.y, 0, bottom);
    g.addColorStop(0, '#5d7d3c'); g.addColorStop(1, '#3b4a2a');
    ctx.fillStyle = g; ctx.fill();
    // a darker lip along the front edge
    ctx.beginPath();
    for (let x = xa; x <= xb; x += step) ctx.lineTo(x, terrainHeight(x) + BAND_FRONT);
    ctx.strokeStyle = '#4b6631'; ctx.lineWidth = Math.max(0.15, 1.5 / this.cam.z); ctx.stroke();
  }

  drawRunway(sim) {
    const { ctx, cam } = this, v = this.view(), R = RUNWAY;
    this.runwayText = [];
    if (v.x1 < R.x0 - 300 || v.x0 > R.x1 + 300) return;
    const band = (x0, x1, f0, f1, color) => { // a patch on the strip, depth fractions f0..f1 (0 = front)
      const d0 = lerp(BAND_FRONT, BAND_BACK, f0), d1 = lerp(BAND_FRONT, BAND_BACK, f1);
      const s0 = SKEW * f0, s1 = SKEW * f1;
      ctx.beginPath(); ctx.moveTo(x0 + s0, d0); ctx.lineTo(x1 + s0, d0); ctx.lineTo(x1 + s1, d1); ctx.lineTo(x0 + s1, d1); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
    };
    band(R.x0 - 60, R.x1 + 60, 0.08, 0.92, '#7c7f74'); // overrun / shoulders
    band(R.x0, R.x1, 0.14, 0.86, '#3b3e43');
    const white = '#e9ecef';
    if (cam.z > 0.6) {
      for (let x = R.x0 + 400; x < R.x1 - 400; x += 60) band(x, x + 36, 0.47, 0.53, white); // centreline
      for (const [start, dir] of [[R.x0, 1], [R.x1, -1]]) {
        for (let i = 0; i < 8; i++) {                                                       // threshold bars
          const f = 0.18 + i * 0.085;
          band(Math.min(start + dir * 6, start + dir * 36), Math.max(start + dir * 6, start + dir * 36), f, f + 0.045, white);
        }
        const aim = start + dir * 300, tdz = start + dir * 150;
        band(Math.min(aim, aim + dir * 50), Math.max(aim, aim + dir * 50), 0.24, 0.36, white); // aiming point
        band(Math.min(aim, aim + dir * 50), Math.max(aim, aim + dir * 50), 0.64, 0.76, white);
        for (const t of [tdz, start + dir * 450]) {
          band(Math.min(t, t + dir * 22), Math.max(t, t + dir * 22), 0.28, 0.34, white);
          band(Math.min(t, t + dir * 22), Math.max(t, t + dir * 22), 0.66, 0.72, white);
        }
        const nx = start + dir * 58;
        this.runwayText.push({ x0: Math.min(nx, nx + dir * 24), x1: Math.max(nx, nx + dir * 24), text: dir > 0 ? '09' : '27' });
      }
    }
    // edge lights: front and back edges, amber over the last 600 m
    const lr = Math.max(0.22, 1.6 / cam.z);
    for (let x = R.x0; x <= R.x1; x += 60) {
      if (x < v.x0 - 5 || x > v.x1 + 5) continue;
      ctx.fillStyle = x > R.x1 - 600 ? '#ffc24a' : '#fffbe8';
      for (const f of [0.12, 0.88]) { ctx.beginPath(); ctx.arc(x + SKEW * f, lerp(BAND_FRONT, BAND_BACK, f), lr, 0, Math.PI * 2); ctx.fill(); }
    }
    // distance-remaining boards (thousands of feet) in front of the runway
    if (cam.z > 2.2) {
      for (let n = 1; n * 304.8 < R.x1 - R.x0; n++) {
        const x = R.x1 - n * 304.8;
        if (x < v.x0 - 5 || x > v.x1 + 5) continue;
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - 0.08, BAND_FRONT - 1.6, 0.16, 0.8);
        ctx.fillRect(x - 0.6, BAND_FRONT - 1.0, 1.2, 0.95);
        this.runwayText.push({ board: true, x, y: BAND_FRONT - 0.52, text: String(n) });
      }
    }
    // PAPI: four lights left of the threshold; white above each light's angle, red below
    const papiX = R.x0 + 300;
    if (papiX > v.x0 - 20 && papiX < v.x1 + 20) {
      const p = sim.ac.body.getPosition();
      const ang = Math.atan2(p.y - 2, papiX - p.x) / DEG;
      const th = [3.5, 3.17, 2.83, 2.5];
      ctx.fillStyle = '#2f3336'; ctx.fillRect(papiX - 12, BAND_FRONT - 1.2, 24, 0.7);
      th.forEach((t, i) => {
        ctx.fillStyle = p.x < papiX && ang > t ? '#ffffff' : p.x < papiX ? '#ff3b30' : '#555';
        ctx.beginPath(); ctx.arc(papiX - 9 + i * 6, BAND_FRONT - 0.85, Math.max(0.5, 2 / cam.z), 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  drawRunwayText() {
    const { ctx, cam } = this;
    if (!this.runwayText) return;
    for (const t of this.runwayText) {
      if (t.board) {
        const px = this.sx(t.x), py = this.sy(t.y), s = cam.z * 0.75;
        ctx.fillStyle = '#f2f2f2'; ctx.font = `bold ${s}px "B612 Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.text, px, py);
        continue;
      }
      if (cam.z < 1.5) continue;
      const y0 = this.sy(lerp(BAND_FRONT, BAND_BACK, 0.2)), y1 = this.sy(lerp(BAND_FRONT, BAND_BACK, 0.8));
      const px = (this.sx(t.x0) + this.sx(t.x1)) / 2 + SKEW * 0.5 * cam.z;
      ctx.save();
      ctx.translate(px, (y0 + y1) / 2);
      ctx.scale(1, Math.abs(y1 - y0) / (cam.z * 20));
      ctx.fillStyle = '#e9ecef'; ctx.font = `bold ${cam.z * 20}px "B612 Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  drawAircraft(sim) {
    const { ctx } = this, ac = sim.ac, b = ac.body, p = b.getPosition(), th = b.getAngle();
    const P = globalThis.planck;
    const W2 = (x, y) => b.getWorldPoint(P.Vec2(x, y));
    // far out, draw the jet (gear and all) larger around its CG so it stays visible
    const k = Math.max(1, CAMERA.minJetPx / (AIRFRAME.length * this.cam.z));
    ctx.save();
    if (k > 1) { ctx.translate(p.x, p.y); ctx.scale(k, k); ctx.translate(-p.x, -p.y); }
    // gear first: legs and wheels sit behind the fuselage when retracted
    for (const l of ac.legs) {
      const g = l.cfg, top = W2(g.attach[0], g.attach[1]), sp = l.strut.getPosition(), wp = l.wheel.getPosition();
      if (!l.broken) {
        ctx.strokeStyle = '#4d545b'; ctx.lineWidth = 0.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(sp.x, sp.y); ctx.stroke();
        ctx.strokeStyle = '#c6ccd2'; ctx.lineWidth = 0.12;
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(wp.x, wp.y); ctx.stroke(); // oleo piston
      }
      const r = g.wheelRadius, a = l.wheel.getAngle();
      ctx.fillStyle = '#1c1d1f'; ctx.beginPath(); ctx.arc(wp.x, wp.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9aa3ab'; ctx.beginPath(); ctx.arc(wp.x, wp.y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4a5158'; ctx.lineWidth = r * 0.12;
      for (let k = 0; k < 3; k++) {
        const s = a + (k * Math.PI * 2) / 3;
        ctx.beginPath(); ctx.moveTo(wp.x, wp.y); ctx.lineTo(wp.x + Math.cos(s) * r * 0.5, wp.y + Math.sin(s) * r * 0.5); ctx.stroke();
      }
    }
    // afterburner / exhaust
    const nz = W2(V.nozzle[0], V.nozzle[1]), dir = { x: -Math.cos(th), y: -Math.sin(th) };
    if (ac.ab > 0.02 || ac.spool > 0.8) {
      const len = ac.ab * (6 + Math.random() * 1.6) + (ac.spool - 0.8) * 4;
      const nx = -dir.y, ny = dir.x, r = V.nozzleRadius;
      const tip = { x: nz.x + dir.x * len, y: nz.y + dir.y * len };
      const g = ctx.createLinearGradient(nz.x, nz.y, tip.x, tip.y);
      g.addColorStop(0, ac.ab > 0.02 ? 'rgba(255,245,210,0.95)' : 'rgba(255,200,150,0.25)');
      g.addColorStop(0.3, ac.ab > 0.02 ? 'rgba(255,150,60,0.8)' : 'rgba(255,170,120,0.1)');
      g.addColorStop(1, 'rgba(120,120,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(nz.x + nx * r, nz.y + ny * r); ctx.lineTo(tip.x, tip.y); ctx.lineTo(nz.x - nx * r, nz.y - ny * r); ctx.closePath(); ctx.fill();
    }
    // the sprite
    const s = this.sprite;
    if (s) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(th); ctx.scale(1 / s.ppm, -1 / s.ppm);
      // crisp pixels when enlarged, smoothed when shrunk far out
      ctx.imageSmoothingEnabled = !SPRITE.pixelArt || this.cam.z * k < s.ppm;
      ctx.drawImage(s.img, -s.cgPx[0], -s.cgPx[1]);
      ctx.restore();
    }
    // moving surfaces on top (body frame)
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(th);
    const plate = (h, len, angle, w, color) => {
      ctx.save(); ctx.translate(h[0], h[1]); ctx.rotate(angle);
      ctx.fillStyle = color; ctx.fillRect(-len, -w / 2, len, w); ctx.restore();
    };
    if (V.flapChord > 0 && ac.flapAngle > 0.01) plate(V.flapHinge, V.flapChord, ac.flapAngle, 0.1, '#59626b');
    if (V.elevatorChord > 0) plate(V.elevatorHinge, V.elevatorChord, ac.elevator, 0.09, '#4b545d');
    if (V.speedBrakeLength > 0 && ac.speedBrake > 0.01) {
      ctx.save(); ctx.translate(V.speedBrakeHinge[0], V.speedBrakeHinge[1]); ctx.rotate(Math.PI + ac.speedBrake * 50 * DEG);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(0, -0.05, V.speedBrakeLength, 0.1); ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  spawn(x, y, vx, vy, r, life, color, front = false) {
    if (this.particles.length > 400) return;
    this.particles.push({ x, y, vx, vy, r, life, max: life, color, front });
  }

  updateParticles(sim, dt) {
    const ac = sim.ac;
    // tyre smoke on touchdown
    if (sim.lastTouchdown && sim.lastTouchdown !== this._td) {
      this._td = sim.lastTouchdown;
      for (const l of ac.legs) {
        const w = l.wheel.getPosition(), v = l.wheel.getLinearVelocity();
        for (let i = 0; i < 10; i++) this.spawn(w.x, w.y - l.cfg.wheelRadius, v.x * 0.3 + (Math.random() - 0.5) * 3, Math.random() * 1.5, 0.6, 1.4, '210,210,210');
      }
    }
    // smoke and fire from a wreck
    if (ac.crashed && Math.random() < 0.6) {
      const p = ac.body.getPosition();
      this.spawn(p.x + (Math.random() - 0.5) * 4, p.y, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, 1.5, 4, '60,60,60');
      if (Math.random() < 0.5) this.spawn(p.x + (Math.random() - 0.5) * 3, p.y, 0, 2, 0.8, 0.6, '255,140,40', true);
    }
    for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; q.r += dt * 1.4; }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  drawParticles(front) {
    const { ctx } = this;
    for (const q of this.particles) {
      if (q.front !== front) continue;
      ctx.fillStyle = `rgba(${q.color},${(q.life / q.max) * 0.5})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawDebug(sim) {
    const { ctx, cam } = this, ac = sim.ac, b = ac.body, weight = ac.mass * SIM.gravity;
    const P = globalThis.planck;
    const colors = { lift: '#21c55d', tlift: '#86efac', drag: '#ef4444', tdrag: '#fca5a5', fdrag: '#f97316', gdrag: '#fb923c', sbdrag: '#fdba74', thrust: '#facc15' };
    const arrow = (x, y, fx, fy, color) => {
      const s = 7 / weight, ex = x + fx * s, ey = y + fy * s, len = Math.hypot(ex - x, ey - y);
      if (len < 0.05) return;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(0.12, 2 / cam.z);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
      const a = Math.atan2(ey - y, ex - x), h = Math.min(len * 0.35, Math.max(0.6, 8 / cam.z));
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex - h * Math.cos(a - 0.4), ey - h * Math.sin(a - 0.4)); ctx.lineTo(ex - h * Math.cos(a + 0.4), ey - h * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fill();
    };
    for (const f of ac.forces) arrow(f.p.x, f.p.y, f.f.x, f.f.y, colors[f.kind] || '#fff');
    const p = b.getPosition();
    arrow(p.x, p.y, 0, -weight, '#60a5fa');
    const v = b.getLinearVelocity();
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = Math.max(0.08, 1.5 / cam.z); ctx.setLineDash([0.6, 0.4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + v.x * 0.1, p.y + v.y * 0.1); ctx.stroke(); ctx.setLineDash([]);
    // CG, neutral point, aerodynamic centres
    const dot = (lx, ly, color, r = 0.3) => { const q = b.getWorldPoint(P.Vec2(lx, ly)); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(r, 3 / cam.z), 0, Math.PI * 2); ctx.fill(); };
    dot(0, 0, '#111'); dot(0, 0, '#fff', 0.15);
    dot(this.np.xnp, 0, '#a855f7');
    dot(WING.ac[0], WING.ac[1], '#21c55d', 0.18); dot(TAIL.ac[0], TAIL.ac[1], '#86efac', 0.18);
    // hull outline
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(0.04, 1 / cam.z);
    for (const poly of AIRFRAME.hull) {
      ctx.beginPath(); poly.forEach(([x, y], i) => { const q = b.getWorldPoint(P.Vec2(x, y)); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
    }
  }
}
