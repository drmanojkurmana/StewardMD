# Connect Hospital phone-runner contract (shared by plugin, phone engine, broker, UI)

Repo conventions: buildless ES5 IIFE client at repo root; `connect-agent/**/*.mjs` are ES modules served as
static files and loaded in the app WebView with dynamic `import()`. Server = Cloudflare Pages Functions under
`functions/`, D1 via `functions/_connect/agent/store.js`. No `node:` imports may be reachable from `functions/`.
No em-dash in app-facing text. Never log or persist cookies, passwords, form values, or PHI values.

Native plugin: see `local-plugins/capacitor-connect-browser/README.md` (name `ConnectBrowser`).

## Broker routes (all under `/api/connect/agent/`, actor-authenticated, tenant resolved server-side)

| Route | Body | Response | Rules |
|---|---|---|---|
| `POST /sessions` | `{ emrUrl, consent:{agreed:true}, runner:"phone" }` | `{ session, job|null, deployment:{ id, origins, activeVersionId|null }, reuse:boolean }` | If the deployment already has an ACTIVE version, create the session (for reauth/use) but NO onboarding job; `reuse:true`. Existing Camofox path unchanged when `runner` is absent. |
| `POST /sessions/:id/handoff` | `{ visitedOrigins:[origin] }` (optional) | existing view + `{ origins, pendingOrigins }` | Origins with the same registrable domain as the deployment's first origin (last 2 labels; last 3 when the 2-label suffix is one of co.in ac.in edu.in org.in gov.in net.in res.in co.uk ac.uk) are appended to the deployment. Others are returned as `pendingOrigins` for doctor confirmation. |
| `POST /sessions/:id/origins` | `{ approve:[origin] }` | `{ origins }` | Only origins previously returned as pending for this session; https only. |
| `POST /sessions/:id/plan` | `{ url, lines:[string<=200 chars] (<=400), visited:[string], depth, events:[{method,path,status,contentType}] (<=200) }` | `{ action:"click"|"back"|"stop", ref?, label?, reason }` | Deterministic keyword planner, no LLM in v1. `ref` MUST come from a line of the form `- <role> "<name>" [ref=<id>]`. Lines are transient: never persisted, never logged. |
| `POST /sessions/:id/progress` | `{ stage:"DISCOVERING", counts?:{events,steps} }` | view | Moves job AUTHENTICATED -> DISCOVERING (progress). Idempotent. |
| `POST /sessions/:id/discovery` | `{ spec, steps:[{ref,label,fromUrl,toUrl}], nativeRequests?:[{method,origin,path}] }` | `{ candidateVersionId, manifest, probes:[{opId, method:"GET", url}], capabilities }` | Server: job DISCOVERING success -> COMPILING -> `compileManifest(spec)` -> VALIDATING (progress) -> offline `validateCandidate`. Probes are GET-only operations on allowlisted origins whose path was observed. Size cap 512 KB -> 413. Job stays VALIDATING until evidence. |
| `POST /sessions/:id/evidence` | `{ probes:[{opId, status, contentType, responseShape, itemCount}] }` | `{ candidateVersionId, capabilities:[{operation, resource, proven, how}], evidenceHash, state }` | Only opIds the server issued. Inserts the version (CREATED -> VALIDATING -> AWAITING_APPROVAL), job -> AWAITING_APPROVAL with candidate_version_id. |
| `GET /sessions/:id` | | existing view + `{ deployment:{id,origins,activeVersionId}, candidateVersionId, capabilities? }` | |
| `GET /versions/:id` | | `{ id, state, deploymentId, operations:[{opId, type, resource, method, pathTemplate}], capabilities, evidenceHash, createdAt }` | Never returns raw response shapes with values (there are none) but may return key names. |
| `POST /versions/:id/approve` | `{}` | `{ state:"ACTIVE", activationId }` | Requires `canAgent(role, "approve")` (add the action if missing; owner/admin only). Calls `activateVersion`. Records ledger entry. |
| `POST /versions/:id/reject` | `{ reason? }` | `{ state:"REVOKED" }` | Same permission. |
| `GET /connections` | | `[{ deploymentId, origins, activeVersionId, activeSince, pendingVersionId, lastSessionState }]` | My tenant only. |

## spec shape (produced by `createCollector().collect()` in `connect-agent/discovery.mjs`, unchanged)

`{ version:3, browser:"phone-ios"|"phone-android", allowedOrigins, events:[{method,path,origin,queryKeys,status,contentType,responseShape,blocked}], blockedEvents, reinstalls, generatedAt, discoveryMode:"read-observe-only" }`

## Snapshot line format (phone engine -> planner)

Playwright-style, one element per line, indented by depth:
`- link "Doctor" [ref=e12]`, `- button "Search" [ref=e13]`, `- textbox "Patient ID" [ref=e14]`, `- heading "IP Worklist"`, `- text "..."` (context lines have no ref). Roles: link, button, menuitem, tab, option, textbox, checkbox, radio, combobox, heading, text, cell, row. Names truncated to 80 chars; runs of 4+ digits in names are replaced with `#` before leaving the phone. Max 400 lines.

## Live probe policy (phone)

Executed in the page realm of the authenticated web view: `fetch(url, {credentials:"include", method:"GET"})` only for probes the server issued; records `status`, `contentType`, key-only `responseShape` (same `shape()` as the observer) and `itemCount` for arrays. Never sends body values off the phone.

## Caps

Exploration: max 40 steps, max 4 minutes, max depth 8, wait 1200 ms after each click. Any `blocked` event or `stopped` event ends exploration immediately and the spec so far is submitted.
