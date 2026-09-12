# MaiKnowledge LLP business cards

Print-ready cards, 3.5 x 2 in, front and back, for three roles: Dr Manoj Kumar K
(Founder), Diwakar Kumar K (Co-Founder), and a generic Company card with no named
person. All three share one back design. `MaiKnowledge-Business-Card.pdf` is the
deliverable: exact page size, vector text (Inter and Dancing Script embedded), logos placed as the
supplied raster originals at native resolution, pure white ground, no gradients.

| File | What it is |
|---|---|
| `MaiKnowledge-Business-Card.pdf` | Dr Manoj Kumar K only: page 1 front, page 2 back. |
| `MaiKnowledge-Business-Cards-All.pdf` | All three, 6 pages: Manoj front/back, Diwakar front/back, Company front/back. Send this to the printer. |
| `proof-front-300dpi.png`, `proof-back-300dpi.png` | 300 DPI rasters of Manoj's PDF pages, for review only. |
| `proof-manoj-*.png`, `proof-diwakar-*.png`, `proof-company-*.png` | 300 DPI rasters of each card's two pages. |
| `artboards/` | All six card faces as design-canvas artboards (96 px/in, 336 x 192) plus `canvas.json`: `Main.dc.html`/`Back.dc.html` (Manoj), `MainDiwakar.dc.html`/`BackDiwakar.dc.html`, `MainCompany.dc.html`/`BackCompany.dc.html`. |
| `img/` | Logos as placed: MaiK mark and infinity crop (from `maik-wordmark-color.png`), WardSynQ and StewardMD (supplied files, backdrop knocked out by `prepare-logos.py`), the supplied QR. `*-white.png` / `*-dark.png` are the same shapes with the fill changed to white (and mint for "MD") for the dark back; `qr-icon.png` adds a small centre infinity. |
| `src/` | The supplied WardSynQ, StewardMD and QR files as received. |
| `fonts/` | Inter 400/500/600, Outfit 600 and Dancing Script 400/600 (Google Fonts, OFL), embedded into the PDF. The wordmark uses Outfit 600 for "aiK" and Dancing Script 400 for "nowledge". |
| `build-print.mjs` | Rebuilds Manoj's PDF and proofs from `artboards/` with Playwright Chromium: `node build-print.mjs`. |
| `build-print-all.mjs` | Rebuilds the combined 6-page PDF and all proofs: `node build-print-all.mjs`. |

Colours: primary `#0B5B4A`, black `#111111`, cursive blue `#1D5FB4`; back ground `#0A2F26` with
white and mint `#5FD3B3` type, flat fills only. The QR (with its centre infinity) decodes to
`https://maiknowledge.com/` from 300, 200 and 150 DPI rasters of the PDF (OpenCV check in the
build session).

**Wordmark construction (owner's call, 12 Sep 2026):** the infinity mark (cropped from
`maik-wordmark-color.png`) is the "M"; "aiK" is typeset in Outfit 600 (single-storey a, geometric,
echoing the original); "nowledge" is Dancing Script 400 in blue. All three sit on one measured
baseline: the mark's ink bottom is 3.3% of its height below it (as in the original), the K cap
height is the mark height / 1.144 (the original ratio), and the script ascenders meet the K cap.
The original blue cursive "nowledge" artwork was never supplied; if it turns up, swap the span in
the three `Main*.dc.html` files and rebuild.

No bleed is included (the brief asked for exact 3.5 x 2 in). Ask the printer whether they want
0.125 in bleed added; the white ground makes that a trivial page-size change in `build-print.mjs`.


## The three cards

- **Dr Manoj Kumar K** — Founder & Managing Partner. Two phone numbers.
- **Diwakar Kumar K** — Co-Founder & Managing Partner. `+91 94944 84157` and `+91 86392 63096`, same email and website.
- **Company** — no named person. The name/title block is replaced with a one-line
  positioning statement ("Healthcare AI, built with clinicians.") and the phone rows
  are dropped, leaving only the general email and website. Ask before using this card
  if a receptionist or general-inquiries phone number should be added instead.
