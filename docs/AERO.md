# Airframe analysis and flight-model constants

Every number here lives in `src/config.js`. Change it there; nothing else hard-codes airframe data.

## Status: stand-in airframe, waiting for your sprite

Your ship sprite never reached the session that built this, so the jet flying now is a stand-in:
a light single-engine jet trainer / light fighter, 14 m long, drawn in code (`makeStandInSprite` in
`src/render.js`). Everything below is derived for that stand-in, using the same method that will be
applied to your sprite (see "Re-deriving from your sprite" at the end).

## 1. Reading the side view

Body frame: origin at the centre of gravity (CG), +x toward the nose, +y up, metres.

| Item | Value | How it was set |
|---|---|---|
| Fuselage length | 14.0 m (nose +7.6, tail −6.4) | scale reference |
| CG | (0, 0), ~46% of length from the nose | about where the wing root sits; mass is mostly engine + fuel |
| Wing | root chord seen edge-on from x = +2.4 to −1.4 | wing visible in the side profile |
| Wing area S | 26.0 m² | span 9.4 m × MAC 2.77 m |
| Wing aspect ratio | 3.4 | b²/S; low and swept, typical of a jet trainer |
| Wing aerodynamic centre | (+0.45, −0.15): quarter chord of the MAC | quarter-chord rule |
| Horizontal tail area | 6.5 m², span 4.6 m (AR 3.3) | ~25% of wing area, normal for this class |
| Tail aerodynamic centre | (−6.0, 0.35) | quarter chord of the stabiliser |
| Tail arm (wing ac → tail ac) | 6.45 m | |
| Tail volume coefficient | 0.58 | S_t·l_t / (S·MAC); 0.5–0.7 is typical for jets |
| Engine thrust line | (−5.6, −0.05), along the body x axis | slightly below the CG: a little nose-up with power |
| Nose gear | leg at x = +4.6, wheel r = 0.30 m | |
| Main gear | leg at x = −0.8, wheel r = 0.42 m | behind the CG so the jet sits on its mains and can rotate |
| Tail-strike angle | ~19.6° | from main-wheel contact to the tail cone |

## 2. Mass and inertia

| | |
|---|---|
| All-up mass | 6,500 kg (airframe body 6,280 kg + gear struts and wheels 220 kg) |
| Weight | 63.8 kN |
| Wing loading | 250 kg/m² |
| Pitch inertia Iyy | 42,450 kg·m² (radius of gyration 2.6 m ≈ 0.19 × length) |
| Static gear loads | nose 9.4 kN (15%), mains 54.3 kN (85%) |

## 3. Aerodynamics

Forces are applied every physics step (240 Hz) on top of Box2D:

* **Wing and tail are separate lifting surfaces.** Each gets its own angle of attack from the
  airflow at its own aerodynamic centre. That velocity comes from Box2D
  (`getLinearVelocityFromWorldPoint`), so it includes pitch rotation, which is where pitch damping
  comes from. Lift = ½ρv²S·CL acts perpendicular to the local airflow and drag = ½ρv²S·CD along it.
* **Lift curve.** Slope from the Helmbold equation, a = 2πA / (2 + √(A² + 4)): 3.59 /rad for
  the wing, 3.51 /rad for the tail. It is linear up to CL_max = 1.15 (clean wing, 17.1° AoA).
  Past that, 30% of CL_max is lost over 5°, then the curve blends into a flat plate (CL = 1.05 sin 2α).
  The flat plate covers the full ±180°, so tail slides and spins don't break the model.
* **Drag polar.** CD = CD0 + k·CL² + 1.28·sin²α·(stall), with k = 1/(π·e·A) = 0.117 (e = 0.8).
  CD0 is 0.008 for the wing, plus fuselage drag (CdA 0.55 m²), gear drag (CdA 0.85 m²,
  scaled by gear extension) and speed-brake drag (CdA 1.4 m²). Above Mach 0.85, wave drag
  multiplies the profile drag by 1 + 60(M − 0.85)², capped at 3×.
* **Stall nose-drop.** As the flow separates, the wing's centre of pressure moves from the quarter
  chord toward mid-chord. That makes the nose drop by itself, without any scripted correction.
* **Downwash.** The tail sees the airflow bent down by ε = 0.45·(α_wing − α0). Downwash is weaker
  when the wing is stalled and in ground effect, so the nose tends to drop in the flare. Real jets
  do this too.
* **Ground effect** (McCormick). Induced drag is multiplied by (16h/b)² / (1 + (16h/b)²), and the
  lift slope rises by up to 18% when the wing is within one span of the ground.
* **Atmosphere.** ISA density and speed of sound. Thrust scales with σ^0.75.

### Pitch stability comes from geometry

