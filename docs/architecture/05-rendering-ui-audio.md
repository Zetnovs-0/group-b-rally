# 05 — Rendering, UI, audio and input

## Renderer and quality

`js/main.js` creates the only `WebGLRenderer`:

```js
new THREE.WebGLRenderer({
  canvas, antialias: !isTouchDevice,
  powerPreference: 'high-performance',
  stencil: false,
})
```

It uses sRGB output, ACES filmic tone mapping (exposure `1.04` by default),
PCF soft shadows and a dark clear colour.

`Game._applyRendererQuality()` derives a pixel-ratio cap:

| Quality | Pixel-ratio cap | Shadows |
|---|---|---|
| high | `min(devicePixelRatio, 1.8)` | on |
| medium | `min(devicePixelRatio, 1.35)` | on |
| low | `1` | off |

During racing, `_adaptResolution()` watches the 2-second FPS window. If FPS
stays below 50 it lowers the internal render scale toward `0.7`; if it stays
above 57 it raises it back toward `1.0` after 8 seconds of headroom. Object
geometry, draw distance and shadows do not change. This is a resolution-only
safety valve.

## Scene composition

A live stage scene contains:

- **Sky/atmosphere:** sky dome with time/weather-graded colours, fog, sun/moon,
  stars, clouds, skyline silhouettes, ambient motes.
- **Terrain:** one authored grid mesh or streamed 2D tiles.
- **Road:** ribbon with crown, markings, shoulders, verge, start/finish
  gantry, marker posts, guardrails and hazards.
- **Scenery:** instanced vegetation, rocks, logs, city blocks, street
  furniture, parked cars, animals/landmarks.
- **Car:** `carRoot` group containing the procedural exterior/interior, wheels
  and rigs.
- **Weather:** `WeatherFX` group (precipitation, spray, dust, fog banks,
  fireflies).
- **Effects:** `Headlights` group attached to the car root; windscreen rain is
  a separate 2D canvas above the WebGL canvas.
- **Destruction:** transient instanced debris/dust groups.

The menu uses a **separate** `MenuPreview` scene with its own camera, studio
lights, backdrop and car model. It is not the stage scene.

## Lighting

`Track.buildSky(scene)` creates the sky dome, sun/moon directional light,
hemisphere light and biome-specific skyline. `Track.updateSun(playerPos, dt)`
moves the sun target and updates fog/lighting as the car moves. Time-of-day and
weather presets modify:

- sun direction, colour and intensity,
- hemisphere sky/ground colours and intensity,
- exposure,
- fog colour/density,
- star visibility, horizon glow, headlight requirement,
- cloud cover, wind, wetness and precipitation.

`WeatherFX` can flash lightning; `Game._lightning()` sets the track flash and
shakes the camera. `Headlights` fades additional cones/glows in at night, rain
or as configured by the player.

## Cameras

`Game` supports four modes from `CAMERA_MODES`:

| Mode | Parent | Character |
|---|---|---|
| `cockpit` | car head rig | First-person, mirrors/steering/dash visible |
| `bonnet` | car body group | Above the bonnet, exterior visible |
| `chase` | scene | Spring-follow camera behind the car |
| `bumper` | car root | Low front bumper view, car hidden |

The camera mode is persisted in settings. `cycleCamera()` and `setCameraMode()`
update the UI, touch label and settings. Exterior meshes are hidden in cockpit
mode so wheels/fender flares do not poke through the interior.

`_updateCamera()` adds speed-based FOV, look yaw/pitch, suspension/impact
shake and body pitch/roll. `_updateChaseCamera()` follows a desired point with
exponential smoothing, keeps the camera above terrain, and looks ahead of the
car. `settings.shake` and car `comfort` scale the shake.

## Cockpit

`js/carModel.js` builds the interior and creates rigs:

- head rig for cockpit camera,
- steering wheel, gear lever and handbrake pivots,
- wheel pivots and spin groups,
- wiper, co-driver, dash screens,
- exterior bits list used for camera visibility.

`js/cockpit.js` owns the instrument rendering. It paints into `CanvasTexture`
canvases:

- speedometer / tachometer (classic and modern styles),
- gear, boost, throttle/brake, time, best, progress,
- trip-computer map (authored stage whole route or endless local section),
- next pacenote, turn arrow/severity, hazard warning, crest/jump/straight,
- co-driver radio pulse.

`Game._updateCockpit(dt, initial, override)` passes a normalized state object
(speed, RPM, gear, inputs, notes, map progress, etc.). During countdown a
virtual state shows revs without moving the car.

