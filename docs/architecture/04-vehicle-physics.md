# 04 — Vehicle physics

`js/physics.js` implements a planar four-wheel vehicle model with per-wheel
ground contact. It is intentionally not a rigid-body engine: the car's body
state is `(forward speed u, lateral speed v, yaw rate r, yaw)`, while tyres,
load transfer, ground slope and collisions are resolved at four contact
patches. This gives most of the feel of a rally car with a small, stable
simulation footprint.

## Driving models — REALISTIC vs ASSISTED

The **DRIVING** selector in the main menu (also in Settings) chooses one of two
tunings of the same physics. It is saved in settings and applied live.

| | REALISTIC (default) | ASSISTED |
|---|---|---|
| Mechanical lateral grip floor | `0.28` | `0.70` |
| Per-wheel grip floor | `0.22` | `0.45` |
| Longitudinal grip gain | `1.92` | `2.05` |
| Peak-slip scale | `1.16` | `1.00` |
| Front / rear peak-slip multiplier | `1.00 / 0.94` | `1.00 / 1.00` |
| Front / rear post-peak force floor | `0.86 / 0.78` | `0.90 / 0.90` |
| Rear lateral bias | `0.95` | `1.00` |
| Power-oversteer term | `0.14` | `0` |
| Handbrake rear-grip loss | `0.90` | `0.80` |
| Yaw damping (base + speed + slide) | low | high |
| Stability-control scale | `0.30` | `1.00` |
| Traction-control trim | `0.90` | `0.72` |
| Load-transfer scale | `1.14` | `1.00` |
| Loose-surface wheelspin drag | `1.40` | `0.45` |

REALISTIC is not “less grip everywhere”: asphalt remains high-grip, but the
front axle keeps more steering bite after the peak while the rear can step out
and stay out. It also reduces the artificial yaw self-centring and stability
intervention, so throttle, weight transfer and the handbrake can rotate the
car. ASSISTED keeps the original forgiving floor and stronger stabilisation.

`CarPhysics.setDrivingModel(model)` swaps the tuning table without rebuilding
the car. `Game._applySettings()` calls it immediately when the menu selection
changes; new stages pass `model` into the `CarPhysics` constructor.

## Car data model

Each entry in `CARS` provides:

| Field | Used for |
|---|---|
| `power` (bhp), `weight` (kg) | peak torque, inertia, load |
| `frontWeight` | static front/rear axle load split |
| `grip` | tyre lateral grip coefficient |
| `topSpeed` | final drive and speed cap |
| `brake` | brake force multiplier |
| `layout` | `AWD`, `RWD`, `FWD` drive share |
| `style.length/width` | wheelbase, track width, inertia, body dimensions |
| `handling` | optional modern-car assists: `abs`, `traction`, `stability`, `brakeAssist`, `powerMul`, `peakSlip`, steering rates, comfort, RPM limits |
| `audio` | cylinders, rasp, turbo response (audio only) |

`CarPhysics._initVehicle()` derives wheelbase, half-track, inertia, final
drive, peak torque and per-wheel coordinates. `reset()` places the car at the
start sample and clears all transient state.

## State and axes

World axes follow Three.js:

```text
forward = ( sin(yaw), 0, cos(yaw) )
left    = ( cos(yaw), 0, -sin(yaw) )
```

The body state is:

- `forwardSpeed` (`u`) — signed forward velocity in m/s,
- `vLat` (`v`) — lateral velocity along the body's left axis,
- `yawRate` (`r`),
- world `pos`, `vel`, `yaw`,
- per-wheel arrays of ground height, grip, load, travel, angle, rate, steer,
  slip, lock, spin and contact.

Per-wheel order is front-left (+x), front-right (-x), rear-left (+x),
rear-right (-x), matching `carModel.wheels`.

## One physics step

`step(dt, input, track)` is called with `dt = 1/120 s`. The order matters:

### 1. Surface queries

The car centre and each wheel query `track.driveAt(pos, hint)`. This returns
height, grip, off-road state, surface name, hazard and route progress. Each
wheel can be on a different surface (for example three wheels on tarmac, one
on a verge).

### 2. Steering

Input steer is in `[-1, 1]`. The rack is speed-sensitive:

```text
authority = 1 / (1 + speed * steerFalloff)
steerLock = maxLock * authority / weightRatio^0.045
target    = inputSteer * steerLock
steer     = moveToward(steer, target, steerRate * dt)
```

Return-to-centre is faster than turn-in. `_frontWheelAngles()` applies an
Ackermann-like split: the inner wheel turns more than the outer wheel. Positive
steering means left, and the returned signs are consistent with the renderer.

### 3. Driveline

`_updateDriveline()` handles:

- reverse selection: brake held at rest for 0.55 s selects reverse; throttle
  or releasing the brake exits it,
- six fixed gear ratios plus final drive,
- automatic up/down shifts with shift timers,
- engine RPM from wheel speed, with clutch slip below 2 m/s,
- turbo boost spool: throttle × RPM build, faster spool for low-turbo cars.

