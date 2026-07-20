"""Provider interfaces + the production capability layer (Phase 6A).

Every pipeline stage is an abstract Provider. Concrete impls come in two flavours per stage:
  • None<Stage>  — raises StageNotImplemented (the default until models are wired).
  • Real<Stage>  — the production implementation (classical) or a model-integration seam.
The registry (registry.py) picks the impl by config, so adding a real model NEVER changes the routes,
the orchestrator, or the iOS frontend — you flip one env var and drop the model in.

Phase 6A gives EVERY provider a uniform production surface: version, declared dependencies (+ availability
check), config validation, an async health() self-report, and per-stage timeout/retry policy that the
orchestrator applies uniformly (see pipeline/orchestrator.run_stage). Providers stay in a safe
"not ready" state (`implemented=False` / deps missing / config invalid) until a validated model exists.

Signals are passed between stages as plain dicts (kept schema-light on purpose so model authors choose
their own tensors internally):
    traces  = {"leads": {"II": [...px...], ...}, "calibration": {"mmPerS": 25, "mmPerMv": 10}}
    signal  = {"leads": {"II": {"mv": [...], "fs": 500}, ...}, "duration_s": 10.0}
"""
from __future__ import annotations

import importlib.util
from abc import ABC, abstractmethod

from app.core.errors import StageNotImplemented, UpstreamUnavailable


def module_available(mod: str) -> bool:
    """True if an import module is importable, without importing it (safe for dotted names)."""
    try:
        return importlib.util.find_spec(mod) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


class Provider(ABC):
    name: str = "base"
    stage: str = "report"
    implemented: bool = False            # real impls flip True once the model actually works + is validated
    version: str = "0.0.0"
    requires: tuple[str, ...] = ()        # python modules this provider needs at runtime
    timeout_s: float = 30.0               # per-call budget the orchestrator enforces
    max_retries: int = 0                  # transient-error retries the orchestrator applies
    retry_on: tuple[type, ...] = (UpstreamUnavailable,)  # only retry transient upstream failures

    def _ni(self):
        raise StageNotImplemented(f"Stage '{self.stage}' provider '{self.name}' is not implemented yet.", stage=self.stage)

    def dependencies(self) -> list[dict]:
        return [{"module": m, "available": module_available(m)} for m in self.requires]

    def deps_ok(self) -> bool:
        return all(d["available"] for d in self.dependencies())

    def validate_config(self) -> list[str]:
        """Return a list of config problems (empty = OK). Override for checkpoints / keys."""
        return []

    async def health(self) -> dict:
        deps = self.dependencies()
        issues = self.validate_config()
        ready = bool(self.implemented and all(d["available"] for d in deps) and not issues)
        return {
            "stage": self.stage, "name": self.name, "version": self.version,
            "implemented": self.implemented, "ready": ready,
            "dependencies": deps, "configIssues": issues,
            "policy": {"timeoutS": self.timeout_s, "maxRetries": self.max_retries},
        }


class PreprocessingProvider(Provider):
    stage = "enhancement"
    @abstractmethod
    async def enhance(self, image: bytes) -> bytes: ...


class QualityProvider(Provider):
    stage = "quality"
    @abstractmethod
    async def assess(self, image: bytes) -> dict: ...   # score usability; raise BadImage if unusable


class DigitizationProvider(Provider):
    stage = "digitization"
    @abstractmethod
    async def digitize(self, image: bytes) -> dict: ...   # image → per-lead pixel traces + calibration


class WfdbProvider(Provider):
    stage = "signalExtraction"
    @abstractmethod
    async def to_signal(self, traces: dict) -> dict: ...  # calibrated traces → mV/ms signal (+ WFDB I/O)


class RhythmProvider(Provider):
    stage = "rhythm"
    @abstractmethod
    async def rhythm(self, signal: dict) -> dict: ...     # rate + regularity + rhythm label
    @abstractmethod
    async def beats(self, signal: dict) -> dict: ...      # per-beat labels (normal/PVC/PAC/paced)
    @abstractmethod
    async def morphology(self, signal: dict) -> dict: ... # P/f-waves, hypertrophy, BBB, T-waves


class MeasurementProvider(Provider):
    stage = "measurement"
    @abstractmethod
    async def measure(self, signal: dict) -> dict: ...    # PR/QRS/QT/QTc/axis + per-lead amplitudes
    @abstractmethod
    async def st(self, signal: dict) -> dict: ...         # ST deviation per lead + territory


class RuleEngineProvider(Provider):
    stage = "ruleValidation"
    @abstractmethod
    async def validate(self, features: dict) -> dict: ... # matched criteria + weights + verify + conf cap


class GeminiProvider(Provider):
    stage = "clinicalExplanation"
    @abstractmethod
    async def explain(self, validated: dict) -> str: ...  # plain-language, constrained to validated findings
