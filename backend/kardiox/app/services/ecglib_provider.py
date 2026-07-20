"""EcgLib pretrained classifiers (ispras/EcgLib, Apache-2.0) — real integration.

EcgLib ships pretrained binary 12-lead pathology models (auto-fetched by create_model(pretrained=True))
under Apache-2.0 (code + weights) — commercially usable. This provider runs the enabled pathology models
(AFIB / 1AVB / STACH / SBRAD / IRBBB / CRBBB / PVC) and returns POSITIVE findings as CANDIDATES for the
evidence-fusion / differential engine. The deterministic Rule Engine still validates everything; a model
never diagnoses unchecked.

HONESTY: KardioX ships no weights and cannot run this in-sandbox. It is NOT READY (raises
UpstreamUnavailable, never fabricates) until (a) KARDIOX_ECGLIB_PATHOLOGIES is set and (b) `ecglib`
(+torch) is installed so create_model can fetch the weights. The create_model call targets ecglib >= 1.1.0
(create_model(model_name=..., pathology=..., pretrained=True)); confirm the exact args + expected input
length against the installed version — any mismatch surfaces as a clean Not-Ready error, not a fake result.

Expected input:  a signal dict {"leads": {lead: {"mv":[...], "fs":int}}, ...}.
Expected output: classify(signal) -> list[{source:"ecglib", pathology, label, confidence}] (positives only).
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable
from app.services.base import Provider

# EcgLib pathology code -> KardioX label vocabulary.
_PATHOLOGY_LABEL = {
    "AFIB": "Atrial fibrillation",
    "1AVB": "First-degree AV block",
    "STACH": "Sinus tachycardia",
    "SBRAD": "Sinus bradycardia",
    "IRBBB": "Incomplete right bundle branch block",
    "CRBBB": "Complete right bundle branch block",
    "PVC": "Premature ventricular contractions",
}
_POSITIVE_THRESHOLD = 0.5
_ECGLIB_INPUT_SPEC = "ptbxl_500hz_10s"   # 12-lead, 500 Hz, 10 s (5000) — confirm vs installed ecglib


def label_for(pathology: str) -> str:
    return _PATHOLOGY_LABEL.get((pathology or "").upper(), pathology)


def supported_pathologies() -> list[str]:
    return list(_PATHOLOGY_LABEL)


class EcgLibClassifier(Provider):
    """Runs the enabled EcgLib binary pathology models and returns positive findings as fusion candidates."""

    name = "ecglib"
    stage = "specialist:ecglib"
    version = "1.1.0"
    requires = ("ecglib",)
    timeout_s = 60.0

    def _pathologies(self) -> list[str]:
        from app.core.config import get_settings
        raw = getattr(get_settings(), "ecglib_pathologies", "") or ""
        want = [p.strip().upper() for p in raw.split(",") if p.strip()]
        return [p for p in want if p in _PATHOLOGY_LABEL]

    @property
    def implemented(self) -> bool:  # type: ignore[override]
        # "implemented" = an operator enabled the (pretrained, Apache-2.0) models. Clinical validation on
        # KardioX's own pipeline remains a separate external gate.
        return bool(self._pathologies())

    def validate_config(self) -> list[str]:
        if not self._pathologies():
            return ["EcgLib disabled — set KARDIOX_ECGLIB_PATHOLOGIES=AFIB,1AVB,STACH,SBRAD,IRBBB,CRBBB,PVC"]
        return []

    def _load_model(self, pathology: str, cache: dict):
        if pathology in cache:
            return cache[pathology]
        try:
            from ecglib.models import create_model
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("ecglib not installed (pip install ecglib)", stage=self.stage) from e
        try:
            model = create_model(model_name="resnet1d18", pathology=pathology, pretrained=True)
            model.eval()
        except Exception as e:
            raise UpstreamUnavailable(f"ecglib model load failed for {pathology}: {type(e).__name__}",
                                      stage=self.stage) from e
        cache[pathology] = model
        return model

    async def probabilities(self, signal: dict) -> dict:
        """ALL enabled-pathology probabilities (unthresholded) — for VALIDATION / threshold tuning /
        calibration fitting. {pathology: prob in [0,1]}. Not-Ready-safe; never fabricates."""
        import asyncio
        paths = self._pathologies()
        if not paths:
            raise UpstreamUnavailable("EcgLib NOT READY: no pathologies enabled "
                                      "(KARDIOX_ECGLIB_PATHOLOGIES)", stage=self.stage)

        def _run() -> dict:
            try:
                import numpy as np
                import torch
            except ImportError as e:  # pragma: no cover
                raise UpstreamUnavailable("ecglib inference needs numpy + torch", stage=self.stage) from e
            from app.services.models import adapt_signal, get_input_spec
            spec = get_input_spec(_ECGLIB_INPUT_SPEC)
            x = adapt_signal(signal, spec)                      # (1, 12, 5000)
            tensor = torch.from_numpy(np.asarray(x, dtype="float32"))
            cache: dict = {}
            probs: dict = {}
            for p in paths:
                model = self._load_model(p, cache)
                with torch.no_grad():
                    logit = model(tensor)
                probs[p] = round(float(torch.sigmoid(logit).flatten()[0].item()), 4)
            return probs

        return await asyncio.to_thread(_run)

    async def classify(self, signal: dict) -> list[dict]:
        """Positive findings (prob >= threshold) as fusion candidates."""
        probs = await self.probabilities(signal)
        return [{"source": "ecglib", "pathology": p, "label": label_for(p), "confidence": prob}
                for p, prob in probs.items() if prob >= _POSITIVE_THRESHOLD]
