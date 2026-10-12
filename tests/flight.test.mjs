// Flight-model tests: run with `npm test` (Node 20+). They fly the real Box2D sim with simple
// autopilots and check the behaviour the brief asks for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, defaultControls, fly, state, DEG, aero, config } from './harness.mjs';

const { WING, TAIL, RUNWAY } = config;

test('ISA atmosphere', () => {
  assert.ok(Math.abs(aero.atmosphere(0).rho - 1.225) < 0.001);
  assert.ok(Math.abs(aero.atmosphere(11000).rho - 0.3639) < 0.002);
  assert.ok(Math.abs(aero.atmosphere(0).a - 340.3) < 0.5);
});

test('lift curve: linear, then stalls, then flat plate', () => {
  const at = (deg, mods) => aero.coefficients(WING, deg * DEG, mods);
  assert.ok(at(5).cl > at(2).cl && at(10).cl > at(5).cl);
  const stallDeg = (WING.alpha0 + WING.clMax / aero.liftSlope(aero.aspectRatio(WING))) / DEG;
  assert.ok(at(stallDeg + 4).cl < WING.clMax, 'lift drops past the stall');
  assert.ok(at(stallDeg + 4).stall > 0.5);
  assert.ok(at(stallDeg + 4).cd > at(stallDeg - 2).cd * 1.5, 'drag rises in the stall');
  assert.ok(Math.abs(at(90).cl) < 0.05, 'no lift broadside');
  // flaps raise CL at a given AoA and lower the stall angle
  const flaps = config.FLAPS.settings[2];
  assert.ok(at(5, flaps).cl > at(5).cl + 0.3);
  const stallFlap = (WING.alpha0 + (WING.clMax + flaps.dClMax - flaps.dCl0) / aero.liftSlope(aero.aspectRatio(WING))) / DEG;
  assert.ok(stallFlap < stallDeg);
});

test('ground effect cuts induced drag near the ground only', () => {
  assert.ok(aero.groundEffectDrag(1, WING.span) < 0.8);
  assert.ok(aero.groundEffectDrag(50, WING.span) > 0.99);
});

test('pitch-stable from geometry: neutral point behind the CG', () => {
  const { staticMargin } = aero.neutralPoint(WING, TAIL);
  assert.ok(staticMargin > 0.03 && staticMargin < 0.25, `static margin ${staticMargin}`);
});

test('parked: struts compress to their static load and the brakes hold at idle', () => {
  const sim = new Sim(), c = defaultControls();
  fly(sim, c, 3);
  const s = state(sim);
  const main = sim.ac.legs.find((l) => l.cfg.id === 'main');
  assert.ok(main.compression > 0.05 && main.compression < 0.2, `main compression ${main.compression}`);
  assert.ok(Math.abs(s.vx) < 0.05);
  assert.equal(sim.ac.crashed, null);
});

test('cannot rotate below rotation speed; takes off from the runway with dry thrust', () => {
  const sim = new Sim(), c = defaultControls();
  c.wheelBrake = false; c.throttle = 1;
  let noseUpAt = null, liftoffX = null;
  fly(sim, c, 60, (sim, c) => {
    const s = state(sim);
    c.pitch = 1; // full back stick from the start of the roll
    const nose = sim.ac.legs.find((l) => l.cfg.id === 'nose');
    if (noseUpAt === null && nose.compression < 0.0) noseUpAt = s.ias;
    if (liftoffX === null && sim.ac.legs.every((l) => l.compression < 0)) liftoffX = s.x;
    return s.agl > 30;
  });
  assert.ok(noseUpAt > 40 && noseUpAt < 65, `nose came up at ${noseUpAt} m/s`);
  assert.ok(liftoffX !== null && liftoffX < RUNWAY.x1, `lift-off at x=${liftoffX}`);
  assert.equal(sim.ac.crashed, null);
});

test('full back stick stalls: AoA passes the stall, then the nose drops by itself', () => {
  const sim = new Sim(), c = defaultControls();
  sim.spawnAir({ x: 0, y: 3000, speed: 110, gamma: 0, alpha: 2 * DEG, gearDown: false, flaps: 0, throttle: 0 }, c);
  let stalled = false, noseDrop = false;
  fly(sim, c, 40, (sim, c, t) => {
    const s = state(sim);
    c.pitch = t > 2 ? 1 : 0;
    if (s.stall > 0.5) stalled = true;
    if (stalled && s.w < -10 * DEG) noseDrop = true;
    return noseDrop;
  });
  assert.ok(stalled, 'reached the stall');
  assert.ok(noseDrop, 'nose dropped with the stick held back');
});

test('engine spools up with lag and the afterburner adds thrust', () => {
  const sim = new Sim(), c = defaultControls();
  c.throttle = 1;
  fly(sim, c, 0.5);
  assert.ok(sim.ac.thrust < 0.6 * config.ENGINE.thrustDry, 'not instant');
  fly(sim, c, 8);
  assert.ok(sim.ac.thrust > 0.95 * config.ENGINE.thrustDry);
  c.afterburner = true;
  fly(sim, c, 2);
  assert.ok(sim.ac.thrust > 0.95 * config.ENGINE.thrustAB);
});

