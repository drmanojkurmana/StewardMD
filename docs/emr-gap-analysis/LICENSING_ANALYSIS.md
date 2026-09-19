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

**Verified directly against the LICENSE file in each cloned repo** (not GitHub's license-detection
API, which reports some of these repos incorrectly as unlicensed):

| Repo | Confirmed license |
|---|---|
| `bahmni-core` (the backend module, formerly bahmnicore) | **AGPL-3.0** |
| `openmrs-module-bedmanagement` | **AGPL-3.0** |
| `bahmnicommons` | **AGPL-3.0** |
| `openmrs-module-bahmni.ie.apps` (forms 2.0 backend) | **AGPL-3.0** |
| `openmrs-module-bahmnievents`, `insurance-integration`, `bahmni-reports`, `openmrs-distro-bahmni`, `form-controls`, `appointments-frontend`, `bahmni-carbon-ui`, `crater`, `bahmni-infra` | **AGPL-3.0** |
| `bahmniapps` (classic AngularJS frontend) | MPL-2.0 |
| `bahmni-apps-frontend` (new React 19 rewrite) | MPL-2.0 |
| `openmrs-module-ipd`, `medicationadministration`, `appointments`, `pacs-integration` | MPL-2.0 |
| `bahmni-odoo-modules` | MPL-2.0 at root, but individual addons declare LGPL-3 in their own manifest — mixed, check per addon |
| `default-config` (the clinical config/pattern layer) | **MIT** — freely reusable |

**The finding that matters: this inverts the technical instinct exactly backwards.** The Bahmni code
most worth reusing headlessly — `bahmni-core` and `bedmanagement`, the actual backend domain logic —
is AGPL. The mostly-frontend pieces are the more permissive MPL. And the one piece that's completely
free to use (MIT) is `default-config` — not code at all, but the pattern/idea layer, which is exactly
what `REUSE_VS_REBUILD.md` already recommends taking.

AGPL's defining, unusual term is **network-use copyleft**: unlike GPL, merely running a modified AGPL
program as a network service (SaaS) — without ever "distributing" it in the traditional sense — still
triggers the obligation to offer your modified source to every user who interacts with it over the
network.

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

**Confirmed** (not assumed) by directly reading the LICENSE file in each cloned repo — see the table
above and `OPENMRS_BAHMNI_AUDIT.md`. One genuine open question the source audit correctly flagged
rather than guessing at: whether AGPL's copyleft reaches a REST/HTTP client calling `bahmni-core`
as an external service, versus an `.omod` running inside the same JVM and calling its Java services
directly — the latter is a far stronger "derivative work" argument than the former. **This is a
lawyer question, to be answered before design, not after** — the practical recommendation in this
document (call nothing AGPL-licensed as a live network service; treat bahmnicore/bedmanagement as
read-only engineering reference only) is the conservative default that avoids needing the answer at
all, not a claim that the answer is definitely "yes, a REST client is safe."

## Bottom line
- Option A (build everything native) and Option D (extract ideas/specs, reimplement natively): no
  licensing exposure at all.
- OpenMRS-as-a-called-service for terminology specifically (option D, narrowly): **low risk**, MPL is
  built for exactly this pattern.
- Any option that runs Bahmni-derived AGPL code as a live, user-facing network service inside a
  closed-source commercial product: **high legal risk**, likely a non-starter without a separately
  negotiated commercial license.
