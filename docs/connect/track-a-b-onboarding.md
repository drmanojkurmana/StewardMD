# StewardMD Connect — Track A (FHIR/SMART) + Track B (HL7/CSV) — Owner Onboarding

**Branch:** `feat/connect-fhir-smart` (off merged main which has Track D). Recovery tag `pre-connect-fhir`.
**Flags (both default OFF, separate from `smd_connect`):** `smd_connect_fhir` (env `CONNECT_FHIR_FLAG`) gates the FHIR pull surface; `smd_connect_hl7` (env `CONNECT_HL7_FLAG`) gates the HL7/CSV ingest routes. A surface with its flag OFF is a 404 (no existence leak). Nothing is pushed; both ship inert.

## Track A — Hospital EMR Connector (FHIR R4 + SMART-on-FHIR Backend Services)
A synchronous **pull** connector: SMART Backend Services auth (`client_credentials` + asymmetric `private_key_jwt`), bounded paginated fetch, FHIR R4 -> SCCM. Files: `functions/_connect/smart/{flags,discovery,assertion,token}.js`, `functions/_connect/connectors/fhir-r4/{paginate,connector,normalize}.js`, engine ctx surface + `smart-mock.local` sandbox host + router flag gate.

Security posture: token-endpoint **trust gate** (https, no-userinfo, host-allow-listed, validated before signing and re-asserted before POST), asymmetric-only signer (`alg:none`/HMAC structurally impossible), envelope-sealed NON-PHI token cache (tenant+connector scoped), scope never widened, fail-closed. The frozen `SMART_HOST_ALLOWLIST` is a HARD CEILING — a per-tenant override can only NARROW it; `fhirBase` is gated before any discovery fetch (no SSRF).

## Track B — Legacy Feeds (HL7 v2 + file/CSV)
Two **event/push** connectors behind an HMAC-gated ingest spine. Files: `functions/_connect/ingest.js` (spine), `functions/_connect/connectors/hl7v2/{parser,normalize,connector}.js`, `functions/_connect/connectors/file/{csv,normalize,connector}.js`, `db/connect_hl7_schema.sql` (`connect_feed`), additive `/ingress/hl7` + `/ingress/file` router branches.

Hand-written (no-dep) parsers, adversarially hardened (warn-never-throw, budget-bounded). The spine: flag -> verify HMAC-SHA256 (constant-time) -> replay defense (freshness + HMAC'd nonce) -> correlate (authoritative tenant from the `connect_feed` row; headers are cross-check only) -> route -> validate/scope-filter/PHI-free-audit -> discard. No StewardMD actor on the push path; no PHI/secret in ack/audit/log/KV.

## Verification (as run)
- Connect suite **391/0** (incl. all SMART, HL7, CSV, ABDM); top-level **208/0**. Zero regression.
- Adversarial: the FHIR mock verifies client assertions like a real AS (rejects `alg:none`/wrong-aud/expired/jti-replay); the HL7/CSV parsers are fuzz-bounded; the ingest spine's 401/403/replay/no-PHI paths are all tested. A red-team of the SMART token path returned SAFE secret-handling and the two exfil-boundary HIGHs it found are fixed.
- Bench: FHIR normalize 8 us; signer 0.9 ms (once/token, cached); HL7/CSV parse+normalize ~0.3 ms. All far under the 50 ms budget.

## Owner go-live gates / `// VERIFY` (required before any real hospital feed)
**Track A (FHIR):**
1. `SMART_HOST_ALLOWLIST` — the real hospital FHIR base host(s) **and** their authorization-server host(s), which are often distinct (Keycloak/Okta/Auth0 vs the FHIR gateway). Until pinned, only the SMART sandbox is allow-listed and everything else fails closed.
2. Per-tenant client registration: the tenant's **public** key (JWKS/`jwks_url`) registered with the hospital AS and a `client_id` issued; the matching **private** JWK envelope-sealed into `secret_ref`.
3. Signing alg per server (RS384/ES384 vs RS256/ES256) and SMART scope syntax (`.rs` vs `.read`).
4. `mode:live` stays refused (sandbox-only) until the consent/DPA + MaiK-egress gate of a later phase.

**Track B (HL7/CSV):**
1. Inbound auth scheme (this build assumes an HMAC-signed HTTPS POST from the hospital's integration engine) — confirm vs mTLS/IP-allow-list; it is the single swap seam in `ingest.js`.
2. Transport: HTTPS POST vs an MLLP->HTTPS bridge (MLLP is not reachable from the edge).
3. Provision each `connect_feed`: opaque `feed_id`, envelope-sealed HMAC `secret_ref`, allowed `msg_types`, SCCM `granted_scopes`, and (CSV) the `columnMap`.
4. Apply `db/connect_hl7_schema.sql` to the Connect D1.

**Both:** provision `CONNECT_DB`, `MAIK_KV`, `CONNECT_MASTER_KEY`, `CONNECT_HMAC_SALT`; keep flags OFF until the above hold. AL1/DG1 ADT maps and local->LOINC crosswalk are owner-gated / deferred.
