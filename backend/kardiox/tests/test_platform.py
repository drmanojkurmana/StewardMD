"""KardioX data + training platform — registry, pipelines, validation.

The orchestration (DatasetRegistry, Training/FineTuning/Validation pipelines) is pure Python and RUNS in
the base CI job with a synthetic in-memory provider + a stub DL backend (no torch/numpy). The metric math
(BenchmarkPipeline, build_batches) needs numpy and is guarded with importorskip.
"""
from __future__ import annotations

import tempfile

import pytest

from app.data.base import DatasetProvider, Sample


class SynthProvider(DatasetProvider):
    name = "synth"
    license = "CC-BY-4.0"
    modalities = ("labels",)
    tasks = ("rhythm",)
    fs = 500

    def __init__(self, root=None, n=20):
        super().__init__(root=root)
        self._n = n

    def available(self):
        return True

    def label_space(self):
        return ["A", "B"]

    def iter_samples(self, split=None, limit=None):
        n = self._n if limit is None else min(self._n, limit)
        for i in range(n):
            yield Sample(id=f"s{i}", labels=["A" if i % 2 else "B"])


class StubBackend:
    """A DL backend stub that exercises the orchestration WITHOUT consuming batches (no numpy)."""

    def __init__(self):
        self.epoch = 0
        self.head = None
        self.frozen = False
        self.base = None

    def find_lr(self, batches):
        return 1e-3

    def fit_epoch(self, batches):
        self.epoch += 1
        return 1.0 / self.epoch

    def evaluate(self, batches):
        return {"loss": 1.0 / max(1, self.epoch), "weightedF1": 0.5}

    def restore_best(self):
        pass

    def export_onnx(self, path):
        with open(path, "wb") as f:
            f.write(b"onnx-stub")

    def load_base(self, ref):
        self.base = ref

    def adapt_head(self, n):
        self.head = n

    def freeze_encoder(self):
        self.frozen = True


# ── DatasetRegistry ─────────────────────────────────────────────────────────────────────────────

def test_registry_lists_all_datasets():
    from app.data.registry import get_dataset, list_datasets
    names = set(list_datasets())
    assert {"mimic-iv-ecg", "meeti", "ptb-xl", "mit-bih", "chapman", "cpsc", "code-15"} <= names
    p = get_dataset("ptb-xl")
    d = p.describe()
    assert d["license"] == "CC-BY-4.0" and d["access"] == "open"
    assert d["available"] is False        # no data present -> honest, not fabricated


def test_credentialed_datasets_flagged():
    from app.data.registry import get_dataset
    for name in ("mimic-iv-ecg", "meeti"):
        d = get_dataset(name).describe()
        assert d["access"] == "credentialed-dua" and d["redistribute"] is False


def test_unknown_dataset_raises():
    from app.data.registry import get_dataset
    with pytest.raises(KeyError):
        get_dataset("not-a-dataset")


# ── TrainingPipeline / FineTuningPipeline (stub backend, no numpy) ────────────────────────────────

def test_training_pipeline_runs_and_registers():
    from app.training.config import HyperparameterConfig
    from app.training.experiment import ExperimentTracker
    from app.training.model_registry import ModelRegistry
    from app.training.pipeline import TrainingPipeline
    d = tempfile.mkdtemp()
    tp = TrainingPipeline(HyperparameterConfig(lr=1e-3, max_epochs=3, early_stop_patience=2),
                          tracker=ExperimentTracker(d + "/e"), registry=ModelRegistry(d + "/m"))
    s = tp.run(SynthProvider(root=d), StubBackend(), run_id="r1")
    assert s["epochs"] == 3 and s["modelCard"] == "r1" and s["artifact"]


def test_finetune_head_adaptation_and_provenance():
    from app.training.config import HyperparameterConfig
    from app.training.finetune import FineTuningPipeline
    from app.training.model_registry import ModelRegistry
    d = tempfile.mkdtemp()
    reg = ModelRegistry(d + "/m")
    b = StubBackend()
    ft = FineTuningPipeline(HyperparameterConfig(lr=1e-3, max_epochs=2, mode="head_only"), registry=reg)
    out = ft.run(SynthProvider(root=d), b, base_model="/models/base.onnx", run_id="r2",
                 spec_name="ptbxl_500hz_10s")
    assert b.head == 2 and b.frozen is True and b.base == "/models/base.onnx"
    assert "finetune" in out                      # provenance block present
    assert reg.get("r2").metrics.get("provenance") is not None   # audit trail persisted


def test_validation_pipeline_reports_clean():
    from app.training.validation import ValidationPipeline
    rep = ValidationPipeline().validate_provider(SynthProvider(root="/x"), sample_limit=10)
    assert rep["available"] is True and rep["nSampled"] == 10
    assert rep["ok"] is True and set(rep["labelSpace"]) == {"A", "B"}


# ── BenchmarkPipeline (needs numpy) ───────────────────────────────────────────────────────────────

def test_benchmark_metrics_with_stub_model():
    pytest.importorskip("numpy")
    from app.training.benchmark import BenchmarkPipeline

    def model_fn(_signal):
        return {"A": 0.9, "B": 0.1}
    rep = BenchmarkPipeline().evaluate(SynthProvider(root="/x", n=12), model_fn, split="test",
                                       label_space=["A", "B"])
    assert "weightedF1" in rep and "accuracy" in rep and rep["n"] == 12
