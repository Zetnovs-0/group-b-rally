# Architecture notes

This folder documents how **Group B — Rally Legends** is put together and why
the core systems behave the way they do. It is aimed at a developer who has to
change the game, debug a regression, profile performance or review a security
fix.

## Reading order

| Document | What it covers |
|---|---|
| [01-project-structure.md](01-project-structure.md) | Repository layout, module graph, entry point and responsibilities |
| [02-runtime-architecture.md](02-runtime-architecture.md) | Boot, frame loop, game state machine, stage loading, cancellation and cleanup |
| [03-procedural-world.md](03-procedural-world.md) | Track splines, terrain, surfaces, pacenotes, endless streaming and side roads |
| [04-vehicle-physics.md](04-vehicle-physics.md) | Four-wheel vehicle model, driveline, tyre forces, collisions and recovery |
| [05-rendering-ui-audio.md](05-rendering-ui-audio.md) | Three.js scene, cameras, post-FX, cockpit, weather, UI, audio and input |
| [06-security-and-deployment.md](06-security-and-deployment.md) | Trust boundaries, storage validation, debug hooks, CSP/headers and supply chain |
| [07-development-and-testing.md](07-development-and-testing.md) | Local workflow, tests, debug API, profiling and CI |
| [08-audit-fix-map.md](08-audit-fix-map.md) | How the QA/security audit findings map to code changes |

## Core invariants

These are the rules that keep the simulation coherent. Break one and the game
usually fails in a subtle way rather than an obvious way.

1. **One active stage build.** `Game.startStage()` is single-flight. A build
   gets a generation token and only publishes its resources after the final
   token check. `quitToMenu()` invalidates the token.
2. **Physics runs at a fixed 120 Hz.** Rendering is variable-rate. Real frame
   time feeds a capped accumulator; the race clock advances by the simulation
   time that was actually consumed.
3. **The world is queried, not guessed.** Surface height, grip, off-road state,
   pacenotes and colliders all come from `Track` sample/streaming APIs. The car
   never owns a private copy of the road.
4. **Random content is seeded.** Authored stages use a fixed `stage.seed`;
   endless runs get a fresh 31-bit seed per run. `mulberry32` is the shared PRNG.
5. **Resources have an owner.** Stage objects are disposed through
   `disposeObject(scene)` plus subsystem-specific `dispose()` methods. A stale
   build disposes its private resource bag.
6. **Untrusted storage is sanitized.** Settings and records are validated on
   read and write; corrupt JSON, wrong types, negative values and absurd times
   fall back to defaults.
7. **No HTML sink for messages.** Error/overlay text uses `textContent`.
8. **Debug surfaces are opt-in.** `window.__RALLY` and `window.__GAME` only
   exist on a `?debug=1` URL.

## High-level data flow

```text
index.html
  → import map resolves "three" to vendor/three.module.js
  → js/main.js creates WebGLRenderer + Game + frame loop
      → Game.update(dt, realDt)
          → Input → CarPhysics.step() → Track surface/collision queries
          → Cockpit / Weather / Effects / Destruction / PostFX
          → renderer.render() or PostFX.render()
      → Game state transitions (menu → loading → countdown → racing → …)
```

The car is simulated in world space, but the road is the authority for height,
grip and progress. `Track.driveAt()` and `Track.nearest()` are the hot queries
used by physics every step.
