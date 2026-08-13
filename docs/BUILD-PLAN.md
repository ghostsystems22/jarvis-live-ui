# Jarvis Live UI — build plan (VPS)

## Source analysed

- Reel: `https://www.instagram.com/reel/DboZHeqJwYC/`
- Local video: `/root/video-intake/instagram-DboZHeqJwYC/DboZHeqJwYC.mp4`
- Transcript: `docs/reel-transcript.txt`

## What the Reel actually proposes

1. Give the agent a permanent home (laptop, Mac Mini, or VPS).
2. Install an agentic harness (Hermes Agent).
3. Choose a replaceable model (Claude, Codex, Gemini).
4. Provide operating context: identity, business, process, rules.
5. Add durable memory.
6. Add reusable skills.
7. Connect operational tools (email, calendar, documents, browser).
8. Connect communications (Telegram, Slack, iMessage, voice).
9. Build a custom live voice/UI layer with Claude Design.

## Current VPS reality

- VPS capacity: 55 GB free on `/` at discovery.
- Hermes Agent `v0.17.0` is installed.
- Existing isolated Hermes profiles include `jarvis`, `ultron`, `atlas`, `forge`, `sentinel`, etc.
- Existing Hermes gateways are already running, including the `jarvis` profile.
- This project deliberately does **not** modify the existing Jarvis profile, its memory, tools, Telegram gateway, or credentials in Phase 0–1.

## Product outcome

A private, browser-based command surface for Gabriel that makes Jarvis feel live without becoming a cosmetic dashboard:

- speak or type a request;
- see routing, active work, tool actions, and evidence as structured events;
- switch working mode/profile only through an explicit approved action;
- read the final answer and open real artifacts;
- maintain a clear boundary between the UI, the broker, and Hermes profiles.

## Architecture decision

### Chosen path: VPS-hosted private app + narrow Hermes broker

```text
Browser (private HTTPS UI)
        │  WebSocket / HTTPS, authenticated session
        ▼
jarvis-live-ui app (React UI + Node/Fastify API)
        │  local Unix socket / localhost-only broker API
        ▼
Hermes broker (purpose-built, allowlisted)
        │  Hermes CLI/API or dedicated bridge session
        ▼
Hermes profiles (Jarvis first; specialists only through explicit routing)
        │
        ├── skills / profile memory / tools
        ├── Telegram gateway
        └── existing source systems
```

### Why this is the right first implementation

| Option | Verdict | Reason |
|---|---|---|
| Use only the stock Hermes dashboard | Useful for administration, not the Jarvis live-operating experience | It is already available but is primarily config/session management. |
| Put a static `APP_TOKEN` in a React UI and call Hermes directly | Rejected | Browser secrets are extractable; it would overexpose high-privilege agent capabilities. |
| Private VPS UI + local allowlisted broker | **Chosen** | Gives custom live UX, preserves Hermes isolation, and allows controlled capability expansion. |

## Non-negotiable security rules

- No Hermes profile API key, Telegram token, model credential, or Airtable/Notion secret enters frontend code.
- The frontend never invokes shell commands or Hermes profiles directly.
- The broker is `127.0.0.1`/Unix-socket only and validates every requested action against an allowlist.
- Browser auth uses an HttpOnly, Secure, SameSite session cookie; no permanent shared browser token.
- Phase 1 is read-only operational telemetry plus request submission. Tool writes remain in Telegram/Hermes until individually approved.
- Existing Jarvis memory remains the source of truth; this UI adds no second memory system.

## Scope by phase

### Phase 0 — project and safety foundation (0.5 day)

**Goal:** create the VPS project, understand the safe Hermes integration surface, and prove a browser can receive a harmless live event.

Deliverables:

- Node/TypeScript app skeleton in this repository.
- `.env.example`, secrets policy, Docker Compose, reverse-proxy route.
- `AGENTS.md` with profile/credential boundaries.
- A local broker spike exposing only:
  - `GET /health`
  - `GET /status` (sanitized profile/service status)
  - `POST /demo-event` (development-only proof)
- One browser page rendering a streaming event timeline.

Acceptance evidence:

- `npm test`, `npm run build`, Docker health check.
- Public URL returns the UI shell over HTTPS.
- Demo event appears live through WebSocket/SSE.
- No secret appears in built JS/CSS assets.

### Phase 1 — live operator cockpit (1–2 days)

**Goal:** replace passive chat with an inspectable operating surface.

UI surfaces:

1. **Command rail** — typed request, microphone placeholder, selected operating mode.
2. **Live run stream** — planned → tool call → evidence → result; collapsible details.
3. **Agent constellation** — Jarvis and specialist states: idle, queued, running, blocked, done.
4. **Mission panel** — user goal, current work, blockers, artifact links.
5. **Trust controls** — readonly / approval-required / delegated labels.

