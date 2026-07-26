# Review Decision Tree
_Fast "what changed → what runs → what blocks." Follow top-down; stop a chain if a mandatory reviewer returns a Critical._

```
                          ┌─────────────────────────┐
                          │   A change is proposed   │
                          └────────────┬─────────────┘
                                       ▼
                     What surface(s) does the diff touch?
   ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
   ▼               ▼               ▼               ▼               ▼               ▼
Clinical logic   AI / model     Auth/Data/Net   Native / UI     Perf / bundle    Docs
/data/calc/ECG   /prompt/OCR    /secrets/PHI    /Swift/Watch    /assets/query    only
   │               │               │               │               │               │
   ▼               ▼               ▼               ▼               ▼               ▼
 R1 (MUST)       R2 (MUST)       R3 (MUST)        R4              R6            advisory
   │               │               │               │               │           (R1 cites,
 golden          injection?      secret/PHI?     crash/race?    25MiB/OOM?      R7 currency)
 changed?        PHI to prov?    auth bypass?      │               │
   │               │               │               ▼               ▼
   ├─ yes+unintended → CRITICAL: BLOCK             R5 (if UI)     Important/
   ├─ false-negative → CRITICAL: BLOCK              │              Critical(25MiB)
   └─ ok → Important/Advisory                     a11y/UX
                    │               │             critical?
             CRITICAL if:      CRITICAL if:         │
             - actionable      - secret shipped   ├─ value not readable → BLOCK
               injection       - PHI in log/URL    └─ else Important/Advisory
             - PHI leak        - plaintext clin.
             - garbage→        - auth bypass
               confident
                    │               │
                    ▼               ▼
              (chain to R3 if PHI) (chain to R7 at ship)

                          ┌─────────────────────────┐
                          │   Ready to ship/deploy?  │
                          └────────────┬─────────────┘
                                       ▼
                     R1 clear? AND R3 clear?  ── no ──▶ NO-GO (fix upstream)
                                       │ yes
                                       ▼
                                 R7 Release gate
                     ┌─────────────┼──────────────┐
                     ▼             ▼              ▼
                golden run?   privacy manifest  25MiB / debug
                secrets out?  + form match?     flags / logging
                     │             │              │
                 all pass ─────────┴──────────────┴──▶ GO
                 any fail ───────────────────────────▶ GO-WITH-FIXES / NO-GO
```

## One-line rules
- Clinical logic changed → **R1 always, blocking.**
- AI touched → **R2 always.** Data/auth/net/secret touched → **R3 always.**
- Native/UI → R4 (+R5 if UI). Hot-path/asset → R6.
- Shipping → **R7 gate, and R1+R3 must be clear first.**
- Never run all 7; a Critical from any mandatory reviewer (R1/R2/R3) or a deploy-breaker (R6 25 MiB, R4 crash, R5 unreadable value) blocks.
