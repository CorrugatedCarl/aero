# Airframe analysis and flight-model constants

Every number here lives in `src/config.js`. Change it there; nothing else hard-codes airframe data.

## 1. Reading the sprite

`ship.png` is 215 × 69 px, a side view with the nose to the right. Scale: **13.5 px per metre**,
so the ship is **15.9 m** long and the fuselage is 2.5 m deep, about the size of a light fighter.
Body frame: origin at the centre of gravity (CG), +x toward the nose, +y up, metres.
Pixel (px, py) maps to body (x, y) = ((px − 96) / 13.5, (35 − py) / 13.5).

| Item | Pixels | Body frame | How it was read |
|---|---|---|---|
| Nose tip (shark mouth) | x 214, y 32 | (+8.74, +0.22) | rightmost opaque pixel |
| Fuselage | x 9–214, y 17–52 | depth 2.5 m | column-by-column top and bottom of the opaque pixels |
| Canopy (green pixels) | x 142–185, y 19–26 | +3.4 … +6.6 m | colour mask |
| Engine nozzle (blue pixels) | x 8–9, y 26–46 | (−6.5, −0.07), radius 0.7 m | colour mask; this is the thrust point |
| Dorsal and ventral fins | x 0–29, y 0–19 and 52–68 | to ±2.5 m | swept fins at the tail, read as an X-tail |
| Upper and lower cannon pods | x 30–86, y 5–16 and 53–68 | above and below the rear fuselage | mass and drag only, no lift |
| Silhouette area centroid | (87, 35) | (−0.67, 0) | mean of all opaque pixels |
| **Centre of gravity** | **(96, 35)** | **(0, 0)** | 9 px ahead of the area centroid: the fins and pods are light structure, while the cockpit, nose and forward fuel are dense |

**What the side view can't show, and the assumptions made for it.** The wing is edge-on, so it is
invisible. It is assumed to be mid-fuselage at the deepest part of the body (x ≈ 70–112 px),
with a low aspect ratio like the fighter the art suggests:

| Surface | Value | Basis |
|---|---|---|
| Wing area / span / MAC | 32 m² / 10.4 m / 3.08 m (AR 3.4) | wing loading 250 kg/m², typical of light fighters |
| Wing aerodynamic centre | (+0.52, −0.2) | quarter chord of the MAC, placed so the ship is pitch-stable (below) |
| Tail | X-tail at the rear fins; 10 m² horizontal projection, span 5 m | the four canted fin panels; their horizontal share gives pitch control |
| Tail aerodynamic centre | (−5.6, 0) | quarter chord of the fins at mid-height (x ≈ 20 px) |
| Tail volume coefficient | 0.62 | S_t·l_t / (S·MAC); 0.5–0.7 is normal for jets |

**Collision hull:** 12 convex pieces traced from the silhouette: 8 fuselage sections from tail to
nose, the dorsal fin, the ventral fin and both cannon pods. The lowest points are the ventral
fin and the lower pod, both 2.44 m below the CG, which is why the gear is tall (below).

## 2. Mass and inertia

| | |
|---|---|
| All-up mass | 8,000 kg (airframe body 7,740 kg + gear struts and wheels 260 kg) |
| Weight | 78.5 kN |
| Wing loading | 250 kg/m² |
| Pitch inertia Iyy | 69,660 kg·m² (radius of gyration 3.0 m ≈ 0.19 × length) |
| Static gear loads | nose 14.1 kN (18%), mains 64.3 kN (82%) |

## 3. Aerodynamics

Forces are applied every physics step (240 Hz) on top of Box2D:

* **Wing and tail are separate lifting surfaces.** Each gets its own angle of attack from the
  airflow at its own aerodynamic centre. That velocity comes from Box2D
  (`getLinearVelocityFromWorldPoint`), so it includes pitch rotation, which is where pitch damping
  comes from. Lift = ½ρv²S·CL acts perpendicular to the local airflow and drag = ½ρv²S·CD along it.
* **Lift curve.** Slope from the Helmbold equation, a = 2πA / (2 + √(A² + 4)): 3.59 /rad for
  the wing, 3.02 /rad for the tail. It is linear up to CL_max = 1.15 (clean wing, 17.2° AoA).
  Past that, 30% of CL_max is lost over 5°, then the curve blends into a flat plate (CL = 1.05 sin 2α).
  The flat plate covers the full ±180°, so tail slides and spins don't break the model.
* **Drag polar.** CD = CD0 + k·CL² + 1.28·sin²α·(stall), with k = 1/(π·e·A) = 0.118 (e = 0.8).
  CD0 is 0.008 for the wing, plus fuselage and pod drag (CdA 0.8 m²), gear drag (CdA 1.0 m²,
  scaled by gear extension) and speed-brake drag (CdA 1.6 m²). Above Mach 0.85, wave drag
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

