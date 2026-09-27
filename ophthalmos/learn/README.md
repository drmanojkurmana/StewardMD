# Learn content

Start here, Unit 1 (retina and diabetic eye disease, MBBS) and Retina for residents: 14 AI-drafted lessons in English and Hindi, awaiting ophthalmologist review. Every lesson must pass `D.validateLesson` (`node --test test/learn.test.mjs test/learn-content.test.mjs` checks every file in `lessons/`).

- `index.json`: `{v: 1, review, units: [{id, title: {en, hi}, level: "mbbs" | "resident", lessons: [ids]}]}`; study order is every MBBS unit, then every Resident unit.
- `lessons/<id>.json`: the lesson schema in `docs/DESIGN.md` (Learn section).
- `glossary.json`: `{terms: {<id>: {term: {en, hi}, def: {en, hi}}}}`. Any lesson text may link a term as `[[id]]` or `[[id|shown words]]`.
- `diagrams/<name>.svg`: unlabelled; give the root `<svg>` `width`, `height` and a `viewBox` so hotspots (x, y as fractions of the picture) land where they should, and put that viewBox width and height in the lesson as `see.w` and `see.h` (the frame takes its shape before the picture loads; the test checks they match).
- `media/`: the image library (photos, illustrations, animations). `media/credits.json` is the one source for each item's alt text, caption, size (`w`, `h`) and credit. A lesson shows items under its main picture by listing their ids in `see.more`.
