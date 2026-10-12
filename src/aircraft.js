// aircraft.js — the jet as Box2D bodies and joints, plus the per-step forces on top of them:
// wing and tail lift/drag, drag items, engine thrust with spool lag and afterburner, gear actuation and damage.

import {
  AIRFRAME, WING, TAIL, FUSELAGE, GEAR_DRAG, SPEED_BRAKE, FLAPS, ENGINE, GEAR,
} from './config.js';
import {
  atmosphere, surfaceForce, dragForce, compressibilityFactor, groundEffectDrag, groundEffectLift, cpShift,
  liftSlope, aspectRatio,
} from './aero.js';
import { terrainHeight } from './terrain.js';
import { clamp, lerp, approach, DEG } from './util.js';

const pl = () => globalThis.planck;
const GROUP = -1; // aircraft parts never collide with each other

// Flap coefficient increments at any angle between the settings (linear between neighbours).
export function flapMods(angle) {
  const s = FLAPS.settings;
  if (angle <= s[0].angle) return s[0];
  for (let i = 1; i < s.length; i++) {
    if (angle <= s[i].angle) {
      const a = s[i - 1], b = s[i], t = (angle - a.angle) / (b.angle - a.angle);
      return {
        dCl0: lerp(a.dCl0, b.dCl0, t), dClMax: lerp(a.dClMax, b.dClMax, t),
        dCd0: lerp(a.dCd0, b.dCd0, t), dCm: lerp(a.dCm, b.dCm, t),
      };
    }
  }
  return s[s.length - 1];
}

// Engine thrust fraction of dry thrust as a function of spool.
export function dryThrustFraction(spool) {
  const E = ENGINE, t = clamp((spool - E.idleSpool) / (1 - E.idleSpool), 0, 1);
  return E.idleThrust + (1 - E.idleThrust) * Math.pow(t, 1.6);
}

export class Aircraft {
  constructor(world, x, y, angle = 0) {
    this.world = world;
    this.events = [];          // short messages for the HUD ("NOSE GEAR COLLAPSED", ...)
    this.crashed = null;       // reason string once crashed
    // control-surface and system state
    this.elevator = 0;         // rad, + = trailing edge down (nose down)
    this.trim = 0;             // rad
    this.flapIndex = 1;        // spawn with take-off flaps
    this.flapAngle = FLAPS.settings[1].angle;
    this.speedBrake = 0;       // 0..1
    this.gearDown = true;
    this.spool = ENGINE.idleSpool;
    this.ab = 0;               // 0..1 afterburner level
    this.abTimer = 0;
    this.throttle = 0;
    this.thrust = 0;
    this.forces = [];          // debug: { kind, p:{x,y}, f:{x,y} }
    this.aero = {};            // debug numbers
    this.build(x, y, angle);
  }

  build(x, y, angle) {
    const P = pl();
    const body = this.body = this.world.createBody({
      type: 'dynamic', position: P.Vec2(x, y), angle, bullet: true, allowSleep: false,
    });
    AIRFRAME.hull.forEach((poly, i) => {
      body.createFixture(P.Polygon(poly.map(([px, py]) => P.Vec2(px, py))), {
        density: 1, friction: AIRFRAME.hullFriction, restitution: 0.05, filterGroupIndex: GROUP,
        userData: { part: 'hull', index: i },
      });
    });
    const k = AIRFRAME.radiusOfGyration;
    body.setMassData({ mass: AIRFRAME.mass, center: P.Vec2(0, 0), I: AIRFRAME.mass * k * k });
    body.setUserData({ kind: 'airframe' });

    const down = body.getWorldVector(P.Vec2(0, -1));
    const up = body.getWorldVector(P.Vec2(0, 1));
    this.legs = GEAR.legs.map((g) => {
      const at = body.getWorldPoint(P.Vec2(g.attach[0], g.attach[1] - g.length));
      // strut: carries the wheel and slides along the leg axis to retract
      const strut = this.world.createBody({ type: 'dynamic', position: at, angle, allowSleep: false });
      strut.setMassData({ mass: g.strutMass, center: P.Vec2(0, 0), I: g.strutMass * 0.05 });
      const lock = this.world.createJoint(P.PrismaticJoint({
        enableLimit: true, lowerTranslation: -g.retract, upperTranslation: 0,
        enableMotor: true, maxMotorForce: g.collapseForce, motorSpeed: g.retract / GEAR.transitTime,
      }, body, strut, at, down));
      const wheel = this.world.createBody({ type: 'dynamic', position: at, angle, allowSleep: false });
      wheel.createFixture(P.Circle(g.wheelRadius), {
        density: 1, friction: GEAR.tireFriction, restitution: 0.02, filterGroupIndex: GROUP,
        userData: { part: 'wheel', leg: g.id },
      });
      wheel.setMassData({ mass: g.wheelMass, center: P.Vec2(0, 0), I: 0.5 * g.wheelMass * g.wheelRadius ** 2 });
      // suspension: Box2D's soft spring is defined by frequency and damping ratio over the joint's
      // effective mass, so convert the physical stiffness (N/m) and damping (N·s/m) into those
      const mEff = 1 / (1 / g.strutMass + 1 / g.wheelMass);
      const omega = Math.sqrt(g.stiffness / mEff);
      const spring = this.world.createJoint(P.WheelJoint({
        enableMotor: true, maxMotorTorque: GEAR.rollingTorque, motorSpeed: 0,
        frequencyHz: omega / (2 * Math.PI), dampingRatio: g.damping / (2 * mEff * omega),
      }, strut, wheel, at, up));
      return { cfg: g, strut, wheel, lock, spring, broken: false, compression: 0, extension: 1, onGround: false };
    });
  }

