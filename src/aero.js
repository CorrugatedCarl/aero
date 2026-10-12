// aero.js — pure aerodynamics: atmosphere, lift / drag curves, per-surface forces. No Box2D, no DOM.

import { clamp, smoothstep, wrapAngle, DEG } from './util.js';
import { COMPRESSIBILITY, GROUND_EFFECT } from './config.js';

// International Standard Atmosphere (troposphere + lower stratosphere).
export function atmosphere(h) {
  h = clamp(h, -500, 20000);
  let T, p;
  if (h <= 11000) {
    T = 288.15 - 0.0065 * h;
    p = 101325 * Math.pow(T / 288.15, 5.25588);
  } else {
    T = 216.65;
    p = 22632.1 * Math.exp(-(h - 11000) / 6341.62);
  }
  const rho = p / (287.05 * T);
  return { rho, sigma: rho / 1.225, a: Math.sqrt(1.4 * 287.05 * T), T, p };
}

// Lift-curve slope of a finite wing (Helmbold), per radian.
export const liftSlope = (AR) => (2 * Math.PI * AR) / (2 + Math.sqrt(AR * AR + 4));
export const aspectRatio = (s) => (s.span * s.span) / s.area;
export const inducedK = (s) => 1 / (Math.PI * s.oswald * aspectRatio(s));

// Induced-drag factor in ground effect (McCormick); 1 = free air.
export function groundEffectDrag(h, span) {
  if (!(h > 0)) return 0.05;
  const r = (16 * h) / span;
  return Math.max(0.05, (r * r) / (1 + r * r));
}
// Lift-slope multiplier in ground effect; 1 = free air.
export function groundEffectLift(h, span) {
  if (h >= span) return 1;
  const r = 1 - Math.max(h, 0) / span;
  return 1 + GROUND_EFFECT.liftBoost * r * r;
}

export function compressibilityFactor(mach) {
  const { mdd, k, maxFactor } = COMPRESSIBILITY;
  if (mach <= mdd) return 1;
  return Math.min(maxFactor, 1 + k * (mach - mdd) * (mach - mdd));
}

// Section coefficients over the full ±180° range.
//   alpha: angle of attack (rad); mods: { dCl0, dClMax, dCd0, dCm, liftMul, inducedMul, cd0Mul }
// Returns { cl, cd, cm, stall } where stall ∈ [0, 1] measures flow separation and also moves the
// centre of pressure aft (see cpShift), which is what makes the nose drop in a stall.
export function coefficients(s, alpha, mods = {}) {
  const a = liftSlope(aspectRatio(s)) * (mods.liftMul ?? 1);
  const dCl0 = mods.dCl0 ?? 0;
  const clMax = s.clMax + (mods.dClMax ?? 0);
  const clMin = s.clMin;
  alpha = wrapAngle(alpha);
  const ae = alpha - s.alpha0;
  const flat = 1.05 * Math.sin(2 * alpha); // flat plate, valid far past the stall and in reverse flow
  const aPos = (clMax - dCl0) / a;         // stall angles in effective AoA
  const aNeg = (clMin - dCl0) / a;
  const fade = 5 * DEG;

  let cl, stall;
  if (ae >= aNeg && ae <= aPos) {
    cl = a * ae + dCl0;
    stall = 0;
  } else if (ae > aPos) {
    const over = ae - aPos;
    const post = clMax * (1 - s.postStallDrop * Math.min(1, over / fade));
    const w = smoothstep(fade, 0.45, over);
    cl = post * (1 - w) + flat * w;
    stall = smoothstep(0, fade, over);
  } else {
    const over = aNeg - ae;
    const post = clMin * (1 - s.postStallDrop * Math.min(1, over / fade));
    const w = smoothstep(fade, 0.45, over);
    cl = post * (1 - w) + flat * w;
    stall = smoothstep(0, fade, over);
  }
  // lift makes induced drag; separated flow adds pressure drag ~ flat plate
  const cd0 = (s.cd0 + (mods.dCd0 ?? 0)) * (mods.cd0Mul ?? 1);
  const sa = Math.sin(alpha);
  const cd = cd0 + inducedK(s) * cl * cl * (mods.inducedMul ?? 1) + 1.28 * sa * sa * stall;
  const cm = (s.cm0 + (mods.dCm ?? 0)) * (1 - stall);
  return { cl, cd, cm, stall };
}

// Centre-of-pressure shift aft of the ac, as a fraction of chord: quarter chord → mid chord when stalled.
export const cpShift = (stall) => 0.25 * stall;

// Force on one surface, all vectors in world coordinates.
//   vAir:   air-relative velocity of the surface's ac {x, y}
//   chord:  world angle of the surface's zero-incidence chord line (body angle + incidence)
//   rho:    air density; flowRotate: rotate the incoming flow by this angle (downwash), rad
// Returns { alpha, cl, cd, cm, stall, q, lift:{x,y}, drag:{x,y}, moment }
export function surfaceForce(s, vAir, chord, rho, mods = {}, flowRotate = 0, qMul = 1) {
  const V = Math.hypot(vAir.x, vAir.y);
  if (V < 0.5) {
    return { alpha: 0, cl: 0, cd: 0, cm: 0, stall: 0, q: 0, V, lift: { x: 0, y: 0 }, drag: { x: 0, y: 0 }, moment: 0 };
  }
  const gamma = Math.atan2(vAir.y, vAir.x) + flowRotate;
  const alpha = wrapAngle(chord - gamma + (mods.dAlpha ?? 0));
  const c = coefficients(s, alpha, mods);
  const q = 0.5 * rho * V * V * qMul;
  const ux = Math.cos(gamma), uy = Math.sin(gamma); // flow direction
  const L = q * s.area * c.cl, D = q * s.area * c.cd;
  return {
    alpha, cl: c.cl, cd: c.cd, cm: c.cm, stall: c.stall, q, V,
    lift: { x: -uy * L, y: ux * L },  // perpendicular to the flow, toward the surface's upper side for +cl
    drag: { x: -ux * D, y: -uy * D },
    moment: q * s.area * (s.mac ?? s.area / s.span) * c.cm,
  };
}

// Drag-only item (fuselage, gear, speed brake): returns world force.
export function dragForce(cda, vAir, rho, mul = 1) {
  const V = Math.hypot(vAir.x, vAir.y);
  const k = 0.5 * rho * V * cda * mul;
  return { x: -vAir.x * k, y: -vAir.y * k };
}

// Steady straight-and-level numbers for a configuration (used by the analysis doc and the tests).
export function stallSpeed(weightN, s, rho = 1.225, dClMax = 0) {
  return Math.sqrt((2 * weightN) / (rho * s.area * (s.clMax + dClMax)));
}

// Longitudinal static stability from geometry: neutral point and static margin.
// x positions are body-frame (CG at 0); returns metres and fraction of MAC.
export function neutralPoint(wing, tail) {
  const aw = liftSlope(aspectRatio(wing)) * wing.area;
  const at = liftSlope(aspectRatio(tail)) * tail.area * tail.eta * (1 - tail.downwashGradient);
  const xnp = (aw * wing.ac[0] + at * tail.ac[0]) / (aw + at);
  return { xnp, staticMargin: -xnp / wing.mac };
}
