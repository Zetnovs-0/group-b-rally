# 08 — Audit fix map

The source audit is [`../../group_b_rally_QA_security_audit.md`](../../group_b_rally_QA_security_audit.md).
This table maps each finding to the change made, the current state and any
remaining verification.

| ID | Finding | Change in this repo | Status |
|---|---|---|---|
| QA-001 | Competing async stage starts | `Game.startStage()` is single-flight (`_loadInFlight` + `state === 'loading'`). Every build gets `_loadGeneration`; duplicate calls are refused. | Fixed by design. Duplicate-call behavior verified in headless Chromium: two simultaneous calls produced one build (`loadGeneration = 1`). |
| QA-002 | Race time vs physics desync under FPS drops | `main.js` passes `rawDt`; `Game._stepPhysics()` uses a capped 120 Hz accumulator. Race time advances by simulated steps, not a clipped display delta. Dropped time is exposed as `simTimeDropped`. | Fixed. Needs a repeatable 120/60/30/15 FPS comparison on real hardware for final tuning. |
| QA-003 | Infinite per-frame error logging | `main.js` counts consecutive `game.update()` errors, rate-limits logging and stops the loop after three failures with one recovery overlay. | Fixed. Fault-injection test in headless Chromium showed one overlay. |
| QA-004 | No dependency manifest/version for Three.js | Recorded Three.js r160 (`0.160.0`), size and SHA-256 in `THIRD_PARTY_NOTICES.md` and `vendor/README.md`; `package.json` has `vendorDependencies`. Update procedure documented. | Fixed for provenance. Optional next step: SBOM/OSV scan in CI. |
| QA-005 | Global debug API in production | `window.__GAME` is only assigned on `?debug=1`. `window.__RALLY` is a frozen minimal API, only on `?debug=1`; it does not expose the mutable `Game`. | Fixed. Normal URL verified to have no debug API. |
| QA-006 | HTML sink in error display | `js/main.js` builds overlays with DOM APIs; messages use `textContent`. | Fixed. No variable text is inserted as HTML. |
| QA-007 | Dev server binds all interfaces | `run.sh` and npm scripts bind `127.0.0.1` by default; `HOST=0.0.0.0` / `serve:lan` are explicit opt-ins with a warning. | Fixed. README and security docs describe risk. |
| QA-008 | Stale async builds can publish | `_buildStage()` creates a private resource `bag`, checks the generation after every `await` and publishes only after the final check. `quitToMenu()` invalidates the token and hides loading. | Fixed. Stale start-then-quit test showed `state = menu`, `scene = null`, `loading = false`. |
| QA-009 | localStorage validation/schema | `sanitizeSettings()` validates every field; record readers/writers validate finite positive values and sane maxima; UI selection is shape/ID-checked; all storage calls are guarded. Unit tests cover settings/records. | Fixed for current schema. Versioned migration remains a future improvement if the schema changes. |
| QA-010 | WebGL context loss/restore | `main.js` listens for both events, pauses an active race, shows a recovery overlay and resumes rendering after restore. | Fixed. Verified with `WEBGL_lose_context` in headless Chromium. |
| QA-011 | GPU/resource lifecycle | `_disposeStage()` disposes the scene/subsystems, clears timers and render lists; `_disposeBuildBag()` cleans cancelled builds; `DestructionSystem` releases its dust texture. | Improved. 3 rapid stage/quit cycles showed stable renderer memory; long endless profiling still recommended. |
| QA-012 | No CI/lint/test runner | Added Node built-in unit tests, `npm run check`, `npm test`, `npm run lint` alias and a GitHub Actions workflow. | Fixed for basic CI. ESLint/Playwright are documented next steps. |
| QA-013 | Input focus/gamepad/touch edge cases | `Input.reset()` runs on blur/visibility loss and clears touch, look and previous gamepad buttons. `TouchControls` releases all buttons on blur/hide. Gamepad disconnect clears edge state. | Improved. Multi-device matrix still needs real-device testing. |
| QA-014 | Recovery/record integrity | `recoverCar()` has a 1.5 s cooldown, resets to the nearest track sample (no forward teleport) and keeps the +3 s penalty. Records are range-validated. | Improved. Client-side records remain casually editable; there is no server anti-cheat. |
| QA-015 | Endless generation/streaming budgets | Documented and retained bounded streaming: 1.1 km route lead, 204 m chunks, 7×7 terrain tiles, 3.4 ms/3-tile driving budget, 18-burst destruction cap. `debugState()` exposes counts and renderer info. | Instrumented; full 30–60 minute profiling still recommended on target hardware. |
| QA-016 | Browser zoom disabled | Removed `maximum-scale=1, user-scalable=no` from the viewport meta. Touch gameplay still scopes `touch-action: none` to the game canvas/controls, not the whole UI. | Fixed. Verify pinch zoom on iOS Safari/Android before release. |
| QA-017 | Timers and stage callbacks | `_disposeStage()` clears `_hintTimer` and `_countdownTimer`; `startStage()` clears hints; stale builds are fenced by generation. | Fixed for current timers. A future `TimerRegistry` would make this easier to audit. |
| QA-018 | Production security headers | Added `_headers` (safe default headers for static hosts) and a CSP rollout guide with the current import-map hash, caching policy and the limits of GitHub Pages. | Documented/partially applied. Host must enforce headers; enforce CSP only after Report-Only testing. |

## Verification performed

- `npm run check` — all JS modules parse.
- `npm test` — 13 unit tests pass (settings/records + surface profiles).
- Headless Chromium (`?debug=1`, SwiftShader):
  - menu render and debug API present on debug URL,
  - stage load and countdown,
  - duplicate start during load refused,
  - race clock advances with simulation,
  - WebGL loss pauses + overlay; restore removes overlay,
  - quit clears the stage,
  - start-then-quit leaves no stale scene/countdown,
  - corrupt `localStorage` settings still boots,
  - injected update throw stops the loop and shows one overlay.
- Three start/quit cycles at low quality: in-stage renderer info stayed at
  103 geometries / 43 textures; menu baseline stabilized at 44 / 5.
- Screenshot of the menu rendered successfully in headless Chromium.

## Not verified here

- Real GPU performance and frame-time percentiles on low/mid/high devices.
- Safari/Firefox WebGL and CSP behavior.
- Real touch devices, hybrid pointer detection and gamepad hot-plug.
- A full 30–60 minute endless soak with heap snapshots.
- Actual production host header delivery (GitHub Pages cannot set arbitrary
  response headers).