  destroy() {
    for (const l of this.legs) { this.world.destroyBody(l.wheel); this.world.destroyBody(l.strut); }
    this.world.destroyBody(this.body);
  }

  get mass() {
    return AIRFRAME.mass + GEAR.legs.reduce((m, g) => m + g.wheelMass + g.strutMass, 0);
  }

  event(text) {
    const same = this.events.find((e) => e.text === text);
    if (same) same.t = 0; else this.events.push({ text, t: 0 });
  }

  breakLeg(leg, why) {
    if (leg.broken) return;
    leg.broken = true;
    if (leg.spring) { this.world.destroyJoint(leg.spring); leg.spring = null; }
    leg.lock.enableMotor(false);
    this.event(`${leg.cfg.id.toUpperCase()} GEAR ${why}`);
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = reason;
    for (const l of this.legs) this.breakLeg(l, 'TORN OFF');
  }

  // Systems update: controls → surfaces, gear, engine. Called once per physics step.
  update(c, dt) {
    const T = TAIL;
    // elevator: stick (+1 = pull, nose up) commands trailing edge up; trim adds a bias
    this.trim = clamp(this.trim - c.trimInput * T.trimRate * dt, -T.trimMax, T.trimMax);
    const want = clamp(-c.pitch * T.elevatorMax + this.trim, -T.elevatorMax, T.elevatorMax);
    this.elevator = approach(this.elevator, want, T.elevatorRate * dt);
    // flaps and speed brake
    this.flapIndex = clamp(c.flaps, 0, FLAPS.settings.length - 1);
    this.flapAngle = approach(this.flapAngle, FLAPS.settings[this.flapIndex].angle, FLAPS.rate * dt);
    this.speedBrake = approach(this.speedBrake, c.speedBrake ? 1 : 0, SPEED_BRAKE.rate * dt);

    // gear: weight on wheels blocks retraction (squat switch)
    const wow = this.legs.some((l) => !l.broken && l.compression > 0.02);
    if (!c.gearDown && this.gearDown && wow) { if (!this._wowWarned) this.event('GEAR UP BLOCKED: WEIGHT ON WHEELS'); this._wowWarned = true; }
    else { this.gearDown = c.gearDown; if (c.gearDown) this._wowWarned = false; }
    for (const l of this.legs) {
      const g = l.cfg, t = l.lock.getJointTranslation();
      l.extension = clamp(1 + t / g.retract, 0, 1);
      if (!l.broken) {
        l.lock.setMotorSpeed((this.gearDown ? 1 : -1) * g.retract / GEAR.transitTime);
        // the down-lock gave way: the strut was shoved up while it should be locked down
        if (this.gearDown && l.extension < 0.9 && l.wasLocked) this.breakLeg(l, 'COLLAPSED');
        l.wasLocked = this.gearDown && l.extension > 0.995;
      }
      if (l.spring) {
        l.compression = l.spring.getJointTranslation();
        if (l.compression > g.travel) this.breakLeg(l, 'COLLAPSED');
      } else l.compression = 0;
      if (l.spring) l.spring.setMaxMotorTorque(GEAR.rollingTorque + (c.wheelBrake ? g.brakeTorque : 0));
    }

    // engine
    const E = ENGINE;
    const thr = this.crashed ? 0 : clamp(c.throttle, 0, 1);
    this.throttle = thr;
    const target = this.crashed ? 0 : E.idleSpool + (1 - E.idleSpool) * thr;
    const tSpool = clamp((this.spool - E.idleSpool) / (1 - E.idleSpool), 0, 1);
    const tau = target > this.spool ? lerp(E.spoolUpSlow, E.spoolUpFast, tSpool) : E.spoolDown;
    this.spool += (target - this.spool) * Math.min(1, dt / tau);
    const abWanted = !this.crashed && c.afterburner && thr > 0.99 && this.spool > 0.95;
    if (abWanted) {
      this.abTimer += dt;
      if (this.abTimer >= E.abLightDelay) this.ab = Math.min(1, this.ab + dt / E.abRamp);
    } else { this.abTimer = 0; this.ab = Math.max(0, this.ab - dt / 0.25); }

    for (const e of this.events) e.t += dt;
    this.events = this.events.filter((e) => e.t < 4);
  }