## Weather and effects

`WeatherFX` builds quality-scaled particle systems:

- rain/snow points with wind and car-relative motion,
- wheel spray and off-road dust,
- fog banks,
- fireflies at night,
- lightning timer/callback.

`setEnabled()` controls visibility from settings. `Game._updateWeather()` feeds
camera position, car speed/off-road state and wheel positions. `WindscreenFX`
draws 2D droplets on a canvas over the WebGL view, with speed-based streaks and
a visible-area mask. `Headlights` controls cone/glow opacity.

`DestructionSystem` creates one `InstancedMesh` per debris burst. Bursts are
capped at 18 live groups; old ones are retired. Pieces fall, bounce, spin and
fade; dust is a `Points` cloud. `dispose()` releases all bursts, the group and
the shared dust texture.

## Post-processing

`js/postfx.js` is optional (`shaders: 'off' | 'vivid' | 'cinematic'`). It uses
render targets sized to the drawing buffer.

- Prefers `HalfFloatType`; falls back to `UnsignedByteType` on WebGL1 / old
  mobile GL.
- Bright-pass extraction, separable blur, bloom combine, colour grade, vignette
  and film grain.
- `setMode('off')` bypasses the stack; `Game.renderScene()` calls
  `renderer.render()` directly.
- `dispose()` releases render targets, quad geometry and all materials.

The game defaults to `off` for performance and battery life.

## UI layer

`js/ui.js` owns all DOM overlays in `index.html`:

- main menu with car list, stage cards, biome art, condition pickers, best time
  and start button,
- loading screen with progress and tips,
- countdown,
- pause modal,
- results modal (time, best, delta, rank, note, record flag),
- settings modal,
- controls/help modal,
- toast notifications,
- game hints and mobile rotate prompt.

Dynamic values are set with `textContent` where possible. The menu cards and
biome art use generated/inline SVG and CSS; no remote images are loaded.
`UI` persists car/stage selection and settings. `Game` binds callbacks rather
than reaching into UI internals.

`touch.js` adds HTML buttons for steering, throttle, brake, handbrake, camera,
pause and recover. `input.js` merges keyboard, mouse-look, gamepad and touch
into a single state. Focus loss, visibility change, pointer cancel and gamepad
disconnect release all inputs, so no pedal can stay held after an alt-tab.

## Audio

`js/audio.js` is fully procedural WebAudio; there are no audio files.

- Lazily creates `AudioContext` after a user gesture (`audio.init()`).
- Master gain → compressor → destination; gain follows settings volume/mute.
- Engine: saw/square/sine oscillators through a low-pass, with per-car
  cylinder count, rasp, turbo response and boost.
- Surface/tyre noise, wind, turbo whistle and crackle layers.
- Impacts and shatters use filtered noise/envelopes.
- Thunder, UI beeps and click.
- `speechSynthesis` speaks co-driver pacenotes and countdown messages.
- `setEngine(on)`, `hushVoice()`, `suspend()` control lifecycle.

Audio is presentation-only. Physics never waits for it, and a missing
`AudioContext` is non-fatal.

## Frame presentation pipeline

```text
Game.update
  ├─ input.update
  ├─ fixed physics steps
  ├─ carRoot transform (position, yaw, pitch, roll, wheels)
  ├─ camera update (mode, FOV, shake, chase smoothing)
  ├─ cockpit canvas update (throttled)
  ├─ weather/effects/destruction update
  ├─ audio.update
  ├─ renderScene:
  │    PostFX.render(...) if enabled
  │    else renderer.render(scene, camera)
  └─ adaptive resolution (racing only)
```

The cockpit and menu preview both use canvas/Three.js resources that are
disposed with their owner. The renderer itself lives for the whole page, while
stage-specific scenes are replaced on each `startStage()`.

## Performance rules of thumb

- Prefer instancing/merging and shared materials over one mesh per prop.
- Do not create new `Vector3`/`Matrix4` objects inside physics or the render
  loop; use the preallocated temporaries in each module.
- Keep `CanvasTexture` updates throttled (cockpit redraw is not every frame).
- Dispose generated geometry/material/texture when its streamed owner is
  removed.
- Dynamic resolution changes only pixel ratio; never silently remove scenery
  or physics content.
- Use `debugState().render` (`draw calls`, triangles, geometries, textures) to
  compare changes; run the endless streaming test for at least 15 minutes.