For a forward gear:

```text
torque     = peakTorque * torqueCurve(rpm) * throttle
driveForce = torque * ratio * efficiency / wheelRadius
             * (0.6 + 0.4 * boost) * powerMul
```

Engine braking is a small negative torque when the throttle is closed. Above
`topSpeed` drive force is cut. In reverse, pedals swap roles: brake is reverse
throttle and throttle is the brake.

### 4. Load transfer and downforce

The model computes static front/rear loads from mass and weight distribution,
adds aero downforce (`0.5 * rho * liftCdA * u²`), then applies the previous
step's longitudinal load transfer. Lateral transfer from `latAccel` shifts load
left/right. Per-wheel load is floored so a wheel never carries zero load.

Slope reduces effective load via `slopeCos`, and steep side slopes reduce
lateral capacity so the car can slide off a bank.

### 5. Tyre forces

For each wheel:

- longitudinal capacity = `wheelLongGrip * load * 0.985`,
- drive share depends on layout (`AWD` 42% front / 58% rear, `FWD` 100%
  front, `RWD` 0% front),
- brake bias follows front load share, clamped 0.52–0.90,
- handbrake adds rear longitudinal force and removes most rear lateral grip,
- desired longitudinal force is clamped to the friction circle,
- combined-slip lateral capacity is reduced by longitudinal usage:

  ```text
  latCap = wheelLatGrip * load * sqrt(1 - fxUsage²)
  ```

- the lateral force uses a slip curve: rises, peaks, then falls. Peak slip is
  about `0.105 + (1 - surfaceGrip) * 0.045` unless a car overrides it, multiplied
  by the model scale and the front/rear peak multiplier.
- after the peak, REALISTIC drops front force to 86% and rear force to 78% of
  the peak; ASSISTED holds both at 90%. The lower rear floor is what lets a
  slide be held instead of instantly snapping back.
- front wheels use their steer angle to project tyre force into the body frame.

`ABS` and traction control are optional assists. ABS trims the combined-slip
term and prevents full wheel lock. Traction control trims longitudinal usage
when wheel drive is high. `stability` adds a yaw-rate correction toward the
kinematic target and bleeds lateral velocity, only when the car is actually
sliding. Rally cars leave these off, so they remain analogue.

Longitudinal drive/brake forces are treated as axle-symmetric for yaw. This
prevents an unloading inside wheel from spinning the car instantly; lateral
forces still produce turn-in and rear breakaway.

### 6. Body integration

Body forces include:

- tyre longitudinal/lateral forces projected to body axes,
- rolling resistance from surface type and off-road flag,
- aerodynamic drag,
- gravity from terrain grade,
- extra uphill resistance above 0.5 grade and a small downhill gain,
- a light tyre-relaxation/aero yaw damping term.

The equations are:

```text
uDot = Fz/mass + r*v + rolling/mass + drag/mass - g*grade - uphill + downhill
vDot = Fx/mass - r*u - g*sideGrade
rDot = yawMoment/inertia - damping
```

Then semi-implicit Euler integrates `u`, `v`, `r`, `yaw` and world position.
Low-speed settling damps `v` and `r` and snaps `u` to zero when the car is
stationary. Speed and reverse speed are clamped.

### 7. Steep-face constraint

The car probes the ground where it is trying to move. If `rise / distance`
exceeds `MAX_CLIMB_GRADE = 0.72` (about 36°), the move is rejected: position
is restored, velocity is zeroed/scrubbed and an impact callback may fire. This
prevents driving up near-vertical terrain like a ladder. Engine torque also
fades above `MAX_DRIVE_GRADE = 0.58`.

### 8. Hard collisions

- Gate posts are solid circles. The car is pushed out, normal velocity is
  reflected, speed is scrubbed and an impact callback fires.
- A soft world edge at the biome's `worldBound` pushes the car back toward the
  route and dampens outward velocity.
- Scenery uses a spatial hash (`collidersNear`). Solid props push the car out
  and bounce/scrub speed. Breakable props above their `breakSpeed` are removed
  and reported through `onBreak`, producing debris and audio.
- The physics layer reports impacts through `onImpact(strength, kind)`; `Game`
  maps that to camera shake and audio.

### 9. Ground follow and body attitude

After collisions, the car height is fitted to the ground:

- a large sudden rise is limited per step (`maxRise`), then damped,
- front/rear average ground heights give pitch,
- left/right average heights give roll,
- individual wheel residual above the fitted plane becomes visible suspension
  travel,
- pitch/roll also include acceleration-based body lean, scaled by `comfort`,
- `pitch`, `roll`, `wheelTravel`, wheel rotation and steer are exposed to
  `Game._updateCarTransform()`.

### 10. Finish detection

For authored stages, `physics.finished` becomes true when route distance passes
the finish gate (or `length - 6`). `Game._updateRacing()` observes this after
the physics step and enters `finishing`. Endless runs have no finish.

## Surfaces and grip model

