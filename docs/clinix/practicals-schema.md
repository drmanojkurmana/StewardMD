# CliniX Practicals: content schema (v1, 2026-10-18)

Owner direction: CliniX must cover every final-year subject so a UG or PG student can read, learn and rehearse the practical exam in the app (spotters, instruments, drugs, procedures, charts, models, short cases). First sources: the owner's practical-exam books for Obstetrics and Gynaecology and the Manipal clinical paediatrics manual. The books are source FACTS only: every item is rewritten in our own words (a validator measures verbatim overlap) and no book image is ever used.

## Files
`clinix/practicals/<subject>/<section>.json`, one per book section, listed in `clinix/practicals/index.json` (written by `tools/clinix-practicals-index.mjs`). Subject ids: `obgyn`, `paediatrics` (later `surgery`, ...).

```json
{
  "v": 1, "subject": "obgyn", "section": "instruments", "title": {"en": "Instruments in obstetrics and gynaecology"},
  "intro": {"en": "one or two sentences on what the section tests"},
  "source": {"book": "obg-practical-guide", "section": "I"},
  "items": [ ITEM, ... ]
}
```

## ITEM
```json
{
  "id": "obg.ins.sims-speculum",
  "kind": "instrument",
  "title": {"en": "Sim's speculum"},
  "aka": ["Sims double-bladed vaginal speculum"],
  "group": "Speculums and retractors",
  "summary": "One or two plain sentences: what it is and how to recognise it.",
  "blocks": [
    {"title": "How to recognise it", "bullets": ["..."]},
    {"title": "Uses", "groups": [{"label": "Outpatient", "bullets": ["..."]}, {"label": "Labour ward", "bullets": ["..."]}]},
    {"title": "Points to remember", "bullets": ["..."]}
  ],
  "viva": [{"q": "Examiner question", "a": "Short model answer"}],
  "image": {"brief": "What a good picture must show (view, parts to see, background), used to find a CC image or to prompt an AI image", "file": null, "mediaId": null},
  "competencies": ["OG35.1"],
  "src": {"book": "obg-practical-guide", "section": "I", "no": 1},
  "review": "ai_drafted"
}
```
Rules:
- `kind`: instrument, device, drug, procedure, method, staging, chart, specimen, xray, model, case-sheet, exam-step, topic.
- `blocks[]`: ordered, each has `title` plus ONE of `bullets` (string[]), `text` (string), `groups` ([{label, bullets}]), `table` ({head: string[], rows: string[][]}). Keep the book's teaching headings but in our wording (Uses, Adverse effects, Contraindications, Dosage, Steps, Complications, Points to remember, Comparison ...).
- Drug items keep a `Dosage` block as the book gives it; the app labels it "Exam reference. Check your local protocol." (owner decision pending: drop the block to remove doses).
- 2 to 4 `viva` pairs per item, answers at most 40 words, only facts that are in the item or standard textbook knowledge.
- `image.brief` is required for kinds instrument, device, specimen, xray, model, method, procedure (steps picture) and optional otherwise. `file` and `mediaId` stay null until a cleared image exists (CC0, CC BY, CC BY-SA, public domain, or AI-generated and checked). Never reference a book image.
- Text rules: English, British spelling, ASCII punctuation, no em or en dashes, abbreviations expanded on first use in the item, every bullet at most 220 characters, no lorem, no copying: the validator measures shared 7-word sequences with the source text.
- Anything you are unsure of: leave it out of the item and list it in `unsure[]` (array of strings, optional) on the item, so the reviewer can check it.
- `review` is always "ai_drafted".
