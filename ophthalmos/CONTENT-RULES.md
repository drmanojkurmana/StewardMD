# Ophthalmós content rules

Owner rules, 2026-10-08. They apply to every Ophthalmós text: lessons, notes, glossary, explorers, simulators,
tools and quizzes, in English and in Hindi. `test/ophthalmos-content-rules.test.mjs` checks the rules that can be
checked mechanically (R1, R3, R4, R5, R9); the rest needs a careful read.

## R1. Medical term first, plain meaning in brackets

Write the medical term, with the plain meaning in brackets the first time it appears in a lesson or screen. After
that, the medical term alone.

- Yes: "So the right side of the brain sees the left half of the visual field (the left side of everything you see)."
- No: "The right brain sees the left half of the world."

Never use a lay word instead of the medical term outside an analogy: not "world" for visual field, "picture" for
the image on the retina, "relay knot" for the lateral geniculate nucleus, "screen" for retina, "camera" for eye.

## R2. Analogies stay in the analogy block

Analogies live only in the lesson's "Think of it like this" block, or in a sentence clearly marked "like ...".
Even there, keep the medical term next to the plain one: "the retina (the eye's light-sensing layer, like the film
in a camera)".

## R3. Abbreviations: the full form at first use

Write the full form at the first use in each lesson or screen: "lateral geniculate nucleus (LGN)". Later uses may
be the short form.

- Glossary abbreviations (`"abbr": true` with `"full": {"en", "hi"}` in `learn/glossary.json`) are expanded by the
  renderer at their first `[[term]]` in a lesson, so content may write `[[lgn]]`. Later links show "LGN"; tapping
  any of them opens the glossary sheet, whose title is the full form.
- Any other abbreviation in running text must be written out by the author at first use: IOP, RAPD, VA, BCVA,
  OCT, FFA, AMD, DR, NPDR, PDR, CSME, DME, CRAO, CRVO, BRAO, BRVO, RP, POAG, PACG, NTG, IOL, SICS, MSICS, LASIK,
  PRK, INO, IIH, NAION, GCA, ONTT, MOG, ROP, RD, PVD, VKC, HSV, HZO, TB, HLA and the rest. OD and OS are written
  "right eye" and "left eye". Units (mm, D, mmHg) follow the same rule where a reader may not know them.

## R4. Hindi: plain Hindi, English medical term in brackets; no dashes

- "दृष्टि क्षेत्र (visual field) का बायाँ आधा (आप जो देखते हैं उसका बायाँ हिस्सा)"
- Full forms may stay in English letters: "लैटरल जेनिकुलेट न्यूक्लियस (lateral geniculate nucleus, LGN)".
- No em dash or en dash anywhere, in either language. Use a colon, a comma or a new sentence.

## R5. Visual field defects are shown, not only described

Every lesson that teaches a field defect (pathway, chiasm and pituitary, tract, radiation and Meyer loop, cortex,
optic nerve and RAPD, glaucoma, retinitis pigmentosa, macular disease and central scotoma, retinal detachment,
artery occlusion, NAION, papilloedema and the enlarged blind spot, hemianopia) has a `fields` block. The lesson
then gets a "What the patient sees" step: the left eye's view, the right eye's view and both eyes open, drawn on
one everyday street scene, with "Normal" always first for comparison.

```json
"fields": {
  "intro": {"en": "...", "hi": "..."},
  "items": [
    { "id": "bitemporal",
      "label": {"en": "Bitemporal hemianopia (outer half lost in each eye)", "hi": "..."},
      "le": "temporal", "re": "temporal",
      "where": {"en": "Chiasm: a pituitary tumour presses the crossing nasal fibres", "hi": "..."},
      "lesion": "chiasm" }
  ]
}
```

- `le` and `re` are the pattern of the left eye and the right eye, as the PATIENT sees it. Patterns: full, blind,
  left-half, right-half, temporal (the outer half of that eye: left half for the left eye, right half for the
  right eye), nasal (the inner half), sup-left, inf-left, sup-right, inf-right, tunnel, central, arcuate-sup,
  arcuate-inf, altitudinal-sup, altitudinal-inf, left-half-sparing, right-half-sparing, blind-spot, blur, patchy.
- `lesion` (optional) links a pathway site: optic-nerve, chiasm, optic-tract, lgn, meyer-loop, parietal-radiation,
  occipital-cortex, retina, macula. A "See it" hotspot named after that site then offers "See what the patient sees".
- `id` is lowercase letters, digits and hyphens, and never "normal".

## R6. Short sentences, same facts

Keep sentences short (about 20 words or fewer) and the lesson's meaning unchanged. Keep the medical facts exact;
do not invent facts. Nothing new is marked reviewed: every lesson keeps `"review": "ai_drafted"`.

## R7. Anatomically complete

When a structure is mentioned, say what it carries or contains, and state the full consequence of damage: which
eye, which part of the field.

- No: "In front of the chiasm, each optic nerve carries one eye."
- Yes: "Each optic nerve carries both the nasal and the temporal fibres of its own eye. Damage there causes loss
  of the entire visual field of that eye."

## R8. Name structures precisely

Give the exact anatomical identity in plain form at first use.

- "Meyer loop: the inferior fibres of the optic radiation, which loop forward through the temporal lobe. They
  carry the upper field. Damage gives an upper quadrantanopia ('pie in the sky')."
- Also: pretectal nucleus, Edinger-Westphal nucleus, short ciliary nerves, lateral geniculate nucleus (LGN).

## R9. No vague counts or placeholders where a name exists

Name the arteries, nerves, muscles, nuclei, drugs and trials. "Two arteries", "some nerves", "a drug", "a muscle",
"a branch" are not allowed when the specific name is known and teachable.

- No: "The tip of the occipital lobe often gets blood from two arteries."
- Yes: "The occipital pole (where the macula is represented) is often supplied by both the posterior cerebral
  artery (calcarine branch) and branches of the middle cerebral artery. So a posterior cerebral artery stroke may
  spare the central field (macular sparing)."

If unsure, use the standard textbook name (Khurana, Kanski, Parsons, Liu-Volpe-Galetta) and flag it for the
ophthalmologist. A sentence may run a little past 20 words to stay complete; split it into two where possible.
