# MaiKnowledge LLP business card

Print-ready founder card, 3.5 x 2 in, front and back. `MaiKnowledge-Business-Card.pdf` is the
deliverable: exact page size, vector text (Inter and Dancing Script embedded), logos placed as the
supplied raster originals at native resolution, pure white ground, no gradients.

| File | What it is |
|---|---|
| `MaiKnowledge-Business-Card.pdf` | Page 1 front, page 2 back. Send this to the printer. |
| `proof-front-300dpi.png`, `proof-back-300dpi.png` | 300 DPI rasters of the PDF pages, for review only. |
| `artboards/` | The two card faces as design-canvas artboards (96 px/in, 336 x 192) plus `canvas.json`. |
| `img/` | Logos as placed: MaiK mark and infinity crop (from `maik-wordmark-color.png`), WardSynQ and StewardMD (supplied files, backdrop knocked out by `prepare-logos.py`), the supplied QR. |
| `src/` | The supplied WardSynQ, StewardMD and QR files as received. |
| `fonts/` | Inter 400/500/600 and Dancing Script 600 (Google Fonts, OFL), embedded into the PDF. |
| `build-print.mjs` | Rebuilds the PDF and proofs from `artboards/` with Playwright Chromium: `node build-print.mjs`. |

Colours: primary `#0B5B4A`, black `#111111`, cursive blue `#1D5FB4`. The QR decodes to
`https://maiknowledge.com/` from the 300 DPI and 150 DPI rasters of the PDF (OpenCV check in
the build session); it carries no centre icon, deliberately.

**Open item:** the original blue handwritten "nowledge" artwork was not available (only the MaiK
mark exists in the repo). It is set in Dancing Script as a stand-in. Replace the `<span>` in
`artboards/Main.dc.html` with the original file once supplied, then re-run `build-print.mjs`.

No bleed is included (the brief asked for exact 3.5 x 2 in). Ask the printer whether they want
0.125 in bleed added; the white ground makes that a trivial page-size change in `build-print.mjs`.
