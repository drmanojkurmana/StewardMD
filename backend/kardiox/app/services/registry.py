"""Provider registry / DI. Maps config names → provider classes and assembles the active set. Swapping
in a real model is a one-line env change (e.g. KARDIOX_PROVIDER_RHYTHM=torchecg) — routes never change."""
from __future__ import annotations

import asyncio

from app.core.config import Settings
from app.services import (digitization, gemini, measurement, preprocessing, quality, rhythm, rules,
                          specialists, wfdb_io)

_PREPROC = {"none": preprocessing.NonePreprocessing, "opencv": preprocessing.OpenCVPreprocessing}
_QUALITY = {"none": quality.NoneQuality, "opencv": quality.OpenCVQuality}
_DIGI = {"none": digitization.NoneDigitization, "classical": digitization.ClassicalDigitization,
         "opencv": digitization.OpenCVDigitization, "external": digitization.ExternalDigitization,
         "consensus": digitization.ConsensusDigitization}
_WFDB = {"none": wfdb_io.NoneWfdb, "wfdb": wfdb_io.WfdbSignal}
_RHY = {"none": rhythm.NoneRhythm, "deterministic": rhythm.DeterministicRhythm,
        "torchecg": rhythm.TorchECGRhythm}
_MEAS = {"none": measurement.NoneMeasurement, "neurokit2": measurement.NeuroKitMeasurement}
_RULES = {"none": rules.NoneRules, "builtin": rules.BuiltinRules}
_GEM = {"none": gemini.NoneGemini, "gemini": gemini.GeminiExplainer}


class Providers:
    def __init__(self, s: Settings):
        self.preprocessing = _PREPROC.get(s.provider_preprocessing, preprocessing.NonePreprocessing)()
        self.quality = _QUALITY.get(s.provider_quality, quality.NoneQuality)()
        self.digitization = _DIGI.get(s.provider_digitization, digitization.NoneDigitization)()
        self.wfdb = _WFDB.get(s.provider_wfdb, wfdb_io.NoneWfdb)()
        self.rhythm = _RHY.get(s.provider_rhythm, rhythm.NoneRhythm)()
        self.measurement = _MEAS.get(s.provider_measurement, measurement.NoneMeasurement)()
        self.rules = _RULES.get(s.provider_rules, rules.NoneRules)()
        self.gemini = _GEM.get(s.provider_gemini, gemini.NoneGemini)()
        # Specialist model classifiers (optional, config-activated; each Not Ready until a checkpoint exists).
        self.specialists = specialists.build_specialists(s)

    def all(self):
        return [self.preprocessing, self.quality, self.digitization, self.wfdb, self.rhythm,
                self.measurement, self.rules, self.gemini]

    def status(self) -> list[dict]:
        return [{"stage": p.stage, "name": p.name, "implemented": p.implemented, "version": p.version} for p in self.all()]

    async def health_report(self) -> list[dict]:
        return await asyncio.gather(*(p.health() for p in self.all()))

    async def specialist_health(self) -> list[dict]:
        return await asyncio.gather(*(p.health() for p in self.specialists))


def build_providers(s: Settings) -> Providers:
    return Providers(s)
