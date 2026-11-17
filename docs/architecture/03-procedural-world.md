# 03 — Procedural world

The world has two sources of truth:

1. **Authored stages** — hand-written control points in `STAGES`, sampled into
   a Catmull-Rom road.
2. **Endless stages** — a forward-progressing generator that emits one road
   sample at a time and never revisits earlier ground.

Both feed the same `Track` query API, so physics, AI-less traffic-free scenery,
pacenotes, cockpit map and rendering do not need to know which mode is active.

## Authored routes

A stage in `js/config.js` looks like:

```js
{
  id: 'kielder', ss: 'SS01', name: 'KIELDER',
  biome: 'forest', width: 7.0,
  baseGrip: ENV.forest.surfaceGrip,
  targetSpeed: 22.0,
  seed: 1187,
  env: ENV.forest,
  route: [[x, z, y], ...]
}
```

`Track._buildSamples()`:

1. Maps `[x, z, y]` to `Vector3` control points.
2. Builds a non-closed `THREE.CatmullRomCurve3` with tension `0.35`.
3. Requests arc-length-spaced samples at a fixed `step = 1.7 m`.
4. Computes a tangent from the neighbouring samples and a horizontal `right`
   vector.
5. Stores heading, distance, grade, curvature and smoothed curvature.
6. Adds a smooth side-slope profile used by terrain height.

The road is a ribbon: five lateral lanes from `-halfWidth` to `+halfWidth`,
with a small parabolic crown. Shoulders and verges are separate geometry.
The road surface sits `0.055 m` above the sample height.

## Terrain height

`Track.heightAtSample(index, lateral)` is the core terrain function. It combines:

- the road cross-section height,
- a biome terrain profile (`plain`, `mountain`, etc.),
- a bank/ditch/edge shape,
- low-frequency `fbm` noise,
- an optional mountain-side bias,
- a safety rule that terrain under the carriageway stays below the road.

`terrainHeightAt(x, z)` and `worldHeightAt(x, z)` find the nearest route
cross-section and evaluate the same function, so ground exists beyond the
streamed road mesh.

`surfaceHeight(index, lateral)` returns the drivable top: road crown inside the
carriageway, verge/terrain outside it. `Track.driveAt(pos, hint)` returns the
surface info used every physics step:

```js
{
  index, center, right, heading, dist, progress,
  lateral, mainLateral, height, grip, offRoad,
  surfaceName, hazard, hazardLabel
}
```

## Surfaces and grip

Each sample starts at `stage.baseGrip`. Hazard patches multiply it:

| Biome | Hazard examples | Grip multipliers |
|---|---|---|
| forest | loose gravel, mud | 0.72, 0.62 |
| jungle | water, deep mud, roots | 0.60, 0.52, 0.70 |
| snow | black ice, deep snow | 0.42, 0.64 |
| japan | wet tarmac, moss, loose tarmac | 0.74, 0.62, 0.70 |
| russia | deep ruts, mud, loose gravel | 0.68, 0.58, 0.72 |
| safari | sand, fesh-fesh, rocks | 0.66, 0.52, 0.70 |
| city | standing water, wet leaves, roadworks | 0.72, 0.78, 0.74 |

Off-road queries apply another `0.82` factor in physics. `surfaceName` is used
for rolling resistance and audio/visual surface selection.

## Pacenotes

For authored stages, `_buildPacenotes()` scans smoothed curvature:

- a corner starts when `|curvature| > 0.009`,
- its angle and minimum radius determine severity 1–6 or a hairpin,
- `TIGHTENS` / `OPENS` modifiers compare early and late curvature,
- crests/jumps are detected from grade transitions,
- hazards become high-priority notes,
- long gaps between corners become `STRAIGHT n` notes,
- finish is always the last note.

Notes are sorted and de-duplicated with a minimum spacing of 13 m. For endless
stages the same idea runs incrementally in `_scanEndlessNotes()` as samples are
generated, so notes are available before the car reaches them.

`Game._announceNotes()` walks notes ahead of the car's distance, marks them
announced and sends a short phrase to audio. The cockpit map/gauge reads the
same notes for its display.

## Endless route generation

`js/endlessRoute.js` contains `EndlessRoute`. It is a state machine sampled at
1.7 m:

- **Sections:** straight or corner. Each biome profile defines corner radius,
  corner angle, straight length and how often straights appear.
- **Heading envelope:** `baseHeading()` is a pair of low-frequency sine waves.
  A corner prefers the direction that returns the heading toward that
  envelope. This keeps the road progressing instead of looping or crossing
  itself.
- **Curvature:** corners choose a radius from the profile, convert angle to arc
  length and set `targetCurvature = dir / radius`.
- **Grade:** gentle target grades with occasional 1.7× crests/compressions,
  clamped to ±0.14. `y` is pulled back toward zero when it grows large.
- **Sample:** x/z advance by `step` along heading; pitch follows grade.

