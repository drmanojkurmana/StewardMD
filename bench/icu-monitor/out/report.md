# ICU monitor extraction benchmark: parser v2.1.0, policy strict, 2-scale Vision

Generated 2026-09-14T12:02:57.279Z. Local extraction only (Apple Vision on macOS + icu-monitor-parser.js). **Gemini calls: 0** (not part of this benchmark; the app's on-tap fallback is counted separately). Network calls: 0.

**Groups are reported separately and never pooled.** `real` = photographs as taken. `perturbed-real` = images derived from a real photograph (robustness, not new monitors). `synthetic` = rendered layouts (layout handling, not photographic accuracy). Unit-test fixtures are not included.

## Acceptance

- Silent guesses (all groups): **0**
- AUTO fields without complete evidence: **0**
- PASS: Philips 2x photo, unlabeledAuto: HR 105, SpO2 100, 149/66, MAP 98, RR 22 (Pulse not inferred) ({"hr":105,"spo2":100,"sbp":149,"dbp":66,"map":98,"rr":22} pulse=undefined)
- PASS: Philips 2x photo, strict: no wrong auto-fill; every non-auto core field suggests the true value (auto hr,spo2,sbp,dbp,map,rr)
- PASS: Philips real 900px, strict: no wrong auto-fill, MAP never computed, Pulse never inferred (auto sbp,dbp,map,art,hr,spo2,pvc)

## Group: real (1 case)

Silent guesses 0 · incomplete evidence 0 · RETAKE_PHOTO 0 · DEGRADED 0 · avg Vision full 202 ms + crop 272 ms · parse 2 ms · boxes 47 (+13 from crop) · colour used in 1

| field | visible | correct | wrong | review | missed | exact % | precision % | needs-review % | silent-guess % | safe % |
|---|---|---|---|---|---|---|---|---|---|---|
| hr | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| spo2 | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| sbp | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| dbp | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| map | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| rr | 1 | 0 | 0 | 1 | 0 | 0 | - | 100 | 0 | 0 |
| pulse | 1 | 0 | 0 | 1 | 0 | 0 | - | 100 | 0 | 0 |
| pvc | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| art | 1 | 1 | 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| nibp | 0 | 0 | 0 | 0 | 0 | - | - | 0 | 0 | 100 |

## Group: perturbed-real (21 cases)

Silent guesses 0 · incomplete evidence 0 · RETAKE_PHOTO 0 · DEGRADED 3 · avg Vision full 221.8 ms + crop 238.7 ms · parse 2 ms · boxes 32.4 (+8.9 from crop) · colour used in 20

| field | visible | correct | wrong | review | missed | exact % | precision % | needs-review % | silent-guess % | safe % |
|---|---|---|---|---|---|---|---|---|---|---|
| hr | 20 | 13 | 0 | 6 | 2 | 65 | 100 | 28.6 | 0 | 66.7 |
| spo2 | 21 | 7 | 0 | 10 | 4 | 33.3 | 100 | 47.6 | 0 | 33.3 |
| sbp | 20 | 10 | 0 | 8 | 3 | 50 | 100 | 38.1 | 0 | 52.4 |
| dbp | 20 | 10 | 0 | 8 | 3 | 50 | 100 | 38.1 | 0 | 52.4 |
| map | 20 | 10 | 0 | 4 | 7 | 50 | 100 | 19 | 0 | 52.4 |
| rr | 20 | 6 | 0 | 9 | 5 | 30 | 100 | 42.9 | 0 | 33.3 |
| pulse | 20 | 0 | 0 | 13 | 7 | 0 | - | 61.9 | 0 | 4.8 |
| pvc | 20 | 0 | 0 | 10 | 11 | 0 | - | 47.6 | 0 | 4.8 |
| art | 20 | 10 | 0 | 2 | 9 | 50 | 100 | 9.5 | 0 | 52.4 |
| nibp | 0 | 0 | 0 | 0 | 0 | - | - | 0 | 0 | 100 |

Per manufacturer (perturbed-real; core fields exact % / safe %)

| manufacturer | cases | hr | spo2 | sbp | dbp | map | rr |
|---|---|---|---|---|---|---|---|
| philips-intellivue | 21 | 65 / 66.7 | 33.3 / 33.3 | 50 / 52.4 | 50 / 52.4 | 50 / 52.4 | 30 / 33.3 |

| perturbation | quality | hr | spo2 | sbp | dbp | map | rr | pulse | art |
|---|---|---|---|---|---|---|---|---|---|
| blur-r1 | OK | 105 ✓ | ?100 R | ?149 R | ?66 R | ?98 R | ?22 R | · M | · M |
| blur-r2_5 | OK perspective:info:14.712 | ?100 R | ?100 R | ?149 R | ?66 R | · M | · M | · M | · M |
| blur-r4 | DEGRADED blur:moderate:1.261 | ?100 R | ?100 R | · M | · M | · M | · M | · M | · M |
| brightness-055 | OK | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | ?30 R | ?105 R | 149/66(98) ✓ |
| brightness-160 | OK | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | ?30 R | ?105 R | 149/66(98) ✓ |
| contrast-055 | OK | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | ?22 R | ?105 R | 149/66(98) ✓ |
| contrast-160 | OK | 105 ✓ | 100 ✓ | · M | · M | · M | ?22 R | · M | · M |
| crop-bottom-rr | OK | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | · ✓ | ?105 R | 149/66(98) ✓ |
| crop-right-truncates | DEGRADED partial:moderate:1 | 105 ✓ | ?100 R | · ✓ | · ✓ | · ✓ | ?22 R | · ✓ | · ✓ |
| glare-moderate | OK | 105 ✓ | ?100 R | 149 ✓ | 66 ✓ | 98 ✓ | ?22 R | ?105 R | 149/66(98) ✓ |
| glare-severe-hr | OK | ?100 ✓ | ?100 R | 149 ✓ | 66 ✓ | 98 ✓ | 22 ✓ | ?105 R | 149/66(98) ✓ |
| jpeg-q10 | OK | 105 ✓ | ?100 R | ?149 R | ?66 R | ?98 R | · M | ?105 R | · M |
| jpeg-q30 | OK | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | ?22 R | ?105 R | 149/66(98) ✓ |
| perspective-mild | OK | 105 ✓ | ?100 R | 149 ✓ | 66 ✓ | 98 ✓ | 22 ✓ | ?105 R | 149/66(98) ✓ |
| perspective-strong | DEGRADED partial:moderate:1 | ?105 R | · M | 149 ✓ | 66 ✓ | 98 ✓ | 22 ✓ | ?105 R | 149/66(98) ✓ |
| resize-035 | OK perspective:info:8.488 | · M | · M | ?149 R | ?66 R | · M | ?8 R | · M | · M |
| resize-050 | OK | ?100 R | ?100 R | ?149 R | ?86 R | ?98 R | 22 ✓ | ?105 R | · M |
| rotate-05 | OK | 105 ✓ | ?100 R | · M | · M | · M | 22 ✓ | ?105 R | · M |
| rotate-12 | OK perspective:info:10.616 | · M | · M | ?149 R | ?86 R | · M | · M | · M | ?149/86 R |
| rotate-25 | OK | ?105 R | · M | ?149 R | ?66 R | · M | · M | · M | · M |
| owner-1800px | OK perspective:info:6.34 | 105 ✓ | 100 ✓ | 149 ✓ | 66 ✓ | 98 ✓ | 22 ✓ | ?105 R | 149/66(98) ✓ |

## Group: synthetic (39 cases)

Silent guesses 0 · incomplete evidence 0 · RETAKE_PHOTO 0 · DEGRADED 2 · avg Vision full 223.9 ms + crop 285.3 ms · parse 1.8 ms · boxes 22 (+1.2 from crop) · colour used in 37

| field | visible | correct | wrong | review | missed | exact % | precision % | needs-review % | silent-guess % | safe % |
|---|---|---|---|---|---|---|---|---|---|---|
| hr | 39 | 35 | 0 | 4 | 0 | 89.7 | 100 | 10.3 | 0 | 89.7 |
| spo2 | 33 | 32 | 0 | 7 | 0 | 97 | 100 | 17.9 | 0 | 97.4 |
| sbp | 39 | 16 | 0 | 23 | 0 | 41 | 100 | 59 | 0 | 41 |
| dbp | 39 | 16 | 0 | 23 | 0 | 41 | 100 | 59 | 0 | 41 |
| map | 39 | 16 | 0 | 22 | 1 | 41 | 100 | 56.4 | 0 | 41 |
| rr | 28 | 24 | 0 | 4 | 0 | 85.7 | 100 | 12.1 | 0 | 87.9 |
| pulse | 27 | 20 | 0 | 6 | 1 | 74.1 | 100 | 22.2 | 0 | 74.1 |
| pvc | 21 | 13 | 0 | 7 | 1 | 61.9 | 100 | 33.3 | 0 | 61.9 |
| temp | 12 | 10 | 0 | 2 | 0 | 83.3 | 100 | 16.7 | 0 | 83.3 |
| art | 27 | 19 | 0 | 5 | 3 | 70.4 | 100 | 18.5 | 0 | 70.4 |
| nibp | 26 | 18 | 0 | 1 | 7 | 69.2 | 100 | 3.8 | 0 | 69.2 |

Per manufacturer (synthetic; core fields exact % / safe %)

| manufacturer | cases | hr | spo2 | sbp | dbp | map | rr |
|---|---|---|---|---|---|---|---|
| draeger-infinity | 6 | 100 / 100 | 100 / 100 | 50 / 50 | 50 / 50 | 50 / 50 | 40 / 50 |
| ge-carescape | 7 | 85.7 / 85.7 | 83.3 / 85.7 | 0 / 0 | 0 / 0 | 0 / 0 | 83.3 / 85.7 |
| generic-transport | 6 | 66.7 / 66.7 | 100 / 100 | 83.3 / 83.3 | 83.3 / 83.3 | 83.3 / 83.3 | - / - |
| mindray-beneview | 7 | 100 / 100 | 100 / 100 | 0 / 0 | 0 / 0 | 0 / 0 | 100 / 100 |
| nihon-kohden | 6 | 100 / 100 | 100 / 100 | 16.7 / 16.7 | 16.7 / 16.7 | 16.7 / 16.7 | 100 / 100 |
| philips-intellivue | 7 | 85.7 / 85.7 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |

## Threshold sweep (confidence threshold per field; correct auto / silent guesses)

real:

| field | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 | current |
|---|---|---|---|---|---|---|---|---|---|
| hr | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 0/0 | 0.8 |
| spo2 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 0/0 | 0/0 | 0.82 |
| rr | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0.85 |
| pulse | 1/0 | 1/0 | 1/0 | 1/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0.85 |
| pvc | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 0.88 |
| temp | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0.85 |
| pressure | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 2/0 | 0.8 |
| map | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 1/0 | 0/0 | 0.85 |

perturbed-real:

| field | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 | current |
|---|---|---|---|---|---|---|---|---|---|
| hr | 13/0 | 13/0 | 13/0 | 13/0 | 13/0 | 12/0 | 10/0 | 6/0 | 0.8 |
| spo2 | 8/0 | 8/0 | 8/0 | 8/0 | 7/0 | 6/0 | 4/0 | 0/0 | 0.82 |
| rr | 6/0 | 6/0 | 6/0 | 6/0 | 6/0 | 6/0 | 4/0 | 2/0 | 0.85 |
| pulse | 7/0 | 7/0 | 7/0 | 7/0 | 6/0 | 0/0 | 0/0 | 0/0 | 0.85 |
| pvc | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0.88 |
| temp | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0.85 |
| pressure | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 18/0 | 14/0 | 0.8 |
| map | 10/0 | 10/0 | 10/0 | 10/0 | 10/0 | 10/0 | 9/0 | 0/0 | 0.85 |

synthetic:

| field | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 | current |
|---|---|---|---|---|---|---|---|---|---|
| hr | 36/0 | 36/0 | 36/0 | 35/0 | 35/0 | 34/0 | 29/0 | 9/0 | 0.8 |
| spo2 | 33/0 | 33/0 | 33/0 | 33/0 | 32/0 | 32/0 | 21/0 | 4/0 | 0.82 |
| rr | 28/0 | 28/0 | 28/0 | 28/0 | 27/0 | 24/0 | 22/0 | 4/0 | 0.85 |
| pulse | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 20/0 | 0.85 |
| pvc | 13/0 | 13/0 | 13/0 | 13/0 | 13/0 | 13/0 | 13/0 | 13/0 | 0.88 |
| temp | 10/0 | 10/0 | 10/0 | 10/0 | 10/0 | 10/0 | 6/0 | 0/0 | 0.85 |
| pressure | 32/0 | 32/0 | 32/0 | 32/0 | 32/0 | 32/0 | 32/0 | 32/0 | 0.8 |
| map | 16/0 | 16/0 | 16/0 | 16/0 | 16/0 | 16/0 | 15/0 | 0/0 | 0.85 |

## Every non-correct outcome

- **draeger-infinity-clean-21** [synthetic] (draeger-infinity, clean, quality OK): rr review (exp 16, sug 16: confidence 0.84 below 0.85)
- **draeger-infinity-high-acuity-23** [synthetic] (draeger-infinity, clean, quality DEGRADED): sbp review (exp 78, sug 78: reading touches the photo edge (may be truncated)); dbp review (exp 44, sug 44: reading touches the photo edge (may be truncated)); map review (exp 55, sug 55: reading touches the photo edge (may be truncated)); rr review (exp 34, sug 34: confidence 0.85 below 0.9); art review (exp {"sbp":78,"dbp":44,"map":55}, sug {"s":78,"d":44,"map":55}: reading touches the photo edge (may be truncated))
- **draeger-infinity-limit-vs-value-22** [synthetic] (draeger-infinity, clean, quality OK): sbp review (exp 108, sug 108: OCR repaired (split hundreds digit): "A0T 1 08/64" read as 108/64; OCR scales disagree ("A0T 1 08/64" vs "108/); dbp review (exp 64, sug 64: OCR repaired (split hundreds digit): "A0T 1 08/64" read as 108/64; OCR scales disagree ("A0T 1 08/64" vs "108/); map missed (exp 79: no (MM) read next to A0T 1 08/64; MAP is only ever a displayed value); art review (exp {"sbp":108,"dbp":64,"map":79}, sug {"s":108,"d":64,"map":null}: OCR repaired (split hundreds digit): "A0T 1 08/64" read as 108/64; OCR scales disagree ("A0T 1 08/64" vs "108/)
- **draeger-infinity-low-light-blur-25** [synthetic] (draeger-infinity, low-light+blur, quality OK): temp review (exp 37.5, sug 37.5: only 1 independent signal(s))
- **draeger-infinity-tilt-glare-24** [synthetic] (draeger-infinity, tilt+glare, quality OK): sbp review (exp 130, sug 130: pressure source (ART / NIBP) not identified); dbp review (exp 85, sug 85: pressure source (ART / NIBP) not identified); map review (exp 100, sug 100: pressure source (ART / NIBP) not identified); rr review (exp 18, sug 18: confidence 0.84 below 0.85); art missed (exp {"sbp":130,"dbp":85,"map":100})
- **ge-carescape-clean-11** [synthetic] (ge-carescape, clean, quality OK): sbp review (exp 118, sug 118: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); dbp review (exp 76, sug 76: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); map review (exp 90, sug 90: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); art review (exp {"sbp":118,"dbp":76,"map":90}, sug {"s":118,"d":76,"map":90}: OCR repaired (leading 1 read as T): "ART T18/76 (90)" read as 118/76)
- **ge-carescape-close-03** [synthetic] (ge-carescape, close-candidates, quality OK): sbp review (exp 119, sug 119: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); dbp review (exp 66, sug 66: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); map review (exp 84, sug 84: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); art review (exp {"sbp":119,"dbp":66,"map":84}, sug {"s":119,"d":66,"map":84}: OCR repaired (leading 1 read as T): "ART T19/66 (84)" read as 119/66)
- **ge-carescape-high-acuity-13** [synthetic] (ge-carescape, clean, quality OK): sbp review (exp 78, sug 78: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 44, sug 44: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 55, sug 55: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **ge-carescape-limit-vs-value-12** [synthetic] (ge-carescape, clean, quality OK): sbp review (exp 108, sug 108: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 64, sug 64: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 79, sug 79: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **ge-carescape-low-light-blur-15** [synthetic] (ge-carescape, low-light+blur, quality OK): sbp review (exp 122, sug 122: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; OCR scales disagree ("ARTT22/78 (93)" vs ); dbp review (exp 78, sug 78: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; OCR scales disagree ("ARTT22/78 (93)" vs ); map review (exp 93, sug 93: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; OCR scales disagree ("ARTT22/78 (93)" vs ); art missed (exp {"sbp":122,"dbp":78,"map":93}); nibp review (exp {"sbp":122,"dbp":78,"map":93}, sug {"s":122,"d":78,"map":93}: OCR repaired (leading 1 read as T): "ARTT22/78 (93)" read as 122/78; OCR scales disagree ("ARTT22/78 (93)" vs )
- **ge-carescape-partial-obscured-16** [synthetic] (ge-carescape, partial+label-obscured, quality OK): sbp review (exp 126, sug 126: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); dbp review (exp 80, sug 80: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); map review (exp 95, sug 95: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice; OC); pvc missed (exp 0: no readable candidate); art review (exp {"sbp":126,"dbp":80,"map":95}, sug {"s":126,"d":80,"map":95}: OCR repaired (leading 1 read as T): "ARTT26/80 (95)" read as 126/80)
- **ge-carescape-tilt-glare-14** [synthetic] (ge-carescape, tilt+glare, quality OK): hr review (exp 82, sug 82: confidence 0.74 below 0.8); spo2 review (exp 96, sug 96: confidence 0.79 below 0.82); sbp review (exp 130, sug 130: pressure source (ART / NIBP) not identified); dbp review (exp 85, sug 85: pressure source (ART / NIBP) not identified); map review (exp 100, sug 100: pressure source (ART / NIBP) not identified); rr review (exp 18, sug 18: confidence 0.83 below 0.85); art missed (exp {"sbp":130,"dbp":85,"map":100}); nibp missed (exp {"sbp":130,"dbp":85,"map":100})
- **generic-transport-partial-obscured-56** [synthetic] (generic-transport, partial+label-obscured, quality DEGRADED): hr review (exp 88, sug 88: value touches the photo edge (may be truncated))
- **generic-transport-tilt-glare-54** [synthetic] (generic-transport, tilt+glare, quality OK): hr review (exp 82, sug 82: two candidates too close (82 vs 96)); sbp review (exp 130, sug 130: pressure source (ART / NIBP) not identified; OCR repaired (split hundreds digit): "NBP1 30/85 (100)" read as 1); dbp review (exp 85, sug 85: pressure source (ART / NIBP) not identified; OCR repaired (split hundreds digit): "NBP1 30/85 (100)" read as 1); map review (exp 100, sug 100: pressure source (ART / NIBP) not identified; OCR repaired (split hundreds digit): "NBP1 30/85 (100)" read as 1); nibp missed (exp {"sbp":130,"dbp":85,"map":100})
- **mindray-beneview-clean-31** [synthetic] (mindray-beneview, clean, quality OK): sbp review (exp 118, sug 118: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 76, sug 76: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 90, sug 90: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-close-02** [synthetic] (mindray-beneview, close-candidates, quality OK): sbp review (exp 119, sug 119: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 66, sug 66: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 84, sug 84: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-high-acuity-33** [synthetic] (mindray-beneview, clean, quality OK): sbp review (exp 78, sug 78: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 44, sug 44: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 55, sug 55: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-limit-vs-value-32** [synthetic] (mindray-beneview, clean, quality OK): sbp review (exp 108, sug 108: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 64, sug 64: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 79, sug 79: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-low-light-blur-35** [synthetic] (mindray-beneview, low-light+blur, quality OK): sbp review (exp 122, sug 122: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 78, sug 78: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 93, sug 93: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-partial-obscured-36** [synthetic] (mindray-beneview, partial+label-obscured, quality OK): sbp review (exp 126, sug 126: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 80, sug 80: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 95, sug 95: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **mindray-beneview-tilt-glare-34** [synthetic] (mindray-beneview, tilt+glare, quality OK): sbp review (exp 130, sug 130: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); dbp review (exp 85, sug 85: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice); map review (exp 100, sug 100: ART and NIBP are both displayed: use the ART / NIBP fields, the primary pressure is the clinician's choice)
- **nihon-kohden-clean-41** [synthetic] (nihon-kohden, clean, quality OK): sbp review (exp 118, sug 118: pressure source (ART / NIBP) not identified); dbp review (exp 76, sug 76: pressure source (ART / NIBP) not identified); map review (exp 90, sug 90: pressure source (ART / NIBP) not identified); nibp missed (exp {"sbp":118,"dbp":76,"map":90})
- **nihon-kohden-limit-vs-value-42** [synthetic] (nihon-kohden, clean, quality OK): sbp review (exp 108, sug 108: pressure source (ART / NIBP) not identified); dbp review (exp 64, sug 64: pressure source (ART / NIBP) not identified); map review (exp 79, sug 79: pressure source (ART / NIBP) not identified); nibp missed (exp {"sbp":108,"dbp":64,"map":79})
- **nihon-kohden-low-light-blur-45** [synthetic] (nihon-kohden, low-light+blur, quality OK): sbp review (exp 122, sug 122: pressure source (ART / NIBP) not identified); dbp review (exp 78, sug 78: pressure source (ART / NIBP) not identified); map review (exp 93, sug 93: pressure source (ART / NIBP) not identified); temp review (exp 37.5, sug 37.5: only 1 independent signal(s)); nibp missed (exp {"sbp":122,"dbp":78,"map":93})
- **nihon-kohden-partial-obscured-46** [synthetic] (nihon-kohden, partial+label-obscured, quality OK): sbp review (exp 126, sug 126: pressure source (ART / NIBP) not identified); dbp review (exp 80, sug 80: pressure source (ART / NIBP) not identified); map review (exp 95, sug 95: pressure source (ART / NIBP) not identified); nibp missed (exp {"sbp":126,"dbp":80,"map":95})
- **nihon-kohden-tilt-glare-44** [synthetic] (nihon-kohden, tilt+glare, quality OK): sbp review (exp 130, sug 130: another pressure on screen could not be read: "NIBP"; pressure source (ART / NIBP) not identified); dbp review (exp 85, sug 85: another pressure on screen could not be read: "NIBP"; pressure source (ART / NIBP) not identified); map review (exp 100, sug 100: another pressure on screen could not be read: "NIBP"; pressure source (ART / NIBP) not identified); nibp missed (exp {"sbp":130,"dbp":85,"map":100})
- **philips-intellivue-clean-01** [synthetic] (philips-intellivue, clean, quality OK): pulse review (exp 72, sug 72: the value was not read identically by both OCR passes); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-intellivue-close-01** [synthetic] (philips-intellivue, close-candidates, quality OK): pulse review (exp 104, sug 104: the value was not read identically by both OCR passes); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-intellivue-high-acuity-03** [synthetic] (philips-intellivue, clean, quality OK): hr review (exp 138, sug 138: two candidates too close (138 vs 120)); pulse review (exp 136, sug 136: the value was not read identically by both OCR passes); pvc review (exp 4, sug 4: the value was not read identically by both OCR passes)
- **philips-intellivue-limit-vs-value-02** [synthetic] (philips-intellivue, clean, quality OK): pulse review (exp 90, sug 90: the value was not read identically by both OCR passes); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-intellivue-low-light-blur-05** [synthetic] (philips-intellivue, low-light+blur, quality OK): pulse review (exp 96, sug 96: the value was not read identically by both OCR passes); pvc review (exp 1, sug 1: the value was not read identically by both OCR passes)
- **philips-intellivue-partial-obscured-06** [synthetic] (philips-intellivue, partial+label-obscured, quality OK): pulse review (exp 88, sug 88: the value was not read identically by both OCR passes); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-intellivue-tilt-glare-04** [synthetic] (philips-intellivue, tilt+glare, quality OK): pulse missed (exp 82: no readable candidate); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-mp40-blur-r1** [perturbed-real] (philips-intellivue, perturbed+gaussianBlur, quality OK): spo2 review (exp 100, sug 100: label not read (slot and colour agree)); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified); dbp review (exp 66, sug 66: pressure source (ART / NIBP) not identified); map review (exp 98, sug 98: pressure source (ART / NIBP) not identified); rr review (exp 22, sug 22: label not read (slot and colour agree)); pulse missed (exp 105: no readable candidate); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-blur-r2_5** [perturbed-real] (philips-intellivue, perturbed+gaussianBlur, quality OK): hr review (exp 105, sug 100: label not read (slot only)); spo2 review (exp 100, sug 100: label not read (slot only)); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified); dbp review (exp 66, sug 66: pressure source (ART / NIBP) not identified); map missed (exp 98: no (MM) read next to 149/66; MAP is only ever a displayed value); rr missed (exp 22: no readable candidate); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-blur-r4** [perturbed-real] (philips-intellivue, perturbed+gaussianBlur, quality DEGRADED): hr review (exp 105, sug 100: two candidates too close (100 vs 105)); spo2 review (exp 100, sug 100: label not read (slot only)); sbp missed (exp 149: no SSS/DD box); dbp missed (exp 66: no SSS/DD box); map missed (exp 98: no pressure); rr missed (exp 22: no readable candidate); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-brightness-055** [perturbed-real] (philips-intellivue, perturbed+brightness, quality OK): rr review (exp 22, sug 30: the value was not read identically by both OCR passes); pulse review (exp 105, sug 105: confidence 0.81 below 0.85); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-mp40-brightness-160** [perturbed-real] (philips-intellivue, perturbed+brightness, quality OK): rr review (exp 22, sug 30: the value was not read identically by both OCR passes); pulse review (exp 105, sug 105: confidence 0.81 below 0.85); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-mp40-contrast-055** [perturbed-real] (philips-intellivue, perturbed+contrast, quality OK): rr review (exp 22, sug 22: two candidates too close (22 vs 30)); pulse review (exp 105, sug 105: confidence 0.80 below 0.85); pvc missed (exp 0: no readable candidate)
- **philips-mp40-contrast-160** [perturbed-real] (philips-intellivue, perturbed+contrast, quality OK): sbp missed (exp 149: no SSS/DD box); dbp missed (exp 66: no SSS/DD box); map missed (exp 98: no pressure); rr review (exp 22, sug 22: two candidates too close (22 vs 30)); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-crop-bottom-rr** [perturbed-real] (philips-intellivue, perturbed+crop, quality OK): pulse review (exp 105, sug 105: confidence 0.35 below 0.85); pvc missed (exp 0: no readable candidate)
- **philips-mp40-crop-right-truncates** [perturbed-real] (philips-intellivue, perturbed+crop, quality DEGRADED): spo2 review (exp 100, sug 100: label not read (slot only)); rr review (exp 22, sug 22: photo quality degraded and the value was not read identically by both OCR passes)
- **philips-mp40-glare-moderate** [perturbed-real] (philips-intellivue, perturbed+glare, quality OK): spo2 review (exp 100, sug 100: OCR scales disagree ("38 100" vs "100"); the value was not read identically by both OCR passes); rr review (exp 22, sug 22: two candidates too close (22 vs 30)); pulse review (exp 105, sug 105: confidence 0.36 below 0.85); pvc review (exp 0, sug 0.5: the value was not read identically by both OCR passes)
- **philips-mp40-glare-severe-hr** [perturbed-real] (philips-intellivue, perturbed+glare, quality OK): spo2 review (exp 100, sug 100: label not read (slot only)); pulse review (exp 105, sug 105: confidence 0.78 below 0.85); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-mp40-jpeg-q10** [perturbed-real] (philips-intellivue, perturbed+jpeg, quality OK): spo2 review (exp 100, sug 100: label not read (slot only)); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified); dbp review (exp 66, sug 66: pressure source (ART / NIBP) not identified); map review (exp 98, sug 98: pressure source (ART / NIBP) not identified); rr missed (exp 22: no readable candidate); pulse review (exp 105, sug 105: confidence 0.34 below 0.85); pvc review (exp 0, sug 5: the value was not read identically by both OCR passes); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-jpeg-q30** [perturbed-real] (philips-intellivue, perturbed+jpeg, quality OK): rr review (exp 22, sug 22: the value was not read identically by both OCR passes); pulse review (exp 105, sug 105: confidence 0.36 below 0.85); pvc review (exp 0, sug 0: two candidates too close (0 vs 88, same size and row))
- **philips-mp40-perspective-mild** [perturbed-real] (philips-intellivue, perturbed+perspective, quality OK): spo2 review (exp 100, sug 100: label not read (slot and colour agree)); pulse review (exp 105, sug 105: confidence 0.80 below 0.85); pvc missed (exp 0: no readable candidate)
- **philips-mp40-perspective-strong** [perturbed-real] (philips-intellivue, perturbed+perspective, quality DEGRADED): hr review (exp 105, sug 105: two candidates too close (105 vs 120)); spo2 missed (exp 100: no readable candidate); pulse review (exp 105, sug 105: photo quality degraded and the value was not read identically by both OCR passes); pvc review (exp 0, sug 0.5: photo quality degraded and the value was not read identically by both OCR passes)
- **philips-mp40-resize-035** [perturbed-real] (philips-intellivue, perturbed+resize, quality OK): hr missed (exp 105: no readable candidate); spo2 missed (exp 100: no readable candidate); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified; OCR scales disagree ("149/66" vs "149/66 (98)"); the value was no); dbp review (exp 66, sug 66: pressure source (ART / NIBP) not identified; OCR scales disagree ("149/66" vs "149/66 (98)"); the value was no); map missed (exp 98: no (MM) read next to 149/66; MAP is only ever a displayed value); rr review (exp 22, sug 8: OCR scales disagree ("-105 . 08" vs "105 0.0"); the value was not read identically by both OCR passes); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-resize-050** [perturbed-real] (philips-intellivue, perturbed+resize, quality OK): hr review (exp 105, sug 100: label not read (slot only)); spo2 review (exp 100, sug 100: label not read (slot only)); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified; OCR scales disagree ("149/86" vs "149/66"); the value was not rea); dbp review (exp 66, sug 86: pressure source (ART / NIBP) not identified; OCR scales disagree ("149/86" vs "149/66"); the value was not rea); map review (exp 98, sug 98: pressure source (ART / NIBP) not identified; OCR scales disagree ("149/86" vs "149/66"); the value was not rea); pulse review (exp 105, sug 105: the value was not read identically by both OCR passes); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-rotate-05** [perturbed-real] (philips-intellivue, perturbed+rotate, quality OK): spo2 review (exp 100, sug 100: confidence 0.78 below 0.82); sbp missed (exp 149: no SSS/DD box); dbp missed (exp 66: no SSS/DD box); map missed (exp 98: no pressure); pulse review (exp 105, sug 105: confidence 0.82 below 0.85); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-rotate-12** [perturbed-real] (philips-intellivue, perturbed+rotate, quality OK): hr missed (exp 105: no readable candidate); spo2 missed (exp 100: no readable candidate); sbp review (exp 149, sug 149: the value was not read identically by both OCR passes); dbp review (exp 66, sug 86: the value was not read identically by both OCR passes); map missed (exp 98: no (MM) read next to NNAЛЛAANN 149/86; MAP is only ever a displayed value); rr missed (exp 22: no readable candidate); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art review (exp {"sbp":149,"dbp":66,"map":98}, sug {"s":149,"d":86,"map":null}: the value was not read identically by both OCR passes)
- **philips-mp40-rotate-25** [perturbed-real] (philips-intellivue, perturbed+rotate, quality OK): hr review (exp 105, sug 105: the value was not read identically by both OCR passes); spo2 missed (exp 100: no readable candidate); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); dbp review (exp 66, sug 66: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); map missed (exp 98: no (MM) read next to 149/66; MAP is only ever a displayed value); rr missed (exp 22: no readable candidate); pulse missed (exp 105: no readable candidate); pvc missed (exp 0: no readable candidate); art missed (exp {"sbp":149,"dbp":66,"map":98})
- **philips-mp40-owner-1800px** [perturbed-real] (philips-intellivue, real-photo+upscaled-2x+reflections, quality OK): pulse review (exp 105, sug 105: confidence 0.82 below 0.85); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes)
- **philips-mp40-owner-900px** [real] (philips-intellivue, real-photo+low-resolution+reflections, quality OK): rr review (exp 22, sug 22: label not read (slot and colour agree)); pulse review (exp 105, sug 105: confidence 0.78 below 0.85)
