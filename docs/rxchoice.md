# RxChoice™

## Prescription modes

Every prescription created through `SMD_RX` now exposes two modes:

- **Simple Prescription** — the existing StewardMD prescription workflow. No cost-choice UI is shown unless the doctor opens RxChoice.
- **RxChoice™** — a cost-choice layer for the medicines already written in the prescription.

## RxChoice columns

Each medicine is presented as four choices:

1. **Generic — Lowest Cost**: lowest verified non-discontinued priced product returned for the resolved composition.
2. **Balanced ⭐ — Best Value**: a transparent MVP heuristic using price and manufacturer diversity; this is a value label, not a claim of clinical superiority.
3. **Premium — Top Branded**: highest-priced verified non-discontinued product returned for the resolved composition.
4. **Doctor Prescribed**: the brand currently present in the prescription, preserved as the reference choice.

## Safety contract

RxChoice never changes the prescribed generic, dose, route, frequency or duration. It only writes a selected brand into the existing brand field after the doctor explicitly taps **Use this**. If the composition cannot be verified from `MEDAPI`, alternatives are not shown.

AI is not used to decide therapeutic equivalence. Composition lookup and product eligibility are deterministic database operations.

## Data source

Current product/price data is obtained through the existing `MEDAPI.searchCompositions()` + `MEDAPI.composition()` path already used by the prescription brand picker. Discontinued products and products without a numeric MRP are excluded from the four-way ranking.

## Current MVP limitation

The Balanced ranking is intentionally a deterministic placeholder: it prefers manufacturer diversity and selects a middle price position. It must not be described as proof that one manufacturer is clinically better than another. A future verified manufacturer/quality scoring source can replace this ranking without changing the RxChoice UI contract.

## Implementation

The browser prescription builder dynamically imports `rx-build.mjs`. The RxChoice integration is installed there so existing prescription entry points — including SknX drafts and the Hospital prescription tile — receive the same two-mode surface without duplicating prescription logic.