x_np = (a_w·S_w·x_w + a_t·S_t·η·(1 − dε/dα)·x_t) / (a_w·S_w + a_t·S_t·η·(1 − dε/dα)) = **−0.19 m**

With the CG at 0, the **static margin is 6% of MAC**. That is mildly stable, typical of a
fighter, and it is why a trimmed jet returns to its trim AoA after a disturbance without any
auto-level code. `neutralPoint()` in `src/aero.js` computes this, and the debug overlay draws the
point as a purple dot.

### Controls

| Control | Model |
|---|---|
| Elevator | ±28°, effectiveness τ = 0.7: tail AoA changes by τ·δe; moves at 60°/s |
| Trim | ±12° elevator bias, moves at 1.5°/s. Starts at −10° (take-off trim) on the runway |
| Flaps UP / T/O / LDG | 0° / 15° / 35°. ΔCL0 0 / 0.22 / 0.50, ΔCL_max 0 / 0.25 / 0.45, ΔCD0 0 / 0.012 / 0.045, ΔCm 0 / −0.03 / −0.07 |
| Speed brake | CdA 1.6 m² on the belly just behind the CG (slight nose-down), deploys in 0.6 s |
| Engine | 37 kN dry, 57 kN with afterburner, at the blue nozzle. Spool time constant 3.2 s from idle, 0.9 s near full power, 1.4 s spooling down. Afterburner lights 0.35 s after it's requested at full throttle and ramps up over 0.5 s |

## 4. Resulting performance (sea level)

| | |
|---|---|
| Stall speed, clean / T/O / LDG flaps | 115 / 104 / 97 kt |
| Stall AoA, clean / T/O / LDG | 17.2° / 17.7° / 16.4° (flaps raise CL_max but shift the curve up, so the stall comes earlier) |
| Thrust/weight, dry / afterburner | 0.47 / 0.73 |
| Max L/D (clean, gear up) | 8.0 at about 169 kt |
| Rotation and lift-off (rotate at 120 kt to 10°) | lifts off at ~128 kt after a ~555 m roll on dry thrust |
| Tail-strike angle (ventral fin) | 15.7°; full back stick on the roll can scrape the fin |
| Hands-off climb after take-off (trim −10°, T/O flaps, full dry) | settles at ~170 kt |
| Hands-off approach (trim −8°, LDG flaps, 55% throttle) | ~133 kt, ~450 ft/min down |

## 5. Landing gear

Each leg is three bodies and two joints. Nothing is moved kinematically:

Legs: nose at x = +4.55 m, mains at x = −1.0 m (pixel x 157 and 82, where the belly is flat).
They are long (2.3 / 2.1 m) because the wheels must reach 3.85 m below the CG, clear of the
ventral fin and the lower cannon pod.

1. A **prismatic joint** between the airframe and a strut body, along the leg axis, with limits
   from 0 (down-locked) to −2.6 m (stowed inside the fuselage). Its motor drives the gear up or
   down in the 4 s transit time. The motor's force limit is the down-lock's strength (90 kN nose,
   360 kN main).
   A load above that shoves the strut up, and the leg counts as collapsed.
2. A **wheel joint** between the strut and the wheel, which is the oleo. Box2D defines its spring
   by frequency and damping ratio over the joint's effective mass. The physical stiffness
   (200 / 620 kN/m) and damping (17 / 62 kN·s/m) are converted to those, so static deflection
   comes out at about 7 cm nose and 10 cm main. A compression past the travel limit
   (0.24 m nose, 0.27 m main) breaks the leg. The wheel joint's motor gives rolling resistance
   and the wheel brakes (28 kN·m per main).

Behaviour measured by the tests (`tests/flight.test.mjs`):

| Touchdown | Result |
|---|---|
| Mains first, up to ~4.2 m/s (830 ft/min) | holds |
| Mains first, ~4.7 m/s (920 ft/min) and above | main gear collapses, belly slide, crash |
| Nose first at ~3.3 m/s (650 ft/min) | nose gear collapses |
| Gear up | hull hits the runway: crash |
| Any hull impact with Δv > 4 m/s | crash |

A squat switch blocks gear retraction while any strut is compressed.

## 6. Changing the ship

To swap in another sprite or adjust this one: set `SPRITE` (file, px per metre, CG pixel), then
re-trace `AIRFRAME.hull`, and update `WING`, `TAIL`, `ENGINE.point`, `GEAR.legs` and
`AIRFRAME.visual`, all in `src/config.js`. Then run `npm test`. The tests check stability
(static margin 3–25%), rotation speed, lift-off inside the runway, the stall break, landing limits
and stopping on the runway.
