"""KardiQ X server-side ST-elevation STEMI layer (modular).

  extract.py  -> image -> per-lead calibrated signals + an EXTRACTION-QUALITY score
  rule.py     -> signals -> per-lead ST deviation -> contiguous-territory STEMI criteria
  detector.py -> orchestrator: extract -> QUALITY GATE -> run rule only if quality>threshold,
                 else ABSTAIN (no STEMI result). A poor extraction can NEVER create a STEMI.

Designed to run ALONGSIDE the CNN in main.py: when the rule fires a confident STEMI, it elevates
STEMI to the verdict (the CNN cannot veto it); otherwise the CNN result stands unchanged.
Territories are data-driven (rule.TERRITORIES) so posterior/inferior/lateral/reciprocal extend cleanly.
"""
from .detector import assess_stemi, STEMIResult   # noqa: F401
