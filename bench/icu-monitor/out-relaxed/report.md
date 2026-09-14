# ICU monitor extraction benchmark (policy: relaxed)

Generated 2026-09-14T11:05:04.393Z · parser v2.0.0 · 41 cases (2 real, 39 synthetic) · colour used in 39 cases · policy relaxed (slot + channel colour may auto-fill an unlabeled value)

Avg OCR 2063.6 ms · avg parse 2.6 ms · avg boxes 23.1 · network calls 0 · Gemini fallbacks 0 · **silent guesses 1**

## Field accuracy (all cases)

| field | visible | correct | wrong | review | missed | exact % | recall % | precision % | FP % | needs-review % | silent-guess % | safe % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hr | 41 | 36 | 0 | 5 | 0 | 87.8 | 87.8 | 100 | 0 | 12.2 | 0 | 87.8 |
| spo2 | 35 | 34 | 0 | 7 | 0 | 97.1 | 97.1 | 100 | 0 | 17.1 | 0 | 97.6 |
| sbp | 41 | 33 | 0 | 8 | 0 | 80.5 | 80.5 | 100 | 0 | 19.5 | 0 | 80.5 |
| dbp | 41 | 33 | 0 | 8 | 0 | 80.5 | 80.5 | 100 | 0 | 19.5 | 0 | 80.5 |
| map | 41 | 32 | 0 | 7 | 2 | 78 | 78 | 100 | 0 | 17.1 | 0 | 78 |
| rr | 30 | 30 | 1 | 0 | 0 | 100 | 100 | 96.8 | 3.2 | 0 | 2.9 | 97.1 |
| pulse | 29 | 19 | 0 | 0 | 10 | 65.5 | 65.5 | 100 | 0 | 0 | 0 | 65.5 |
| pvc | 23 | 15 | 0 | 5 | 3 | 65.2 | 65.2 | 100 | 0 | 21.7 | 0 | 65.2 |
| temp | 12 | 9 | 0 | 2 | 1 | 75 | 75 | 100 | 0 | 16.7 | 0 | 75 |
| etco2 | 0 | 0 | 0 | 0 | 0 | - | - | - | - | - | - | - |

## Per manufacturer (core fields, exact % / safe %)

| manufacturer | cases | hr | spo2 | sbp | dbp | map | rr |
|---|---|---|---|---|---|---|---|
| draeger-infinity | 6 | 100 / 100 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | 100 / 100 |
| ge-carescape | 7 | 85.7 / 85.7 | 83.3 / 85.7 | 42.9 / 42.9 | 42.9 / 42.9 | 42.9 / 42.9 | 100 / 100 |
| generic-transport | 6 | 83.3 / 83.3 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | - / - |
| mindray-beneview | 7 | 85.7 / 85.7 | 100 / 100 | 85.7 / 85.7 | 85.7 / 85.7 | 85.7 / 85.7 | 100 / 100 |
| nihon-kohden | 6 | 83.3 / 83.3 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | 100 / 83.3 |
| philips-intellivue | 9 | 88.9 / 88.9 | 100 / 100 | 100 / 100 | 100 / 100 | 88.9 / 88.9 | 100 / 100 |

## Per layout (core fields, exact % / safe %)

| layout | cases | hr | spo2 | sbp | dbp | map | rr |
|---|---|---|---|---|---|---|---|
| right-column-triangle-limits | 6 | 100 / 100 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | 100 / 100 |
| right-column-label-above | 7 | 85.7 / 85.7 | 83.3 / 85.7 | 42.9 / 42.9 | 42.9 / 42.9 | 42.9 / 42.9 | 100 / 100 |
| right-column-minimal | 6 | 83.3 / 83.3 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | - / - |
| right-column-limits-right | 7 | 85.7 / 85.7 | 100 / 100 | 85.7 / 85.7 | 85.7 / 85.7 | 85.7 / 85.7 | 100 / 100 |
| right-column-label-left-limits-right | 6 | 83.3 / 83.3 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | 100 / 83.3 |
| right-column-limits-left | 9 | 88.9 / 88.9 | 100 / 100 | 100 / 100 | 100 / 100 | 88.9 / 88.9 | 100 / 100 |

