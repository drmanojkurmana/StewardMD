# ICU monitor extraction benchmark: parser v2.1.0, policy strict, 2-scale Vision

Generated 2026-09-14T12:38:41.776Z. Local extraction only (Apple Vision on macOS + icu-monitor-parser.js). **Gemini calls: 0** (not part of this benchmark; the app's on-tap fallback is counted separately). Network calls: 0.

**Groups are reported separately and never pooled.** `real` = photographs as taken. `perturbed-real` = images derived from a real photograph (robustness, not new monitors). `synthetic` = rendered layouts (layout handling, not photographic accuracy). Unit-test fixtures are not included.

## Acceptance

- Silent guesses (all groups): **0**
- AUTO fields without complete evidence: **0**

## Group: real (26 cases)

Silent guesses 0 · incomplete evidence 0 · RETAKE_PHOTO 1 · DEGRADED 2 · avg Vision full 199.9 ms + crop 122.6 ms · parse 2.9 ms · boxes 31.6 (+7.7 from crop) · colour used in 21

| field | visible | correct | wrong | review | missed | exact % | precision % | needs-review % | silent-guess % | safe % |
|---|---|---|---|---|---|---|---|---|---|---|
| hr | 13 | 5 | 0 | 9 | 1 | 38.5 | 100 | 56.3 | 0 | 50 |
| spo2 | 12 | 2 | 0 | 5 | 6 | 16.7 | 100 | 31.3 | 0 | 37.5 |
| sbp | 13 | 2 | 0 | 11 | 2 | 15.4 | 100 | 73.3 | 0 | 26.7 |
| dbp | 13 | 2 | 0 | 11 | 2 | 15.4 | 100 | 73.3 | 0 | 26.7 |
| map | 12 | 2 | 0 | 8 | 4 | 16.7 | 100 | 53.3 | 0 | 33.3 |
| rr | 18 | 4 | 0 | 15 | 4 | 22.2 | 100 | 60 | 0 | 44 |
| pulse | 8 | 0 | 0 | 8 | 4 | 0 | - | 50 | 0 | 50 |
| pvc | 5 | 2 | 0 | 2 | 1 | 40 | 100 | 40 | 0 | 40 |
| temp | 4 | 0 | 0 | 5 | 1 | 0 | - | 62.5 | 0 | 50 |
| etco2 | 1 | 0 | 0 | 1 | 0 | 0 | - | 100 | 0 | 0 |
| art | 4 | 2 | 0 | 2 | 2 | 50 | 100 | 33.3 | 0 | 66.7 |
| nibp | 12 | 0 | 0 | 1 | 11 | 0 | - | 6.3 | 0 | 25 |

## Every non-correct outcome

- **owner-2d6f5cea** [real] (philips-intellivue, real-photo+glare+invalid-values+big-clock, quality OK): sbp review (exp 96, sug 96: pressure source (ART / NIBP) not identified; OCR scales disagree ("96/47" vs "96147"); the value was not read ); dbp review (exp 47, sug 47: pressure source (ART / NIBP) not identified; OCR scales disagree ("96/47" vs "96147"); the value was not read ); map missed (exp 68: no (MM) read next to 96/47; MAP is only ever a displayed value); rr missed (exp 16: no readable candidate); art missed (exp {"sbp":96,"dbp":47,"map":68})
- **owner-3e5ad24b** [real] (contec, real-photo+seven-segment+occlusion+low-light+unreadable-labels, quality OK): spo2 review (exp 94, sug 94: label not read (slot only)); sbp missed (exp 171: no SSS/DD box); dbp missed (exp 107: no SSS/DD box); pulse missed (exp 118: no readable candidate); nibp missed (exp {"sbp":171,"dbp":107,"map":null})
- **owner-4e9c199c** [real] (philips-g40e, real-photo+trend-table+invalid-values+window-glare, quality OK): sbp review (exp 73, sug 73: pressure source (ART / NIBP) not identified); dbp review (exp 36, sug 36: pressure source (ART / NIBP) not identified); map review (exp 49, sug 49: pressure source (ART / NIBP) not identified); rr review (exp 12, sug 12: confidence 0.78 below 0.85); temp review (exp 23.3, sug 42: size/position inconsistent); nibp missed (exp {"sbp":73,"dbp":36,"map":49})
- **owner-576e6ab4** [real] (philips-g40e, real-photo+distance+glass-reflection+trend-table, quality OK): spo2 missed (exp 94: no readable candidate); sbp review (exp 112, sug 112: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); dbp review (exp 53, sug 53: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); map review (exp 81, sug 81: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); rr missed (exp 53: no readable candidate); pulse review (exp 53, sug 30: only 1 independent signal(s)); nibp missed (exp {"sbp":112,"dbp":53,"map":81})
- **owner-840e2f7e** [real] (meditec, product-photo+low-resolution+demo-watermark, quality RETAKE_PHOTO): hr review (exp 60: RETAKE_PHOTO: no monitor numerics were read); spo2 review (exp 98: RETAKE_PHOTO: no monitor numerics were read); sbp review (exp 120: RETAKE_PHOTO: no monitor numerics were read); dbp review (exp 80: RETAKE_PHOTO: no monitor numerics were read); map review (exp 90: RETAKE_PHOTO: no monitor numerics were read); rr review (exp 27: RETAKE_PHOTO: no monitor numerics were read); pulse review (exp 60: RETAKE_PHOTO: no monitor numerics were read); etco2 review (exp 38: RETAKE_PHOTO: no monitor numerics were read); nibp missed (exp {"sbp":120,"dbp":80,"map":90})
- **owner-97c20181** [real] (philips-g40e, real-photo+trend-table+invalid-values+window-glare, quality OK): sbp review (exp 73, sug 73: the value was not read identically by both OCR passes); dbp review (exp 36, sug 36: the value was not read identically by both OCR passes); map review (exp 49, sug 49: the value was not read identically by both OCR passes); rr review (exp 15, sug 15: the value was not read identically by both OCR passes); temp review (exp 22.3, sug 42: the value was not read identically by both OCR passes); nibp review (exp {"sbp":73,"dbp":36,"map":49}, sug {"s":73,"d":36,"map":49}: the value was not read identically by both OCR passes)
- **owner-9f8f815b** [real] (philips-g40e, real-photo+distance+low-resolution+glass-reflection+second-screen, quality OK): sbp review (exp 193, sug 193: pressure source (ART / NIBP) not identified); dbp review (exp 105, sug 105: pressure source (ART / NIBP) not identified); map missed (exp 142: no (MM) read next to 193/105; MAP is only ever a displayed value); nibp missed (exp {"sbp":193,"dbp":105,"map":142})
- **owner-aa0cb94d** [real] (ge-dash, published-photo+low-resolution+dual-pressure+alarm-list, quality OK): hr review (exp 84, sug 84: two candidates too close (84 vs 60)); spo2 review (exp 97, sug 60: two candidates too close (60 vs 84)); rr review (exp 24, sug 60: two candidates too close (60 vs 43)); pvc review (exp 0, sug 0: the value was not read identically by both OCR passes); temp review (exp 36.5, sug 40: the value was not read identically by both OCR passes); art missed (exp {"sbp":141,"dbp":43,"map":70}); nibp missed (exp {"sbp":113,"dbp":60,"map":81})
- **owner-b1b1f0fa** [real] (ventilator-other, real-photo+ventilator+set-vs-measured+glass-smudge, quality OK): rr review (exp 12, sug 12: confidence 0.85 below 0.85)
- **owner-b9278080** [real] (philips-intellivue, real-photo+distance+tiny-labels+big-clock+trend-table, quality OK): hr review (exp 103, sug 199: two candidates too close (199 vs 103)); spo2 missed (exp 99: no readable candidate); sbp review (exp 169, sug 169: pressure source (ART / NIBP) not identified); dbp review (exp 98, sug 98: pressure source (ART / NIBP) not identified); map review (exp 114, sug 114: pressure source (ART / NIBP) not identified); rr review (exp 17, sug 9: the value was not read identically by both OCR passes); pulse missed (exp 103: no readable candidate); nibp missed (exp {"sbp":169,"dbp":98,"map":114})
- **owner-c5ed1725** [real] (nihon-kohden, real-photo+plastic-wrap-glare+exif-rotated+distance, quality OK): hr review (exp 144, sug 144: the value was not read identically by both OCR passes); spo2 missed (exp 96: no readable candidate); sbp review (exp 145, sug 145: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); dbp review (exp 82, sug 82: pressure source (ART / NIBP) not identified; the value was not read identically by both OCR passes); map missed (exp 103: no (MM) read next to 145/ 82; MAP is only ever a displayed value); rr missed (exp 19: no readable candidate); pvc missed (exp 0: no readable candidate); temp missed (exp 21: no readable candidate); nibp missed (exp {"sbp":145,"dbp":82,"map":103})
- **owner-cc56af64** [real] (philips-intellivue, real-photo+glare+tilt, quality OK): hr review (exp 62, sug 96: label not read (slot only)); pulse review (exp 61, sug 61: confidence 0.79 below 0.85); pvc review (exp 0, sug 61: only 1 independent signal(s))
- **owner-fb589478** [real] (philips-intellivue, real-photo+low-resolution+reflections+duplicate-of-real-case, quality OK): pulse review (exp 105, sug 105: confidence 0.79 below 0.85)
- **owner-img_7635** [real] (philips-g40e, real-photo+motion-blur+tilt+distance, quality OK): spo2 missed (exp 88: no readable candidate); pulse missed (exp 131: no readable candidate)
- **owner-img_7945** [real] (ventilator-other, real-photo+ventilator+set-vs-measured+glare+possible-patient-name, quality OK): rr review (exp 35, sug 12: two candidates too close (12 vs 24))
- **owner-img_8377** [real] (ventilator-other, real-photo+ventilator+tilt+glare+set-vs-measured, quality OK): rr review (exp 18, sug 18: two candidates too close (18 vs 30))
- **owner-img_8379** [real] (ventilator-other, real-photo+ventilator+glare+set-vs-measured+cropped-edge, quality DEGRADED): rr review (exp 20, sug 20: only 1 independent signal(s))
- **owner-stock-123rf-ge-dash4000** [real] (ge-dash, stock-photo+watermark+tilt+big-clock, quality OK): hr review (exp 56, sug 56: label not read (slot only)); spo2 missed (exp 96: no readable candidate); sbp missed (exp 132: no SSS/DD box); dbp missed (exp 61: no SSS/DD box); map missed (exp 90: no pressure); rr review (exp 16, sug 16: two candidates too close (16 vs 23, same size and row)); nibp missed (exp {"sbp":132,"dbp":61,"map":90})
- **owner-stock-dreamstime** [real] (other, stock-photo+watermark+low-resolution+dual-pressure, quality OK): hr review (exp 65, sug 68: OCR scales disagree ("W/68 *" vs "89 / 41"); the value was not read identically by both OCR passes); spo2 review (exp 98, sug 68: OCR scales disagree ("W/68 *" vs "89 / 41"); the value was not read identically by both OCR passes); nibp missed (exp {"sbp":89,"dbp":41,"map":54})
- **owner-stock-vecteezy** [real] (nihon-kohden, stock-photo+watermark+colour-cast+distance, quality OK): hr missed (exp 110: no readable candidate); spo2 missed (exp 99: no readable candidate); sbp review (exp 149, sug 149: pressure source (ART / NIBP) not identified); dbp review (exp 97, sug 97: pressure source (ART / NIBP) not identified); map review (exp 112, sug 112: pressure source (ART / NIBP) not identified); rr missed (exp 22: no readable candidate); pulse missed (exp 109: no readable candidate); nibp missed (exp {"sbp":149,"dbp":97,"map":112})
