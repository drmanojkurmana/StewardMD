# StewardMD — App-store data-safety / privacy-label answers

Ready-to-paste answers for **Google Play Data Safety** and **Apple App Privacy (Nutrition Labels)**, derived from the app's verified data-flow map. Review with your lawyer before submitting; update if the data flows change.

> Baseline facts: no advertising, **no analytics/tracking SDKs**, no data selling. Most preferences never leave the device. Cloud data lives in Google Firestore (India, asia-south1). AI features are **off by default**. In-app account + data deletion exists.

---

## A. Google Play — Data safety form

**Does your app collect or share any of the required user data types?** → **Yes.**
**Is all data encrypted in transit?** → **Yes** (HTTPS/TLS).
**Do you provide a way for users to request data deletion?** → **Yes** — in-app (Account → *Delete account & data*) and by email (privacy@stewardmd.in).

| Data type | Collected | Shared | Purpose | Optional? | Linked to identity |
|---|---|---|---|---|---|
| **Name** | Yes | No* | Account management, app functionality | Only if you sign in | Yes |
| **Email address** | Yes | No* | Account management | Only if you sign in | Yes |
| **Photos** (profile photo from Google; captured clinical images for AI) | Yes | **Yes** (images → Google Vertex AI to extract text) | App functionality | Yes (AI is optional) | Profile photo: yes · AI images: not stored |
| **Health info** (clinical case findings; AI clinical queries; Ward Sync labs/radiology/patient lists) | Yes | **Yes** (AI queries → Google Vertex AI; Ward Sync relays your institution's data) | App functionality | Yes | Saved cases: yes |
| **App activity** (preferences, recent-case history) | **No** — stored only on device, never transmitted | — | — | — | — |
| **Device/other IDs** (push subscription id) | Yes | No | Send medical-update notifications | Yes | No |

\* "No" = not shared for the third party's own purposes. Google (Firebase/Firestore/Vertex AI) and Cloudflare act as **service providers/processors** under contract, which Play does not count as "sharing." Vertex AI does not train on the data.

**Notes to include in the form's context where allowed:**
- AI features are optional and off by default; content sent for AI is **not stored** by StewardMD.
- Ward Sync is an institution-gated feature; the institution (GIMSR/GITAM) is the controller of that patient data and StewardMD does not store it.
- **We do not store your institution password.**

---

## B. Apple — App Privacy (Nutrition Labels)

**Data used to track you** → **None.** (No cross-app/website tracking, no ad identifiers.)

**Data linked to you** (collected and tied to identity):
| Category | Specific type | Purpose |
|---|---|---|
| Contact Info | Name, Email Address | App Functionality |
| Health & Fitness | Health (clinical case findings; clinical queries) | App Functionality |
| User Content | Photos or Videos (captured clinical images); Other User Content (case notes) | App Functionality |
| Identifiers | User ID (account id); Device ID (push subscription) | App Functionality |
| Sensitive Info | Health/clinical information | App Functionality |

**Data not linked to you** → none material (no analytics/diagnostics SDK).

**Per-type flags:**
- Used for **Tracking**: **No** for every type.
- Used for **Third-Party Advertising**: **No** for every type.
- Purpose for all: **App Functionality** (a few could also be "Product Personalization" for saved-case sync — App Functionality is accurate and simplest).

**Notes / answers for review:**
- AI (optional): captured images + clinical queries are sent to Google Vertex AI for processing and are **not retained** by StewardMD. Declare Photos/Health as *collected* (leaves the device) to be safe, even though not stored.
- Ward Sync: institution-controlled data; disclose under Health/Sensitive as accessed via the app.
- Account deletion: implemented in-app (required by Apple 5.1.1(v)) — link the support/privacy URL in App Store Connect.

---

## C. Both stores — supporting URLs & toggles
- **Privacy Policy URL:** https://stewardmd.in/privacy
- **Terms of Use URL:** https://stewardmd.in/terms
- **Account deletion:** in-app (Account → Delete account & data) + privacy@stewardmd.in
- **Age rating:** adult / professional use; intended for qualified healthcare professionals (state in the listing).
- **Category:** Medical.

## D. Open items that change these answers
- If **on-device OCR** replaces cloud AI vision later → remove image sharing to Google (Photos no longer "shared").
- If **Ward Sync** is gated out of the consumer build → drop the Ward Sync health-data disclosures.
- If any **analytics/crash SDK** is added later → add a Diagnostics/Analytics disclosure.
