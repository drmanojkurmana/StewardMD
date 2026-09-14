# WardSynQ patient portal translations - brief for Antigravity

Owner decision D6: the WardSynQ patient portal ships in English, Spanish, Telugu, Hindi, Bengali,
Kannada, Tamil and Malayalam. English (`wardsynq/site/i18n.js`) is ours and is the source of truth,
154 keys as of this brief. You write the other seven catalogs. This file is the whole contract - read
it before your first commit.

## What you touch, and nothing else

You own exactly these seven files, one language each:

```
wardsynq/site/i18n/es.js   Spanish   (Español)
wardsynq/site/i18n/te.js   Telugu    (తెలుగు)
wardsynq/site/i18n/hi.js   Hindi     (हिन्दी)   - already has a first pass, reviewed:false
wardsynq/site/i18n/bn.js   Bengali   (বাংলা)
wardsynq/site/i18n/kn.js   Kannada   (ಕನ್ನಡ)
wardsynq/site/i18n/ta.js   Tamil     (தமிழ்)
wardsynq/site/i18n/ml.js   Malayalam (മലയാളം)
```

Never edit `wardsynq/site/i18n.js` (the engine and the English catalog), `wardsynq/site/portal.js`,
`wardsynq/site/portal.html`, or any other file in this repository. This is what makes seven people
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

It prints, per language, how many of the 154 English keys still fall back to English - that is your
progress counter, not a failure. The test only fails on: a key you added that English does not have, a
missing or reshaped `{placeholder}`, an empty value, an em dash, an emoji, clinical-shaped text (a
number next to `mg`/`ml`/`mcg`/etc.), or a file that does anything beyond the one `register(...)` call
described above.