## Failures and abstentions

- **draeger-infinity-limit-vs-value-22** (draeger-infinity, clean, 21 boxes, layout=generic): sbp review (expected 108, suggested 108: OCR repaired (split hundreds digit): "A0T 1 08/64" read as 108/64; confirm); dbp review (expected 64, suggested 64: OCR repaired (split hundreds digit): "A0T 1 08/64" read as 108/64; confirm); map missed (expected 79: no (MM) read next to A0T 1 08/64; MAP is never computed from SBP/DBP)
- **draeger-infinity-low-light-blur-25** (draeger-infinity, low-light+blur, 19 boxes, layout=generic): temp review (expected 37.5, suggested 37.5: only 1 independent signal(s))
- **ge-carescape-clean-11** (ge-carescape, clean, 23 boxes, layout=ge-carescape): sbp review (expected 118, suggested 118: OCR repaired (leading 1 read as T): "ART T18/76 (90)" read as 118/76; confirm); dbp review (expected 76, suggested 76: OCR repaired (leading 1 read as T): "ART T18/76 (90)" read as 118/76; confirm); map review (expected 90, suggested 90)
- **ge-carescape-close-03** (ge-carescape, close-candidates, 24 boxes, layout=ge-carescape): sbp review (expected 119, suggested 119: OCR repaired (leading 1 read as T): "ART T19/66 (84)" read as 119/66; confirm); dbp review (expected 66, suggested 66: OCR repaired (leading 1 read as T): "ART T19/66 (84)" read as 119/66; confirm); map review (expected 84, suggested 84)
- **ge-carescape-low-light-blur-15** (ge-carescape, low-light+blur, 22 boxes, layout=ge-carescape): sbp review (expected 122, suggested 122: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; confirm); dbp review (expected 78, suggested 78: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; confirm); map review (expected 93, suggested 93)
- **ge-carescape-partial-obscured-16** (ge-carescape, partial+label-obscured, 13 boxes, layout=generic): sbp review (expected 126, suggested 126: OCR repaired (leading 1 read as T): "ARTT26/80 (95)" read as 126/80; confirm); dbp review (expected 80, suggested 80: OCR repaired (leading 1 read as T): "ARTT26/80 (95)" read as 126/80; confirm); map review (expected 95, suggested 95); pvc missed (expected 0: no readable candidate)
- **ge-carescape-tilt-glare-14** (ge-carescape, tilt+glare, 18 boxes, layout=ge-carescape): hr review (expected 82, suggested 82: confidence 0.77 below 0.8); spo2 review (expected 96, suggested 96: confidence 0.79 below 0.8)
- **generic-transport-tilt-glare-54** (generic-transport, tilt+glare, 7 boxes, layout=generic): hr review (expected 82, suggested 82: two candidates too close (82 vs 96)); sbp review (expected 130, suggested 130: OCR repaired (split hundreds digit): "NBP1 30/85 (100)" read as 130/85; confirm); dbp review (expected 85, suggested 85: OCR repaired (split hundreds digit): "NBP1 30/85 (100)" read as 130/85; confirm); map review (expected 100, suggested 100)
- **mindray-beneview-clean-31** (mindray-beneview, clean, 25 boxes, layout=mindray-beneview): pulse missed (expected 72: no readable candidate)
- **mindray-beneview-close-02** (mindray-beneview, close-candidates, 25 boxes, layout=mindray-beneview): sbp review (expected 119, suggested 119: two pressures of similar size: 119/66 (84) (art) vs 121/79 (93) (nibp)); dbp review (expected 66, suggested 66: two pressures of similar size: 119/66 (84) (art) vs 121/79 (93) (nibp)); map review (expected 84, suggested 84); pulse missed (expected 72: no readable candidate)
- **mindray-beneview-high-acuity-33** (mindray-beneview, clean, 26 boxes, layout=mindray-beneview): pulse missed (expected 136: no readable candidate)
- **mindray-beneview-limit-vs-value-32** (mindray-beneview, clean, 25 boxes, layout=mindray-beneview): pulse missed (expected 90: no readable candidate)
- **mindray-beneview-low-light-blur-35** (mindray-beneview, low-light+blur, 26 boxes, layout=mindray-beneview): pulse missed (expected 96: no readable candidate)
- **mindray-beneview-partial-obscured-36** (mindray-beneview, partial+label-obscured, 17 boxes, layout=mindray-beneview): pulse missed (expected 88: no readable candidate)
- **mindray-beneview-tilt-glare-34** (mindray-beneview, tilt+glare, 21 boxes, layout=mindray-beneview): hr review (expected 82, suggested 82: two candidates too close (82 vs 96)); pulse missed (expected 82: no readable candidate)
- **nihon-kohden-limit-vs-value-42** (nihon-kohden, clean, 34 boxes, layout=generic): hr review (expected 90, suggested 90: two candidates too close (90 vs 94))
- **nihon-kohden-low-light-blur-45** (nihon-kohden, low-light+blur, 28 boxes, layout=generic): temp review (expected 37.5, suggested 37.5: only 1 independent signal(s))
- **nihon-kohden-partial-obscured-46** (nihon-kohden, partial+label-obscured, 17 boxes, layout=generic): rr silent-guess (expected null, got 37); temp missed (expected 37: no readable candidate)
- **nihon-kohden-tilt-glare-44** (nihon-kohden, tilt+glare, 26 boxes, layout=generic): sbp review (expected 130, suggested 130: another pressure on screen could not be read: "NIBP"); dbp review (expected 85, suggested 85: another pressure on screen could not be read: "NIBP"); map review (expected 100, suggested 100)
- **philips-intellivue-clean-01** (philips-intellivue, clean, 31 boxes, layout=philips-intellivue): pvc review (expected 0, suggested 50: only 1 independent signal(s))
- **philips-intellivue-close-01** (philips-intellivue, close-candidates, 31 boxes, layout=philips-intellivue): pvc review (expected 0, suggested 50: only 1 independent signal(s))
- **philips-intellivue-high-acuity-03** (philips-intellivue, clean, 31 boxes, layout=philips-intellivue): hr review (expected 138, suggested 138: two candidates too close (138 vs 120)); pvc missed (expected 4: no readable candidate)
- **philips-intellivue-limit-vs-value-02** (philips-intellivue, clean, 31 boxes, layout=philips-intellivue): pvc missed (expected 0: no readable candidate)
- **philips-intellivue-low-light-blur-05** (philips-intellivue, low-light+blur, 29 boxes, layout=philips-intellivue): pvc review (expected 1, suggested 50: only 1 independent signal(s))
- **philips-intellivue-partial-obscured-06** (philips-intellivue, partial+label-obscured, 14 boxes, layout=philips-intellivue): pvc review (expected 0, suggested 50: only 1 independent signal(s))
- **philips-intellivue-tilt-glare-04** (philips-intellivue, tilt+glare, 25 boxes, layout=philips-intellivue): pulse missed (expected 82: no readable candidate); pvc review (expected 0, suggested 50: only 1 independent signal(s))
- **philips-mp40-owner-1800px** (philips-intellivue, real-photo+upscaled-2x+reflections, 44 boxes, layout=philips-intellivue): pulse missed (expected 105: no readable candidate)
- **philips-mp40-owner-900px** (philips-intellivue, real-photo+low-resolution+reflections, 47 boxes, layout=philips-intellivue): map missed (expected 98: no (MM) read next to 149/66; MAP is never computed from SBP/DBP); pulse missed (expected 105: no readable candidate)

