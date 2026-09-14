# S6: ABDM integration where every hospital plugs in its own registration

Status: DESIGN ONLY. No code changed. Written 2026-09-14 on branch `design-s3-s6` (base `origin/wardsynq-product` @ 5d3584e2).
Owner decision S6: **ABDM registrations are hospital-specific. Build the ABDM integration so each hospital later uses its own HFR
facility ID (and its doctors their own HPR / registration IDs).** Another session owns `feat/abdm-v3-reconcile`
(worktree `~/Developer/abdm`); this design reuses it and must not conflict with it.

Sources: code in this worktree; `origin/feat/abdm-v3-reconcile` read with `git log` / `git show` only (it IS on origin, last commit
6cea9d22 on 2026-08-21; not modified); `origin/wardsynq-task7-abdm-hiu`. Anything not proven by code or by a live call recorded in
that branch is marked **UNVERIFIED**. ABDM paths are quoted from code, never invented.

---

## 0. The short version

1. There are **two ABDM implementations** and the better one is not merged. `wardsynq-product` (= main plus 2 doc commits) carries
   the July Connect ABDM code (`functions/_connect/abdm/*`, about 2,860 lines) whose endpoint paths are all marked `// VERIFY` and
   whose Fidelius key derivation the v3 branch proved wrong. `feat/abdm-v3-reconcile` (50 commits, +16,281/-216, branched at
   `c86c6f96` on 2026-08-18) pins real V3 paths, fixes Fidelius, wires M1, M2 (9 HIP callbacks) and M3 (6 HIU callbacks), and is
   inert with flags off. `wardsynq-product` has moved 1,520 commits since, and 14 files changed on both sides.
2. **The v3 branch is single-bridge, single-identity outbound.** `wrangler.toml` on the branch commits `ABDM_ENV="sandbox"`,
   `ABDM_CLIENT_ID="SBXID_062379"`, `ABDM_HIP_ID="IN2810006668"`, `ABDM_HIU_ID="IN2810006668"`; every outbound call uses those.
   Inbound HIP callbacks are already partly multi-tenant: `resolveHipTenant` maps `X-HIP-ID` to a tenant from
   `connect_connector_config` rows (`hip-handlers.js:104-123`, fail closed on unknown).
3. **ABDM's own model already is "hospital-specific".** Per the branch's reading of the ABDM integrator FAQ (Q22-Q26,
   `docs/connect/abdm/V3-SPEC-RECONCILIATION.md` on the branch): a hospital registers itself in HFR, presses **Software Linkage**
   to bind a software's bridge (client) id, and each (facility, bridge) pair gets its own **HIP ID**. So "each hospital plugs in its
   own facility ID" does not require each hospital to hold its own bridge credentials. It requires **per-tenant outbound identity**
   (`X-HIP-ID` / `X-HIU-ID`), which neither implementation has.
4. What `wardsynq-product` adds that the branch lacks: `functions/_wardsynq/abdm-land.js`, the step that files decrypted ABDM
   documents into the WardSynQ record through MPI reconciliation, the governed store and audit (tested, 10 tests; no real sandbox),
   plus `hfrId` on the org and `hprId` on members (format checks only).
