# 04 — Vehicle physics

`js/physics.js` implements a planar four-wheel vehicle model with per-wheel
ground contact. It is intentionally not a rigid-body engine: the car's body
state is `(forward speed u, lateral speed v, yaw rate r, yaw)`, while tyres,
load transfer, ground slope and collisions are resolved at four contact
patches. This gives most of the feel of a rally car with a small, stable
simulation footprint.

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

- the lateral force uses a slip curve: rises, peaks, then gently falls. Peak
  slip is about `0.105 + (1 - surfaceGrip) * 0.045` unless a car overrides it.
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

Surface grip is multiplicative:

```text
car.grip * track sample grip * (offRoad ? 0.82 : 1) * 1.10
```

A mechanical floor of `0.70` for lateral grip prevents the car feeling like
ice on loose surfaces. Longitudinal grip is `2.05×` lateral grip, deliberately
higher so braking and traction feel positive. Rolling resistance varies by
surface name:

| Surface | Coefficient |
|---|---|
| asphalt/tarmac | 0.018 |
| snow/ice | 0.030 |
| gravel | 0.034 |
| sand/dirt | 0.048 |
| mud | 0.055 |
| off-road | ×1.55 |

Hazard patches lower grip further in `Track` (ice, mud, water, fesh-fesh,
etc.). The physics step never reads `localStorage` or the DOM.

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
