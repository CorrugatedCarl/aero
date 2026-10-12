// terrain.js — deterministic infinite terrain: a height function plus a chunk manager that keeps
// Box2D edge chains alive around the points of interest (the aircraft and the camera).

import { TERRAIN, RUNWAY } from './config.js';
import { smoothstep, lerp } from './util.js';

const pl = () => globalThis.planck;

function hash1(i, seed) {
  let h = Math.imul(i ^ (seed * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296 * 2 - 1; // [-1, 1)
}
// smooth 1D value noise in [-1, 1]
export function noise1(x, seed) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}
function fbm(x, seed, octaves) {
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq, seed + o * 101);
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

// terraces: flat treads joined by short risers
function terrace(h, step) {
  const k = Math.floor(h / step), f = h / step - k;
  return (k + smoothstep(0.72, 1, f)) * step;
}

// Ground height (m) at x. Flat around the runway, rolling hills and plateaus farther out.
export function terrainHeight(x) {
  const T = TERRAIN, s = T.seed;
  const away = x < T.flatFrom ? T.flatFrom - x : x > T.flatTo ? x - T.flatTo : 0;
  if (away <= 0) return 0;
  const w = smoothstep(0, T.blend, away);
  const hills = T.hillAmp * (fbm(x / T.hillWave, s, 4) + 0.35 * smoothstep(0, 4000, away));
  const plateauMask = smoothstep(0.15, 0.45, noise1(x / T.plateauWave, s + 7));
  const raised = T.hillAmp * 1.6 * (0.6 + 0.5 * fbm(x / (T.hillWave * 2.2), s + 31, 2));
  const plateau = terrace(Math.max(raised, 0), T.plateauStep);
  const detail = 3 * noise1(x / 90, s + 3) * (1 - plateauMask);
  return w * (lerp(hills, plateau, plateauMask) + detail);
}

export const terrainSlope = (x) => (terrainHeight(x + 1) - terrainHeight(x - 1)) / 2;
export const onRunway = (x) => x >= RUNWAY.x0 && x <= RUNWAY.x1;

// Box2D side: one static body per chunk, an open chain with ghost vertices so wheels roll over seams.
export class TerrainChunks {
  constructor(world) {
    this.world = world;
    this.chunks = new Map(); // index → body
  }
  chunkIndex(x) { return Math.floor(x / TERRAIN.chunkWidth); }
  build(i) {
    const P = pl(), W = TERRAIN.chunkWidth, d = TERRAIN.spacing;
    const x0 = i * W, n = Math.round(W / d);
    const verts = [];
    for (let k = 0; k <= n; k++) verts.push(P.Vec2(x0 + k * d, terrainHeight(x0 + k * d)));
    const chain = P.Chain(verts, false);
    chain.setPrevVertex(P.Vec2(x0 - d, terrainHeight(x0 - d)));
    chain.setNextVertex(P.Vec2(x0 + W + d, terrainHeight(x0 + W + d)));
    const body = this.world.createBody({ type: 'static' });
    body.createFixture(chain, { friction: TERRAIN.friction, userData: 'ground' });
    body.setUserData({ kind: 'ground' });
    return body;
  }
  // keep the chunks around every x in xs, drop the rest
  update(xs) {
    const want = new Set();
    for (const x of xs) {
      const c = this.chunkIndex(x);
      for (let k = -TERRAIN.keepChunks; k <= TERRAIN.keepChunks; k++) want.add(c + k);
    }
    for (const [i, body] of this.chunks) if (!want.has(i)) { this.world.destroyBody(body); this.chunks.delete(i); }
    for (const i of want) if (!this.chunks.has(i)) this.chunks.set(i, this.build(i));
  }
}