5. So the plan is: **merge first (the branch owner's call), then add a per-hospital layer beside the branch's files**: a sealed
   per-hospital ABDM profile, a tenant-scoped gateway identity, a WardSynQ-record HIP source, HIU from the chart, M1 at the WardSynQ
   registration desk, and a per-hospital certification checklist in the Admin Center.

---

## 1. What exists

### 1.1 In `wardsynq-product` (this worktree)

| Area | File | What it does | State |
|---|---|---|---|
| Gateway | `functions/_connect/abdm/gateway.js:8-14` | `ENDPOINTS`: `sessions /api/hiecm/gateway/v3/sessions`, `consentInit /consent-requests/init`, `consentFetch /consents/fetch`, `hiRequest /health-information/cm/request`, `hiNotify /health-information/notify`, each `// VERIFY`. Headers `authorization`, `X-CM-ID` (default `sbx`), `REQUEST-ID`, `TIMESTAMP`, `X-HIU-ID`, `X-HIP-ID` (`:28-39`). Credentials `secrets.get("ABDM_CLIENT_ID"/"ABDM_CLIENT_SECRET")` = plain env. Token cache KV `connect:abdm:tok:<hiuId\|\|hipId>`. | Superseded by v3 paths |
| HIU | `hiu.js` | consent init, HI request (Fidelius key minted, sealed into D1), `consumeTransfer`; task 7 added date-range clamp | Real, mock-tested |
| HIP | `hip.js`, `hip-sources/followcare.js`, `hip-crypto.js`, `hip-flags.js` | discovery, care-context linking, serve with cross-patient guard, push to HIU `dataPushUrl` with host allow-list `CONNECT_HIP_PUSH_HOSTS` | Real, mock-tested |
| Crypto | `fidelius.js` | X25519 ECDH + HKDF + AES-GCM | **HKDF input and public key encoding are the pre-fix versions** (v3 findings D4, D4b) |
| Signatures | `jws.js` | RS256 verify with JWKS from `env.ABDM_JWKS_URL` (`:124`); allowed hosts `dev.abdm.gov.in`, `sbx.abdm.gov.in`, `abdm.gov.in`, `healthidsbx.abdm.gov.in` (`:109-112`) | Real |
| Ingress | `ingress.js` | single JWS-body endpoint `/api/connect/ingress/abdm`, auto artifact fetch on GRANT, `consumeAndLand` hook (task 7) | v3 calls it superseded |
| State | `state.js`, `consent.js`, `no-phi.js` | monotonic consent/transfer state machine, sweep, erasure, PHI-free KV guard | Real |
| Schema | `db/connect_abdm_schema.sql` | `connect_abdm_consent_req`, `connect_abdm_txn` (sealed ephemeral private key, exactly-once ack), `connect_abdm_carecontext` | |
| Tenancy | `db/connect_schema.sql:2-18` | `connect_tenant (mode sandbox\|live)`, `connect_membership`, `connect_connector_config (tenant_id, connector_id, config, secret_ref)` already used for sealed per-tenant onboarding credentials | Reusable |
| Sealing | `functions/_connect/secrets.js` | AES-256-GCM `seal/open` with `CONNECT_MASTER_KEY` (32 bytes); `get()` is a plain env lookup | Reusable |
| Routes | `functions/api/connect/[[path]].js` | `abdmGatewayFor` needs `ABDM_GATEWAY_URL` + `ABDM_HIU_ID` (`:47-56`); `/ingress/abdm` (`:68-108`); `POST /abdm/hiu/consent-request` (`:133`, sends no requester), `/abdm/hiu/data-request` (`:159`), `/hip/care-contexts` (`:184`) | Flags `CONNECT_FLAG`, `CONNECT_HIP_FLAG` off |
| Landing | `functions/_wardsynq/abdm-land.js` | `landNdhmDocuments`: service actor may read Patient only; writes by the SCCM adapter at DRAFT on behalf of the consent requester; `reconcileIdentity` quarantines ambiguous patients; idempotency `ingest:abdm:<txn>:<n>`; no consent means refused. `LANDABLE` has 8 types (no Immunization, no Invoice). `makeConsumeAndLand` composes decrypt + land. | Tested (`test/wardsynq-abdm-landing.test.mjs`), no real sandbox |
| HFR / HPR | `functions/_region_in.js:52-98`, `functions/_opd_org.js:79, 275` | org `regionProfile.hfrId` (`IN` + 10 digits), member `regionProfile.hprId` (14 digits), member `regNo` | Format only; nothing ABDM reads them |
| ABHA as identifier | `functions/_wardsynq/identity-key.js:41`, `wardsynq/wardsynq-mpi.js`, `patient-register.js` ("ABDM-ready") | ABHA number as an identifier system in the MPI | No M1 calls |
| Tests | `test/connect/abdm/*` (~35 files incl. Fidelius and HIP-seal known-answer vectors, mock gateway), `test/wardsynq-abdm-hiu-routes.test.mjs` (11) | | Mock only |
| Docs | `docs/connect/abdm/owner-onboarding.md`, `docs/connect-GO-LIVE-CHECKLIST.md`, `docs/superpowers/specs/2026-07-31-stewardmd-connect-part2-abdm-design.md` | | Describe the July design |

`origin/wardsynq-task7-abdm-hiu` (1 commit, 69546037) is already squash-merged into `wardsynq-product` as 586cd7c1 (#1022): identical
4-file diff. Treat the branch as stale; do not merge it again.

### 1.2 What `origin/feat/abdm-v3-reconcile` builds (read-only)

**Configuration** (`functions/_connect/abdm/config.js`): `ABDM_ENV` sandbox or production.

| | Sandbox | Production |
|---|---|---|
| CM id | `sbx` | `abdm` |
| Gateway (sessions, M2, M3) | `https://dev.abdm.gov.in` | `https://apis.abdm.gov.in` |
| ABHA (M1) | `https://abhasbx.abdm.gov.in` + `/abha/api/v3` | `https://abha.abdm.gov.in` + `/api/abha/v3` |
| ABHA address | `https://abhasbx.abdm.gov.in` + `/abha/api/v3/phr/web` | `https://phr.abdm.gov.in` + `/api/phr/web/v3` |
| Facility registry (FHIR system) | `https://facilitysbx.ndhm.gov.in` | `https://facility.ndhm.gov.in` |
| HFR registration portal | `https://hspsbx.abdm.gov.in/home` | `https://nhpr.abdm.gov.in/home` (per branch doc; UNVERIFIED here) |

Plus `ABDM_CALLBACK_BASE` (India-hosted domain, base only), `ABDM_HIP_ID`, `ABDM_HIU_ID` (both the HFR facility id).

**Outbound gateway paths** (`gateway.js`, "PINNED 2026-08-18", host-only base + absolute paths). Live-verified from the branch's
own bridge: sessions, bridge-services, bridge/url PATCH (200/202) and the consent-init body field matrix
(`docs/connect/abdm/CERTIFICATION-READINESS.md` §2 on the branch). The rest are pinned from ABDM Postman collections and Swagger,
**not observed live**:

| Purpose | Method + path |
|---|---|
| Session | `POST /api/hiecm/gateway/v3/sessions` (live) |
| Bridge URL | `PATCH /api/hiecm/gateway/v3/bridge/url` (live) |
| Bridge services | `/api/hiecm/gateway/v3/bridge-services` (live) |
| Gateway public keys | `/api/hiecm/gateway/v3/certs` |
| HIP link token | `/api/hiecm/v3/token/generate-token` |
| HIP-initiated link | `/api/hiecm/hip/v3/link/carecontext` |
| Link context notify | `/api/hiecm/hip/v3/link/context/notify` |
| SMS notify | `/api/hiecm/hip/v3/link/patient/links/sms/notify2` |
| Patient links | `/api/hiecm/hip/v3/link/patient/links` |
| User-initiated discovery / link replies | `/api/hiecm/user-initiated-linking/v3/patient/care-context/on-discover`, `.../v3/link/care-context/on-init`, `.../v3/link/care-context/on-confirm` |
| HIP consent notify reply | `/api/hiecm/consent/v3/request/hip/on-notify` |
| HIP data request reply | `/api/hiecm/data-flow/v3/health-information/hip/on-request` |
| Scan and share reply | `/api/hiecm/patient-share/v3/on-share` |
| HIU consent | `/api/hiecm/consent/v3/request/init` (body live-verified), `/request/status`, `/request/hiu/on-notify`, `/api/hiecm/consent/v3/fetch` |
| HIU data | `/api/hiecm/data-flow/v3/health-information/request`, `/request/status`, `/api/hiecm/data-flow/v3/health-information/notify` |

**Inbound callback receiver** (`functions/api/v3/[[path]].js` + `callbacks.js`): Bearer JWT verified against gateway JWKS (RS256/RS512),
issuer `<gateway>/auth/realms/central-registry`, REQUEST-ID + TIMESTAMP (10 min skew) + KV replay nonce, immediate 202, work in
`waitUntil`. HIP routes: `/api/v3/hip/token/on-generate-token`, `/api/v3/hip/patient/care-context/discover`,
`/api/v3/hip/link/care-context/init`, `/api/v3/hip/link/care-context/confirm`, `/api/v3/link/on_carecontext`,
`/api/v3/links/context/on-notify`, `/api/v3/patients/sms/on-notify`, `/api/v3/consent/request/hip/notify`,
`/api/v3/hip/health-information/request`, `/api/v3/hip/patient/share`. HIU routes: `/api/v3/hiu/consent/request/on-init`,
`/on-status`, `/api/v3/hiu/consent/request/notify`, `/api/v3/hiu/consent/on-fetch`, `/api/v3/hiu/health-information/on-request`,
`/api/v3/hiu/patient/on-share`. Most inbound bodies are marked `// INFERRED`; only some callback kinds were ever observed from the
real sandbox (the branch's readiness doc says the human half of capture needs a sandbox ABHA app user).

**M1 ABHA** (`functions/api/abdm/[[path]].js`, flag `ABDM_M1_FLAG`, `abha.js` with RSA-OAEP field encryption from
`/profile/public/certificate`): enrolment `/enrollment/request/otp`, `/enrollment/enrol/byAadhaar`, `/enrollment/auth/byAbdm`,
`/enrollment/enrol/suggestion`, `/enrollment/enrol/abha-address`; login and verify `/profile/login/request/otp`,
`/profile/login/verify`, `/profile/login/verify/user`, `/login/abha/request/otp`, `/login/abha/verify`, `/login/abha/search`; account
`/profile/account/abha/search`, `/profile/account`, `/profile/account/abha-card`, `/profile/account/qrCode`,
`/login/profile/abha-profile`, `/login/profile/abha/phr-card` (relative to the ABHA prefix). `abha-link.js` (one ABHA per patient,
address sealed), `consent-text.js` (published ABHA consent language, recorded single use).

**M2 / M3**: `hip-handlers.js` (discovery by exact ABHA plus demographic index, our own link OTP `otp.js`, link-token cache
`linktoken.js`, consent store/delete, ack-first data serve, scan-and-share issuing an OPD token via `opd-bridge.js`), sources
`hip-sources/native-opd.js`, `connected-emr.js`, `clinic-billing.js`, `consented-store.js` (R2); `hiu-handlers.js` (6 kinds, 14-day
re-fetch window).

**Crypto fixes**: HKDF over the Weierstrass x coordinate (D4); 65-byte uncompressed public key (D4b/c); `dhPublicKey` as
`{expiry, parameters, keyValue}` (D6); known-answer tests against an independent BigInt reference of BouncyCastle.

**FHIR**: `serialize.js` conforms for 8 of 8 HI types against NRCES R4 (HAPI validator 6.2.1 evidence); Composition attester is the
HFR facility. SCCM gains `immunizations` and `invoices` (still `SCCM_VERSION "1.0"`).

**Storage**: new tables `connect_abha_link`, `connect_abdm_consented_record`, `connect_abdm_enrol_consent`,
`connect_abdm_demographic`; columns `consent_request_id`, `last_fetched_at`; idempotent `migrate.js` + `scripts/abdm-migrate.mjs`.

**Open blockers it records**: callback capture needs a sandbox ABHA app user; M2/M3 never run end to end; India hosting (ABDM FAQ
Q29: callback must be an India-based server addressed by domain, NAT IPs `13.203.243.253`, `13.203.245.166`, `65.0.113.207`,
`14.143.232.140` allowed); functional testing and CERT-In/STQC not started; DLT OTP template missing.

### 1.3 Where the two collide (14 files changed on both sides since `c86c6f96`)

High risk:
1. `functions/_connect/abdm/hiu.js`: both edit `buildHiRequestBody` in `requestHealthInformation` (date-range clamp vs `keyMaterial`).
   Textual conflict.
2. `functions/api/connect/[[path]].js` consent route sends no `requester`; v3 `requestConsent` throws without
   `requester.identifier.value` (the doctor's registration number). `test/wardsynq-abdm-hiu-routes.test.mjs` test 1 would fail after merge.
3. Two "SCCM 1.1": `wardsynq-product` bumps to 1.1 with `administrations`/`serviceRequests`/`consents`; v3 keeps 1.0 and adds
   `immunizations`/`invoices`. Needs a union.
4. Two env schemes: `ABDM_GATEWAY_URL` with relative paths (product) vs `ABDM_ENV` with host-only bases (v3). A URL with a path
   against v3 `gateway.js` doubles the path.
5. `abdm-land.js` hooks only the old JWS-body `ingress.js`; v3 has no route for the HIP data push to the HIU. The HIU data push
   receiver under V3 is **unconfirmed on both sides**.
6. `test/connect/abdm/mock-gateway.mjs` (both edit the data-push payload), `functions/_queue_engine.js`, `_queue_roles.js`,
   `_queue_timeline.js`, `functions/api/queue/[[path]].js`, `opd-emr.js`, `queue-flags.js`, `index.html` (v3 adds immunisation capture
   and scan-and-share against thousands of lines of product changes), `functions/_connect/canonical/model.js`, `validate.js`,
   `vault/Home.md`, `vault/decisions/Decisions.md`, `wrangler.toml`.

---

## 2. How to reuse without conflicting

- **Rule 1: nothing in this plan edits a file the v3 branch changed until that branch is merged into `wardsynq-product`.** The
  merge is the branch owner's work (their worktree `~/Developer/abdm`); this session does not rebase, cherry-pick or push to it.
- **Rule 2: before the merge, only new files and docs.** Per-hospital work that can start now lives in new files that neither side
  touches: `functions/_wardsynq/abdm-hospital.js` (profile model, pure), `functions/_wardsynq/abdm-hospital-store.js` (sealed
  storage over `connect_connector_config`), `wardsynq/site/pages/abdm.js` (Admin Center tab), their tests. They depend only on
  `functions/_connect/secrets.js` and `db/connect_schema.sql`, which the branch did not change.
- **Rule 3: after the merge, integrate through seams, not rewrites.** The per-tenant identity enters v3 code at three points only:
  `abdmConfig(env)` (add `abdmConfigFor(env, tenantProfile)`), the gateway session/token cache key, and the header builder. The
  existing `resolveHipTenant` stays the inbound selector, reading the same `connect_connector_config` rows this plan writes.
- **Rule 4: one landing path.** v3's HIU handlers call `makeConsumeAndLand` from `abdm-land.js` instead of a second ending; extend
  `LANDABLE` with `Immunization` and `Invoice` (or `ChargeItem`) once SCCM is unified.
- **Merge checklist to hand the branch owner** (from 1.3): resolve `hiu.js` by keeping both the clamp and `keyMaterial`; add
  `requester` to the product consent route (from member `regNo`); unify SCCM to one 1.1 with all five collections; delete
  `ABDM_GATEWAY_URL` in favour of `ABDM_ENV`; route V3 HIU data push into `makeConsumeAndLand`; move the committed sandbox
  `ABDM_CLIENT_ID` / `ABDM_HIP_ID` / `ABDM_HIU_ID` out of `wrangler.toml` into the sandbox tenant's profile (section 3) so a
  production deploy cannot inherit sandbox identity; run both suites (the branch reports 1,109 ABDM + connect tests; the product
  reports 6,641) plus `node scripts/wardsynq-reachability.mjs`.

---

## 3. The per-hospital model

### 3.1 Bridge versus facility: what is "the hospital's own"

| Thing | Owner | Per hospital? | Where it lives |
|---|---|---|---|
| HFR facility id | the hospital (registers itself in HFR with its licences) | yes | org `regionProfile.hfrId` (exists) |
| HIP ID (and HIU id) | ABDM, issued per (facility, bridge) pair after Software Linkage | yes | ABDM profile `hipId`, `hiuId` |
| Bridge (client) id + secret | the software vendor, one per software per environment | **shared by default**, own bridge optional | profile `bridge` (shared: reference; own: sealed) |
| Bridge callback URL | per bridge id, base URL only | follows the bridge | profile `callbackBase` for own bridges |
| Doctor identity on consent requests | the doctor | per member | member `regNo` (exists), `regionProfile.hprId` (exists) |
| Counter ids for scan and share | the hospital | per department/counter | profile `counters[]` |

**Default (recommended): one StewardMD bridge per environment, each hospital links it.** It matches ABDM's documented model (per
branch FAQ reading Q22-Q26), one certification of the software covers every hospital, and callbacks for every hospital reach one
receiver that selects the tenant by `X-HIP-ID` (already built). **Optional: a hospital's own bridge**, for a hospital that insists on
holding its own ABDM credentials or runs its own WardSynQ deployment (D4 says WardSynQ is deployed per hospital, Epic-style). Then the
profile carries its own client id and a sealed secret, and that hospital's callbacks need its own base URL. The model supports both;
**which to offer is owner decision A1**.

Per-hospital deployments and a shared bridge: one bridge has one callback base, so separate hospital deployments behind a shared
bridge need a small **ABDM router** at that base that verifies the gateway JWT once and forwards by `X-HIP-ID` to the hospital's
deployment. Without the router, each deployment needs its own bridge. This is the same India-hosted front door section 3.8 needs.

### 3.2 The ABDM hospital profile

Stored as one `connect_connector_config` row per hospital: `tenant_id` = the hospital's Connect tenant (org `connectTenantId`,
`functions/_opd_org.js:77`), `connector_id = "abdm"` (the key `resolveHipTenant` already scans), `config` JSON:

```json
{
  "version": 1,
  "env": "sandbox",
  "hfrFacilityId": "IN2810006668",
  "hipId": "IN2810006668",
  "hiuId": "IN2810006668",
  "roles": { "hip": true, "hiu": true, "abhaDesk": true, "scanShare": true },
  "bridge": { "mode": "shared" },
  "bridgeOwn": { "clientId": "SBXID_...", "secretSealed": "<AES-GCM envelope>", "callbackBase": "https://abdm.<host>" },
  "counters": [ { "counterId": "OPD1", "departmentId": "dep_med" } ],
  "hiTypesServed": ["OPConsultation", "Prescription", "DiagnosticReport", "DischargeSummary"],
  "status": "draft",
  "checks": { "hfrVerified": null, "softwareLinked": null, "sessionOk": null, "bridgeServicesSeen": null, "m1": null, "m2": null, "m3": null },
  "updatedBy": "orgId~identity", "updatedAt": "..."
}
```

Rules:
- `hfrFacilityId` must equal org `regionProfile.hfrId`; a mismatch is refused, so there is one source of truth for the facility.
- `env` is per hospital: a sandbox tenant and a production tenant can coexist in one deployment (the branch's `ENVS` table is reused,
  selected by the profile, not by a global `ABDM_ENV`).
- Secrets are sealed with `functions/_connect/secrets.js` (`CONNECT_MASTER_KEY`, AES-256-GCM, random IV). Never in KV (R16 rule,
  `no-phi.js`), never in any response: the Admin tab shows "set on <date>, fingerprint <8 chars>". Rotation writes a new envelope and
  audits it. **No new env vars or bindings** (owner rule: bindings are at their limit); the shared bridge secret stays the one
  existing Pages secret `ABDM_CLIENT_SECRET`.
- `status`: `draft -> sandbox-linked -> sandbox-passed -> production-linked -> live -> suspended`. Only `live` serves production
  callbacks; `suspended` makes discovery answer "no records" and refuses new consent requests, fail closed.
- Writes need `staff.admin` on the org and are audited in `q_audit` (chained by G3).

### 3.3 Tenant-scoped identity (the change neither side has)

- `abdmConfigFor(env, profile)`: gateway, ABHA and CM hosts from `profile.env`; `hipId`/`hiuId` from the profile; bridge from
  `profile.bridge.mode` (shared: env `ABDM_CLIENT_ID` + secret; own: opened `bridgeOwn`).
- Session token cache key becomes `connect:abdm:tok:<env>:<clientId>` (a session belongs to a bridge, not a facility); the header
  builder takes `X-HIP-ID`/`X-HIU-ID` from the profile on every call.
- Inbound: HIP callbacks resolve tenant by `X-HIP-ID` (existing `resolveHipTenant`, env fallback removed for production); HIU
  callbacks resolve by the correlation row created when that tenant sent the request (existing); a callback whose resolved tenant
  profile is not `live` (or `sandbox-*` for sandbox env) is refused and audited.
- Cross-tenant guard tests: a callback with hospital A's HIP ID never reads hospital B's care contexts; a consent artefact for B
  never lands in A (the branch's D8 adversarial pattern, extended to two profiles).

### 3.4 HIP role (the hospital shares its records)

- **Care contexts**: one per OPD visit and one per IPD admission (branch design, `vault/modules/ABDM.md` on the branch). New HIP
  source `hip-sources/wardsynq-record.js` reading the WardSynQ record through `RecordService` for the tenant: Encounter,
  Condition, MedicationOrder, Observation, DiagnosticReport, discharge summary (`functions/_wardsynq/migrate-discharge.js`),
  ImmunizationRecord, invoice. The branch's `native-opd.js` / `clinic-billing.js` stay for clinics and non-WardSynQ orgs.
- **Linking**
  - HIP-initiated: when a patient with a verified linked ABHA completes a visit or is discharged, generate a link token
    (`/api/hiecm/v3/token/generate-token`, reply at `/api/v3/hip/token/on-generate-token`), link (`/api/hiecm/hip/v3/link/carecontext`,
    reply `/api/v3/link/on_carecontext`), notify (`/api/hiecm/hip/v3/link/context/notify`), optional SMS notify. Queued through the
    WardSynQ outbox (`functions/_wardsynq/outbox.js`) so a failed call retries and never blocks discharge.
  - User-initiated: discovery by ABHA then demographics (`/api/v3/hip/patient/care-context/discover`), init and confirm with our
    OTP (`/api/v3/hip/link/care-context/init`, `/confirm`). Ambiguous demographic matches return no match (branch rule), never a guess.
  - Scan and share: the facility QR per counter (`https://phrsbx.abdm.gov.in/share-profile?hip-id=<HIP ID>&counter-id=<code>` in sandbox,
    per branch doc) posts to `/api/v3/hip/patient/share`; the reply issues an OPD token through the **same department counter** as the
    desk (S3 doc section 4.3), using `counters[].departmentId`.
- **Serving data**: consent notify stored per tenant; HI request answered ack first; bundles serialised by the branch's NRCES-conformant
  `serialize.js`; encrypted with Fidelius; pushed to the HIU's `dataPushUrl` with the host allow-list; transfer and erasure via
  `state.js` sweep.

### 3.5 HIU role (the hospital asks for outside records)

- **Entry**: a "Request records from ABDM" action on the WardSynQ chart (`ward.js` chart header), capability `emr.treat`, for a patient
  with a linked ABHA. Purpose (ABDM purpose code; which codes to offer is UNVERIFIED, take them from the branch's live consent-init matrix), HI types, date range, expiry chosen by the doctor. `requester.identifier` =
  `{type: "REGNO", value: member.regNo}` (format per branch live consent-init test; HPR ID carried where the member has one).
- **Flow**: `/api/hiecm/consent/v3/request/init` -> `/api/v3/hiu/consent/request/on-init` -> patient approves in ABHA app ->
  `/api/v3/hiu/consent/request/notify` -> `/api/hiecm/consent/v3/request/hiu/on-notify` -> `/api/hiecm/consent/v3/fetch` ->
  `/api/v3/hiu/consent/on-fetch` -> `/api/hiecm/data-flow/v3/health-information/request` (with our Fidelius key material) ->
  `/api/v3/hiu/health-information/on-request` -> HIP pushes ciphertext -> decrypt (`consumeTransfer`) -> `makeConsumeAndLand` ->
  record (DRAFT, on behalf of the requester, MPI reconciled, purpose stamped) -> `health-information/notify`.
- **What the doctor sees**: request status on the chart (requested, granted, denied, expired, revoked, received N documents, quarantined
  M), landed items tagged "from ABDM, consented for care management until <date>" (purpose from `consumeNdhmBundle`).
- **Revocation and expiry**: the sweep erases consented data per artefact (`data_erase_at`); landed DRAFT record rows keep provenance.
  Whether landed rows must also be erased on revocation is a DPDP question: **owner decision A4**.

### 3.6 Consent manager flows and ABHA (M1)

- **ABHA at the WardSynQ registration desk** (`patient-register.js`, shared by `queue.js` and `opd.html`): verify an existing ABHA
  (number or address, OTP), or create one by Aadhaar OTP, using the branch's `abha.js` and `consent-text.js` (the published consent
  text recorded single use). The ABHA number joins the MPI as the `abha` identifier (`identity-key.js:41`); one ABHA per patient per
  tenant (`abha-link.js`).
- Aadhaar numbers, OTPs and mobile numbers are request-scoped only: the branch's server-side `abha.js` encrypts them with the ABHA
  public key (RSA-OAEP SHA-1, `abha.js:56-88`) and never logs, caches or persists them (`abha.js:7-8`). Desk staff role
  needs a capability (`queue.add` today) plus an explicit per-hospital `roles.abhaDesk`.
- The patient's own ABHA app is the consent manager UI; WardSynQ never approves consent on a patient's behalf.

### 3.7 Health information exchange with Fidelius

- Key agreement: ECDH on Curve25519 (X25519), ephemeral key pair per transfer on each side; key derivation HKDF over the shared
  secret with the XOR of both nonces; payload AES-GCM (branch `fidelius.js` after fixes D4, D4b, D4c, D6). Reference implementation
  the branch tested against: ABDM's Fidelius (Java/BouncyCastle) via an independent BigInt reproduction.
- The HIU's ephemeral private key is sealed into D1 (`connect_abdm_txn`) and deleted at the exactly-once ack.
- Ciphertext buffer in R2 (`CONNECT_R2`) only, erased on ack or sweep; KV carries no PHI and no key material.
- **Must use the branch's `fidelius.js`.** The product copy derives keys the way the branch proved incompatible with ABDM; any work
  before the merge must not call it for real traffic.

### 3.8 Hosting and residency

ABDM requires an India-based callback server addressed by domain with its NAT IPs allowed (branch FAQ Q29). Cloudflare Pages
answers from the nearest edge; Regional Services is an Enterprise add-on and KV/D1/R2 residency guarantees do not cover India
(branch research 2026-08-18). The owner's AWS migration (D12, about 2026-09-28) is the natural answer: an India-region (Mumbai)
ABDM front door plus the ABDM state store (consent requests, transactions, sealed keys, ciphertext buffer) in the same region.
**No production ABDM traffic before that.** Sandbox work can continue on the current stack. Owner decision A2.

---

## 4. Certification path

### 4.1 Once for the software (StewardMD / WardSynQ as the integrator)

| Step | Sandbox | Production | Evidence to keep |
|---|---|---|---|
| Bridge registration | done: `SBXID_062379` (MAIKNOWLEDGE LLP, per branch) | apply after sandbox exit | approval emails |
| Bridge URL | still a placeholder; set to India callback base | production callback base | PATCH response |
| Milestones for an HMIS: M1 (ABHA), M2 (HIP), M3 (HIU); HFR linkage mandatory, HPR not (branch reading of ABDM docs, UNVERIFIED officially) | run every callback kind end to end with a sandbox ABHA app user | n/a | captured callback bodies, `abdm-capture.py` logs |
| FHIR conformance | HAPI 6.2.1 against `https://nrces.in/ndhm/fhir/r4`, 8 of 8 HI types (branch) | same | validator logs |
| Functional test with NHA / empanelled lab | book after M1-M3 green | | test report |
| Security audit (CERT-In empanelled / STQC or as NHA requires) | not started | required before production | audit report |
| DLT-registered SMS template for link OTP | missing | required | DLT id |
| Production credentials | | issued after the above | sealed as the shared bridge secret |

### 4.2 Per hospital (repeatable, from the Admin Center checklist)

1. Hospital registers its facility in HFR (sandbox `https://hspsbx.abdm.gov.in/home`, production per NHA) with its own documents;
   HFR verification completes. Enter `hfrId` on the org (exists).
2. Hospital presses **Software Linkage** for the StewardMD bridge; ABDM shows the HIP ID. Enter it in the ABDM tab. (Own-bridge
   hospitals: enter client id and secret; secret sealed.)
3. **Check session**: the tab calls sessions and bridge-services for that profile and shows the facility's services (live-verifiable
   today with the branch's calls). `checks.sessionOk`, `checks.bridgeServicesSeen` set.
4. Sandbox run for that hospital's profile: verify an ABHA at the desk, link one visit, share with a sandbox ABHA app, request records
   as HIU, land them. Each step flips its `checks.*` with a timestamp and the transaction ids (no PHI).
5. Doctors: `regNo` required to request records; `hprId` optional.
6. Counters: print scan-and-share QR per counter.
7. Owner (hospital admin) confirms DPDP notices and consent text are displayed at the desk.
8. Switch `env` to production (new profile row or version) after the software holds production credentials; status `live`.

Nothing in 4.2 repeats software certification; that is the benefit of the shared-bridge default. **UNVERIFIED**: whether NHA asks
for any per-facility functional test when a certified software is linked to a new facility; ask NHA before promising timelines.

---

## 5. Phased build plan with tests

| Phase | Depends on | Scope | Tests |
|---|---|---|---|
| **A0 Merge** (branch owner) | owner go-ahead | Merge `feat/abdm-v3-reconcile` into `wardsynq-product` with the section 2 checklist; flags stay off | both suites green; reachability; new `abdm-merge-invariants.test.mjs`: one SCCM version, one gateway env scheme, product consent route sends requester, `LANDABLE` includes immunization/invoice |
| **A1 Hospital profile** (can start before A0: new files only) | none | `abdm-hospital.js` (pure validation: HFR format and equality with org, HIP id format, status transitions), `abdm-hospital-store.js` (sealed row in `connect_connector_config`), Admin Center "ABDM" tab (`wardsynq/site/pages/abdm.js`) behind `staff.admin`, org mode `wardsynq` only | `abdm-hospital.test.mjs` (validation, transitions); `abdm-hospital-sealing.test.mjs` (secret never in any response or audit, envelope opens, wrong key fails); `neg-auth-abdm-profile.test.mjs` (non-admin, other org, staff of other hospital refused); reachability entry for the new routes |
| **A2 Tenant-scoped gateway** | A0, A1 | `abdmConfigFor`, token cache per bridge, per-call HIP/HIU headers, production refusal of env fallback, "Check session" action | mock gateway asserts `X-HIP-ID` per tenant; two-tenant cross-callback tests; env-fallback refused in production |
| **A3 WardSynQ HIP source** | A2 | `hip-sources/wardsynq-record.js`; care context on visit end and discharge via outbox; HIP-initiated link; user-initiated discovery against the WardSynQ MPI | serializer output validated in CI with the NRCES fixtures the branch uses (no network); discovery ambiguity returns none; discharge never blocked by a failed link; cross-patient guard |
| **A4 HIU from the chart** | A2, abdm-land | chart action, status card, landing through `makeConsumeAndLand`, provenance tag, revocation behaviour per A4 decision | end-to-end with mock gateway + Fidelius KAT vectors; quarantine on ambiguous identity; purpose stamped; no landing without consent; `run-ward-abdm-request-golden-path.mjs` |
| **A5 ABHA desk and scan and share** | A0, S3 P5 (department tokens) | M1 in `patient-register.js`; QR per counter; share reply allocates department token | M1 client tests from branch; `abdm-scan-share-token.test.mjs` (same counter as desk); Aadhaar never persisted sweep |
| **A6 India front door and sandbox evidence** | D12 AWS, A2 | India-region callback host + state store; bridge URL set; capture every callback kind; per-hospital checklist run for the first hospital | captured bodies replayed as fixtures; `abdm-inferred-shapes` sweep switched from inferred to observed |
| **A7 Certification** | A6 | functional test, security audit, DLT template, production credentials; first production hospital | external reports filed under `docs/connect/abdm/` |

Server-only: all phases (Pages functions, D1 migrations applied with `wrangler d1 execute ... --remote` before code that needs them).
App bundle (`www`, OTA or rebuild): A4 chart action and A5 desk changes reach the phone through `ward.js` / `patient-register.js`.
No native rebuild is needed for ABDM.

Test rules carried from the repo: negative authorisation tests for every new route; PHI-free audit sweep (`no-phi-sweep` pattern)
over every new log and KV write; nothing claims "verified against ABDM" without a captured live exchange.

---

## 6. Unverified or open, in one place

- Every ABDM path except sessions, bridge-services, bridge/url and the consent-init body: pinned from ABDM collections by the branch,
  not observed live.
- Inbound callback body shapes (most marked `// INFERRED` on the branch).
- The V3 HIU data-push receiver route and its authentication.
- Production HFR portal URL and the production Software Linkage flow.
- Whether HPR is optional for an HMIS integrator (branch reading of FAQ; confirm with NHA).
- Whether NHA requires per-facility testing when a certified software is linked to a new facility.
- Whether per-hospital WardSynQ deployments (D4) can share one bridge without an ABDM router (one callback base per bridge).
- Test counts on the branch (not run here).

## 7. Owner decisions needed for S6

- **A1** Shared StewardMD bridge with each hospital linking its own facility (recommended), or also let a hospital bring its own
  bridge credentials?
- **A2** Hold all production ABDM traffic until the India-region hosting from the AWS move exists?
- **A3** Who merges `feat/abdm-v3-reconcile` into `wardsynq-product`, and when (it blocks A2-A5)?
- **A4** When a patient revokes consent, erase records already filed into the chart from ABDM, or keep them marked as received
  under a consent that has since been withdrawn?
- **A5** Should desk staff create new ABHA numbers by Aadhaar OTP, or only verify ABHAs patients already have?
