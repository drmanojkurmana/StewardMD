"""Fast, no-real-weights coverage for the heatmap-attachment failure path.

The heatmap is an adjunct to a finding, not the clinical payload. If
Grad-CAM (or model/index lookup) blows up on a real image, the request must
still succeed with the findings intact and heatmap_png_b64 left None —
never a 500 that drops valid findings.
"""
import numpy as np
import torch
import torch.nn as nn

from app.models.schemas import EngineResult, Finding
from app.pipeline import localize, orchestrator
from app.providers.base import PreparedImage


class _Tiny(nn.Module):
    """Same tiny stub shape as test_localize.py's _Tiny — has the
    `.features.norm5` layer `localize.default_target_layer` expects, and a
    `.pathologies` list like the real TorchXRayVision model."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential()
        self.features.add_module("conv", nn.Conv2d(1, 4, 3, padding=1))
        self.features.add_module("norm5", nn.BatchNorm2d(4))
        self.head = nn.Linear(4, 3)
        self.pathologies = ["Pneumonia", "Effusion", "Cardiomegaly"]

    def forward(self, x):
        f = self.features(x)
        return self.head(f.mean(dim=(2, 3)))


def _prepared():
    arr = (np.random.rand(224, 224).astype("float32") * 2048) - 1024
    return PreparedImage(array=arr, outbound_png=b"")


def test_attach_heatmaps_degrades_gracefully_on_failure(monkeypatch):
    def _boom(model, img, class_index, target_layer):
        raise RuntimeError("grad-cam blew up")

    monkeypatch.setattr(localize, "heatmap_for", _boom)

    model = _Tiny().eval()
    finding = Finding(label="Pneumonia", band="High", severity="severe", relevance="test")
    engine_result = EngineResult(engine="torchxrayvision", educational=False, findings=[finding])

    # Must not raise.
    orchestrator._attach_heatmaps_for_model(_prepared(), engine_result, model)

    assert engine_result.findings[0].heatmap_png_b64 is None


def test_attach_heatmaps_still_attaches_on_success(monkeypatch):
    calls = []

    def _fake(model, img, class_index, target_layer):
        calls.append(class_index)
        return "aGVhdG1hcA=="

    monkeypatch.setattr(localize, "heatmap_for", _fake)

    model = _Tiny().eval()
    finding = Finding(label="Effusion", band="Medium", severity="mild", relevance="test")
    engine_result = EngineResult(engine="torchxrayvision", educational=False, findings=[finding])

    orchestrator._attach_heatmaps_for_model(_prepared(), engine_result, model)

    assert engine_result.findings[0].heatmap_png_b64 == "aGVhdG1hcA=="
    assert calls == [1]  # "Effusion" is index 1 in model.pathologies


def test_attach_heatmaps_low_band_never_calls_heatmap_for(monkeypatch):
    def _boom(*a, **kw):
        raise AssertionError("heatmap_for should not be called for a Low-band finding")

    monkeypatch.setattr(localize, "heatmap_for", _boom)

    model = _Tiny().eval()
    finding = Finding(label="Pneumonia", band="Low", severity="mild", relevance="test")
    engine_result = EngineResult(engine="torchxrayvision", educational=False, findings=[finding])

    orchestrator._attach_heatmaps_for_model(_prepared(), engine_result, model)

    assert engine_result.findings[0].heatmap_png_b64 is None
