# 02 — Runtime architecture

## Boot sequence

1. Browser parses `index.html`; the import map aliases `three` to
   `vendor/three.module.js`.
2. `js/main.js` reads the pointer type. Coarse pointers get a `touch-mode`
   body class and antialiasing is reduced.
3. `new THREE.WebGLRenderer(...)` is created. Failure shows a DOM error screen
   with a reload button; the module then throws so the console keeps the cause.
4. `new Game(canvas, renderer)` builds UI, audio, menu preview, post-FX,
   input, touch controls and starts the menu preview.
5. `resize()` is called immediately and on window/orientation/visual-viewport
   changes.
6. `requestAnimationFrame(loop)` starts the frame loop.

## Frame loop

`js/main.js` owns the browser loop. It distinguishes three time values:

| Value | Meaning | Bound |
|---|---|---|
| `rawDt` | Real elapsed frame time from `performance.now()` | passed to `Game.update` |
| `dt` | Display/input/UI delta | capped at `0.05 s` |
| `realDt` inside `Game` | Simulation catch-up budget | capped at `0.25 s` |

```js
const rawDt = Math.max(0, (now - last) / 1000);
const dt = Math.min(0.05, rawDt);
game.update(dt, rawDt);
```

The loop also:

- skips updating while a WebGL context is lost;
- accumulates FPS over 2 s windows;
- counts consecutive update failures;
- after **three consecutive throws**, stops scheduling work conceptually by
  setting `loopStopped`, disables engine audio and shows one recovery overlay;
- logs at most occasional repeated errors instead of spamming once per frame.

`requestAnimationFrame` is scheduled before the update call, so a normal
one-off exception does not stop rendering. The fatal guard prevents the
infinite-error-loop pattern where every frame throws forever.

## Game state machine

```text
             startStage()
  menu ─────────────────────► loading
   ▲                            │ build succeeds + next frame
   │                            ▼
   │                         countdown
   │                            │ countdown reaches 0
   │                            ▼
   │                         racing ◄──────────────┐
   │                          │  │                 │
   │                 pause()  │  │ finish gantry   │ resume()
   │                          ▼  ▼                 │
   │                       paused  finishing ──────┘
   │                          │        │
   │                 quit()   │        │ results
   └──────────────────────────┘        ▼
                                    finished
                                       │ next/retry
                                       └──────────► loading / countdown
```

Valid transitions are enforced by guards inside each method:

- `startStage()` returns if `_loadInFlight` or `state === 'loading'`.
- `pause()` only acts in `racing`.
- `resume()` only acts in `paused`; it restores `pausedFrom` (normally
  `racing`).
- `restartStage()` refuses while loading and otherwise calls
  `_beginCountdown()` on the existing stage.
- `nextStage()` selects the next authored stage and starts a new build.
- `quitToMenu()` invalidates any in-flight build, saves endless progress,
  hides overlays, disposes the stage and returns to `menu`.
- Finishing is entered only after `physics.finished` becomes true; endless
  runs never finish.

Visibility handling: `document.visibilitychange` pauses an active race. Input
also resets on hidden/blur, so a held throttle does not survive a tab switch.

## Stage loading and cancellation

Stage creation is deliberately **single-flight and ownership-based**:

```js
async startStage(car, stage, endless = false) {
  if (this._loadInFlight || this.state === 'loading') return;
  const token = ++this._loadGeneration;
  this._loadInFlight = true;
  // ...show loading UI, set state = 'loading'
  try {
    const built = await this._buildStage(car, stage, conditions, token);
    if (!built || token !== this._loadGeneration) return;
    // ...hide loading, begin countdown
  } catch (err) {
    if (token !== this._loadGeneration) return;
    // ...show menu, dispose partial stage
  } finally {
    if (token === this._loadGeneration) this._loadInFlight = false;
  }
}
```

`_buildStage` creates **local owners** in a `bag`:

```js
const bag = { scene, track, destruction, carModel, carRoot,
              physics, cockpit, weather, headlights, camera };
```

Every expensive step is separated by `await nextFrame()` (so the loading
screen can paint) and followed by a token check:

```js
const checkpoint = async () => {
  await nextFrame();
  if (!isCurrent()) throw new StageLoadCancelled();
};
```

Only after the final checkpoint does the build publish fields to `this`:

```js
this.scene = bag.scene;
this.track = bag.track;
this.car = car;
// ...then _prepareRun(), _setCameraMode()
```

Consequences:

- A second start call during a build is ignored, not allowed to interleave.
- `quitToMenu()` increments `_loadGeneration`; the old build discards itself
  into its private bag and cannot show a countdown or replace a newer scene.
- If the build throws before publishing, `startStage` disposes the partial
  resources and restores the menu.
- If the build throws after publishing (for example in `_prepareRun`), the
  catch path calls `_disposeStage()` to return to a clean state.

`_disposeBuildBag()` releases the destruction system, headlights and scene,
then nulls every bag entry. `_disposeStage()` does the equivalent for the live
stage and also clears `_hintTimer`, `_countdownTimer` and stage-scoped state.

## Countdown and race start

`_beginCountdown()` is called for a new stage and for a restart. It:

- sets `state = 'countdown'`, `time = 0`, `countdownTime = 3.0`;
- resets input, physics, notes, start lights, camera and cockpit;
- resets the recovery cooldown;
- shows the countdown and starts engine audio.

During countdown, `_updateCountdown(dt)` decreases the countdown, updates
lights/beeps, renders the scene and calls `_go()` when it reaches zero.

`_go()` sets `state = 'racing'`, resets the race clock, turns on start lights,
shows touch controls and schedules the hint fade with `_hintTimer`.

## Simulation clock

This is the most important timing detail for fair results.

- Physics step: `PHYS_STEP = 1 / 120 s`.
- Maximum catch-up: `PHYS_CATCHUP_LIMIT = 0.25 s`.
- Maximum steps per frame: `MAX_PHYS_STEPS = ceil(0.25 / (1/120)) = 30`.
- `Game._stepPhysics(realDt, input)` adds the real frame time to `physAcc`,
  runs up to 30 fixed steps, and returns the simulated time consumed
  (`steps * PHYS_STEP`).
- Racing advances `this.time` by that returned simulated time.
- If the accumulator still has more than one step after the cap, the excess is
  moved to `_simTimeDropped` instead of being silently zeroed. The car and the
  race clock both slow down together under extreme load, so low FPS cannot
  make a stage look faster relative to distance driven.

```js
this.time += this._stepPhysics(realDt, this.input.state());
```

The display/UI/input path still uses the capped `dt` (`<= 0.05 s`). This keeps
camera damping, weather, audio and UI from jumping after a long frame.

The tuning choice is: **slow motion under extreme load is acceptable; silently
discarding physics time or letting the race clock run at a different rate from
the car is not.** `debugState().simTimeDropped` exposes dropped time.

## Recovery cooldown

`recoverCar()` only works while `racing`. It:

- refuses if `_recoverCooldown > 0`, then sets a 1.5 s cooldown;
- calls `physics.resetToTrack(track)`, which resets to the nearest track sample
  (not a forward teleport);
- adds the authored `+3 s` penalty to `this.time`;
- clears the physics accumulator and camera shake.

The cooldown prevents recovery-spam from firing multiple resets in one
collision/landing frame.

## Cleanup contract

`_disposeStage()`:

1. stops engine audio and speech;
2. disposes `DestructionSystem` and `Headlights` explicitly;
3. calls `disposeObject(scene)` to dispose geometries, materials and textures
   reachable from the scene;
4. clears the glass effect and render lists;
5. nulls `scene`, `camera`, `track`, car, physics, cockpit, weather and stage
   metadata;
6. clears timers and the recovery cooldown.

`DestructionSystem.dispose()` also disposes its shared dust texture. Streamed
chunks own their resources and are disposed when pruned by `Track`.

## WebGL context loss

`js/main.js` listens for `webglcontextlost` and `webglcontextrestored` on the
game canvas.

- On loss: `preventDefault()` allows restoration, rendering is skipped, an
  overlay explains what happened, and an active race is paused.
- On restore: the overlay is removed and normal rendering resumes. The run
  stays paused; the player chooses Resume.
- Three.js re-uploads GPU resources on demand; the game does not rebuild the
  scene graph for a context loss.

A hard GPU/browser crash still ends the page; the overlay offers Reload.

## Debug state

On `?debug=1`, `Game` exposes `debugState()` through the minimal `__RALLY`
surface. It includes:

- state, race time, speed, progress, car/stage/endless;
- live chunks, terrain tiles, side-road debug info;
- load generation and loading flag;
- physics accumulator and dropped simulation time;
- recovery cooldown;
- `renderer.info` draw calls, triangles, geometries and textures.

This is enough for an automated smoke test or a profiling script without
exposing mutable game objects in normal production URLs.
