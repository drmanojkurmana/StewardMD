# Capturing real ABDM callbacks — runbook

Every `// INFERRED` comment in `hip-handlers.js` and `hiu-handlers.js` marks a callback body we reasoned
our way to because ABDM has not released the V3 YAML. This runbook replaces each one with something we
have seen. It needs about 20 minutes and an Android phone.

## Why a human is needed at all

Two facts, both established against the live sandbox on 2026-08-19:

1. **The gateway resolves the ABHA subject synchronously.** A consent request or a link-token request for
   an address that does not exist is refused `400 "User not found"` on the request itself, and **no
   callback is emitted**. So nothing can be captured until a real sandbox ABHA address exists.
2. **Half the callbacks are patient-initiated.** Discovery, consent GRANT, user-initiated linking and
   scan-and-share only fire when someone taps in the Sandbox ABHA app. There is no server-side way to
   simulate that.

Which is why step 1 below is yours, and most of the rest is scripted.

## Current state

| | |
|---|---|
| Bridge | `SBXID_062379` (MAIKNOWLEDGE LLP), active |
| Facility / HIP / HIU id | `IN2810006668` "StewardMD", HIP+HIU, active |
| Callback base registered | a webhook.site capture URL - read it with `./scripts/abdm-sandbox-probe.sh bridge` |

The previous callback URL had expired, so ABDM's callbacks were going nowhere and nothing was retained.
It was re-registered on 2026-08-19. Confirm at any time with:

```bash
./scripts/abdm-sandbox-probe.sh bridge
```

> webhook.site free tokens expire. If `bridge` shows a URL that 404s, mint a new one and re-register:
> `./scripts/abdm-sandbox-probe.sh set-url https://webhook.site/<new-token>` — **base URL only**, no
> path, or the gateway appends the endpoint twice (FAQ Q30).

## Step 1 — create a sandbox ABHA address (yours to do)

1. Install the Sandbox ABHA app: the apk is linked from the sandbox docs, "Getting Started → Sandbox ABHA
   App" (v3.3.0 Godavari, Android only).
2. Create an ABHA address. It will look like `something@sbx`.
3. Set a password for it — some APIs need one.
4. You can check the profile at `https://abhasbx.abdm.gov.in`.

Sandbox allows **100 ABHA creations per client id** (`ABDM-1227`), so there is room, but do not burn them.

Then tell me the address, or run step 2 yourself.

## Step 2 — trigger the server-driven flows (scripted)

```bash
# Start the capture watcher in one terminal
./scripts/abdm-capture.py "$(./scripts/abdm-sandbox-probe.sh bridge | sed -n 's#.*webhook.site/##p')" --watch

# Fire the flows in another
./scripts/abdm-sandbox-probe.sh flow <your-address>@sbx
```

That posts a consent request and a demographic-auth link-token request. Expect:

| Callback | Path |
|---|---|
| consent request accepted | `/api/v3/hiu/consent/request/on-init` |
| link token issued | `/api/v3/hip/token/on-generate-token` |

The consent request will appear as a **notification in your ABHA app**.

## Step 3 — the patient-initiated half (yours, in the app)

Do these in the ABHA app against facility **StewardMD / `IN2810006668`**. Each produces callbacks the
watcher will print:

| What you do in the app | Callback we need |
|---|---|
| Approve the pending consent request | `/api/v3/hiu/consent/request/notify`, then `/api/v3/hiu/consent/on-fetch` |
| Search StewardMD and "find my records" | `/api/v3/hip/patient/care-context/discover` |
| Link a discovered care context (enter the OTP we send) | `/api/v3/hip/link/care-context/init`, `/confirm` |
| Scan the facility QR | `/api/v3/hip/patient/share` |
| Later: revoke the consent | `/api/v3/consent/request/hip/notify` with `REVOKED` |

Discovery and linking only return something if StewardMD holds care contexts for that ABHA, so link one
first (HIP-initiated) or expect an empty-but-well-formed discovery response — which is still the shape
evidence we want.

## Step 4 — turn captures into fixtures

```bash
./scripts/abdm-capture.py "$(./scripts/abdm-sandbox-probe.sh bridge | sed -n 's#.*webhook.site/##p')" \
  --out test/connect/abdm/fixtures/real-callbacks.mjs
```

Identifiers (ABHA address and number, mobile, Aadhaar) are **masked by default**; the structure, which is
the actual evidence, is untouched. Do not pass `--raw` into a tracked path.

Then, for each captured callback:

1. Find the matching `// INFERRED` block in `hip-handlers.js` / `hiu-handlers.js`.
2. Diff our assumed shape against the real body.
3. Replace the comment with `// PINNED (captured <date>)` and fix the parser if it differs.
4. Add an assertion in `hip-handlers.test.mjs` / `hiu-handlers.test.mjs` driven from `REAL_CALLBACKS`.

## What is already evidence-backed

`test/connect/abdm/fixtures/sandbox-probes.mjs` holds live gateway responses from 2026-08-19 proving
which consent-init fields are mandatory. Reproduce with:

```bash
./scripts/abdm-sandbox-probe.sh consent-matrix
```

| Field | Live gateway says |
|---|---|
| `consent.hiu` | "HIU ID is mandatory" |
| `permission.accessMode` | "Invalid accessMode, it must be in VIEW, STORE, QUERY, STREAM" |
| `permission.frequency` | "Frequency should not be null or empty" |
| `hiTypes` | "HI Types cannot be null" |
| `purpose` | "Consent purpose cannot be null" |
| `requester` | *accepted without it* — we require it anyway (certification pins it, and the patient's consent screen must name the doctor) |
| `hip` / `careContexts` | *accepted without them* — we send explicit nulls, as ABDM's own collection does |

## Why the capture URL is not written down here

A webhook.site URL is an unauthenticated inbox, and the callbacks ABDM posts to it carry a real ABHA
address and real patient demographics. Committing the token would put "anyone who can read this repo can
read captured PHI" into git history, where it cannot be taken back. So the token lives only in the ABDM
registration, and every command above reads it from there:

```bash
./scripts/abdm-sandbox-probe.sh bridge     # prints the registered URL
```

Rotate it (mint a new token and `set-url`) once the capture exercise is finished, so the inbox stops
being live.

## Safety

- The probe script targets a deliberately nonexistent address by default, so no real person is sent a
  consent request unless you pass one to `flow`.
- Credentials are sourced from `~/.stewardmd-secrets/abdm-sandbox.env` and never printed.
- `set-url` refuses a URL with a path, because that silently doubles the endpoint (FAQ Q30).
- **Do not set `CONNECT_HIP_FLAG=1`** until the inferred shapes have been replaced. An unverified parser
  against a real peer fails silently, which is exactly how D4, D6 and the two key-format defects happened.