`Track._extendEndlessSamples(metres)` appends samples, smooths curvature/grade
over a 7-sample window, scans new notes/hazards and grows side roads.
`streamEndless(pos)` keeps roughly **1.1 km** of generated road ahead:

```js
if (this.length < dist + 1100)
  this._extendEndlessSamples(Math.max(700, dist + 1500 - this.length));
```

## Chunk streaming

Endless road/scenery is built in chunks of about **204 m**:

- `_buildEndlessChunks()` builds at most two new chunks per frame once the
  initial full build is done.
- `_ensureChunkScenery()` plants dense verge vegetation only within about
  **260 m** of the player.
- Chunks whose `dist1 < playerDist - 520` are removed and disposed.
- Geometry is disposed unless it belongs to a shared geometry set.

Terrain is separate from the road. It is a **2D square tile grid**:

- tile size `96 m`, vertex step about `3.2 m`,
- radius 3 tiles around the car (7×7),
- tiles farther than the radius are disposed,
- a queued nearest-first build budget of about `3.4 ms` / max 3 tiles per
  frame while driving (larger slice during initial load),
- each tile is built row-by-row across frames to avoid a long hitch,
- ground cover (trees, rocks, grass) is planted only within about **220 m**
  and two tiles per frame.

This is why the player can leave the road, drive across terrain, and still
find ground everywhere while draw calls and live geometry stay bounded.

## Branching side roads

`js/roadNetwork.js` grows side roads from the endless main route:

- The first junction is at 150–240 m; later junctions are 155–375 m apart.
- About 34% of junctions fork both ways; the rest fork one way.
- A branch is either **joined** (returns to the main road 130–390 m later) or
  **dead-end** (80–270 m).
- Half-width is 3.0–4.1 m. Surface follows the main environment: asphalt,
  snow or gravel.
- Control points create a departure, an offset mid-section and either a
  rejoin or a dead-end turnaround.
- The deck is smoothed, limited to a 0.19 max grade, raised above the terrain
  and blended into the main road height at each junction lip.
- `_branchIsClear()` rejects branches that cut through the main road, clip an
  existing side road or fold back over themselves.
- Junction aprons fill the flare between the branch crown and the main
  carriageway.

Runtime:

- `RoadNetwork.update(playerDist)` builds a road when it is within 260 m
  before its start or 300 m after its end, disposes it once 340 m behind, and
  drops topology once 1400 m behind.
- `RoadNetwork.nearest()` and `isNearRoad()` are used by physics and scenery
  placement. Branch grip is computed from its surface and `stage.baseGrip`.

## Scenery, props and colliders

`Track.buildProps()` and `buildScenery()` place biome-specific content:

- trees, palms, bushes, ferns, grass, reeds, flowers, rocks, logs and stumps,
- guardrails, marker posts, telegraph poles, fences, warning boards,
- city blocks, shopfronts, street lamps, parked cars, crossings and plazas,
- start/finish gantries, banners and start lights,
- hazard patches, puddles, snow banks and animal/landmark set pieces.

To keep draw calls low:

- static scenery sharing a geometry/material is pooled into global
  `InstancedMesh` batches (`SceneryBatchHandle` / batch manager),
- batches are spatially bucketed (about 1024 m cells) so frustum culling still
  works,
- tiles/chunks own their instance entries and release them on dispose,
- cars and cockpit static parts are merged per material in `carModel.js`.

Each prop can register a collider in a spatial hash (`colliderCell = 9 m`).
Colliders contain position, radius, break speed and optional palette. Physics
queries only nearby cells. A breakable collider is removed from the hash and
replaced with a short-lived `DestructionSystem` debris burst.

## Conditions and biomes

`resolveConditions(stage, weatherId, timeId)` starts from the stage's authored
`env` and applies:

- time presets: dawn/day/dusk/night sun direction, colour, exposure, fog, stars
  and headlights,
- weather presets: clear/overcast/rain/storm/snow/fog — precipitation,
  sky dimming, desaturation, fog multiplier, sun/hemi strength, grip multiplier,
  wetness, cloud, wind, wipers, lightning and headlights,
- a run-local copy of the stage with the resolved `env`, `baseGrip` and
  condition object.

This is why any authored stage can be driven at night in a storm without a
second set of assets. The base palette stays the stage's identity; presets
grade it.

## Determinism

- Authored geometry is fixed by `stage.seed` and the route control points.
- Endless runs use `Math.random()` once per run to pick a 31-bit seed, then
  derive all route/scenery/hazard randomness from `mulberry32`.
- Shared helpers `mulberry32`, `hash2`, `noise2` and `fbm` are in `util.js`.
- Passing the same seed to `Track`/`EndlessRoute` produces the same sequence.
  The endless route object owns its own PRNG; side roads own another seeded by
  `track.seed + 0x51de`; visual props have a separate visual PRNG.

Deterministic replay is possible for authored stages if input is recorded with
the same 120 Hz step sequence; weather particles and destruction are visual
only and do not affect physics.
