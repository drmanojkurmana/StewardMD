# Review Matrix — Domain × Reviewer + Path Routing
_Which of the 7 reviewers owns each concern, and which files trigger which reviewers. Reviewers: R1 Clinical Safety & Evidence · R2 AI Safety · R3 Security & Privacy · R4 Platform & Reliability · R5 Clinical UX & Accessibility · R6 Performance · R7 Release._

## Domain → Reviewer (primary owner ●, contributor ○)
| Domain | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Drug doses / interactions / contraindications | ● | | ○ | | | | |
| Clinical calculators / scores | ● | | | | ○ | | |
| Emergency logic (Code Blue) | ● | | | ○ | ○ | | |
| Lab interpretation / ECG logic | ● | ○ | | | | | |
| False negatives / positives | ● | ○ | | | | | |
| Clinical evidence / guideline freshness | ● | | | | | | ○ |
| Prompt injection / hallucination / guardrails | | ● | ○ | | | | |
| Model selection / AI PHI / context leakage | | ● | ○ | | | | |
| Secrets / auth / networking / encryption / pinning | | ○ | ● | | | | ○ |
| PHI / DPDP / logging / data lifecycle / cleanup | ○ | ○ | ● | | | | ○ |
| SwiftUI / UIKit / Watch / Widgets / Live Activities | | | | ● | ○ | ○ | |
| Concurrency / crashes / offline / retry / DB integrity | | | | ● | | ○ | |
| Accessibility (VoiceOver/Dynamic Type/contrast) | | | | ○ | ● | | |
| Clinical UX (cognitive load, emergency, night-shift) | ○ | | | | ● | | |
| Memory / battery / startup / latency / bundle-25MiB | | ○ | | ○ | | ● | ○ |
| Testing (unit/integration/UI/golden/snapshot/perf) | ○ | | | ○ | | | ● |
| Architecture / maintainability / tech debt (periodic) | | | | ● | | | |
| App Store / privacy manifest / HealthKit / rollback | | | ○ | | | | ● |

## Path → Reviewers (auto-routing)
| Changed path (glob) | Reviewers triggered |
|---|---|
| `www/**/{engine,drug,dose,interaction,calc,score,icu,alert,codeblue,lab,ecg}*` | **R1 (mandatory)**, R2 if AI-assisted, R3 if PHI |
| `backend/**`, `www/**{maik,kardiox,fundx,vertex,whisper,ocr}*`, model/serving code | **R2 (mandatory)**, R3 (PHI/secrets), R1 if clinical framing |
| auth/token/gate/storage/network/`functions/**`/Firestore rules/`*.entitlements`/configs | **R3 (mandatory)**, R7 if release-config |
| `ios/**`, `local-plugins/**`, `**/*.swift`, widgets/Live Activities, `www/native-*.js` | **R4**, R5 if UI, R3 if secrets/entitlements |
| `www/**` UI, `*.css`, SwiftUI views, emergency/alert screens | **R5**, R4 if native, R6 if hot-path |
| hot paths, large assets, `www/` bundle, serving, DB queries | **R6**, R3 if the asset carries PHI |
| release candidate / flag flip / deploy config / `PrivacyInfo.xcprivacy` | **R7 (gate)** + requires R1 & R3 clear |
| `docs/**` | Advisory only (R1 for clinical citations, R7 for currency) — no standalone docs reviewer |

**Rule:** never run all 7. Route by the table; R1 and R3 are the two that escalate to *mandatory/blocking* on their surfaces; R7 gates the ship.