  // Aerodynamic and engine forces. Called once per physics step, before world.step.
  applyForces() {
    const P = pl(), b = this.body, theta = b.getAngle(), pos = b.getPosition();
    const atm = atmosphere(pos.y);
    const vCG = b.getLinearVelocity();
    const mach = vCG.length() / atm.a;
    const cmp = compressibilityFactor(mach);
    const F = this.forces = [];
    const add = (kind, p, f) => { b.applyForce(P.Vec2(f.x, f.y), p, true); F.push({ kind, p: { x: p.x, y: p.y }, f }); };

    // wing
    const pw = b.getWorldPoint(P.Vec2(WING.ac[0], WING.ac[1]));
    const hw = pw.y - terrainHeight(pw.x);
    const geD = groundEffectDrag(hw, WING.span), geL = groundEffectLift(hw, WING.span);
    const fm = flapMods(this.flapAngle);
    const wing = surfaceForce(WING, b.getLinearVelocityFromWorldPoint(pw), theta + WING.incidence, atm.rho, {
      dCl0: fm.dCl0, dClMax: fm.dClMax, dCd0: fm.dCd0, dCm: fm.dCm, liftMul: geL, inducedMul: geD, cd0Mul: cmp,
    });
    // stalled flow moves the centre of pressure aft of the quarter chord
    const pwCp = b.getWorldPoint(P.Vec2(WING.ac[0] - cpShift(wing.stall) * WING.mac, WING.ac[1]));
    add('lift', pwCp, wing.lift);
    add('drag', pwCp, wing.drag);
    b.applyTorque(wing.moment, true);

    // tail: sees the wing's downwash (weaker in ground effect and when the wing is stalled)
    const pt = b.getWorldPoint(P.Vec2(TAIL.ac[0], TAIL.ac[1]));
    const eps = clamp(TAIL.downwashGradient * (wing.alpha - WING.alpha0), -12 * DEG, 12 * DEG)
      * (1 - 0.5 * wing.stall) * (0.4 + 0.6 * geD);
    const de = this.elevator * TAIL.elevatorTau;
    const tail = surfaceForce(TAIL, b.getLinearVelocityFromWorldPoint(pt), theta + TAIL.incidence, atm.rho, {
      dAlpha: de, dCd0: 0.3 * de * de, cd0Mul: cmp,
    }, -eps, TAIL.eta);
    const ptCp = b.getWorldPoint(P.Vec2(TAIL.ac[0] - cpShift(tail.stall) * (TAIL.area / TAIL.span), TAIL.ac[1]));
    add('tlift', ptCp, tail.lift);
    add('tdrag', ptCp, tail.drag);

    // drag items
    const dragAt = (kind, local, cda) => {
      const p = b.getWorldPoint(P.Vec2(local[0], local[1]));
      if (cda > 0) add(kind, p, dragForce(cda, b.getLinearVelocityFromWorldPoint(p), atm.rho, kind === 'fdrag' ? cmp : 1));
    };
    dragAt('fdrag', FUSELAGE.point, FUSELAGE.cda);
    const ext = this.legs.reduce((s, l) => s + (l.broken ? 0 : l.extension), 0) / this.legs.length;
    dragAt('gdrag', GEAR_DRAG.point, GEAR_DRAG.cda * ext);
    dragAt('sbdrag', SPEED_BRAKE.point, SPEED_BRAKE.cda * this.speedBrake);

    // thrust along the body axis
    const E = ENGINE;
    this.thrust = Math.pow(atm.sigma, E.densityExponent)
      * (E.thrustDry * dryThrustFraction(this.spool) + this.ab * (E.thrustAB - E.thrustDry));
    if (this.crashed) this.thrust *= 0;
    const dir = b.getWorldVector(P.Vec2(1, 0));
    add('thrust', b.getWorldPoint(P.Vec2(E.point[0], E.point[1])), { x: dir.x * this.thrust, y: dir.y * this.thrust });

    // numbers for the HUD and debug overlay
    const V = vCG.length();
    this.aero = {
      alpha: wing.alpha, alphaTail: tail.alpha, cl: wing.cl, cd: wing.cd, clTail: tail.cl, stall: wing.stall,
      q: 0.5 * atm.rho * V * V, mach, ias: Math.sqrt(atm.rho / 1.225) * V, tas: V, rho: atm.rho,
      geDrag: geD, hWing: hw, downwash: eps, cmp,
      // AoA at which this configuration stalls (for the warning)
      alphaStall: WING.alpha0 + (WING.clMax + fm.dClMax - fm.dCl0) / (liftSlope(aspectRatio(WING)) * geL),
    };
  }
}
