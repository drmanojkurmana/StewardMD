# AI Vision — on-device-first (D → B) with graceful D fallback

Redesign of the AI Vision feature for privacy + resilience. Implement in the native
Capacitor app (on-device OCR is native-only). Hand this to Claude Code CLI on the Mac.

## Principle
**On-device OCR is the foundation and ALWAYS runs. The cloud is only an enhancement
layered on top.** If AI is off, offline, or out of quota/tokens, the feature silently
falls back to on-device-only and still works. The photo is **never uploaded** in any mode.

## Flow
```
1. Capture photo (native camera)                     // @capacitor/camera
2. On-device OCR → text                              // ML Kit / Vision — image NEVER leaves device
3. Redact obvious identifiers from text on-device    // regex: name/MRN/UHID/DOB/phone/email
4. Decide:
   if (AI enabled && online) {
       try {
           structured = POST /api/ai/vision  { text }   // B: Gemini under BAA + no-retention
           autofill(structured);  flag "verify every value"
       } catch (quota | 429 | network | ai-off | any error) {
           tapToFill(text)                               // D fallback
       }
   } else {
       tapToFill(text)                                   // D fallback (fully on-device)
   }
```
- **tapToFill(text):** show the recognized lines; clinician taps a value → drops into the
  target field. No network. This is the guaranteed-working baseline.
- **autofill(structured):** AI mapped text → fields; clinician verifies. Better detection.

## "Tokens up" / failure handling (must be graceful)
- Backend `/api/ai/vision` returns a clear signal when Vertex quota/budget is exhausted
  (HTTP **429** or `{ error: "quota" }`). Also `{ error: "ai-off" }` when the flag is off.
- Client treats **ANY** cloud failure — quota, 429, timeout, offline, ai-off — identically:
  fall through to `tapToFill(text)`. Never show a dead end; never block the feature on the cloud.
- Show a tiny mode hint: "✨ AI structured — verify every value" vs "Tap a value to fill."

## Backend change
- `/api/ai/vision` now accepts **text**, not an image (smaller, cheaper, no image PHI).
- Enforce **no-retention** and put Vertex under the **Google Cloud BAA / HIPAA-eligible**
  config (free to sign; you already pay per call). See privacy wording below.
- Keep the `smd_ai` flag gate. On quota/budget cap, return 429 so the client falls back.

## On-device pieces (native)
- **OCR plugin:** ML Kit Text Recognition (on-device, free, iOS + Android) via a Capacitor
  plugin (e.g. `@capacitor-mlkit/text-recognition` or equivalent). iOS can alternatively use
  the Vision framework. Must be **on-device** (no cloud OCR).
- **Redaction:** small local function stripping lines/tokens matching identifier patterns
  (`Name[:]`, `MRN`, `UHID`, `DOB`, dates, 10-digit phone, email) before any send.
- **Camera:** `@capacitor/camera`.

## Decisions (defaults — change if you want)
- **Crop step:** *fast-follow*, not v1. (Native lets the clinician crop to just the values so
  identifiers aren't even OCR'd — strong add-on, but ship the OCR+fallback core first.)
- **"Explain this" text AI** (`/api/ai/explain`): **unchanged** — it's text, not images; separate concern.
- **Web PWA:** on-device OCR doesn't exist in the browser → **hide/disable AI Vision on web**;
  it's a native-app feature. (App is native-only, so fine.)

## Privacy policy wording (replace the current AI-Vision paragraph)
> AI Vision reads text on your device; the photo is never uploaded. Recognized text is
> scrubbed of obvious identifiers on your device. If online AI is enabled, only that scrubbed
> text (never the image) is processed to structure the values under a signed data-processing
> agreement, and is never stored or used to train models. If AI is unavailable, text
> recognition and entry happen entirely on your device.

## Test checklist (on device)
- AI ON + online → capture a lab/monitor photo → values auto-fill → "verify" shown; confirm
  no image left the device (only text in the request).
- AI ON but simulate quota (429) → falls back to tap-to-fill, no error dead end.
- AI OFF / airplane mode → OCR + tap-to-fill works fully offline.
- Redaction: a label with a name/MRN → those tokens are stripped from what's sent.
- Web build → AI Vision hidden.

---
*Net result: image never leaves the device; cloud is optional and only ever sees scrubbed
text under a BAA; the feature degrades gracefully to fully-on-device when tokens/network/AI
are unavailable.*
