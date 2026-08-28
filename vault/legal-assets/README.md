# Legal assets — MAIKNOWLEDGE LLP

Git-tracked, **404's from the public web** (verified live: `stewardmd.in/vault/*` returns 404,
same as every other file in `vault/` — see `vault/Home.md`). Not referenced by
`scripts/build-www.sh`, so nothing here ever ships in `www/`.

## Files

| File | What it is | Source |
|---|---|---|
| `signature-manoj-kurmana.png` | Dr. Kurmana Manoj Kumar's signature, transparent-ish crop, 309×159 | Extracted from the signed Vi/DLT "Declaration of the Authorized Person" letter, dated 20 Aug 2026 |
| `llp-seal-maiknowledge.png` | MAIKNOWLEDGE LLP round seal ("MAIKNOWLEDGE LLP · LLPIN: ADA-6560 · VISAKHAPATNAM"), 229×225 | Same source document |

## Entity facts (safe to reuse in filings)

| Field | Value |
|---|---|
| Registered name | MAIKNOWLEDGE LLP |
| LLPIN | ADA-6560 |
| PAN | ACIFM2328K |
| Registered office | C/O Kurmana Nageswara Rao, Eden Gardens Sector-5, M.V.P. Colony, Visakhapatnam - 530017, Andhra Pradesh, India |
| Designated Partner | Dr. Kurmana Manoj Kumar |
| Contact number | 8897298117 |
| Email | drmanojkurmana@gmail.com |
| Vi/Vodafone Idea PE UEID | 1101720950000098192 |

Two addresses appear across the source documents: **530017** (this authorization letter) vs
**530016** (the Vi Principal Entity certificate and the earlier header-justification PDF). Confirm
the correct PIN before reusing it verbatim on a new filing — don't assume either is authoritative.

## Deliberately NOT stored here, anywhere in this repo, or in any AI memory

**Aadhaar number and Aadhaar card scans (front/back).** They were in the source PDF as an
annexure. Aadhaar is government-issued biometric-linked ID; storing it beyond the immediate,
consented purpose it was collected for is not something to do casually, committed to a git
repository is not that purpose, and no assistant should hold a persistent copy "forever" merely
because it was asked to. If a future filing needs the Aadhaar copy again, re-supply it for that
one use.

## Using these in a new document

Signature block pattern used in `MaiKnowledge-LLP-Brand-Justification-STEWARDMD.docx` /
`brand-declaration.html`:

```
For MAIKNOWLEDGE LLP
[signature-manoj-kurmana.png]
Dr. Kurmana Manoj Kumar
Designated Partner
[llp-seal-maiknowledge.png]
```
