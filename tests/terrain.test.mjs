import test from 'node:test';
import assert from 'node:assert/strict';
import { terrain, config } from './harness.mjs';

test('runway region is flat at 0', () => {
  for (let x = config.TERRAIN.flatFrom; x <= config.TERRAIN.flatTo; x += 50) assert.equal(terrain.terrainHeight(x), 0);
});

test('terrain is deterministic, continuous and has hills both ways', () => {
  let maxStep = 0, maxH = 0;
  for (let x = -40000; x < 40000; x += 10) {
    const h = terrain.terrainHeight(x);
    assert.equal(h, terrain.terrainHeight(x));
    maxStep = Math.max(maxStep, Math.abs(terrain.terrainHeight(x + 10) - h));
    maxH = Math.max(maxH, h);
  }
  assert.ok(maxStep < 10, `steepest 10 m step ${maxStep}`);
  assert.ok(maxH > 60, `highest ${maxH}`);
  assert.ok(terrain.terrainHeight(-20000) !== 0 && terrain.terrainHeight(20000) !== 0);
});
