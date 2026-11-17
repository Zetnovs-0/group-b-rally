# 07 — Development and testing

## Local workflow

```bash
./run.sh                 # serve 127.0.0.1:8080 and try to open a browser
npm start                # same loopback server
HOST=0.0.0.0 ./run.sh    # explicit LAN debug; prints a warning
```

ES modules require HTTP. Opening `index.html` from `file://` fails on module
and import-map resolution.

Checks:

```bash
npm run check    # node --check over every js/*.js module
npm test         # Node built-in unit tests (tests/*.test.js)
npm run lint     # alias for check
```

There is no bundler, runtime dependency install or build step. Node 18+ is
recorded in `package.json` `engines`; CI uses Node 20.

## Test coverage today

`tests/config.test.js` uses a memory `localStorage` shim and covers:

- defaults when storage is empty,
- malformed JSON, `null` and arrays,
- type/range validation of every setting,
- valid settings round-trip and save-time sanitization,
- stage/endless record round-trip,
- invalid/negative/Infinity/absurd record values,
- `clearBests()` prefix safety.

`tests/surfaces.test.js` covers surface-key/name resolution, aliases, required
profile fields, and the deliberately different grip/rolling values for
asphalt, gravel, mud and ice.

Syntax checking covers all modules, including those that import Three.js
(`node --check` parses but does not resolve imports).

CI: `.github/workflows/ci.yml` runs both steps on push to `main` and on pull
requests.

## Debug API

Open:

```text
http://localhost:8080/?debug=1
```

Then:

```js
await window.__RALLY.start('quattro', 'kielder');       // authored stage
await window.__RALLY.start('quattro', 'kielder', true); // endless
window.__RALLY.state();        // debugState(): state, time, speed, render info
window.__RALLY.pause();
window.__RALLY.resume();
window.__RALLY.camera('chase');
window.__RALLY.quit();
```

`?debug=1` also exposes `window.__GAME` for deeper inspection. It is mutable
and development-only; never ship a link that enables it.

Useful `debugState()` fields:

```js
{
  state, time, speedKph, progress, car, stage, endless,
  chunks, terrainTiles, colliders, sideRoads,
  loadGeneration, loading,
  surface, surfaceBump, drivingModel,
  physAcc, simTimeDropped, recoverCooldown,
  render: { calls, triangles, geometries, textures }
}
```

## Browser smoke checklist

Run after changing lifecycle, physics, rendering, input or streaming:

- [ ] Menu preview renders; car list/stage cards switch.
- [ ] Every stage loads without console errors.
- [ ] Countdown reaches GO; timer starts at zero.
- [ ] Pause/resume, restart, quit and next stage all work.
- [ ] Finish results show time, best, delta, rank and record flag.
- [ ] ENDLESS runs for several minutes; chunks/tiles stay bounded.
- [ ] All four cameras work in cockpit and exterior modes.
- [ ] Quality low/medium/high, shaders off/vivid/cinematic.
- [ ] Weather clear/rain/storm/snow/fog at day/night.
- [ ] WebGL context loss → overlay → restore → Resume.
- [ ] Keyboard, gamepad and touch; focus loss releases every control.
- [ ] Corrupt `localStorage` settings/records still boots and starts.
- [ ] `?debug=1` API works; normal URL has no `__RALLY`/`__GAME`.

## Automated browser testing

A minimal CDP/Playwright smoke flow:

1. Launch the page with `?debug=1`.
2. Wait for `window.__RALLY.state().state === 'menu'`.
3. Call `start()` twice without awaiting: the second call must be ignored while
   the first build is in flight (`loadGeneration` should increment once).
4. Wait for `countdown`/`racing`; assert `stage`, `car`, `render.calls`.
5. Shorten `__GAME.countdownTime` in a test-only harness or wait naturally.
6. Assert `time` increases while racing.
7. Trigger `WEBGL_lose_context`; assert state is `paused` and the overlay is
   present; restore; assert the overlay disappears.
