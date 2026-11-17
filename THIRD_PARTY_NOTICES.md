# Third-party notices

## Three.js

- **Version:** r160 (`0.160.0`)
- **File:** `vendor/three.module.js`
- **Size:** 1,272,972 bytes
- **SHA-256:** `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495`
- **License:** MIT
- **Upstream:** <https://github.com/mrdoob/three.js>
- **Notice in source:** `Copyright 2010-2023 Three.js Authors`, `SPDX-License-Identifier: MIT`

The vendored file is loaded through the import map in `index.html`:

```html
<script type="importmap">
  { "imports": { "three": "./vendor/three.module.js" } }
</script>
```

It is not installed from npm at runtime, and `package.json` has no npm
`dependencies` tree. The `vendorDependencies` field records the revision so
security scanners and SBOM tools can index the runtime code.

### Updating Three.js

1. Download the exact `three.module.js` for the target release from the
   official Three.js repository or npm package.
2. Record the new version, size and SHA-256 in this file and in
   `vendor/README.md`.
3. Run `npm run check` and `npm test`.
4. Smoke-test: menu preview, every stage, cockpit/chase/bonnet/bumper cameras,
   post-FX modes, WebGL context loss/restore, and mobile touch controls.
5. Check the release notes and OSV/GHSA advisories for the old and new
   revisions before merging.

Three.js is distributed under the MIT license. This game's own source is not
covered by that license.
