# Licensing analysis

This section matters more than it usually would because architecture option B/C ("fork Bahmni" or
"run Bahmni/OpenMRS as a backend service behind our frontend") only survive contact with reality if
the licenses allow WardSynQ to stay closed-source and commercial.

## OpenMRS core
License: **Mozilla Public License 2.0 (MPL-2.0)**, some pieces Apache-2.0. MPL-2.0 is file-level
copyleft: you can combine MPL code with proprietary code in a larger work, and you only need to share
source for the MPL-licensed files themselves if you modify them — not for the rest of your product.
**This is commercially safe** for the specific pattern of "call OpenMRS's REST/FHIR API as an
external service" (you're not distributing modified OpenMRS code, you're calling it over the network)
and reasonably safe even for "fork and modify OpenMRS core files," provided the modified files'
source stays available. Verify per-module before committing — OpenMRS is umbrella-organized and a
few modules may carry different terms.

## Bahmni
This is the one to be careful with. Historically, core Bahmni repositories (including pieces of
`bahmnicore` and the clinical frontend) have shipped under **AGPL v3**. AGPL's defining, unusual term
is **network-use copyleft**: unlike GPL, merely running a modified AGPL program as a network service
(SaaS) — without ever "distributing" it in the traditional sense — still triggers the obligation to
offer your modified source to every user who interacts with it over the network.

Practical consequence for each architecture option:
- **Option B (fork Bahmni, replace the frontend)**: if any AGPL-licensed Bahmni backend code ships
  in the running service, WardSynQ would be obligated to publish the source of that service,
  including WardSynQ's own modifications to it, to every hospital/user who accesses it. This is very
  likely incompatible with a closed-source commercial product strategy unless a commercial/dual
  license was separately negotiated with the copyright holders (some OpenMRS-ecosystem projects do
  offer this).
- **Option C (run bahmnicore as a backend microservice)**: still AGPL-triggering if bahmnicore itself
  is the thing running and serving your users over the network, REGARDLESS of whether WardSynQ's own
  frontend is proprietary and calls it as "just an API." AGPL's copyleft attaches to the AGPL program
  itself being network-accessible to users, not to whether you also built a separate closed frontend.
  This is a common misunderstanding worth being explicit about: "we only use it as a backend, our
  frontend is ours" does **not** avoid the AGPL obligation.
- **A genuinely safe pattern**: use Bahmni/OpenMRS software only for **internal engineering
  reference** (reading the source to understand a workflow, a message format, or a data model, then
  writing WardSynQ's own independent implementation) — this creates no distribution/network-use
  event at all. This is exactly the "reuse the idea, not the code" recommendation made throughout
  `REUSE_VS_REBUILD.md`.

**Action item before any final architecture decision**: have this confirmed by counsel against the
CURRENT, exact license file in whichever specific Bahmni repos would be touched — license terms can
vary by repo and have changed over Bahmni's history, and this analysis should be treated as a strong
default assumption (AGPL is well-documented as Bahmni's historical primary license) rather than a
verified-today legal fact for every single repository. The pending research-agent pass (see
`OPENMRS_BAHMNI_AUDIT.md`) is checking each cloned repo's actual `LICENSE` file, not just OpenMRS's
general reputation for the platform license.

## Bottom line
- Option A (build everything native) and Option D (extract ideas/specs, reimplement natively): no
  licensing exposure at all.
- OpenMRS-as-a-called-service for terminology specifically (option D, narrowly): **low risk**, MPL is
  built for exactly this pattern.
- Any option that runs Bahmni-derived AGPL code as a live, user-facing network service inside a
  closed-source commercial product: **high legal risk**, likely a non-starter without a separately
  negotiated commercial license.