8. Quit and assert `state === 'menu'`, `scene === null`.
9. Start and immediately quit during loading; after the build settles, assert
   the stale builder did not publish a scene or countdown.
10. Inject a throwing `__GAME.update`; after three frames assert one recovery
    overlay and no infinite log stream.

The current tests were run against Chromium headless with SwiftShader; software
rendering is much slower than a real GPU, so allow generous stage-load timeouts.

## Profiling

Use Chrome DevTools Performance + Memory and `debugState()`.

- **Frame time:** p50/p95/p99 after warm-up, not just average FPS.
- **Draw calls/triangles:** `debugState().render.calls` / `.triangles`.
- **GPU memory:** `renderer.info.memory.geometries` / `.textures`; return to
  menu and compare after GC.
- **Streaming:** `chunks`, `terrainTiles`, `colliders`, `sideRoads` over a
  30–60 minute endless run; they must plateau.
- **Physics:** `physAcc`, `simTimeDropped`; a growing dropped time means the
  frame budget is too small or a subsystem is blocking.
- **Loading:** generation token and stale-build behavior under CPU throttling.

Stage switching loop: 25–30 start/quit cycles, capture renderer info in the
menu after each cycle. The menu baseline should be stable (this was verified
with low quality: 103 geometries / 43 textures in-stage, 44 / 5 in the menu
after the preview settled).

## Performance budgets and invariants

There is no hard-coded frame budget in the code, but the following are the
intended design constraints:

- live endless chunks: only the generated window plus ~2 build steps per frame,
- terrain tiles: 7×7 around the car, disposed outside the radius,
- scenery: planted only near the player and in small per-frame batches,
- collision queries: spatial hash, not a full collider scan,
- physics: fixed 120 Hz with capped catch-up,
- dynamic resolution: pixel ratio only, never geometry/draw-distance removal,
- particle counts scale with quality.

If you add a per-frame generation loop, prefer a time/job budget like
`updateTerrainTiles()` (3.4 ms while driving) rather than doing all work in one
frame.

## Adding content safely

### Car

Add to `CARS` with a unique `id`, `style`, `handling` and `audio`. Verify:

- it appears in the menu and preview,
- the cockpit camera is not inside a mesh,
- wheels sit on the ground (no floating/sunken wheel rig),
- brake/steer/turbo feel matches its class,
- audio does not clip.

### Authored stage

Add a `STAGES` entry with a unique `id`, a sensible `route`, `biome`,
`seed`, `env`, `width`, `baseGrip` and target. Verify:

- start and finish are on drivable ground,
- no self-intersecting road/terrain seams,
- pacenotes are readable and not overlapping,
- every camera mode has a usable view,
- terrain bounds contain the route,
- ENDLESS mode on the same stage generates a sensible side-road network.

### Biome

Add an `ENV` entry (palette, terrain style, scatter mix, surface name) and
reference it from a stage. Check `Track` branches for trees, props, hazards and
city behavior, and update `RoadNetwork._sideSurface()` if the new biome needs a
specific side-road surface.

## Known limitations / next steps

- No TypeScript/ESLint yet; `node --check` catches syntax but not unused
  variables, floating promises or unsafe comparisons. Adding ESLint with
  `no-floating-promises` and module-boundary rules is the next quality step.
- No committed Playwright suite; the CDP smoke flow above is manual. Extract it
  into `tests/e2e` when browser automation is part of CI.
- CSP is documented but not enforced on GitHub Pages; apply `_headers`/CDN
  rules on the actual production host and run the hash check.
- Local records are deliberately not anti-cheat. A future online leaderboard
  would need signed submissions and server validation.
- Dynamic resolution aims at FPS, not a fixed frame-time percentile; profile on
  low-end mobile before changing the thresholds.

## Audit traceability

See [08-audit-fix-map.md](08-audit-fix-map.md) for a finding-by-finding map
from the QA/security audit to code and documentation.
