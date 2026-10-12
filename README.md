# Aero Test Range

A 2D side-scrolling jet (your ship, `ship.png`) built on real rigid-body physics: Planck.js (Box2D) bodies and joints, plus
wing and tail aerodynamics applied every step. Infinite procedural terrain with a painted runway
at the origin. Made for iPad first: touch controls and an Xbox controller over Bluetooth.

## Run it

No build step; serve the folder over HTTP and open it:

```sh
python3 -m http.server 8000     # then open http://<this-machine>:8000 on the iPad
```

Or build one self-contained file (Planck.js still loads from jsDelivr):

```sh
node tools/build-single.mjs     # → dist/aero.html
```

## Install on the iPad

Live at **https://corrugatedcarl.github.io/aero/** once GitHub Pages is on (repo Settings → Pages →
Deploy from a branch → `main`, `/ (root)`).

1. Open that address in Chrome or Safari on the iPad and wait for the runway to appear.
2. Tap **Share → Add to Home Screen**.
3. Launch **Aero** from the Home Screen: it opens full screen in landscape and works offline
   (`sw.js` caches the game on first launch). A new version is picked up in the background and
   shows on the next launch.

## Fly it

* **Take off:** push the throttle to the top (MIL) and let it spool up. Pull back at about
  120 kt, hold about 10° nose up, raise the gear once climbing (GEAR), then flaps UP.
* **Land:** press *Final approach* for a 3° final, or fly your own. Use landing flaps, gear down,
  about 130 kt, and keep the PAPI lights two white, two red. Flare just above the runway, then
  idle, speed brake and wheel brakes.
* **Debug** draws the lift, drag, thrust and weight vectors, the CG, neutral point and
  aerodynamic centres, and shows AoA, CL, CD, downwash, ground effect, spool and strut readouts.

| | Touch | Xbox | Keyboard |
|---|---|---|---|
| Pitch | right stick track (drag down = pull) | left stick Y | W / S |
| Throttle | left slider; top zone = afterburner | RT / LT or right stick Y | Shift / Ctrl |
| Afterburner | slider top zone | Y | A |
| Gear | GEAR | A | G |
| Flaps | FLAPS (UP → T/O → LDG) | X | F |
| Speed brake | SPD BRK (hold) | B | V |
| Wheel brakes | BRAKES (hold) | LB | B |
| Trim | TRIM nose up / down | D-pad ↑ / ↓ | [ / ] |
| Pause / reset | top bar | Menu / View | P / R |

## Code

| File | What it does |
|---|---|
| `src/config.js` | **every tunable constant**: geometry, mass, aero, engine, gear, terrain, camera |
| `src/aero.js` | pure aerodynamics: ISA atmosphere, lift and drag curves, ground effect, neutral point |
| `src/aircraft.js` | Box2D bodies and joints for the airframe and gear; applies aero and thrust each step |
| `src/sim.js` | world, fixed 240 Hz step, crash detection, respawn |
| `src/terrain.js` | deterministic terrain height and Box2D edge-chain chunks |
| `src/input.js` | touch HUD, Gamepad API, keyboard → one controls object |
| `src/render.js` | Canvas 2D: sky, parallax, terrain, runway, the jet, effects, debug vectors |
| `src/hud.js` | instruments and the debug readout |

`docs/AERO.md` documents the airframe analysis and how every constant was derived.

## Tests

```sh
npm install && npm test
```

The tests fly the real sim: rotation speed, take-off inside the runway, the stall break, engine
spool lag, gear transit and the squat switch, landing limits (mains, nose first, gear up), and a
full approach, flare and stop.
