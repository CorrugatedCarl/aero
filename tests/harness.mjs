// tests/harness.mjs — loads Planck as a global (as the browser page does) and imports the sim.
import planck from 'planck';
globalThis.planck = planck;
export const { Sim, defaultControls } = await import('../src/sim.js');
export const aero = await import('../src/aero.js');
export const config = await import('../src/config.js');
export const terrain = await import('../src/terrain.js');
export const DEG = Math.PI / 180;

// fly with a function that sets controls each step; stop when it returns true
export function fly(sim, c, seconds, each) {
  const n = Math.round(seconds * config.SIM.hz);
  for (let i = 0; i < n; i++) {
    sim.step(c);
    if (i % 8 === 7) sim.telemetry(8 / config.SIM.hz);
    if (each && each(sim, c, (i + 1) / config.SIM.hz)) return (i + 1) / config.SIM.hz;
  }
  return seconds;
}
export const state = (sim) => {
  const b = sim.ac.body, p = b.getPosition(), v = b.getLinearVelocity();
  return { x: p.x, y: p.y, vx: v.x, vy: v.y, theta: b.getAngle(), w: b.getAngularVelocity(),
    agl: p.y - terrain.terrainHeight(p.x), ...sim.ac.aero };
};
