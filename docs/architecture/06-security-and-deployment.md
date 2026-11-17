# 06 — Security and deployment

## Trust model

This is a **static, client-side game**. There is no backend, no account system,
no payments and no remote user content. The only persistent state is
`localStorage`. The meaningful trust boundaries are therefore:

1. `localStorage` — untrusted input that may be malformed, stale, edited by a
   user/extension or written by an older version.
2. The optional debug/test URL — must not exist in normal production URLs.
3. The browser's WebGL/audio/input APIs — failures must not trap the player in
   an infinite error loop.
4. The static hosting layer — HTTPS and HTTP security headers are the host's
   responsibility, not something `package.json` can enforce.
5. The vendored Three.js file — supply-chain provenance and update checks.

Local records are **not an anti-cheat boundary**. A player who can run
JavaScript in the page can always edit client-side state or `localStorage`.
The game should be robust against corruption, not pretend to be authoritative.

## Storage validation

`js/config.js` sanitizes every read and write.

### Settings

`loadSettings()` reads `gbr.settings.v1`, parses JSON in a `try/catch` and runs
`sanitizeSettings()`. `saveSettings()` sanitizes before writing.

Rules:

| Key | Rule |
|---|---|
| `quality` | `low`, `medium`, `high` |
| `volume` | finite number clamped to `[0, 1]` |
| `muted`, `voice`, `shake`, `weatherFx`, `showHints`, `headlights` | boolean only |
| `lookSensitivity` | finite number clamped to `[0.2, 2.5]` |
| `units` | `kph`, `mph` |
| `weather` | `auto` or a known `WEATHER_MODES` id |
| `timeOfDay` | `auto` or a known `TIME_MODES` id |
| `camera` | known `CAMERA_MODES` id |
| `shaders` | `off`, `vivid`, `cinematic` |
| `drivingModel` | `realistic`, `assisted` |

Malformed JSON, `null`, arrays, primitives, wrong types and out-of-range values
fall back to `DEFAULT_SETTINGS`. The sanitizer reads only known properties, so
prototype-like payloads cannot become settings.

### Records

`getBest`, `setBest`, `getEndlessBest` and `setEndlessBest` use `readRecord` /
`writeRecord`:

- `Number(raw)` must be finite,
- must be `> 0`,
- stage times must be `<= 24 h`,
- endless distances must be `<= 10,000,000 m`,
- writes round to 2 decimals (time) or 1 decimal (distance),
- storage quota/security exceptions are caught and ignored.

Corrupt values are treated as “no record”. `clearBests()` removes only keys
with the `gbr.best.` or `gbr.endless.` prefixes.

UI car/stage/mode selection (`gbr.selection.v1`) is also parsed defensively:
non-object JSON, arrays, unknown car/stage ids and unknown modes fall back to
the default Quattro/Kielder/stage selection. `getCar()` / `getStage()` resolve
ids to a valid config entry.

The mobile quality migration flag (`gbr.mobile.tuned`) is only tested for
presence and written inside `try/catch`.

## Debug and test surfaces

Normal URLs expose **no** game object:

- `Game` only assigns `window.__GAME = this` when the URL has `?debug=1`.
- `js/main.js` only defines `window.__RALLY` on `?debug=1`.
- `__RALLY` is a frozen object with methods, not the mutable `Game` instance:
  `start`, `state`, `pause`, `resume`, `quit`, `camera`.
- `__RALLY.start()` resolves through `startStageById()`, which uses the same
  validated selection path as the UI.

Use `?debug=1` for automation and profiling. Do not enable it in production
marketing links. If a build step is added later, strip these branches with a
compile-time flag instead of relying on URL discipline.

## DOM and XSS

The audit found one HTML sink in the old `fail(message)` helper. It has been
replaced with DOM construction:

```js
const body = document.createElement('div');
body.textContent = message;
```

The fatal/context-loss overlays use static brand markup and `textContent` for
all variable text. UI dynamic strings (car names, stage names) come from the
game's own config, not from URLs or storage. There is no `innerHTML` call with
a network/user-controlled value in the current UI path.

If you add a new error path, log the raw error to the console and show a fixed,
human-readable message plus a safe detail string via `textContent`. Never
concatenate an exception, URL parameter or `localStorage` value into HTML.

## Local development server

`run.sh` and the npm scripts bind to loopback by default:

```bash
./run.sh                         # 127.0.0.1:8080
HOST=0.0.0.0 ./run.sh            # explicit trusted-LAN debug
npm start                        # 127.0.0.1:8080
npm run serve:lan                # 0.0.0.0:8080
```

`python3 -m http.server` is a development tool, not a production server. It
serves directory listings and has no auth, compression, caching or security
headers. The explicit `HOST=0.0.0.0` path is opt-in and prints a warning.

## WebGL and fatal-error handling

- `js/main.js` listens for `webglcontextlost` and `webglcontextrestored`.
  Loss prevents rendering, pauses an active race and shows a recovery overlay.
  Restore removes the overlay; the player resumes when ready.
- Repeated `game.update()` failures are counted. The loop stops after three
  consecutive throws and shows one recovery screen instead of spamming the
  console and burning CPU forever.
- Stage load failures are caught in `startStage()`, dispose partial resources
  and return to the menu with a toast.
- The destructive `_disposeStage()` path is idempotent enough to run after a
  failed publish.

## Production hosting checklist

Use HTTPS only. Recommended response headers:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
```

The repo ships a `_headers` file for static hosts that support that convention
(Netlify, Cloudflare Pages, etc.). GitHub Pages ignores it; configure headers
through the host/CDN if you deploy there.

### Content Security Policy

The page uses an inline import map and inline style attributes, so a strict CSP
must account for both. The import map content is currently:

```html
<script type="importmap">
{ "imports": { "three": "./vendor/three.module.js" } }
</script>
```

Its SHA-256 (including the surrounding newlines) is:

```text
sha256-JmFPMM6hqTDeOhh+5pDmskMz2dW/Br0dXHziUxIC+BA=
```

Start with `Content-Security-Policy-Report-Only`, verify the game and all
overlays, then enforce:

```http
Content-Security-Policy: default-src 'self';
  script-src 'self' 'sha256-JmFPMM6hqTDeOhh+5pDmskMz2dW/Br0dXHziUxIC+BA=';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self';
  media-src 'self' blob:;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'self'
```

Notes:

- `style-src 'unsafe-inline'` is needed because the game uses `style.cssText`
  for runtime overlays and some inline styles. It is a style injection surface
  but not script execution; keep all text insertion as `textContent`.
- If the import map is ever edited (even whitespace), recompute the hash. A
  future cleanup can remove the import map and use relative vendor imports,
  which drops the `script-src` hash requirement.
- Do not add `'unsafe-eval'`; the game does not use `eval`.
- Test CSP in Chromium, Firefox and Safari before enforcing.

### Caching

Suggested policy:

```text
index.html, js/*, css/*     Cache-Control: no-cache (ETag revalidation)
vendor/three.module.js       Cache-Control: public, max-age=31536000, immutable
docs/*.png                   Cache-Control: public, max-age=86400
```

The vendor file is pinned, so long immutable caching is safe until the version
changes. The game itself changes often; use revalidation rather than a long TTL.

## Supply chain

- Runtime dependency: **Three.js r160** (`0.160.0`), MIT, vendored at
  `vendor/three.module.js`.
- SHA-256:
  `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495`
- Size: `1,272,972` bytes.
- `package.json` has no npm `dependencies`; `vendorDependencies` records the
  Three.js version for scanners.
- `THIRD_PARTY_NOTICES.md` and `vendor/README.md` document license, hash and
  update procedure.
- Fonts are local under `assets/fonts/` (SIL OFL). No remote CDN is used.

Update process:

1. Obtain the exact release from the official Three.js repo/npm.
2. Update the file, version, size and SHA-256 in both notice files.
3. Run `npm run check` and `npm test`.
4. Smoke-test all stages, cars, camera modes, post-FX, WebGL1 fallback if
   supported, mobile touch and context loss/restore.
5. Review Three.js release notes and OSV/GHSA advisories.
6. Optionally generate a CycloneDX/SPDX SBOM and scan the vendored file with
   OSV-Scanner or a comparable tool.

## What is deliberately not claimed

- There is no server-side authority, so local records can be edited.
- CSP/headers are only real if the production host applies them.
- The debug URL is a development convenience; treat `?debug=1` links as
  internal.
- `python3 -m http.server` must not be exposed to the public internet.
- A browser/GPU crash cannot be recovered in JavaScript; the overlay offers a
  reload.
