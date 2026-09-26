# MaiK "India's First Offline & Free Medical AI": evidence file

Backs the marketing claim **"India's First Offline & Free Medical AI"** used on the StewardMD
Instagram posts and stories (September 2026). Under the ASCI Code, any claim of objectively
checkable fact must be backed by evidence if ASCI asks, usually after a competitor complaint.
Keep this file current. It is git-tracked and 404s from the public web, like the rest of `vault/`.

## 1. The exact claim

> India's First Offline & Free Medical AI
> \*Offline models only. Supported on AI flagship phones only. T&C apply.

Scope, as worded: **first in India**, not the world. It covers a medical AI that answers
clinicians' questions **fully on the phone, with no internet**, at **no charge**, on the
offline (on-device) models. The cloud engine (MaiK Cloud / Pro) is not part of the claim.

## 2. What MaiK does offline (verifiable in this repo)

| Fact | Where to verify |
|---|---|
| On-device inference via llama.cpp (`local-plugins/capacitor-llama`), no network call | `maik-local.js`, `local-plugins/capacitor-llama/` |
| Downloadable on-device model packs, default `maik-lite` (our own fine-tune) | `maik-models.js`, `docs/MAIK_OFFLINE_RUNBOOK.md` |
| Answers grounded in an on-device knowledge base (BM25 retrieval over a bundled 38 MB store) | `kb/ai/maik-lite-rag.js`, `kb/ai/maik-lite-kb-store.js` |
| Claim-level grounding: unsupported claims are removed or qualified | `kb/ai/maik-grounding.js` |
| Dose questions answered from the drug database, never by the model | `kb/ai/drug-dose.js`, `maik-engine.js` `route()` |
| Offline fallback: when the phone is offline and a local pack is ready, the on-device model answers | `maik-engine.js` `effective()`, flag `smd_maik_offline_local` |

## 3. Dates (priority)

| Event | Date | Record |
|---|---|---|
| On-device answer engine first committed ("capacitor-llama plugin + resumable model download") | **2026-08-19** (22:32 UTC) | commit `bf703332fc` on `drmanojkurmana/StewardMD` |
| Settings model picker + download progress | 2026-08-20 | commit `64b0b295f4` |
| Offline stand-in for the cloud engine when the phone is offline | 2026-09-03 | per `vault/modules/MaiK.md` |
| Model packs expanded to nine; every text pack reads the on-device book | 2026-09-18 | per `vault/modules/MaiK.md` |
| Early access live on Apple App Store | **TODO (owner)** | App Store Connect: first release date containing on-device MaiK |
| Early access live on Google Play | **TODO (owner)** | Play Console: first release date containing on-device MaiK |

The public store release dates are the strongest evidence. Add them, with screenshots of the
App Store Connect and Play Console release history, as soon as possible.

## 4. Screenshot proof

`maik-offline-airplane-mode-2026-09-22.png` (in this folder): an iPhone in **airplane mode**
(status bar airplane icon, 3:05) with MaiK answering a clinical question using the **MAiK Lite**
pack. The footer reads "On-device · StewardMD knowledge base, verify independently".
Supplied by the owner on 2026-09-22.

## 5. Indian market search (2026-09-22)

Web searches for an Indian offline / on-device medical AI for clinicians, run 2026-09-22.
Nothing found matches the claim (Indian + fully offline on-device AI answers + free).

| Product | Indian? | Why it does not match |
|---|---|---|
| HealthPlix (AI-assisted EMR, "offline access") | Yes | Offline access to EMR records, not an AI answering clinical questions on the device |
| Doctors AI: Medical Assistant (Play Store) | Listing is India-region | Nothing in the listing says it runs on the device |
| Tracxn list of Indian native AI-in-healthcare startups (Aug 2026) | Yes | No on-device clinical Q&A product identified |
| Trij, AI CareCompanion (Gemma on-device health apps) | No (hackathon / developer projects) | Not Indian products |
| Speedr AI (offline "AI Doctor") | No | Not an Indian product; general consumer app |

Sources:
- https://www.mobihealthnews.com/news/asia/indian-startup-healthplix-releases-mobile-emr-app
- https://play.google.com/store/apps/details?id=com.kingrittik.doctors&hl=en_IN
- https://tracxn.com/d/explore/native-ai-in-healthcare-startups-in-india/__KIHHuaBJBYBU6ve5YGXs1pco5pOrgob_2DWmjE7RKsw
- https://dev.to/mosss_os/uilding-an-offline-first-ai-medical-triage-app-that-runs-100-on-device-3mi6
- https://dev.to/narender/ai-carecompanion-offline-health-assistant-2fjo
- https://www.speedr.co/

A few web searches are not an exhaustive market survey. Repeat the check (Play Store and
App Store India, Tracxn, Inc42, YourStory) before each new campaign and add a dated row here.

## 6. Keep the claim true

- "Free" and "Unlimited AI use. Forever." apply to the **offline models only**. If on-device
  use is ever metered or charged, pull the claim from all creatives.
- Keep "Supported on AI flagship phones only" and "T&C apply" on every creative.
- If a competitor shows an earlier Indian offline medical AI, switch the creatives to
  "India's Own Offline Medical AI" and note it here.
