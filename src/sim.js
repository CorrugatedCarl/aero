// sim.js — the Box2D world: fixed-timestep stepping, terrain streaming, crash detection, respawn.

import { SIM, AIRFRAME, RUNWAY, GEAR, FLAPS, ENGINE, TAIL } from './config.js';
import { Aircraft } from './aircraft.js';
import { TerrainChunks, terrainHeight } from './terrain.js';

const pl = () => globalThis.planck;

// Default control state; input.js writes into an object of this shape.
export const defaultControls = () => ({
  pitch: 0,          // -1 push … +1 pull
  trimInput: 0,      // -1 nose down … +1 nose up, while held
  throttle: 0,       // 0..1
  afterburner: false,
  flaps: 1,          // index into FLAPS.settings
  gearDown: true,
  speedBrake: false,
  wheelBrake: true,
});

export class Sim {
  constructor() {
    const P = pl();
    P.Settings.maxTranslation = 8; // m per step: allows ~1900 m/s at 240 Hz (default 2 caps at 480 m/s)
    this.world = P.World({ gravity: P.Vec2(0, -SIM.gravity) });
    this.terrain = new TerrainChunks(this.world);
    this.dt = 1 / SIM.hz;
    this.acc = 0;
    this.time = 0;
    this.world.on('post-solve', (contact, impulse) => this.onImpact(contact, impulse));
    this.reset();
  }

  // Respawn parked on the runway, gear down, take-off flaps, brakes set, engine at idle.
  reset(controls) {
    if (this.ac) this.ac.destroy();
    const main = GEAR.legs.find((g) => g.id === 'main');
    const x = RUNWAY.spawnX - main.attach[0];
    const y = terrainHeight(RUNWAY.spawnX) + main.wheelRadius + main.length - main.attach[1] + 0.02;
    this.terrain.update([x]);
    this.ac = new Aircraft(this.world, x, y, 0);
    this.ac.trim = TAIL.takeoffTrim;
    this.prevVel = { x: 0, y: 0 };
    this.g = 1;
    this.maxSink = 0;
    if (controls) Object.assign(controls, defaultControls());
    // let the struts settle before the first frame
    const settle = defaultControls();
    for (let i = 0; i < SIM.hz * 0.75; i++) this.step(settle);
    this.time = 0;
  }

  // Respawn in the air, e.g. on final approach: { x, y, speed, gamma (flight path, rad), alpha (body
  // angle above the flight path, rad), gearDown, flaps, throttle, trim }
  spawnAir(o, controls) {
    const P = pl();
    if (this.ac) this.ac.destroy();
    this.terrain.update([o.x]);
    const ac = this.ac = new Aircraft(this.world, o.x, o.y, o.gamma + o.alpha);
    const v = P.Vec2(o.speed * Math.cos(o.gamma), o.speed * Math.sin(o.gamma));
    ac.gearDown = o.gearDown;
    ac.flapIndex = o.flaps;
    ac.flapAngle = FLAPS.settings[o.flaps].angle;
    ac.trim = o.trim ?? 0;
    ac.spool = ENGINE.idleSpool + (1 - ENGINE.idleSpool) * o.throttle;
    for (const l of ac.legs) {
      if (!o.gearDown) {
        const up = ac.body.getWorldVector(P.Vec2(0, l.cfg.retract));
        for (const body of [l.strut, l.wheel]) body.setPosition(P.Vec2.add(body.getPosition(), up));
      }
      l.strut.setLinearVelocity(v); l.wheel.setLinearVelocity(v);
    }
    ac.body.setLinearVelocity(v);
    this.prevVel = { x: v.x, y: v.y };
    this.g = 1;
    this.time = 0;
    if (controls) Object.assign(controls, defaultControls(), {
      throttle: o.throttle, flaps: o.flaps, gearDown: o.gearDown, wheelBrake: false,
    });
  }

  onImpact(contact, impulse) {
    const a = contact.getFixtureA(), b = contact.getFixtureB();
    const ua = a.getUserData(), ub = b.getUserData();
    const hull = ua && ua.part === 'hull' ? ua : ub && ub.part === 'hull' ? ub : null;
    const ground = ua === 'ground' || ub === 'ground';
    if (!hull || !ground || !this.ac || this.ac.crashed) return;
    const j = impulse.normalImpulses.reduce((s, v) => s + v, 0);
    const dv = j / AIRFRAME.mass;
    const ac = this.ac, speed = ac.body.getLinearVelocity().length();
    const gearHolds = ac.legs.some((l) => !l.broken && l.extension > 0.9);
    const gearUp = ac.legs.every((l) => l.broken || l.extension < 0.5);
    if (dv > AIRFRAME.crashDeltaV) {
      const why = hull.index === 0 ? 'NOSE IMPACT' : hull.index >= AIRFRAME.tailParts ? 'TAIL IMPACT' : gearUp ? 'GEAR-UP IMPACT' : 'HARD IMPACT';
      ac.crash(`${why} (${dv.toFixed(1)} m/s)`);
    } else if (!gearHolds && speed > AIRFRAME.bellySpeed) {
      // nothing left to hold the airframe off the ground at speed: a belly landing wrecks it
      ac.crash(gearUp && !ac.legs.some((l) => l.broken) ? 'GEAR-UP LANDING' : 'GEAR COLLAPSED');
    } else {
      ac.event(hull.index >= AIRFRAME.tailParts ? 'TAIL STRIKE' : 'HULL CONTACT');
    }
  }

  step(controls) {
    const ac = this.ac;
    ac.update(controls, this.dt);
    ac.applyForces();
    this.world.step(this.dt, SIM.velocityIterations, SIM.positionIterations);
    this.time += this.dt;
  }

  // Advance by a frame's real time using the fixed step; returns the number of steps taken.
  advance(frameDt, controls) {
    this.acc = Math.min(this.acc + frameDt, SIM.maxStepsPerFrame * this.dt);
    let n = 0;
    while (this.acc >= this.dt) { this.step(controls); this.acc -= this.dt; n++; }
    if (n) this.telemetry(n * this.dt);
    return n;
  }

  // G-load along the body's vertical axis and other per-frame readouts.
  telemetry(dt) {
    const b = this.ac.body, v = b.getLinearVelocity();
    const ax = (v.x - this.prevVel.x) / dt, ay = (v.y - this.prevVel.y) / dt + SIM.gravity;
    this.prevVel = { x: v.x, y: v.y };
    const up = b.getWorldVector(pl().Vec2(0, 1));
    const g = (ax * up.x + ay * up.y) / SIM.gravity;
    this.g += (g - this.g) * Math.min(1, dt * 12);
    const anyGround = this.ac.legs.some((l) => l.compression > 0.01);
    if (!anyGround) this.lastAirSink = -v.y;
    if (anyGround && !this._wasGround && this.time > 1) {
      const sink = Math.max(0, this.lastAirSink ?? 0);
      this.lastTouchdown = { sink, t: this.time };
      this.ac.event(`TOUCHDOWN ${(sink * 196.85).toFixed(0)} FT/MIN`);
    }
    this._wasGround = anyGround;
    this.terrain.update([b.getPosition().x]);
  }
}
