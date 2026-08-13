# Jarvis Live UI

- Isolated product repository for the private Jarvis web command surface.
- Never copy credentials from Hermes profiles into this repo, frontend bundle, logs, screenshots, or commits.
- Backend is the only component allowed to invoke the local `hermes` CLI.
- Browser may select only the allowlisted profiles/models defined server-side.
- External-write operations are never auto-approved by this application. Hermes retains its normal approval controls.
- Run `npm test` and `npm run build` before each deploy; verify the public HTTPS route after deploy.
- Keep UI source original: use the supplied reference only for broad visual principles (dark command-center, cyan telemetry, radial signal animation).
