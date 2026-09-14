# WardSynQ patient portal translations - brief for Antigravity

Owner decision D6: the WardSynQ patient portal ships in English, Spanish, Telugu, Hindi, Bengali,
Kannada, Tamil, Malayalam and Marathi (Marathi added by the owner 2026-09-14). English
(`wardsynq/site/i18n.js`) is ours and is the source of truth, 157 keys as of this brief. You write the
other eight catalogs. This file is the whole contract - read
it before your first commit.

## What you touch, and nothing else

You own exactly these eight files, one language each:

```
wardsynq/site/i18n/es.js   Spanish   (Español)
wardsynq/site/i18n/te.js   Telugu    (తెలుగు)
wardsynq/site/i18n/hi.js   Hindi     (हिन्दी)   - already has a first pass, reviewed:false
wardsynq/site/i18n/bn.js   Bengali   (বাংলা)
wardsynq/site/i18n/kn.js   Kannada   (ಕನ್ನಡ)
wardsynq/site/i18n/ta.js   Tamil     (தமிழ்)
wardsynq/site/i18n/ml.js   Malayalam (മലയാളം)
wardsynq/site/i18n/mr.js   Marathi   (मराठी)
```

Never edit `wardsynq/site/i18n.js` (the engine and the English catalog), `wardsynq/site/portal.js`,
`wardsynq/site/portal.html`, or any other file in this repository. This is what makes eight people
translating at once conflict-proof: every file you touch is only ever touched by you, and the engine
that reads them never changes underneath you.

## Workflow

1. Branch `i18n/<code>` (e.g. `i18n/es`) from `origin/wardsynq-product`. Never `main`.
2. One language per commit, one commit per file you change. Never force-push.
3. Before you open a PR: `node --test test/wardsynq-i18n.test.mjs` must pass for your language. It
   checks structure (your file does nothing but register a catalog), that every key you use exists in
   English, that every `{placeholder}` you keep matches English exactly, and that nothing you wrote
   looks like clinical content, an em dash, or an emoji.
4. Leave `{ reviewed: false }` exactly as it is in the `register(...)` call. Only a native-speaking
   clinical reviewer flips that flag, in a separate, later change - not you, not in this pass.

## The shape of a language file

```js
(function (root) {
  "use strict";
  var catalog = {
    "signin.title": "...",
    "meds.title": "...",
    // ...
  };
  if (root && root.WSQI18n) root.WSQI18n.register("es", "Español", catalog, { reviewed: false });
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
})(typeof window !== "undefined" ? window : null);
```

Add or edit entries inside `catalog` only. Do not touch anything outside it - the `register(...)` line,
the IIFE wrapper, the `module.exports` line. A key you leave out simply falls back to English on the
live page, so a partial file is always safe to ship; you do not have to translate everything in one
sitting.

## What to translate, and how

- **Keys and `{placeholders}` are code, not text.** Never rename, remove, or reorder a key. Never
  translate the word inside `{ }` (e.g. `{name}`, `{amount}`, `{relationship}`) - copy the token
  verbatim into your translation, wherever the sentence puts it. `"portal.title.proxy": "Record of
  {name}"` might become, in your language, a sentence where `{name}` sits at the start instead of the
  end - that is fine, the token itself must not change.
- **Translate labels, headings, empty/loading/failed states, buttons, and instructions** - the words
  this product wrote, e.g. `"meds.title": "Prescriptions and medicines"`,
  `"allergy.empty": "No allergies are recorded."`, `"signin.submit": "Sign in"`.
- **Never translate, invent, or alter clinical content.** There is none in these files - no drug name,
  dose, route, frequency, diagnosis, test name, unit, or result lives in a catalog, only in the
  patient's actual record, which this page shows exactly as the clinician recorded it. If a key ever
  looks like it wants a dose or a drug name, stop and ask - that would be a bug in `i18n.js`, not
  something to translate around.
- **Patient-friendly and clinically accurate.** These are read by a patient or family member, often
  worried, sometimes right after bad news. Plain, calm, accurate wording over a literal or clever one.
  `"phase.ended": "Your session has ended."` should read as a calm, ordinary sentence in your language,
  not a technical one.
- **No em dash (—) and no emoji**, in any language - match the rest of this product's voice.
- Keep the same register across a whole file (all formal, or all informal) consistent with how the
  rest of your language's medical/government forms address a patient.

## Running the check yourself

```
node --test test/wardsynq-i18n.test.mjs
```

