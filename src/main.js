// main.js — wires the sim, input, renderer and HUD together and runs the frame loop.

import { Sim, defaultControls } from './sim.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { RUNWAY } from './config.js';
import { DEG } from './util.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const controls = defaultControls();
const sim = new Sim();
const renderer = new Renderer(canvas);
const hud = new Hud();
const ui = { paused: false, debug: false, fps: 60, physMs: 0, pad: '' };

const crashBox = $('#crash'), pauseBox = $('#paused');
const setPaused = (p) => { ui.paused = p; pauseBox.hidden = !p; $('#bPause').textContent = p ? 'Resume' : 'Pause'; };

const actions = {
  pause: () => setPaused(!ui.paused),
  reset: () => {
    sim.reset(controls); input.resetState(); renderer.particles = [];
    renderer.follow(sim, 0, true); crashBox.hidden = true; setPaused(false);
  },
  approach: () => {
    // 3° final, 3.2 km out, gear down, landing flaps, trimmed for about 130 kt
    sim.spawnAir({ x: RUNWAY.x0 + 300 - 3200, y: 3200 * Math.tan(3 * DEG) + 3.5, speed: 68, gamma: -3 * DEG,
      alpha: 4 * DEG, gearDown: true, flaps: 2, throttle: 0.55, trim: -8 * DEG }, controls);
    input.resetState(); input.parkingBrake = false; renderer.particles = [];
    renderer.follow(sim, 0, true); crashBox.hidden = true; setPaused(false);
  },
  debug: () => { ui.debug = !ui.debug; $('#bDebug').classList.toggle('on', ui.debug); },
  invertChanged: (inv) => $('#bInvert').classList.toggle('on', inv),
};
const input = new Input(controls, actions);
input.bindTouch(document.body);
$('#bRespawn').addEventListener('click', actions.reset);
$('#bResume').addEventListener('click', () => setPaused(false));

// keep the newest settings across a live reload of the page
const hot = window.claude?.hot;
hot?.snapshot?.(() => ({ debug: ui.debug, invert: input.invert }));
const restore = (d = {}) => {
  if (d.debug) actions.debug();
  if (d.invert) { input.invert = true; actions.invertChanged(true); }
};

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
document.addEventListener('gesturestart', (e) => e.preventDefault()); // no pinch-zoom on iPad

// throttle and stick thumbs follow the controls (gamepad and keyboard move them too)
const thrThumb = $('#throttle .thumb'), thrRead = $('#throttle .readout'), stickThumb = $('#stick .thumb');
function syncControls() {
  const t = controls.afterburner ? 1 : controls.throttle * 0.94;
  thrThumb.style.bottom = `calc(${(t * 100).toFixed(1)}% - 22px)`;
  thrRead.textContent = controls.afterburner ? 'AB' : `${Math.round(controls.throttle * 100)}%`;
  const pitchShown = input.invert ? -controls.pitch : controls.pitch;
  stickThumb.style.top = `calc(${(50 + pitchShown * 50).toFixed(1)}% - 26px)`;
  $('#bGear').classList.toggle('on', controls.gearDown);
  $('#bGear .state').textContent = controls.gearDown ? 'DOWN' : 'UP';
  $('#bFlaps .state').textContent = ['UP', 'T/O', 'LDG'][controls.flaps];
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ui.fps += (1 / Math.max(dt, 1e-3) - ui.fps) * 0.05;
  input.poll(dt);
  ui.pad = input.padName;
  if (!ui.paused) {
    const t0 = performance.now();
    sim.advance(dt, controls);
    ui.physMs += (performance.now() - t0 - ui.physMs) * 0.1;
    renderer.follow(sim, dt);
    if (sim.ac.crashed && crashBox.hidden) {
      $('#crashWhy').textContent = sim.ac.crashed;
      crashBox.hidden = false;
    }
  }
  renderer.draw(sim, ui, ui.paused ? 0 : dt);
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
  hud.draw(renderer.ctx, sim, controls, { W: renderer.W, H: renderer.H, top }, ui);
  syncControls();
  requestAnimationFrame(frame);
}

function start(data) {
  restore(data);
  renderer.follow(sim, 0, true);
  requestAnimationFrame(frame);
}
hot?.ready ? hot.ready(start) : start(hot?.data ?? {});
