// input.js — touch HUD, Xbox controller (Gamepad API) and keyboard, all writing one controls object.
//
// Xbox mapping (standard Gamepad layout): left stick Y = pitch · RT / LT = throttle up / down
// (or right stick Y) · A = gear · X = flaps · B = speed brake (hold) · LB = wheel brakes (hold)
// · Y = afterburner · D-pad ↑/↓ = trim · Menu = pause · View = reset.

import { CONTROLS, FLAPS } from './config.js';
import { clamp } from './util.js';

const DEAD = 0.12;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class Input {
  constructor(controls, actions) {
    this.c = controls;
    this.actions = actions;  // { pause(), reset(), approach(), debug() }
    this.invert = false;     // touch stick: false = drag down to pull (nose up), like a real stick
    this.parkingBrake = true;
    this.keys = new Set();
    this.touch = { pitch: 0, brake: false, speedBrake: false, trim: 0 };
    this.prevPad = [];
    this.padName = '';
    this.bindKeyboard();
  }

  // --- touch -------------------------------------------------------------------------------
  bindTouch(el) {
    const $ = (s) => el.querySelector(s);
    // throttle: absolute vertical slider, stays where it is left; the top zone is the afterburner
    const thr = $('#throttle');
    const setThr = (e) => {
      const r = thr.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.c.afterburner = v >= CONTROLS.abDetent;
      this.c.throttle = Math.min(1, v / CONTROLS.abDetent);
      this.parkingBrake = false;
    };
    this.drag(thr, setThr, null);

    // pitch stick: springs back to centre on release
    const stick = $('#stick');
    const setStick = (e) => {
      const r = stick.getBoundingClientRect();
      const v = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1); // +1 = bottom
      this.touch.pitch = this.invert ? -v : v;
    };
    this.drag(stick, setStick, () => { this.touch.pitch = 0; });

    const hold = (sel, key) => {
      const b = $(sel);
      const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.touch[key] = key === 'trim' ? +b.dataset.dir : true; b.classList.add('held'); if (key === 'brake') this.parkingBrake = false; };
      const off = () => { this.touch[key] = key === 'trim' ? 0 : false; b.classList.remove('held'); };
      b.addEventListener('pointerdown', on);
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
    };
    hold('#bBrakes', 'brake');
    hold('#bSpdBrk', 'speedBrake');
    hold('#bTrimUp', 'trim');
    hold('#bTrimDn', 'trim');
    const tap = (sel, fn) => $(sel).addEventListener('click', (e) => { e.preventDefault(); fn(); });
    tap('#bGear', () => this.toggleGear());
    tap('#bFlaps', () => this.cycleFlaps());
    tap('#bPause', () => this.actions.pause());
    tap('#bReset', () => this.actions.reset());
    tap('#bApproach', () => this.actions.approach());
    tap('#bDebug', () => this.actions.debug());
    tap('#bInvert', () => { this.invert = !this.invert; this.actions.invertChanged?.(this.invert); });
  }

  drag(el, move, release) {
    let id = null;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; el.setPointerCapture?.(id); el.classList.add('held'); move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; el.classList.remove('held'); release?.(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
  }

  toggleGear() { this.c.gearDown = !this.c.gearDown; }
  cycleFlaps() { this.c.flaps = (this.c.flaps + 1) % FLAPS.settings.length; }
  toggleAB() {
    this.c.afterburner = !this.c.afterburner;
    if (this.c.afterburner) this.c.throttle = 1;
    this.parkingBrake = false;
  }

  // --- keyboard (desktop testing) --------------------------------------------------------------
  bindKeyboard() {
    if (typeof window === 'undefined') return;
    const once = {
      KeyG: () => this.toggleGear(), KeyF: () => this.cycleFlaps(), KeyA: () => this.toggleAB(),
      KeyP: () => this.actions.pause(), Escape: () => this.actions.pause(), KeyR: () => this.actions.reset(),
      KeyT: () => this.actions.approach(), KeyD: () => this.actions.debug(),
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (once[e.code]) { once[e.code](); e.preventDefault(); }
      this.keys.add(e.code);
      if (/Arrow|Space/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // --- per-frame poll: merge everything into the controls ------------------------------------
  poll(dt) {
    const c = this.c, k = this.keys;
    let pitch = this.touch.pitch, thrRate = 0, trim = this.touch.trim;
    let brake = this.touch.brake, speedBrake = this.touch.speedBrake;

    if (k.has('ArrowUp') || k.has('KeyW')) pitch -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) pitch += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Equal')) thrRate += 1;
    if (k.has('ControlLeft') || k.has('ControlRight') || k.has('Minus')) thrRate -= 1;
    if (k.has('BracketRight')) trim += 1;
    if (k.has('BracketLeft')) trim -= 1;
    if (k.has('KeyB')) brake = true;
    if (k.has('KeyV')) speedBrake = true;

    const pad = this.gamepad();
    if (pad) {
      const b = (i) => pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0;
      const pressed = (i) => b(i) > 0.5 && !(this.prevPad[i] > 0.5);
      pitch += dz(pad.axes[1] ?? 0);                    // stick back (down, +) = nose up
      thrRate += b(7) - b(6);                           // RT / LT
      const rsy = dz(pad.axes[3] ?? 0);
      if (rsy) thrRate -= rsy * 1.5;                    // right stick Y as throttle
      if (b(12)) trim += 1;                             // D-pad up: nose-up trim
      if (b(13)) trim -= 1;
      if (b(1) > 0.5) speedBrake = true;                // B
      if (b(4) > 0.5) brake = true;                     // LB
      if (pressed(0)) this.toggleGear();                // A
      if (pressed(2)) this.cycleFlaps();                // X
      if (pressed(3)) this.toggleAB();                  // Y
      if (pressed(9)) this.actions.pause();             // Menu
      if (pressed(8)) this.actions.reset();             // View
      this.prevPad = pad.buttons.map((x) => x.value || (x.pressed ? 1 : 0));
    }

    if (thrRate) {
      c.throttle = clamp(c.throttle + thrRate * CONTROLS.throttleRate * dt, 0, 1);
      if (thrRate < 0 && c.throttle < 0.99) c.afterburner = false;
      this.parkingBrake = false;
    }
    if (brake) this.parkingBrake = false;
    c.pitch = clamp(pitch, -1, 1);
    c.trimInput = clamp(trim, -1, 1);
    c.wheelBrake = brake || this.parkingBrake;
    c.speedBrake = speedBrake;
  }

  gamepad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) { this.padName = p.id; return p; }
    this.padName = '';
    return null;
  }

  resetState() {
    this.parkingBrake = true;
    this.touch.pitch = 0;
  }
}
