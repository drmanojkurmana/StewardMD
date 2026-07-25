"""Orchestrator + QUALITY GATE. This is the safety boundary (requirements 3-5):
extract -> if quality below threshold (or too few leads), ABSTAIN and return no STEMI result;
otherwise run the ST rule. A poor extraction can never produce a STEMI.
"""
from dataclasses import dataclass, field
from typing import Optional, List
from . import extract as _ex
from . import rule as _rl

# Extraction-quality below this => ABSTAIN. Tuned on the benchmark to keep the false-STEMI rate ~0
# (messy phone photos cluster at q<=0.65; clean full-lead captures at q>=0.8).
QUALITY_THRESHOLD = 0.70
MIN_LEADS = 6


@dataclass
class STEMIResult:
    abstained: bool
    quality: float
    positive: bool = False
    territory: Optional[str] = None
    leads: List[str] = field(default_factory=list)
    values: List[float] = field(default_factory=list)
    reciprocal: bool = False
    score: float = 0.0
    layout: str = ""
    components: dict = field(default_factory=dict)

    def as_dict(self):
        return dict(abstained=self.abstained, quality=self.quality, positive=self.positive,
                    territory=self.territory, leads=self.leads, values=self.values,
                    reciprocal=self.reciprocal, score=round(self.score, 2), layout=self.layout,
                    components=self.components)


def assess_stemi(path_or_img, quality_threshold: float = QUALITY_THRESHOLD) -> STEMIResult:
    try:
        ex = _ex.extract(path_or_img)
    except Exception:
        return STEMIResult(abstained=True, quality=0.0)
    q = ex["quality"]
    if q < quality_threshold or len(ex["leads"]) < MIN_LEADS:
        # ABSTAIN — do not even run the rule; the CNN result will stand.
        return STEMIResult(abstained=True, quality=q, layout=ex["layout"], components=ex["components"])
    try:
        st = _rl.measure_st(ex["leads"], ex["fs"])
        v = _rl.stemi_verdict(st)
    except Exception:
        return STEMIResult(abstained=True, quality=q, layout=ex["layout"], components=ex["components"])
    return STEMIResult(abstained=False, quality=q, positive=v["positive"], territory=v["territory"],
                       leads=v["leads"], values=v["values"], reciprocal=v["reciprocal"],
                       score=v["score"], layout=ex["layout"], components=ex["components"])