Broker capabilities (still narrow):

- Read sanitized status from Hermes CLI and/or an intentional status file.
- Submit a request into a dedicated Jarvis UI session after user confirmation.
- Stream only user-safe events from that session.
- Link to artifacts under approved project directories.

Acceptance evidence:

- One real prompt is submitted through the broker to a dedicated Jarvis session.
- Browser renders state changes and final output.
- Attempt to call an unallowlisted profile/tool returns `403` and logs a safe audit event.

### Phase 2 — voice and voice-visible execution (1 day)

**Goal:** push-to-talk interaction without creating a fragile “always listening” system.

- Browser MediaRecorder captures a user-initiated audio clip.
- Server-side transcription using the existing Hermes/STT provider only after consent.
- Text is sent through the same request broker as typed input.
- Optional response TTS plays only after the text run is complete.
- Transcript, audio retention, and deletion policy are explicit.

Acceptance evidence:

- A 20–30 second voice request creates a transcript, a visible run, and a spoken/text response.
- Permission denial, transcription failure, and no-audio states are usable.
- No microphone stream remains active after stop.

### Phase 3 — approved operations and specialist routing (1–2 days)

**Goal:** live UI can trigger useful work while preserving decision authority.

- Explicit intent/risk classification before dispatch.
- Routing matrix: Jarvis orchestration → Ultron technical / Helios content / Nexus fiber / Atlas architecture / Forge implementation / Sentinel verification.
- Approval tray for external writes, deployments, credential actions, or communications.
- Post-run evidence cards with source links and verification status.

Acceptance evidence:

- A safe task is delegated and summarized with an artifact path.
- A consequential operation remains pending until browser approval.
- Every run has request ID, selected profile, allowed capability, result, and timestamp.

## Claude Design UI brief

Create the first design artefact as a real, original operational cockpit — not an Iron Man clone.

### Audience and job

Gabriel operating several autonomous specialist agents from a VPS. He needs to decide: what is running, what requires approval, whether outcomes are real, and what to do next.

### Visual direction

- Dark technical command environment.
- Dense but calm; premium, precise, not gamer HUD.
- Near-black surfaces, graphite borders, restrained cyan signal accent, amber only for approval/risk, red only for failure.
- Strong sans typography; mono only for timestamps, IDs, command/tool telemetry.
- Motion shows execution state and continuity, never decorative loops.
- Original composition: command rail left, live stream center, mission/context rail right, status strip at top.

### Required interactive states

- Idle.
- Typing command.
- Queued / planning.
- Tool action in progress.
- Approval required.
- Final result with artifact link.
- Empty state, offline/broker unavailable state, and error/retry state.
- Mobile: command + run stream first; context collapses below.

### Deliverable order

1. Standalone clickable HTML prototype in `design/` (three directions: conservative, strong-fit, divergent).
2. Gabriel selects one direction.
3. Convert selected direction into React components/tokens under `app/`.
4. Verify visually in Chromium and against keyboard/mobile behavior.

## Hermes integration discovery plan

Before binding UI requests to a real profile, run a controlled spike:

1. Inspect authoritative Hermes CLI/API capabilities and local running service interfaces.
2. Identify a supported way to create or resume a dedicated UI session without sharing unrelated Telegram context.
3. Make a broker adapter with a fake Hermès client first.
4. Run one real harmless prompt against a dedicated test/session boundary.
5. Capture only sanitized events; redact credentials and raw tool environment.
6. Add an end-to-end test that rejects path traversal, unapproved profiles, unallowlisted toolsets, and direct shell execution.

## First build order

```text
0. Scaffold + Docker + HTTPS route
1. Design prototype (Claude Design workflow)
2. Event-stream UI against fake broker
3. Broker contract + fake client tests
4. Hermes read-only status adapter
5. Dedicated Jarvis UI session adapter
6. Voice input/output
7. Approval/routing controls
```

## Decision thresholds

| Signal | Threshold | Decision |
|---|---:|---|
| Browser sees a real, sanitized Hermes run | 1 successful run | Continue Phase 1. |
| Broker must bypass an unsupported/private Hermes interface | Any | Stop; use documented CLI/session bridge or ask for a supported integration route. |
| UI adds latency without better situational awareness | >5 seconds overhead or no actionable state | Simplify to Telegram + stock dashboard; do not force a separate UI. |
| A proposed action can write externally | Any | Require a visible approval step. |

## Definition of first usable version

A private HTTPS VPS UI where Gabriel can submit a typed request to a dedicated Jarvis UI session, watch a transparent run stream, see the final result plus evidence links, and know whether an action was blocked, waiting for approval, or complete.
