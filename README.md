# GROUP B — RALLY LEGENDS

A 3D first-person Group B rally game built with Three.js and vanilla JavaScript. Three procedural stages, six period rally cars, a physical cockpit with a working trip-computer map, co-driver pacenotes, and a proper surface-aware driving model.

![Main menu](docs/menu.png)

## Run it

ES modules need an HTTP server, so opening `index.html` directly will not work.

```bash
./run.sh
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080/>. The game is desktop-first and supports keyboard or gamepad.

## The game

### Stages in three biomes
- **KIELDER** — a fast, blind-crested forest stage in Northumberland. Loose gravel and mud.
- **KURU-KURU** — a tight Central American jungle tunnel of wet mud, standing water and roots, with rain.
- **ROVANIEMI** — Lapland's snowbanks and sweepers, with glare ice and snowfall.

Every route is generated from a Catmull-Rom spline with its own geometry, terrain, tree/rock scatter, hazards, pacenotes and weather. No external models or textures are used.

### Six Group B cars
| Car | Layout | Power | Weight | Character |
|---|---|---|---|---|
| Audi Quattro S1 E2 | AWD | 476 hp | 1090 kg | Heavy, planted, five-cylinder turbo |
| Lancia Delta S4 | AWD | 480 hp | 890 kg | Light, twin-charged, savage |
| Peugeot 205 T16 Evo 2 | AWD | 499 hp | 910 kg | Compact and agile |
| Ford RS200 | AWD | 450 hp | 1050 kg | Balanced mid-engine machine |
| Lancia 037 Rally | RWD | 325 hp | 960 kg | Supercharged, no safety net |
| Renault 5 Turbo 2 | RWD | 350 hp | 970 kg | Short-wheelbase pocket rocket |

### Cockpit and dash
- First-person driver's-eye view with a 3D co-driver sitting to your right.
- Holding the **right mouse button** (or right stick) lets you look around at him, the side windows and the cabin.
- A real center-dash **trip-computer screen** displays the stage map, car marker, timer, best time, gear/speed, surface, grip level, road status and radio state.
- A second physical **co-driver screen** shows large directional arrows, severity numbers, distance, "tightens/opens" modifiers, the next note, current surface/grip and upcoming hazards.
- Steering wheel, hands, gear lever and handbrake animate. The interior has a roll cage, harnesses, screens, wipers, mirrors and co-driver with helmet/headset.
- No floating map or timer HUD. The only overlay in normal driving is a small controls hint that fades away.

![Forest cockpit](docs/cockpit-forest.png)

### Driving model
- Bicycle-style steering model with a grip-limited yaw cap.
- Weight and power affect acceleration, braking and momentum; drivetrain layout gives different characteristics (AWD launch/neutrality, RWD throttle-oversteer, FWD understeer).
- Each car has its own grip figure and tyre package.
- Surface grip changes by biome and by hazard patches: loose gravel, mud, water, roots, black ice, deep snow.
- Handbrake rotates the car but cuts lateral grip and scrubs speed.
- Turbo boost builds with lag; engine/induction/turbo audio follows the revs.
- The stage surface, ruts, snow banks, roadside markers and tree line affect the visual and physical route.
- Start/finish gantry posts are solid; the tree line is a hard corridor boundary.

### Pacenotes and co-driver
- Notes are generated from curvature, corner duration, tightening/opening rate, crests, jumps, straights and hazard patches.
- The co-driver calls notes as you approach them (toggle spoken voice in Settings).
- On-screen arrows and severity badges are drawn into the physical co-driver screen, with the road status/grip footer updating live.
- Radio activity is visualized on the screen, and the co-driver animates while calling.

### Timing
- Stage timer starts when the start lights go green and stops at the finish gantry.
- Personal bests are stored per stage and car in `localStorage`.
- Results show stage time, personal best, delta, a rank (S/A/B/C), and a "new stage record" flag.
- Recovery (`R`) returns the car to the road with a +3 second penalty.

### Settings
Graphics quality (high/medium/low), master volume, co-driver voice, weather effects, camera shake, look sensitivity, km/h or mph units, and clear-records. Quality affects draw distance/tree density, shadow quality and pixel ratio.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | W / ↑ | RT |
| Brake / reverse | S / ↓ | LT |
| Steer | A D / ← → | Left stick |
| Handbrake | Space | A |
| Look around | Hold right mouse / Q E | Right stick |
| Recover to road | R | Y |
| Pause | Esc | Start |
| Mute | M | Back |
| Controls briefing | H | — |

## Project layout

```
index.html            menu, overlays, import map
css/style.css         rally-poster UI, modals, responsive layout
js/main.js            renderer and loop
js/game.js            stage lifecycle, countdown, race loop, results
js/track.js           spline tracks, terrain, road/verges, biome scenery, pacenotes
js/carModel.js        procedural cars, liveries, cockpit, co-driver, dash screens
js/physics.js         driving model and surface/collision handling
js/cockpit.js         CanvasTexture dash/map/pacenote renderers and animations
js/audio.js           procedural WebAudio engine/turbo/surface/impact + speech
js/weather.js         snow/rain particles and wheel spray
js/menuPreview.js     lit 3D showroom
js/ui.js              menu/car/stage cards, settings, pause, results
js/input.js           keyboard, mouse-look, gamepad
js/textures.js        procedural textures/liveries
js/util.js            math, noise, canvas, geometry helpers
vendor/three.module.js local Three.js build
assets/fonts/         local Barlow / Barlow Condensed / Share Tech Mono
docs/                 screenshots
```

## Notes & credits

- Three.js r160 (MIT) is vendored locally; see the header in `vendor/three.module.js`.
- Barlow, Barlow Condensed and Share Tech Mono are licensed under the SIL Open Font License and vendored under `assets/fonts/`.
- All other visuals, textures, geometry, tracks, car models and audio are generated procedurally in the browser.
- Save data lives in the browser's `localStorage` under the `gbr.*` keys.
- Built and tested with Chromium/WebGL2. `run.sh` will try to open your default browser automatically.

![Snow cockpit](docs/cockpit-snow.png)
