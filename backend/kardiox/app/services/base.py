"""Provider interfaces (the plug-in seam for the future ECG models).

Every pipeline stage is an abstract Provider. Concrete impls come in two flavours per stage:
  • None<Stage>  — raises StageNotImplemented (the default until models are wired).
  • Real<Stage>  — the production scaffold with a precise TODO + the exact OSS library to use.
The registry (registry.py) picks the impl by config, so adding a real model NEVER changes the routes,
the orchestrator, or the iOS frontend — you flip one env var and drop the model in.

Signals are passed between stages as plain dicts (kept schema-light on purpose so model authors choose
their own tensors internally):
    traces  = {"leads": {"II": [...px...], ...}, "calibration": {"mmPerS": 25, "mmPerMv": 10}}
    signal  = {"leads": {"II": {"mv": [...], "fs": 500}, ...}, "duration_s": 10.0}
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.core.errors import StageNotImplemented


class Provider(ABC):
    name: str = "base"
    stage: str = "report"
    implemented: bool = False   # real impls flip this True once the model actually works

    def _ni(self):
        raise StageNotImplemented(f"Stage '{self.stage}' provider '{self.name}' is not implemented yet.", stage=self.stage)


class PreprocessingProvider(Provider):
    stage = "enhancement"
    @abstractmethod
    async def enhance(self, image: bytes) -> bytes: ...


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