The neutral point is the lift-weighted position of the wing and tail aerodynamic centres. The
tail's share is reduced by its dynamic-pressure ratio (η = 0.9) and by the downwash, (1 − dε/dα):

x_np = (a_w·S_w·x_w + a_t·S_t·η·(1 − dε/dα)·x_t) / (a_w·S_w + a_t·S_t·η·(1 − dε/dα)) = **−0.25 m**

With the CG at 0, the **static margin is 8.9% of MAC**. That is mildly stable, typical of a
trainer, and it is why a trimmed jet returns to its trim AoA after a disturbance without any
auto-level code. `neutralPoint()` in `src/aero.js` computes this, and the debug overlay draws the
point as a purple dot.

### Controls

| Control | Model |
|---|---|
| Elevator | ±28°, effectiveness τ = 0.7: tail AoA changes by τ·δe; moves at 60°/s |
| Trim | ±8° elevator bias, moves at 1.5°/s. Starts at −7.5° (take-off trim) on the runway |
| Flaps UP / T/O / LDG | 0° / 15° / 35°. ΔCL0 0 / 0.22 / 0.50, ΔCL_max 0 / 0.25 / 0.45, ΔCD0 0 / 0.012 / 0.045, ΔCm 0 / −0.03 / −0.07 |
| Speed brake | CdA 1.4 m² below and behind the CG (slight nose-down), deploys in 0.6 s |
| Engine | 30 kN dry, 46 kN with afterburner. Spool time constant 3.2 s from idle, 0.9 s near full power, 1.4 s spooling down. Afterburner lights 0.35 s after it's requested at full throttle and ramps up over 0.5 s |

## 4. Resulting performance (sea level)

| | |
|---|---|
| Stall speed, clean / T/O / LDG flaps | 115 / 104 / 97 kt |
| Stall AoA, clean / T/O / LDG | 17.1° / 17.6° / 16.3° (flaps raise CL_max but shift the curve up, so the stall comes earlier) |
| Thrust/weight, dry / afterburner | 0.47 / 0.72 |
| Max L/D (clean, gear up) | 8.6 at about 174 kt |
| Nose comes up with full back stick | ~45 m/s (87 kt) |
| Rotation and lift-off (rotate at 120 kt to 10°) | lifts off at ~127 kt after a ~550 m roll on dry thrust |
| Hands-off approach (trim −7°, LDG flaps, 55% throttle) | ~136 kt, ~500 ft/min down |

## 5. Landing gear

Each leg is three bodies and two joints. Nothing is moved kinematically:

1. A **prismatic joint** between the airframe and a strut body, along the leg axis, with limits
   from 0 (down-locked) to −retract (stowed). Its motor drives the gear up or down in the 4 s
   transit time. The motor's force limit is the down-lock's strength (75 kN nose, 300 kN main).
   A load above that shoves the strut up, and the leg counts as collapsed.
2. A **wheel joint** between the strut and the wheel, which is the oleo. Box2D defines its spring
   by frequency and damping ratio over the joint's effective mass. The physical stiffness
   (160 / 520 kN/m) and damping (14 / 52 kN·s/m) are converted to those, so static deflection
   comes out at about 6 cm nose and 10 cm main. A compression past the travel limit
   (0.24 m nose, 0.27 m main) breaks the leg. The wheel joint's motor gives rolling resistance
   and the wheel brakes (22 kN·m per main).

Behaviour measured by the tests (`tests/flight.test.mjs`):

| Touchdown | Result |
|---|---|
| Mains first, up to ~4.2 m/s (830 ft/min) | holds |
| Mains first, ~5.3 m/s (1,040 ft/min) and above | main gear collapses, belly slide, crash |
| Nose first at ~3.7 m/s (740 ft/min) | nose gear collapses |
| Gear up | hull hits the runway: crash |
| Any hull impact with Δv > 4 m/s | crash |

A squat switch blocks gear retraction while any strut is compressed.

## 6. Re-deriving from your sprite

When the sprite is attached:

1. Put the image in the repo and set `SPRITE.src`, `SPRITE.pxPerMeter` (from the real or
   intended length) and `SPRITE.cgPx`.
2. Measure from the image: fuselage length, wing root chord position and MAC, wing span (from the
   design, or estimated from the chord at an assumed aspect ratio), tail area and position,
   engine nozzle, and where the nose and main gear legs can go.
3. Update `AIRFRAME.hull` (convex pieces tracing the silhouette), `WING`, `TAIL`, `ENGINE.point`,
   `GEAR.legs`, and `AIRFRAME.visual`. Put the main gear 0.5–1 m behind the CG.
4. Run `npm test`. The tests check stability (static margin 3–25%), rotation speed, lift-off
   inside the runway, the stall break, landing limits and stopping on the runway. Adjust the
   wing ac or tail area until they pass, then turn on the debug overlay and fly it.
