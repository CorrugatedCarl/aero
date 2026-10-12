// hud.js — the instrument panel and debug readout, drawn on the canvas in screen space.

import { FLAPS, WING, TAIL, ENGINE } from './config.js';
import { neutralPoint } from './aero.js';
import { clamp, DEG } from './util.js';

const C = {
  panel: 'rgba(9,13,18,0.80)', edge: 'rgba(160,190,215,0.18)', label: '#8ea4b8', value: '#f2f6f8',
  green: '#3ddc84', amber: '#ffb020', red: '#ff4d4d', cyan: '#4fd2ff', sky: '#2f6db5', ground: '#7a5634', off: '#3a444e',
};
const MONO = '"B612 Mono", ui-monospace, Menlo, monospace';
const SANS = 'B612, "Helvetica Neue", Arial, sans-serif';
const M2FT = 3.28084;

export class Hud {
  constructor() { this.np = neutralPoint(WING, TAIL); this.fps = 60; }

  draw(ctx, sim, controls, view, ui) {
    const ac = sim.ac, a = ac.aero, b = ac.body, v = b.getLinearVelocity(), th = b.getAngle();
    const { W, H, top } = view;
    const wide = W >= 760;
    const pw = Math.min(600, wide ? W - 300 : W - 24), ph = 84;
    const x0 = Math.round((W - pw) / 2), y0 = Math.round(top + (wide ? 10 : 96));
    ctx.save();
    this.box(ctx, x0, y0, pw, ph + 30);

    // columns: IAS | ADI | ALT+VS | AoA | G/THR
    const col = pw / 5.2;
    const ias = (a.ias ?? 0) * 1.94384;
    this.readout(ctx, x0 + 12, y0 + 10, 'IAS KT', ias.toFixed(0), `M ${(a.mach ?? 0).toFixed(2)}`, ias < 105 && !this.onGround(ac) ? C.amber : C.value);
    this.adi(ctx, x0 + col * 1.55, y0 + ph / 2 + 2, Math.min(38, col * 0.42), th, Math.atan2(v.y, v.x));
    const alt = b.getPosition().y * M2FT, vs = v.y * M2FT * 60;
    this.readout(ctx, x0 + col * 2.2, y0 + 10, 'ALT FT', alt.toFixed(0), `${vs >= 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(0)} FPM`, C.value,
      `AGL ${Math.max(0, (a.hWing ?? 0) * M2FT).toFixed(0)}`);
    this.aoa(ctx, x0 + col * 3.45, y0 + 10, ph - 16, a.alpha ?? 0, a.alphaStall ?? 15 * DEG);
    const n2 = ac.spool * 100;
    this.readout(ctx, x0 + col * 3.95, y0 + 10, 'G', sim.g.toFixed(1), `THR ${(controls.throttle * 100).toFixed(0)}%`,
      sim.g > 7 || sim.g < -2.5 ? C.red : C.value, `N2 ${n2.toFixed(0)}%`);

    // annunciator row
    const ay = y0 + ph + 4;
    let ax = x0 + 10;
    const lamp = (text, color, w = 0) => {
      ctx.font = `bold 11px ${SANS}`;
      const tw = Math.max(w, ctx.measureText(text).width + 14);
      ctx.fillStyle = color === C.off ? 'rgba(255,255,255,0.04)' : color + '26';
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(ax, ay, tw, 20, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color === C.off ? '#5d6a76' : color; ctx.textBaseline = 'middle';
      ctx.fillText(text, ax + 7, ay + 10.5);
      ax += tw + 6;
    };
    const gearText = ac.legs.map((l) => (l.cfg.id === 'nose' ? 'N' : 'M')).join(' ');
    const anyBroken = ac.legs.some((l) => l.broken);
    const allDown = ac.legs.every((l) => !l.broken && l.extension > 0.99), allUp = ac.legs.every((l) => l.extension < 0.01);
    lamp(`GEAR ${gearText}`, anyBroken ? C.red : allDown ? C.green : allUp ? C.off : C.amber);
    lamp(`FLAPS ${FLAPS.settings[ac.flapIndex].name}`, ac.flapIndex === 0 && ac.flapAngle < 0.01 ? C.off : Math.abs(ac.flapAngle - FLAPS.settings[ac.flapIndex].angle) > 0.01 ? C.amber : C.cyan);
    lamp('SPD BRK', ac.speedBrake > 0.05 ? C.amber : C.off);
    lamp('BRAKE', controls.wheelBrake ? C.amber : C.off);
    lamp('AB', ac.ab > 0.05 ? C.amber : C.off);
    const stallWarn = !this.onGround(ac) && (a.alpha ?? 0) > (a.alphaStall ?? 1) - 2.5 * DEG;
    if (stallWarn && (performance.now() / 250 | 0) % 2 === 0) lamp('STALL', C.red);
    if (Math.abs(ac.trim) > 0.001) lamp(`TRIM ${(ac.trim / DEG).toFixed(1)}°`, C.cyan);

    let ey = y0 + ph + 52;
    if (ui.debug) ey = this.debug(ctx, sim, controls, x0, y0 + ph + 38, pw, ui) + 22;
    // event messages under the panel
    ctx.textAlign = 'center';
    for (const e of ac.events.slice(-4)) {
      ctx.globalAlpha = clamp(1.4 - e.t / 3, 0, 1);
      ctx.font = `bold 14px ${SANS}`;
      const tw = ctx.measureText(e.text).width + 20;
      ctx.fillStyle = 'rgba(9,13,18,0.7)'; ctx.fillRect(W / 2 - tw / 2, ey - 12, tw, 22);
      ctx.fillStyle = /COLLAPS|TORN|IMPACT|BLOCKED/.test(e.text) ? C.red : C.value;
      ctx.fillText(e.text, W / 2, ey);
      ey += 26;
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    ctx.restore();
  }

  onGround(ac) { return ac.legs.some((l) => l.compression > 0.01); }

  box(ctx, x, y, w, h) {
    ctx.fillStyle = C.panel; ctx.strokeStyle = C.edge; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  }

  readout(ctx, x, y, label, value, sub, color = C.value, sub2) {
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.label; ctx.font = `bold 10px ${SANS}`; ctx.fillText(label, x, y);
    ctx.fillStyle = color; ctx.font = `bold 24px ${MONO}`; ctx.fillText(value, x, y + 13);
    ctx.fillStyle = C.label; ctx.font = `11px ${MONO}`; ctx.fillText(sub, x, y + 42);
    if (sub2) ctx.fillText(sub2, x, y + 56);
  }

  // attitude reference: pitch ladder with the horizon, plus the flight-path marker
  adi(ctx, cx, cy, r, theta, gamma) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const ppd = r / 25; // pixels per degree
    const hy = cy + (theta / DEG) * ppd;
    ctx.fillStyle = C.sky; ctx.fillRect(cx - r, cy - r, 2 * r, hy - (cy - r));
    ctx.fillStyle = C.ground; ctx.fillRect(cx - r, hy, 2 * r, cy + r - hy);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - r, hy); ctx.lineTo(cx + r, hy); ctx.stroke();
    ctx.lineWidth = 1; ctx.font = `9px ${MONO}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    for (let d = -90; d <= 90; d += 10) {
      if (!d) continue;
      const y = hy - d * ppd;
      if (Math.abs(y - cy) > r) continue;
      const w = r * 0.32;
      ctx.beginPath(); ctx.moveTo(cx - w, y); ctx.lineTo(cx + w, y); ctx.stroke();
      ctx.fillText(String(Math.abs(d)), cx + w + 3, y);
    }
    // flight path marker
    const fy = cy + ((theta - gamma) / DEG) * ppd;
    ctx.strokeStyle = C.green; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, fy, 3.5, 0, Math.PI * 2); ctx.moveTo(cx - 10, fy); ctx.lineTo(cx - 3.5, fy); ctx.moveTo(cx + 3.5, fy); ctx.lineTo(cx + 10, fy); ctx.stroke();
    ctx.restore();
    // fixed aircraft symbol
    ctx.strokeStyle = C.amber; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.6, cy); ctx.lineTo(cx - r * 0.2, cy); ctx.lineTo(cx - r * 0.1, cy + 5);
    ctx.moveTo(cx + r * 0.6, cy); ctx.lineTo(cx + r * 0.2, cy); ctx.lineTo(cx + r * 0.1, cy + 5); ctx.stroke();
    ctx.strokeStyle = C.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  // vertical AoA gauge, -5°..25°, amber band 2.5° before the stall, red beyond
  aoa(ctx, x, y, h, alpha, alphaStall) {
    const lo = -5, hi = 25, w = 12;
    ctx.fillStyle = C.label; ctx.font = `bold 10px ${SANS}`; ctx.textBaseline = 'top';
    ctx.fillText('AOA', x - 2, y);
    y += 14; h -= 14;
    const yy = (d) => y + h - ((d - lo) / (hi - lo)) * h;
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, h);
    const s = alphaStall / DEG;
    ctx.fillStyle = C.amber; ctx.fillRect(x, yy(s), w, yy(s - 2.5) - yy(s));
    ctx.fillStyle = C.red; ctx.fillRect(x, yy(hi), w, yy(s) - yy(hi));
    const d = clamp(alpha / DEG, lo, hi);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 3, yy(d) - 1.5, w + 6, 3);
    ctx.font = `bold 13px ${MONO}`; ctx.fillStyle = d > s - 2.5 ? C.red : C.value; ctx.textBaseline = 'middle';
    ctx.fillText(`${(alpha / DEG).toFixed(1)}°`, x + w + 6, clamp(yy(d), y + 6, y + h - 6));
  }

  debug(ctx, sim, controls, x, y, w, ui) {
    const ac = sim.ac, a = ac.aero;
    const deg = (r) => `${(r / DEG).toFixed(1)}°`;
    const lines = [
      ['α wing', deg(a.alpha)], ['α tail', deg(a.alphaTail)], ['α stall', deg(a.alphaStall)],
      ['CL / CD', `${a.cl.toFixed(2)} / ${a.cd.toFixed(3)}`], ['CL tail', a.clTail.toFixed(2)],
      ['L/D', (a.cl / Math.max(a.cd, 1e-4)).toFixed(1)], ['downwash', deg(a.downwash)],
      ['elevator', deg(ac.elevator)], ['q', `${(a.q / 1000).toFixed(2)} kPa`], ['ρ', `${a.rho.toFixed(3)}`],
      ['ground eff.', `×${a.geDrag.toFixed(2)} Di`], ['wave drag', `×${a.cmp.toFixed(2)}`],
      ['thrust', `${(ac.thrust / 1000).toFixed(1)} kN`], ['spool', `${(ac.spool * 100).toFixed(0)}%`],
      ...ac.legs.map((l) => [`${l.cfg.id} strut`, l.broken ? 'BROKEN' : `${(l.compression * 100).toFixed(0)} cm · ${(l.extension * 100).toFixed(0)}%`]),
      ['static margin', `${(this.np.staticMargin * 100).toFixed(0)}% MAC`],
      ['frame', `${ui.fps.toFixed(0)} fps · ${ui.physMs.toFixed(2)} ms`],
      ['pad', ui.pad || 'none'],
    ];
    const lh = 15, cols = w >= 440 ? 2 : 1, rows = Math.ceil(lines.length / cols), h = rows * lh + 36;
    this.box(ctx, x, y, w, h);
    ctx.textBaseline = 'top'; ctx.font = `11px ${MONO}`;
    lines.forEach(([k, v], i) => {
      const cx = x + 10 + Math.floor(i / rows) * (w / cols), cy = y + 8 + (i % rows) * lh;
      ctx.fillStyle = C.label; ctx.fillText(k, cx, cy);
      ctx.fillStyle = C.value; ctx.fillText(v, cx + 100, cy);
    });
    const key = [['L lift', '#21c55d'], ['D drag', '#ef4444'], ['T thrust', '#facc15'], ['W weight', '#60a5fa'], ['NP neutral pt', '#a855f7'], ['v velocity', '#22d3ee']];
    let kx = x + 10;
    key.forEach(([t, c]) => { ctx.fillStyle = c; ctx.fillText(t, kx, y + h - 20); kx += ctx.measureText(t).width + 12; });
    return y + h;
  }
}
