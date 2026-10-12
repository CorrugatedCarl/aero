// config.js — every tunable constant in one place.
//
// Units are SI (m, kg, s, N, rad) unless a name says otherwise.
// Body frame: origin at the centre of gravity (CG), +x toward the nose, +y toward the canopy.
// The numbers below are measured from ship.png; docs/AERO.md explains where each one comes from.

import { DEG } from './util.js';

// ---------------------------------------------------------------------------------------------
// Sprite. Set src to your side-view image (nose pointing right) and the two numbers that place it.
export const SPRITE = {
  src: 'ship.png',     // your side-view sprite, nose pointing right (215 × 69 px)
  pxPerMeter: 13.5,    // 215 px → 15.9 m long
  cgPx: [96, 35],      // image pixel on the centre of gravity (see docs/AERO.md)
  pixelArt: true,      // scale without smoothing so the pixels stay crisp
};

// ---------------------------------------------------------------------------------------------
// Mass and the collision hull of the airframe.
export const AIRFRAME = {
  mass: 7740,          // kg, airframe + fuel + pilot (the gear bodies add GEAR masses on top: 8000 kg all-up)
  radiusOfGyration: 3.0, // m, pitch axis; Iyy = mass · k²
  length: 15.85,       // m, nose tip to the rear of the fins
  // convex pieces traced from the sprite's silhouette (≤ 8 vertices each), body frame, metres
  hull: [
    [[6.96, 0.67], [8.74, 0.22], [8.74, -0.07], [6.96, -0.67]],             // nose (index 0: nose impacts)
    [[5.11, 1.19], [6.96, 1.04], [6.96, -0.67], [5.11, -0.81]],
    [[3.63, 1.26], [5.11, 1.19], [5.11, -1.11], [3.63, -1.11]],
    [[1.78, 1.11], [3.63, 1.26], [3.63, -0.96], [1.78, -1.11]],
    [[-0.44, 0.96], [1.78, 1.04], [1.78, -1.11], [-0.44, -1.26]],
    [[-2.67, 1.26], [-0.44, 1.11], [-0.44, -1.26], [-2.67, -1.26]],
    [[-4.89, 1.33], [-2.67, 1.26], [-2.67, -1.26], [-4.89, -1.26]],
    [[-6.44, 1.19], [-4.89, 1.33], [-4.89, -1.26], [-6.44, -1.11]],
    [[-6.96, 2.59], [-5.93, 2.59], [-4.96, 1.33], [-6.3, 1.33]],             // dorsal fin
    [[-6.15, -1.26], [-4.96, -1.33], [-6.0, -2.44], [-7.11, -2.44]],         // ventral fin
    [[-4.44, -1.33], [-0.74, -1.33], [-0.74, -2.3], [-2.96, -2.44], [-3.85, -2.44], [-4.44, -2.3]], // lower cannon pod
    [[-4.89, 2.22], [-2.81, 2.22], [-0.74, 2.07], [-0.74, 1.85], [-2.81, 1.41], [-4.89, 1.41]],     // upper cannon pod
  ],
  tailParts: 6,        // hull pieces from this index on count as the tail for strike messages
  // where the moving parts are drawn (body frame, metres); a chord or length of 0 hides that part
  visual: {
    flapHinge: [-2.0, -0.4], flapChord: 0,
    elevatorHinge: [-6.6, 0], elevatorChord: 0,
    speedBrakeHinge: [0.4, -1.26], speedBrakeLength: 1.5,
    nozzle: [-6.55, -0.07], nozzleRadius: 0.7,
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
  ac: [0.52, -0.2],
  area: 32.0,          // m², planform, both sides (hidden in the side view; see docs/AERO.md)
  span: 10.4,          // m (AR = b²/S = 3.4)
  mac: 3.08,           // m, mean aerodynamic chord = S / b
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
  ac: [-5.6, 0],       // quarter chord of the X-tail panels at the rear
  area: 10.0,          // m², horizontal projection of the four X-tail panels
  span: 5.0,
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
  trimMax: 12 * DEG,      // elevator trim authority either way
  trimRate: 1.5 * DEG,    // rad/s while a trim button is held
  takeoffTrim: -10 * DEG,  // set on the runway: hands-off climb at about 170 kt with take-off flaps
};

// Drag-only items: CdA in m², applied at a body-frame point.
export const FUSELAGE = { cda: 0.8, point: [0.5, 0] };
export const GEAR_DRAG = { cda: 1.0, point: [1.5, -2.2] };           // scales with extension
export const SPEED_BRAKE = { cda: 1.6, point: [-0.3, -1.4], rate: 1.6 };  // rate: deploy fraction per second

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
  point: [-6.4, -0.07],  // the blue nozzle at the rear; thrust line just below the CG: a little nose-up with power
  thrustDry: 37000,      // N at 100% (sea level, static)
  thrustAB: 57000,       // N with the afterburner lit
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
      id: 'nose', attach: [4.55, -1.26], length: 2.27, retract: 2.59,
      wheelRadius: 0.32, wheelMass: 45, strutMass: 25,
      stiffness: 200e3, damping: 17e3, travel: 0.24,
      collapseForce: 90e3, brakeTorque: 0,
    },
    {
      id: 'main', attach: [-1.0, -1.26], length: 2.14, retract: 2.59,
      wheelRadius: 0.45, wheelMass: 140, strutMass: 50,
      stiffness: 620e3, damping: 62e3, travel: 0.27,
      collapseForce: 360e3, brakeTorque: 28e3,
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
