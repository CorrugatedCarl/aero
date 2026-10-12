// config.js — every tunable constant in one place.
//
// Units are SI (m, kg, s, N, rad) unless a name says otherwise.
// Body frame: origin at the centre of gravity (CG), +x toward the nose, +y toward the canopy.
// The numbers below describe the stand-in jet; docs/AERO.md explains where each one comes from
// and how they get re-derived from your own sprite.

import { DEG } from './util.js';

// ---------------------------------------------------------------------------------------------
// Sprite. Set src to your side-view image (nose pointing right) and the two numbers that place it.
export const SPRITE = {
  src: null,           // e.g. 'ship.png'; null draws the built-in stand-in jet
  pxPerMeter: 40,      // image pixels per metre of airframe
  cgPx: [330, 110],    // image pixel that sits on the centre of gravity
};

// ---------------------------------------------------------------------------------------------
// Mass and the collision hull of the airframe.
export const AIRFRAME = {
  mass: 6280,          // kg, airframe + fuel + pilot (the gear bodies add GEAR masses on top: 6500 kg all-up)
  radiusOfGyration: 2.6, // m, pitch axis; Iyy = mass · k²
  length: 14.0,        // m, nose tip to tail cone
  // convex pieces of the side profile (≤ 8 vertices each), body frame, metres
  hull: [
    [[7.6, -0.05], [6.4, 0.35], [5.0, 0.62], [5.0, -0.46], [6.6, -0.32]],   // radome / nose
    [[5.0, 0.62], [2.4, 1.15], [0.6, 0.95], [-3.0, 0.62], [-3.0, -0.5], [5.0, -0.46]], // cockpit + centre
    [[-3.0, 0.62], [-3.0, -0.5], [-6.4, -0.06], [-6.4, 0.42]],              // aft fuselage
    [[-4.4, 0.58], [-6.4, 0.42], [-6.9, 2.75], [-6.0, 2.75]],               // fin
  ],
  // where the moving parts are drawn (body frame, metres); purely visual
  visual: {
    flapHinge: [-1.25, -0.22], flapChord: 1.0,
    elevatorHinge: [-6.45, 0.35], elevatorChord: 0.6,
    speedBrakeHinge: [-0.9, -0.5], speedBrakeLength: 1.3,
    nozzle: [-6.55, 0.17], nozzleRadius: 0.3,
  },
  hullFriction: 0.45,  // metal on ground: a belly landing slides to a stop
  // a hull impact that changes the airframe's velocity by more than this is a crash, m/s
  crashDeltaV: 4.0,
  // the hull scraping the ground faster than this with no gear holding it up is a crash, m/s
  bellySpeed: 15,
};

// ---------------------------------------------------------------------------------------------
// Aerodynamic surfaces. ac = aerodynamic centre (quarter chord) in the body frame.
export const WING = {
  ac: [0.45, -0.15],
  area: 26.0,          // m², planform, both sides
  span: 9.4,           // m (AR = b²/S = 3.4)
  mac: 2.77,           // m, mean aerodynamic chord = S / b
  incidence: 1.0 * DEG, // chord angle to the fuselage datum
  alpha0: -1.2 * DEG,  // zero-lift angle (slightly cambered section)
  clMax: 1.15,         // clean, positive stall
  clMin: -0.85,        // clean, negative stall
  cd0: 0.0080,         // profile drag
  oswald: 0.80,        // span efficiency
  cm0: -0.020,         // pitching moment about the ac (nose down)
  postStallDrop: 0.30, // fraction of clMax lost in the first 5° past the stall
};

export const TAIL = {
  ac: [-6.0, 0.35],
  area: 6.5,
  span: 4.6,
  incidence: 0.7 * DEG,
  alpha0: 0,           // symmetric section
  clMax: 1.0,
  clMin: -1.0,
  cd0: 0.0090,
  oswald: 0.85,
  cm0: 0,
  postStallDrop: 0.30,
  eta: 0.90,           // dynamic-pressure ratio at the tail (wake loss)
  downwashGradient: 0.45, // dε/dα: the wing bends the flow down onto the tail
  elevatorMax: 28 * DEG,  // deflection either way
  elevatorTau: 0.70,      // effectiveness: Δα_tail = τ · δe
  elevatorRate: 60 * DEG, // actuator rate, rad/s
  trimMax: 8 * DEG,       // elevator trim authority either way
  trimRate: 1.5 * DEG,    // rad/s while a trim button is held
  takeoffTrim: -7.5 * DEG, // set on the runway: holds about 170 kt hands-off with take-off flaps
};

// Drag-only items: CdA in m², applied at a body-frame point.
export const FUSELAGE = { cda: 0.55, point: [0.6, 0.1] };
export const GEAR_DRAG = { cda: 0.85, point: [0.6, -1.2] };          // scales with extension
export const SPEED_BRAKE = { cda: 1.4, point: [-1.6, -0.62], rate: 1.6 }; // rate: deploy fraction per second