It prints, per language, how many of the 157 English keys still fall back to English - that is your
progress counter, not a failure. The test only fails on: a key you added that English does not have, a
missing or reshaped `{placeholder}`, an empty value, an em dash, an emoji, clinical-shaped text (a
number next to `mg`/`ml`/`mcg`/etc.), a file that does anything beyond the one `register(...)` call
described above, a number that differs from English (write digits as `0-9`, never native numerals), or a
dropped negation in a string where "no"/"not" is the point ("No allergies are recorded", "This does not
mean you are not in the queue"). If you translate one of those keys for a language the test has no
negation markers for, it fails and asks for them.

## What happened to the first pass (review, 2026-09-14)

Antigravity's first pass did not use this brief: it worked on local branch `feat/wardsynq-multilingual-emr`
(363117f5, 2af5eba4, 8da8b5c1, 844a8b4e), rewrote `i18n.js`, and added engines no screen uses. What was
kept went into the per-language files (commit on `d6-antigravity-integrate`); everything else was left out.

Kept: Telugu (152 portal keys), and for Tamil, Kannada, Malayalam, Bengali and Marathi the language label,
sign-out and staff nav labels. Hindi matched ours. All `reviewed:false`. Dropped strings: Tamil
`nav.criticals` ("முக்கிய முடிவுகள்" reads as "important decisions", losing "critical result") and Bengali
`nav.accounts` ("হিসাব" is a financial ledger, not a sign-in account).

Not taken, and not to be re-submitted in this form:
- **Engine rewrite of `i18n.js`**: marked Telugu and Hindi `reviewed:true` with no native clinical review;
  made `t()` read a global active language from localStorage (so the same call returns different text
  depending on another screen's state); added English keys (`common.*`, `ward.*`, `er.*`, ...) including
  `common.aiTranslatedNotice` "AI-translated from English", which WardSynQ never does.
- **Staff shell language switcher** (`shell.js`): translated the rail and a handful of tiles only, so a
  clinician would see a half-translated clinical workstation. D6 is the patient portal; staff UI
  translation needs an owner decision first.
- **`detectLanguage` by address**: no screen called it, and it is wrong in ways that matter: "London, UK"
  resolves to Hindi (`UK` read as Uttarakhand), "Hyderabad, Sindh" to Telugu. The portal asks the patient.
- **`wardsynq-terminology.js`**: translates diagnoses and test names, which WardSynQ shows exactly as
  recorded. Several patient-friendly glosses change meaning (sepsis as "blood poisoning", chronic kidney
  disease as "long-term kidney failure", stroke glossed as "paralysis"); a Malayalam term has Kannada
  letters mixed in; several ICD-10 codes are the US ICD-10-CM subcodes (R51.9, R06.02, R41.82, J45.909,
  I26.99, K35.80, R07.9, R10.9) where Indian hospitals use WHO ICD-10. Its `validateSafety` passes a
  negation moved to another clause, an mg/mcg swap, an added number and OD rewritten as QID.
- **`wardsynq-rx-print.js`**: the "canonical English" line is not the order. Any frequency outside six
  tokens (weekly, Q12H, 1-0-1) is removed from both the canonical line and the dose column while the page
  says "original text preserved" (methotrexate 7.5 mg once weekly prints with no frequency); PRN is
  printed as SOS, TDS as TID; a meal instruction it does not know is dropped; `.125 mg` prints without its
  leading zero; "03/04/2026" prints as 03-Mar-2026 and an early-morning IST time as the previous day; the
  Tamil prescription title reads "Not discharge - prescription"; STAT loses "once" in six languages.
- **`wardsynq-translation-guard.js`**: exists to machine translate clinical documents ("maik-ai"), labels
  unreviewed dictionary output "verified", and carries emoji and em dashes.
- **`Multilingual-Translation-Rulebook.md`**: a general StewardMD standard, not a description of WardSynQ.
  Its rules on unambiguous dates, exact numbers and decimals, negation, never translating codes, names or
  identifiers, never showing raw keys, English fallback and native medical review agree with this brief.
  Its rules permitting AI translation of clinical text with a label (11, 12, 42, 55 level 3, 79), localized
  diagnosis and terminology display (2B, 22 to 25, 47) and external translation services (69) contradict
  WardSynQ's rule that clinical text is never machine translated, so it was not imported. The file is in
  commit 363117f5 at `vault/standards/Multilingual-Translation-Rulebook.md`.

## Status (2026-09-15)

All nine portal languages are complete: every English key is translated (test/wardsynq-i18n.test.mjs fails if any
offered language is missing a key). Keys not already present were machine-translated with Gemini via Vertex AI
(project stewardmd-498ec), validated for placeholders, digits, em dash, emoji and negation, and the safety-relevant
keys back-translated to English; meaning held. Every language stays reviewed:false until a human reviewer checks it.