## Per case

| case | mfr | difficulty | boxes | OCR ms | parse ms | hr | spo2 | sbp | dbp | map | rr |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draeger-infinity-clean-21 | draeger-infinity | clean | 21 | 74856 | 13 | 72 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | 16 ✓ |
| draeger-infinity-high-acuity-23 | draeger-infinity | clean | 21 | 598 | 10 | 138 ✓ | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | 34 ✓ |
| draeger-infinity-limit-vs-value-22 | draeger-infinity | clean | 21 | 222 | 2 | 90 ✓ | 94 ✓ | ?108 R | ?64 R | · M | 14 ✓ |
| draeger-infinity-low-light-blur-25 | draeger-infinity | low-light+blur | 19 | 224 | 1 | 96 ✓ | 93 ✓ | 122 ✓ | 78 ✓ | 93 ✓ | 20 ✓ |
| draeger-infinity-partial-obscured-26 | draeger-infinity | partial+label-obscured | 10 | 220 | 3 | 88 ✓ | ?97 ✓ | 126 ✓ | 80 ✓ | 95 ✓ | ?37 ✓ |
| draeger-infinity-tilt-glare-24 | draeger-infinity | tilt+glare | 16 | 235 | 1 | 82 ✓ | 96 ✓ | 130 ✓ | 85 ✓ | 100 ✓ | 18 ✓ |
| ge-carescape-clean-11 | ge-carescape | clean | 23 | 242 | 3 | 72 ✓ | 98 ✓ | ?118 R | ?76 R | ?90 R | 16 ✓ |
| ge-carescape-close-03 | ge-carescape | close-candidates | 24 | 244 | 2 | 106 ✓ | 98 ✓ | ?119 R | ?66 R | ?84 R | 16 ✓ |
| ge-carescape-high-acuity-13 | ge-carescape | clean | 26 | 221 | 1 | 138 ✓ | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | 34 ✓ |
| ge-carescape-limit-vs-value-12 | ge-carescape | clean | 25 | 252 | 1 | 90 ✓ | 94 ✓ | 108 ✓ | 64 ✓ | 79 ✓ | 14 ✓ |
| ge-carescape-low-light-blur-15 | ge-carescape | low-light+blur | 22 | 245 | 2 | 96 ✓ | 93 ✓ | ?122 R | ?78 R | ?93 R | 20 ✓ |
| ge-carescape-partial-obscured-16 | ge-carescape | partial+label-obscured | 13 | 220 | 1 | 88 ✓ | ?97 ✓ | ?126 R | ?80 R | ?95 R | · ✓ |
| ge-carescape-tilt-glare-14 | ge-carescape | tilt+glare | 18 | 247 | 1 | ?82 R | ?96 R | 130 ✓ | 85 ✓ | 100 ✓ | 18 ✓ |
| generic-transport-clean-51 | generic-transport | clean | 12 | 225 | 0 | 72 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | · ✓ |
| generic-transport-high-acuity-53 | generic-transport | clean | 13 | 233 | 1 | 138 ✓ | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | · ✓ |
| generic-transport-limit-vs-value-52 | generic-transport | clean | 14 | 209 | 0 | 90 ✓ | 94 ✓ | 108 ✓ | 64 ✓ | 79 ✓ | · ✓ |
| generic-transport-low-light-blur-55 | generic-transport | low-light+blur | 9 | 214 | 0 | 96 ✓ | 93 ✓ | 122 ✓ | 78 ✓ | 93 ✓ | · ✓ |
| generic-transport-partial-obscured-56 | generic-transport | partial+label-obscured | 13 | 213 | 1 | 88 ✓ | ?97 ✓ | 126 ✓ | 80 ✓ | 95 ✓ | · ✓ |
| generic-transport-tilt-glare-54 | generic-transport | tilt+glare | 7 | 285 | 1 | ?82 R | 96 ✓ | ?130 R | ?85 R | ?100 R | · ✓ |
| mindray-beneview-clean-31 | mindray-beneview | clean | 25 | 251 | 2 | 72 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | 16 ✓ |
| mindray-beneview-close-02 | mindray-beneview | close-candidates | 25 | 227 | 1 | 72 ✓ | 98 ✓ | ?119 R | ?66 R | ?84 R | 16 ✓ |
| mindray-beneview-high-acuity-33 | mindray-beneview | clean | 26 | 227 | 2 | 138 ✓ | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | 34 ✓ |
| mindray-beneview-limit-vs-value-32 | mindray-beneview | clean | 25 | 268 | 2 | 90 ✓ | 94 ✓ | 108 ✓ | 64 ✓ | 79 ✓ | 14 ✓ |
| mindray-beneview-low-light-blur-35 | mindray-beneview | low-light+blur | 26 | 244 | 1 | 96 ✓ | 93 ✓ | 122 ✓ | 78 ✓ | 93 ✓ | 20 ✓ |
| mindray-beneview-partial-obscured-36 | mindray-beneview | partial+label-obscured | 17 | 230 | 2 | 88 ✓ | ?97 ✓ | 126 ✓ | 80 ✓ | 95 ✓ | · ✓ |
| mindray-beneview-tilt-glare-34 | mindray-beneview | tilt+glare | 21 | 249 | 7 | ?82 R | 96 ✓ | 130 ✓ | 85 ✓ | 100 ✓ | 18 ✓ |
| nihon-kohden-clean-41 | nihon-kohden | clean | 35 | 258 | 16 | 72 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | 16 ✓ |
| nihon-kohden-high-acuity-43 | nihon-kohden | clean | 34 | 258 | 2 | 138 ✓ | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | 34 ✓ |
| nihon-kohden-limit-vs-value-42 | nihon-kohden | clean | 34 | 286 | 3 | ?90 R | 94 ✓ | 108 ✓ | 64 ✓ | 79 ✓ | 14 ✓ |
| nihon-kohden-low-light-blur-45 | nihon-kohden | low-light+blur | 28 | 249 | 2 | 96 ✓ | 93 ✓ | 122 ✓ | 78 ✓ | 93 ✓ | 20 ✓ |
| nihon-kohden-partial-obscured-46 | nihon-kohden | partial+label-obscured | 17 | 217 | 2 | 88 ✓ | ?97 ✓ | 126 ✓ | 80 ✓ | 95 ✓ | 37 ✗ |
| nihon-kohden-tilt-glare-44 | nihon-kohden | tilt+glare | 26 | 228 | 2 | 82 ✓ | 96 ✓ | ?130 R | ?85 R | ?100 R | 18 ✓ |
| philips-intellivue-clean-01 | philips-intellivue | clean | 31 | 245 | 1 | 72 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | 16 ✓ |
| philips-intellivue-close-01 | philips-intellivue | close-candidates | 31 | 221 | 6 | 105 ✓ | 98 ✓ | 118 ✓ | 76 ✓ | 90 ✓ | 16 ✓ |
| philips-intellivue-high-acuity-03 | philips-intellivue | clean | 31 | 214 | 1 | ?138 R | 88 ✓ | 78 ✓ | 44 ✓ | 55 ✓ | 34 ✓ |
| philips-intellivue-limit-vs-value-02 | philips-intellivue | clean | 31 | 208 | 1 | 90 ✓ | 94 ✓ | 108 ✓ | 64 ✓ | 79 ✓ | 14 ✓ |
| philips-intellivue-low-light-blur-05 | philips-intellivue | low-light+blur | 29 | 245 | 2 | 96 ✓ | 93 ✓ | 122 ✓ | 78 ✓ | 93 ✓ | 20 ✓ |
| philips-intellivue-partial-obscured-06 | philips-intellivue | partial+label-obscured | 14 | 198 | 1 | 88 ✓ | ?97 ✓ | 126 ✓ | 80 ✓ | 95 ✓ | · ✓ |
| philips-intellivue-tilt-glare-04 | philips-intellivue | tilt+glare | 25 | 227 | 1 | 82 ✓ | 96 ✓ | 130 ✓ | 85 ✓ | 100 ✓ | 18 ✓ |
| philips-mp40-owner-1800px | philips-intellivue | real-photo+upscaled-2x+reflections | 44 | 255 | 3 | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | 22 ✓ |
| philips-mp40-owner-900px | philips-intellivue | real-photo+low-resolution+reflections | 47 | 199 | 1 | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | · M | 22 ✓ |
