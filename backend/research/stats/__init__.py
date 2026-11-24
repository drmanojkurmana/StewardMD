"""ResearchMD Phase 5D.2 / 5D.3 statistics package (canonical for these models).

Regression (OLS, logistic), survival (Kaplan-Meier, log-rank, Cox PH with
Efron ties and a Schoenfeld-residual PH test) and diagnostic accuracy
(per-study sensitivity/specificity, Reitsma bivariate random-effects model
with SROC curves). Plan section 2: the Python worker is canonical for these
models; R parity runs in CI (scripts/research-parity-5d.R).

IPD rule (plan 5C.3, integrity rule 10): every public model function refuses
to run unless its input carries a compliance flag
{"ipdApproved": True, "evidenceId": "<non-empty string>"} naming the IRB /
consent evidence on file. Patient-level rows NEVER reach an LLM: there is no
LLM call, no network client and no gateway import anywhere in this package.
Rows are read from the frozen dataset snapshot inside the worker process and
only aggregate statistics (plus a data hash, never the rows) leave it, in
result.json. Deterministic code only (integrity rule 5).
"""
from ._common import IpdGateError, __version__, require_ipd_approval
from .regression import linear_regression, logistic_regression
from .survival import cox_ph, kaplan_meier, log_rank
from .diagnostic import per_study_accuracy, reitsma

__all__ = [
    "IpdGateError",
    "require_ipd_approval",
    "linear_regression",
    "logistic_regression",
    "kaplan_meier",
    "log_rank",
    "cox_ph",
    "per_study_accuracy",
    "reitsma",
    "__version__",
]