// Flap settings. dCl0 shifts the lift curve up, dClMax raises the stall CL (so the stall AoA drops),
// dCd0 is extra profile drag, dCm is extra nose-down moment.
export const FLAPS = {
  settings: [
    { name: 'UP', angle: 0, dCl0: 0, dClMax: 0, dCd0: 0, dCm: 0 },
    { name: 'T/O', angle: 15 * DEG, dCl0: 0.22, dClMax: 0.25, dCd0: 0.012, dCm: -0.03 },
    { name: 'LDG', angle: 35 * DEG, dCl0: 0.50, dClMax: 0.45, dCd0: 0.045, dCm: -0.07 },
  ],
  rate: 8 * DEG,       // flap travel, rad/s
};

// Wave drag: profile drag is multiplied by 1 + k·(M − Mdd)² above the drag-divergence Mach.
export const COMPRESSIBILITY = { mdd: 0.85, k: 60, maxFactor: 3 };

// Ground effect (McCormick): induced drag × (16h/b)² / (1 + (16h/b)²); lift slope × 1 + boost·(1 − h/b)².
export const GROUND_EFFECT = { liftBoost: 0.18 };

// ---------------------------------------------------------------------------------------------
export const ENGINE = {
  point: [-5.6, -0.05],  // thrust line slightly below the CG: a little nose-up with power
  thrustDry: 30000,      // N at 100% (sea level, static)
  thrustAB: 46000,       // N with the afterburner lit
  idleThrust: 0.05,      // fraction of dry thrust at idle
  idleSpool: 0.22,       // spool (N2) fraction at idle
  spoolUpSlow: 3.2,      // s time constant spooling up from idle…
  spoolUpFast: 0.9,      // …and near full power
  spoolDown: 1.4,        // s time constant spooling down
  abLightDelay: 0.35,    // s from request to light-off
  abRamp: 0.5,           // s to full afterburner
  densityExponent: 0.75, // thrust ∝ σ^n
};

// ---------------------------------------------------------------------------------------------
// Landing gear. attach = where the leg meets the airframe; length = attach to wheel centre when down.
// stiffness and damping are the physical strut values; collapseForce is what the down-lock holds.
export const GEAR = {
  transitTime: 4.0,      // s, down→up or up→down
  tireFriction: 0.85,
  rollingTorque: 40,     // N·m of rolling resistance per wheel
  legs: [
    {
      id: 'nose', attach: [4.6, -0.42], length: 1.33, retract: 1.62,
      wheelRadius: 0.30, wheelMass: 40, strutMass: 20,
      stiffness: 160e3, damping: 14e3, travel: 0.24,
      collapseForce: 75e3, brakeTorque: 0,
    },
    {
      id: 'main', attach: [-0.8, -0.42], length: 1.21, retract: 1.58,
      wheelRadius: 0.42, wheelMass: 120, strutMass: 40,
      stiffness: 520e3, damping: 52e3, travel: 0.27,
      collapseForce: 300e3, brakeTorque: 22e3,
    },
  ],
};

// ---------------------------------------------------------------------------------------------
export const SIM = {
  gravity: 9.81,
  hz: 240,               // physics steps per second (fixed)
  maxStepsPerFrame: 12,
  velocityIterations: 10,
  positionIterations: 6,
};

export const TERRAIN = {
  seed: 1977,
  chunkWidth: 500,       // m per Box2D edge chain
  spacing: 10,           // m between chain vertices
  keepChunks: 3,         // chunks kept either side of the aircraft and the camera
  flatFrom: -2600, flatTo: 4200, // the flat region around the runway (h = 0)
  blend: 1800,           // m over which the flat region eases into hills
  hillAmp: 70, hillWave: 1500,
  plateauStep: 90,       // m between terrace levels
  plateauWave: 6000,
  friction: 0.9,
};

export const RUNWAY = {
  x0: 0, x1: 3000,       // m; threshold "09" at x0, "27" at x1
  spawnX: 160,           // where the aircraft respawns (main gear)
};

export const CAMERA = {
  lookAhead: 0.6,        // s of velocity to look ahead
  maxLookAhead: 160,     // m
  minView: 42,           // m of world visible vertically when parked
  viewPerSpeed: 0.22,    // extra metres of view per m/s
  viewPerAlt: 1.6,       // extra metres of view per metre above ground (keeps the ground in frame)
  maxView: 2400,
  minJetPx: 64,          // when zoomed far out the jet is drawn at least this long so it stays visible
  smoothing: 2.2,        // 1/s
};

export const CONTROLS = {
  throttleRate: 0.6,     // per second, gamepad triggers / keyboard
  abDetent: 0.94,        // touch slider position above which the afterburner is requested
};
