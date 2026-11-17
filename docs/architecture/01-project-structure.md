# 01 — Project structure

## Repository tree

```text
group-b-rally/
├── index.html                 HTML shell, overlays, import map, touch controls
├── css/style.css              Poster-style UI, modals, responsive/touch layout
├── js/
│   ├── main.js                Renderer boot, frame loop, fatal/context-loss guards
│   ├── game.js                Orchestrator: state machine, stage lifecycle, camera, race
│   ├── config.js              Cars, stages, biomes, presets, storage API
│   ├── util.js                Math/noise/geometry/canvas helpers, disposal
│   ├── ui.js                  Menu, car/stage cards, settings, pause, results, toasts
│   ├── input.js               Keyboard, mouse-look, gamepad, touch state
│   ├── touch.js               On-screen landscape controls
│   ├── physics.js             Four-wheel vehicle dynamics, assisted/realistic models
│   ├── surfaces.js            Surface profiles (grip, rolling, brake, bump, audio)
│   ├── track.js               Spline/endless road, terrain, scenery, pacenotes, streaming
│   ├── endlessRoute.js        Forward-progressing procedural route generator
│   ├── roadNetwork.js         Branching side-road generation and junction meshes
│   ├── carModel.js            Procedural exterior/interior models and cockpit rigs
│   ├── cockpit.js             CanvasTexture dash, gauge, trip computer and map
│   ├── menuPreview.js         Lit 3D showroom scene
│   ├── weather.js             Rain/snow/spray/dust/fog/fireflies/lightning
│   ├── effects.js             Headlights and windscreen rain
│   ├── destruction.js         Debris bursts for breakable scenery
│   ├── textures.js            Procedural canvas textures and liveries
│   ├── postfx.js              Optional bloom/grade/grain stack
│   └── audio.js               Procedural WebAudio engine, impacts and speech
├── vendor/
│   ├── three.module.js        Three.js r160, MIT, vendored
│   └── README.md              Version and SHA-256
├── assets/fonts/              Local Barlow / Share Tech Mono fonts
├── docs/                      Screenshots + this architecture folder
├── tests/                     Node built-in unit tests
├── .github/workflows/ci.yml   Syntax check + unit tests
├── run.sh                     Loopback static server, optional browser open
├── package.json               Scripts, Node engine, vendored dependency record
├── THIRD_PARTY_NOTICES.md     Three.js provenance and update procedure
├── SECURITY.md                Reporting and hardening summary
└── group_b_rally_QA_security_audit.md   Original audit
```

## Entry point and module graph

`index.html` loads `js/main.js` as a native ES module and declares the only
bare-specifier import map:

```html
<script type="importmap">
{ "imports": { "three": "./vendor/three.module.js" } }
</script>
```

There is no bundler at runtime. Every module is fetched directly by the
browser. The graph below shows the main dependencies; `three` is imported by
most rendering modules.

```text
main.js
├── three
└── game.js
    ├── config.js        data + storage
    ├── util.js          math/noise/dispose
    ├── ui.js            DOM UI
    ├── menuPreview.js   showroom
    ├── input.js         keyboard/mouse/pad
    ├── audio.js         WebAudio
    ├── track.js         world + surfaces + colliders
    │   ├── endlessRoute.js
    │   ├── roadNetwork.js
    │   └── textures.js
    ├── carModel.js      procedural car and interior
    ├── physics.js       vehicle dynamics
    ├── surfaces.js      surface profiles
    ├── cockpit.js       canvas instruments
    ├── weather.js       weather particles
    ├── effects.js       headlights/windscreen
    ├── touch.js         mobile controls
    ├── postfx.js        optional post-processing
    └── destruction.js   breakable-scenery debris
```

`textures.js` is the only module that generates bitmap content. It creates
canvas textures for road/ground surfaces, bark, leaves, canopies, rock, wood,
city facades, decals, banners and start lights. Nothing is fetched from a
remote CDN.

## Responsibilities

### `js/main.js`

- Creates `THREE.WebGLRenderer` with antialiasing chosen by pointer type.
- Constructs `Game`.
- Owns `requestAnimationFrame`; computes raw/capped frame delta.
- Rate-limits repeated update errors and stops the loop after three
  consecutive failures.
- Handles `webglcontextlost` / `webglcontextrestored` with a recovery overlay.
- Provides `window.__RALLY` only on `?debug=1`.

### `js/game.js`

The orchestrator and state machine. It owns the active `scene`, `track`, `car`,
`physics`, `cockpit`, `weather`, `camera` and UI state. It does not implement
geometry generation or physics equations; those live in `track.js` and
`physics.js`.

Main areas:

- `startStage()` / `_buildStage()` — guarded asynchronous stage creation.
- `_beginCountdown()` / `_go()` — start sequence.
- `_updateCountdown()` / `_updateRacing()` / `_updateFinishing()` — frame paths.
- `_stepPhysics()` — fixed-step accumulator.
- `_updateCarTransform()` / `_updateCamera()` / `_updateCockpit()` — presentation.
- `_startFinish()` / `_showResults()` / `_saveEndlessRecord()` — scoring.
- `quitToMenu()` / `pause()` / `resume()` / `recoverCar()` — lifecycle.
- `_disposeStage()` — release scene resources and timers.

