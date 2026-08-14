# R1 Clinical-Safety Review — immunotherapy_toxicity.md

VERDICT: APPROVE

goldens changed: no (intended: n/a — reference-content narrative, no engine/rule change)

## 1. SAFETY — pass
No unsafe, misleading, or absolute claims. Key safety-positive elements are present and correct:
- Colitis: explicitly says exclude infectious causes of diarrhoea first (line 20). Correct.
- Endocrinopathy: warns unrecognised adrenal insufficiency / hypophysitis can precipitate a
  life-threatening adrenal crisis, and that established endocrine deficits need long-term replacement
  and are NOT reversed by holding therapy (line 22). Correct and safety-important.
- Myocarditis: flagged as a high-mortality red flag needing urgent corticosteroids + cardiology, and
  as a same-day escalation (lines 24, 44). Appropriately urgent; it understates rather than overstates
  the danger.
- Steroid-refractory events: correctly directs specialist-guided second-line immunosuppression
  rather than empiric steroid dose-escalation (line 46).
No definitive-diagnosis or must-do directive that oversteps decision-support.

## 2. GROUNDING — pass
Adversarial-verify verdict (.verdict.md) returned CLEAN and confirmed each DeVita-attributed claim
line-by-line against the 12th-ed source (mechanism/spectrum, EORTC 18071 41% vs single-agent 10-15%,
steroids/TNF-alpha reversal of colitis/hypophysitis, hold-therapy + corticosteroid principle,
pneumonitis case series, anti-PD-1 rechallenge, oligoprogression local therapy, pseudoprogression/irRC).
Non-DeVita claims are each explicitly inline-tagged "(general oncology standard, not from DeVita's
section on this disease)" or attributed to "the reference note" — no claim is mis-attributed to DeVita.
No fabricated or outdated regimen. No adversarial-flagged issue remains (verdict had none to carry).

Note on edition consistency: narrative source line and verdict both cite 12th ed. — consistent.

## 3. DOSE-FREE — pass
Confirmed no numeric dose leaked. Only numerals are toxicity grades (1-5) and epidemiologic
percentages (41%, ~33%, 10-15%). No mg / mg/kg / mg/m2 / AUC / numbered administration schedule.
Drug names appear without doses (corticosteroids, infliximab, vedolizumab, mycophenolate mofetil,
levothyroxine) — correct; doses belong in structured templates.

## 4. SCOPE — pass
Consistently hedged ("depending on the organ and reversibility", "in carefully selected patients",
"individualised to severity and reversibility", refer-to-specialist framing). Reads as decision-support,
not a directive.

## Advisory (non-blocking)
- Rechallenge section (line 28) frames reintroduction generically around "severity and reversibility"
  but does not name that certain toxicities (notably myocarditis, and severe neurologic irAEs) are
  generally NOT rechallenged. The existing hedge technically covers it, but a one-clause carve-out
  ("with permanent discontinuation the norm after myocarditis or severe neurologic irAE") would
  sharpen the safety signal and is consistent with DeVita Ch. 94. Optional.
- Mycophenolate mofetil for steroid-refractory hepatitis is attributed to "the reference note" and is
  standard ASCO/SITC practice but was not verifiable in the supplied DeVita text — correctly NOT
  claimed as DeVita. Acceptable as labelled; leave as general-standard.

APPROVE — clinically safe, grounded with no DeVita mis-attribution, dose-free, appropriately scoped.