Surface behaviour is centralized in `js/surfaces.js`. Track grip is still the
base value (biome + hazard); the profile adds the second layer of feel:

```text
asphalt:  grip 1.04, long 1.06, rolling 0.018, brake 1.05, bump 0.28
gravel:   grip 0.90, long 0.88, rolling 0.038, brake 0.90, bump 1.05
mud:      grip 0.72, long 0.62, rolling 0.068, brake 0.74, bump 0.95
snow:     grip 0.78, long 0.70, rolling 0.032, brake 0.78, bump 0.55
ice:      grip 0.48, long 0.32, rolling 0.012, brake 0.45, bump 0.15
offroad:  grip 0.70, long 0.64, rolling 0.082, brake 0.78, bump 1.50
```

The full set also covers `broken`, `loose`, `dirt`, `water`, `wet`, `moss`,
`ruts`, `roots`, `rocks`, `sand`, `fesh`, `pavement`. Each profile supplies:

- **grip** — multiplies the track sample grip; the mechanical floor is
  model-dependent.
- **longGrip** — multiplies longitudinal capacity (traction/braking limit).
- **rolling** — rolling-resistance coefficient.
- **brake** — brake-force multiplier.
- **bump** — body/camera shake and visual roughness.
- **loose** — wheelspin drag, dust/spray amount.
- **audioTone / audioGain** — tyre noise character.

Effective lateral grip on an authored stage is roughly:

```text
car.grip * sample.grip * profile.grip * 1.10
```

so asphalt ≈ `0.96 × 1.04`, gravel ≈ `0.82 × 0.90`, mud ≈ `0.68 × 0.72`,
snow ≈ `0.58 × 0.78`, ice ≈ `0.244 × 0.48`. The differences are deliberately
large enough to change braking points, cornering balance and acceleration,
not just colour. Rolling resistance varies from `0.018` on asphalt to `0.068`
on mud and `0.09` in water/fesh.

Off-road is its own profile (`offroad`), not a blanket multiplier. A wheel can
be on a different surface from the other three: each wheel queries
`track.driveAt()` separately, stores its profile key and uses its own grip and
longitudinal capacity.

### Road edge / terrain rejoin

`Track.nearest()` blends the physics height from the road edge to the terrain
over a **1.1 m shoulder ramp**. Without it, the road ribbon (roughly 10–15 cm
above the terrain field) read as a vertical face to the steep-face guard when
a car tried to rejoin from the verge. The steep-face constraint also ignores
rises below **0.20 m**, so kerbs, road lips and small terrain steps are not
treated as walls while genuine cliffs still stop the car.

## Rotation, grip and assists by car

- **Group B / classic rally cars:** AWD or RWD, no ABS/TC/stability, high grip
  and power, steep torque, loose-surface hazards.
- **Modern rally cars:** AWD, stronger grip, optional assists; still analogue
  by default.
- **Road cars and city cars:** ABS, traction control, stability control,
  softer suspension (`comfort`), less aggressive steering rates and power.
- **FWD cars:** drive force only at the front, so the front tyres lose lateral
  capacity under power; the model exposes that through the friction circle.

## Fixed-step rationale

The model is tuned for `1/120 s`. Running it at variable render dt would make
tyre force integration and load transfer frame-rate dependent. `Game` therefore
feeds a fixed-step accumulator:

- each step is exactly `1/120 s`,
- maximum 30 steps per rendered frame,
- race time advances by the simulated time actually consumed,
- leftover/time cap is exposed as `simTimeDropped` rather than silently lost.

At normal frame rates the car and clock run at real time. At extreme load the
whole simulation (motion and clock) slows consistently instead of teleporting
or dropping physics steps.

## Recovery

`Game.recoverCar()` is presentation/orchestration; the physical reset is
`CarPhysics.resetToTrack(track)`:

- calls `reset(track, initial = false)`,
- finds the nearest main-route sample to the current position,
- places the car on the road, zeroes velocity and resets gear/steer,
- clears the track index hint.

It cannot jump the car forward. The game adds a fixed `+3 s` penalty and a
1.5 s recovery cooldown.

## Tuning guide

| If you want to change… | Touch |
|---|---|
| top speed / acceleration | `topSpeed`, `power`, `GEAR_RATIOS`, `finalDrive` |
| turn-in | `grip`, `handling.steerLock`, `steerRate`, `frontWeight` |
| braking | `brake`, `BRAKE_ACCEL_G`, `brakeAssist`, `ABS` |
| stability | `handling.stability`, `yawRate` damping, tyre peak slip |
| off-road feel | `Track` surface grip/hazards, rolling coefficients, wheel queries |
| body motion | `cgHeight`, `pitchGain`, `rollGain`, `comfort`, load-transfer damping |
| collision feel | `_resolvePropCollisions`, gate/world-edge clamps, break speeds |

After any physics change, run the 120/60/30/15 FPS comparison and a fixed-input
replay. The expected invariant is that distance/time does not improve simply
because rendering slowed down.