### `js/config.js`

Pure data plus storage helpers:

- `CARS` — 19 vehicles with power, weight, grip, layout, body style and audio.
- `STAGES` — 11 authored routes (control points), biome, width, grip, target.
- `ENV` / biome tables — palettes, terrain profile, scatter mix, surface names.
- `TIME_MODES` / `WEATHER_MODES` / `CAMERA_MODES` and presets.
- `resolveConditions()` — merges authored environment with time/weather.
- Settings and record validation (`sanitizeSettings`, `loadSettings`,
  `saveSettings`, `getBest`, `setBest`, endless equivalents).

### `js/track.js`

The largest module. It turns one route definition (authored spline or endless
generator) into a drivable world:

- Catmull-Rom sampling (authored) or incremental `EndlessRoute` samples.
- Road ribbon, shoulders, verge, terrain height and surface classification.
- Sky, lighting, fog, skyline, motes and weather-aware materials.
- Props, gates, posts, guardrails, hazards, city blocks, vegetation.
- Spatial collider hash and breakable-object state.
- 2D terrain tile streaming, chunked scenery/road streaming.
- Pacenotes, hazards, map projection, start lights, skid pool.
- Query API: `nearest`, `nearestGlobal`, `driveAt`, `heightAtSample`,
  `terrainHeightAt`, `surfaceHeight`, `collidersNear`, `isNearRoad`.

### Other modules

| Module | Responsibility |
|---|---|
| `endlessRoute.js` | Produces one forward-progressing sample at a time with biome-specific corner/straight/grade statistics. Keeps a wandering heading envelope so the main road cannot self-cross. |
| `roadNetwork.js` | Grows side roads from the endless main route: forks, rejoins, dead ends. Owns branch meshes, junction aprons and branch surface queries. |
| `physics.js` | Four-wheel dynamics: driveline, torque curve, gearbox, steering, tyre slip, load transfer, terrain gradient, collisions, body attitude, and REALISTIC/ASSISTED tuning. |
| `surfaces.js` | Shared surface profiles for asphalt, broken, gravel, loose, dirt, mud, snow, ice, water, roots, ruts, rocks, sand, fesh-fesh, pavement and off-stage. Drives physics grip/rolling/braking, body bump, dust and tyre audio. |
| `carModel.js` | Builds procedural car exteriors/interiors, wheels, cockpits, decals and rigs. Merges static meshes per material for draw-call control. |
| `cockpit.js` | Paints gauge, trip computer, map and pacenote displays into `CanvasTexture`s and animates needles/screens. |
| `ui.js` | DOM-only menu, selection, settings, pause, results, help, toast and loading overlays. |
| `menuPreview.js` | Separate showroom scene with backdrop, lights and rotating car. |
| `weather.js` | Precipitation, spray, dust, fog banks, fireflies and lightning. |
| `effects.js` | Headlights and 2D windscreen rain canvas. |
| `destruction.js` | Short-lived instanced debris bursts and dust. |
| `postfx.js` | Optional half-float bloom/grade/grain pipeline with WebGL fallback. |
| `textures.js` | Procedural canvas textures and car liveries. |
| `audio.js` | Procedural engine, turbo, surface, impact, shatter, thunder, beeps and speech synthesis. |
| `input.js` | Unified keyboard/mouse/gamepad/touch state with focus-loss reset. |
| `touch.js` | Mobile buttons and rotate hint. |
| `util.js` | Math, noise, PRNG, geometry merge, canvas helper, `disposeObject`. |

## Static assets and third-party code

- `vendor/three.module.js` is the only runtime third-party library. It is
  Three.js r160, MIT, pinned by size and SHA-256 in `THIRD_PARTY_NOTICES.md`.
- Fonts are local under `assets/fonts/` (SIL OFL).
- All geometry and textures are generated at runtime from code; there are no
  external models, HDRIs or image textures.
- `docs/*.png` are documentation screenshots and are not loaded by the game.

## Tests and automation

- `tests/config.test.js` uses Node's built-in test runner and a memory
  `localStorage` shim. It covers settings validation, record validation and
  clearing records.
- `npm run check` runs `node --check` over every module.
- `.github/workflows/ci.yml` runs both on push and pull request.
- Browser automation can opt into `?debug=1` to use the minimal `__RALLY` API.

## Where to add content

- **New car:** add an entry to `CARS` in `config.js` with `style`, `handling`
  and `audio`. `carModel.js` and UI cards pick it up automatically.
- **New authored stage:** add a stage to `STAGES` with `route` control points,
  `biome`, `seed`, `env` and target metadata. `track.js` samples it.
- **New biome:** add an `ENV` palette/terrain/scatter entry and map a stage to
  it; `track.js` branches on `stage.biome` for props, vegetation and city.
- **New UI:** add markup to `index.html`, a cache in `UI`'s `dom` object and
  handlers in `UI._bindEvents()`. Keep dynamic text as `textContent`.
- **New simulation feature:** prefer pure helpers inside `physics.js` or
  `track.js`; keep `Game` as orchestration.
