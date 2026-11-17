# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a suspected security problem.
Use GitHub's private vulnerability reporting on
<https://github.com/Zetnovs-0/group-b-rally> (Security → Report a
vulnerability) or contact the repository owner privately. Include:

- affected commit / version,
- reproduction steps,
- expected and actual behaviour,
- browser and platform,
- any proof-of-concept files.

There is no bug bounty and no guaranteed response time. This is a
client-side browser game with no backend, accounts or payments.

## Supported surface

The game is a static Three.js application. It has no server-side runtime and
does not process untrusted remote content. The relevant trust boundaries are:

- `localStorage` records and settings (untrusted input; validated on read),
- the optional `?debug=1` automation API (development only),
- the local Python development server (loopback by default),
- the production hosting configuration (HTTPS and security headers are the
  host's responsibility; see [`docs/architecture/06-security-and-deployment.md`](docs/architecture/06-security-and-deployment.md)).

## Scope

In scope: stored-data validation, XSS in UI sinks, denial of service through
malformed saved data, dependency provenance, and production debug hooks.

Out of scope: cheating in a purely local, offline game; browser/GPU bugs; the
security of a third-party hosting provider; social engineering.

## Hardening already applied

- `loadSettings` / record readers validate type, range and JSON shape.
- Fatal render-loop errors stop the loop and show one recovery screen.
- Stage loading uses an ownership generation token; stale builds cannot publish.
- Debug globals and test hooks require `?debug=1`.
- Error overlays insert messages with `textContent`, never HTML.
- The local dev server binds `127.0.0.1` unless `HOST` is explicitly set.
- The page does not disable browser zoom.
- Input is released on focus loss, visibility change and gamepad disconnect.

See the audit (`group_b_rally_QA_security_audit.md`) for the original findings
and the architecture notes for the current design.