test('gear retracts in its transit time, not with weight on wheels', () => {
  const sim = new Sim(), c = defaultControls();
  c.gearDown = false;
  fly(sim, c, 1);
  assert.ok(sim.ac.legs.every((l) => l.extension > 0.99), 'squat switch blocks retraction');
  sim.spawnAir({ x: 0, y: 2000, speed: 120, gamma: 0, alpha: 3 * DEG, gearDown: true, flaps: 0, throttle: 0.6 }, c);
  c.gearDown = false;
  fly(sim, c, config.GEAR.transitTime * 0.5);
  const mid = sim.ac.legs[0].extension;
  assert.ok(mid > 0.3 && mid < 0.7, `half way after half the transit time (${mid})`);
  fly(sim, c, config.GEAR.transitTime * 0.6);
  assert.ok(sim.ac.legs.every((l) => l.extension < 0.02));
});

// drop onto the runway from just above it at a given sink rate and attitude
const main = config.GEAR.legs.find((l) => l.id === 'main');
const mainDrop = -(main.attach[1] - main.length - main.wheelRadius); // CG height above the main wheel bottoms
function drop(sink, attitudeDeg, gearDown = true) {
  const sim = new Sim(), c = defaultControls();
  const attitude = attitudeDeg * DEG;
  sim.spawnAir({
    x: 500, y: 0.6 + mainDrop + Math.abs(main.attach[0]) * Math.sin(attitude), speed: Math.hypot(62, sink), gamma: -Math.atan2(sink, 62),
    alpha: attitude + Math.atan2(sink, 62), gearDown, flaps: 2, throttle: 0,
  }, c);
  let touch = null;
  fly(sim, c, 4, (sim, c) => {
    const s = state(sim);
    c.pitch = Math.max(-1, Math.min(1, (attitude - s.theta) * 3 - s.w * 0.7 + 0.3));
    if (touch === null && (sim.ac.legs.some((l) => l.compression > 0.005) || sim.ac.crashed)) touch = -s.vy;
  });
  return { sim, touch, broken: sim.ac.legs.filter((l) => l.broken).map((l) => l.cfg.id) };
}

test('normal landing on the mains holds; a hard one collapses the gear', () => {
  const soft = drop(3, 5);
  assert.ok(soft.touch > 2 && soft.touch < 3.2, `touchdown ${soft.touch}`);
  assert.deepEqual(soft.broken, []);
  assert.equal(soft.sim.ac.crashed, null);
  const hard = drop(7, 5);
  assert.ok(hard.broken.includes('main'));
  assert.ok(hard.sim.ac.crashed);
});

test('landing on the nose wheel breaks it at a sink rate the mains survive', () => {
  const r = drop(4, -3);
  assert.ok(r.broken.includes('nose'));
  assert.deepEqual(drop(4, 5).broken, []);
});

test('landing with the gear up is a crash', () => {
  const r = drop(2, 5, false);
  assert.match(r.sim.ac.crashed ?? '', /GEAR-UP/);
});

test('approach, flare and stop on the runway', () => {
  const sim = new Sim(), c = defaultControls();
  sim.spawnAir({ x: -2500, y: 140, speed: 68, gamma: -3 * DEG, alpha: 9 * DEG, gearDown: true, flaps: 2, throttle: 0.5 }, c);
  let flare = false, td = null, iTh = 0.4, iSpd = 0, stopX = null;
  fly(sim, c, 150, (sim, c, t) => {
    const s = state(sim), dt = 1 / 240;
    if (td === null && sim.ac.legs.some((l) => l.compression > 0.01)) td = { t, sink: -s.vy };
    if (s.agl < 10) flare = true;
    if (td === null) {
      const vsT = flare ? -1 : -3.6;
      const thT = 4 * DEG + Math.max(-6, Math.min(6, vsT - s.vy)) * 1.5 * DEG;
      const e = thT - s.theta;
      iTh = Math.max(-1, Math.min(1, iTh + e * 0.8 * dt));
      c.pitch = Math.max(-1, Math.min(1, e * 3 - s.w * 0.7 + iTh));
      iSpd += (66 - s.ias) * dt;
      c.throttle = flare ? 0 : Math.max(0, Math.min(1, 0.5 + (66 - s.ias) * 0.06 + iSpd * 0.01));
    } else {
      c.throttle = 0; c.pitch = 0; c.wheelBrake = t - td.t > 2; c.speedBrake = true;
      if (Math.abs(s.vx) < 0.3) { stopX = s.x; return true; }
    }
  });
  assert.ok(td && td.sink < 3, `touchdown sink ${td?.sink}`);
  assert.equal(sim.ac.crashed, null);
  assert.ok(stopX !== null && stopX > RUNWAY.x0 && stopX < RUNWAY.x1, `stopped at ${stopX}`);
});
