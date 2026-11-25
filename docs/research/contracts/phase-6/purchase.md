# ResearchMD Phase 6: credit purchase + institution invoicing (6.1), `_purchase.js`

D-4 (decided 2026-11-23): reuse the MaiK wallet plus institution invoicing.
NO new payment provider. Research draws from the MaiK wallet balance
(`_credits.js` Phase 3 lifecycle: reserve/settle on the ledger, wallet debited
once at settle). The client never writes balances.

## Reuse mechanism

`_purchase.js` lazily imports the EXISTING MaiK purchase/payment route
(`functions/api/billing/[[path]].js`) and forwards the request to its
`onRequest` with the caller's Authorization header intact:
- web/off-Play checkout -> `POST /api/billing/razorpay/order` with `{pack}`;
- native IAP -> `POST /api/billing/iap/verify` with
  `{platform, productId, purchaseToken}`.
Fulfilment stays on the existing money path: the Razorpay webhook / store
verification calls `fulfilPurchase(env, uid, "tokens:<pack>", ...)`, which
re-reads the pack from the server price table and calls `addTokens` on the
MaiK wallet. A tampered client note cannot mint tokens. The research route
returns the billing response verbatim (status + body).

## Routes (Firebase claims on every route)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/purchase/packs` | read-only server pack table (`plans(env).tokens`), `usdInrRate`, and the note that research spend draws from the MaiK wallet |
| POST | `/v1/purchase/order` | `{pack}`; pack must exist in the server table (400 otherwise); forwards to the billing Razorpay order route; billing's 501 (unconfigured) passes through |
| POST | `/v1/purchase/iap-verify` | `{platform, productId, purchaseToken}`; productId must match `in.stewardmd.tokens.<pack>` (400 otherwise: research sells only token packs); forwards to billing IAP verify |
| POST | `/v1/institutions/{id}/credits` | adminAuth; `{amountMicroUsd}` positive integer <= 1e12; reuses `grantInstitutionCredits` (ledger reason 'grant') |
| POST | `/v1/institutions/{id}/invoices` | adminAuth; `{amountMicroUsd, reference?, note?}`; 201 `{invoice}` status 'issued' |
| GET | `/v1/institutions/{id}/invoices` | adminAuth or institution admin |
| POST | `/v1/invoices/{id}/mark-paid` | adminAuth; grants the invoice amount ONCE (guarded `issued -> paid`); already paid -> 409 `invoice_already_paid`; returns `{invoice, balanceMicroUsd}` |

Members draw from the institution pool automatically (Phase 3
`pickInstitution`: pool first when it covers the quote, else the user wallet).
Institution credits raise the balance, never the spend caps (ceilings.md).
The Phase 3 token-only admin grant route stays available for ops; this module
adds the owner-claim surface and the invoice workflow on the same ledger.
