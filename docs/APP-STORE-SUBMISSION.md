# StewardMD — App Store submission readiness

App: **StewardMD** · bundle `in.stewardmd.app` · v**2.1** (bump build before each upload) · clinician-only medical decision-support.

Tooling: `asc` (App Store Connect CLI, installed via Homebrew). Auth uses your App Store Connect API key.

---

## 0. One-time: authenticate `asc` (you run this — it holds your secret)

Generate an API key at https://appstoreconnect.apple.com/access/integrations/api (role: App Manager or Admin), download the `AuthKey_XXXX.p8`, note the **Key ID** and **Issuer ID**. Then:

```bash
asc auth login --name "StewardMD" --key-id "<KEY_ID>" --issuer-id "<ISSUER_ID>" --private-key /path/to/AuthKey_XXXX.p8
asc auth status --validate
asc auth doctor
```

Run these yourself (in this session prefix with `!`, e.g. `! asc auth status --validate`) so the `.p8` and keychain stay yours. Once authed, I can drive the metadata/build/submit steps.

---

## 1. THE thing that gets gated apps rejected: reviewer access

StewardMD has a **professional-use disclaimer gate + a clinician login**. Apple reviewers will hit a wall and reject under **Guideline 2.1** unless you give them a way in. In App Store Connect → the version → **App Review Information**:

- **Sign-in required: YES.** Provide a **demo account** (a real working login the reviewer can use) — username + password.
- **Notes to reviewer** (paste, fill the demo creds):

> StewardMD is a clinical decision-support tool for licensed physicians only. On first launch, accept the professional-use disclaimer, then sign in with the demo account below.
>
> Demo login: <email> / <password>
>
> The app is decision-support only: it does not diagnose, prescribe, or transmit patient data to third parties. Oncology treatment protocols are shown for reference and are clearly labelled EXPERIMENTAL DRAFT; they cannot be activated as orders (server-gated). Voice/scribe and camera features are optional and clearly prompted. No real patient data is required to review the app; the demo account is pre-populated with synthetic data.

- Contact info: a real name, phone, email Apple can reach.

## 2. Metadata (App Store Connect — I can push these via `asc` once authed)

Draft, em-dash-free (matches the app copy rule). Review/edit before publishing:

- **Name:** StewardMD
- **Subtitle (30 char):** Clinical decision support
- **Promotional text (170):** Point-of-care decision support for physicians: dosing, guidelines, calculators, and clinical reasoning in one fast, offline-capable app.
- **Keywords (100):** clinical,physician,dosing,guidelines,calculator,drug interaction,oncology,ICU,antibiotics,reference
- **Description:** (write full copy; lead with "for licensed clinicians", list the modules, end with the not-a-substitute-for-clinical-judgement disclaimer)
- **Support URL:** https://stewardmd.in/support
- **Privacy Policy URL:** https://stewardmd.in/privacy (must be live)
- **Category:** Medical (primary)
- **Age rating:** complete the questionnaire; "Medical/Treatment Information" -> Infrequent/Mild is typical -> 17+.

## 3. App Privacy (nutrition labels) — must match PrivacyInfo.xcprivacy

`ios/App/App/PrivacyInfo.xcprivacy` exists. In App Store Connect → App Privacy, declare only what the app actually collects (do NOT over-declare). Cross-check against PrivacyInfo + the data-flow. If nothing leaves the device except your own API, keep it minimal and accurate.

## 4. Build + upload (needs your Apple signing)

```bash
# from a clean main checkout with the iOS project + your signing set up
npm run build:www && npx cap sync ios
# bump the build number (each upload must be unique)
#   Xcode: target App > General > Build 7 -> 8   (or: agvtool next-version)
# archive + upload:
#   Xcode: Product > Archive > Distribute App > TestFlight & App Store > Upload
# then confirm processing:
asc builds list --app in.stewardmd.app
```

## 5. Submit for review (once build processed + metadata + reviewer info set)

```bash
asc apps list
asc builds list --app in.stewardmd.app          # get the processed build
# attach the build to the version, then submit:
asc submissions create --app in.stewardmd.app --version 2.1   # confirm exact flags with `asc submissions --help`
```

(Optional: `asc install-skills` adds 23 agent skills for build/TestFlight/metadata/submission workflows.)

## 6. Pre-submit checklist

- [ ] R7 release gate GO (blocking) — see the R7 report; fix any conditions
- [ ] R1 (clinical) + R3 (privacy) clear
- [ ] Demo account works past disclaimer + login; reviewer notes filled
- [ ] Build (>build 7) uploaded + finished processing
- [ ] Screenshots for 6.7" + 6.5" iPhone (+ iPad if enabled), 1024 icon
- [ ] Privacy Policy + Support URLs live
- [ ] App Privacy labels match PrivacyInfo.xcprivacy
- [ ] Age rating + export compliance (already declared in Info.plist) confirmed
- [ ] TestFlight: add the oncologists as internal/external testers first, validate, THEN submit to App Review
