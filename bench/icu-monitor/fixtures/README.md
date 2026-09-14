# ICU monitor OCR benchmark — fixtures

Synthetic bedside-monitor screens for testing an OCR + spatial parser against ICU monitor
numeric layouts, until real de-identified photos are available.

## What's here

- `gen.mjs` — generates every case's HTML (`cases/*.html`) and ground-truth JSON
  (`cases/*.json`) from data baked into the script. No external images, no network calls.
- `render.sh` — renders every `cases/*.html` to a `cases/*.png` (1800x1200) via headless
  Chrome.
- `cases/` — generated output: `<case>.html`, `<case>.png`, `<case>.json`.

All patient-name fields are one of `"Not Admitted"`, `"Bed 4"`, `"Demo"`, or blank — never a
real or plausible patient name. All images are synthetic HTML/CSS/SVG (no photos, no
manufacturer logos — brand names appear only as plain bezel text).

## Manufacturers covered (6 layouts, `layout` field in the JSON)

`philips-intellivue`, `ge-carescape`, `draeger-infinity`, `mindray-beneview`,
`nihon-kohden`, `generic-transport` (a minimal 3-parameter transport monitor used to test
`not_applicable` / `not_visible` handling).

## Cases per manufacturer

6 base variants (`clean`, `limit-vs-value`, `high-acuity`, `tilt-glare`, `low-light-blur`,
`partial-obscured`) plus 3 extra close-candidate cases across philips/mindray/ge, for 39
total PNG+JSON pairs.

- **clean** — nominal values.
- **limit-vs-value** — an alarm-limit number that is itself a plausible reading (e.g. SpO2
  94 with limits 100/90 — "100" is a limit, not the value).
- **high-acuity** — HR 138, SpO2 88, low ART/NIBP, RR 34, with an alarm banner.
- **tilt-glare** — `perspective`/`rotateY`/`rotateX` transform + a radial-gradient glare
  overlay on part of the numeric column.
- **low-light-blur** — `brightness`/`contrast`/`blur` filters on the whole monitor.
  (JPEG-noise texture was skipped — not worth a data-URI asset for what blur+low-light
  already exercises; add a noise overlay div if a parser needs to be tested against it
  specifically.)
- **partial-obscured** — the monitor is shifted down so the stage's `overflow:hidden` crops
  the bottom edge, always cutting off the last numcol tile (RESP/RR) → `rr.status:
  "not_visible"`; a glare blob sits over the SpO2 tile's label only (value still legible) →
  `spo2.status: "ambiguous"` with the true value plus a `why`.
- **close-candidates** (3 cases, not one per manufacturer) — deliberately close numbers
  placed next to each other: HR 105 next to Pulse 104 (philips), NIBP 121/79(93) next to ART
  119/66(84) (mindray), and both combined (ge) — a parser must not conflate the pairs.

## Regenerating

```
node gen.mjs      # (re)writes cases/*.html and cases/*.json from the data in gen.mjs
./render.sh       # renders cases/*.html -> cases/*.png via headless Chrome
```

`render.sh` shells out to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
--headless=new`. Edit the `CHROME` path at the top if Chrome lives elsewhere.

To change a case's values, edit the data in `gen.mjs` (the `VARIANTS` object or the
close-candidate calls near the bottom) and re-run both scripts — do not hand-edit
`cases/*.html`, it's generated and will be overwritten.

## Adding a real de-identified photo

Real fixtures live alongside the synthetic ones in `cases/`, same naming convention:

1. Drop the photo in as `<case-id>.png` or `.jpg` (whatever the real file's format is).
2. Write `<case-id>.json` by hand, same schema as below, except:
   - `"synthetic": false`
   - `"imageSize"` set to the real file's actual pixel dimensions (`sips -g pixelWidth -g
     pixelHeight <file>`), not 1800x1200.
3. Confirm the photo has zero PHI: no patient name, no MRN, no barcode, no accession number,
   nothing readable that identifies a person. If any of that is visible in-frame, crop or
   blur it out before adding the file, or don't add it.

## Ground-truth JSON schema

```json
{
  "id": "philips-intellivue-clean-01",
  "manufacturer": "philips-intellivue | ge-carescape | draeger-infinity | mindray-beneview | nihon-kohden | generic-transport",
  "layout": "<short layout tag>",
  "difficulty": ["clean"] | ["tilt","glare"] | ["low-light","blur"] | ["partial","label-obscured"] | ["close-candidates"],
  "image": "<case>.png",
  "imageSize": {"w": 1800, "h": 1200},
  "synthetic": true,
  "fields": {
    "hr":    {"status": "visible", "value": 105},
    "spo2":  {"status": "visible", "value": 100},
    "sbp":   {"status": "visible", "value": 149, "source": "ART"},
    "dbp":   {"status": "visible", "value": 66,  "source": "ART"},
    "map":   {"status": "visible", "value": 98,  "source": "ART"},
    "rr":    {"status": "not_visible"},
    "pulse": {"status": "visible", "value": 105},
    "pvc":   {"status": "visible", "value": 0},
    "temp":  {"status": "not_applicable"},
    "nibp":  {"status": "visible", "value": {"sbp": 118, "dbp": 76, "map": 90}},
    "art":   {"status": "visible", "value": {"sbp": 149, "dbp": 66, "map": 98}},
    "st":    {"status": "visible", "value": {"I": 0.0, "II": 0.5, "III": 0.5}},
    "etco2": {"status": "not_applicable"}
  },
  "distractors": {"alarmLimits": {"hr": [120, 50], "spo2": [100, 90], "rr": [30, 8]}, "clock": "20:38", "banner": "** RR HIGH"},
  "notes": "free text"
}
```

`status` is one of `"visible" | "not_visible" | "ambiguous" | "not_applicable"`.
`"ambiguous"` still carries the true `"value"` plus a `"why"`. An absent value is never
encoded as `0`. `sbp`/`dbp`/`map` are the PRIMARY pressure shown big on that monitor (ART if
present, else NIBP) with a `"source"`; when both ART and NIBP are shown, both also appear
under `"art"`/`"nibp"`.
