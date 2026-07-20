"""ModelRegistry — ONNX-first, file-based model catalog (adopts ExChanGeAI's ONNX-centric interchange).

ExChanGeAI stores models as ONNX (+ a WebDAV "Model ExChanGe" server for sharing). KardioX keeps the
ONNX-first principle but uses a simple local manifest (no WebDAV dependency); a registered model bridges
straight to the inference seam via `to_backend()` -> the same {kind, path, labels, inputSpec} that
`app.services.models.load_backend` + the provider config consume. Provenance (source/license) is a
first-class field so a commercial deployment can audit every weight.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field


@dataclass
class ModelCard:
    name: str
    task: str                      # rhythm | mi | conduction | morphology | beat | encoder | digitizer
    fmt: str = "onnx"              # onnx | torchscript | torch_statedict | tensorflow
    path: str = ""                 # local path to the weights
    source: str = ""               # upstream repo / HF id
    license: str = "unknown"
    inputSpec: str = ""            # named app.services.models.INPUT_SPECS preset
    labels: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)   # e.g. {"macroF1": 0.82, "dataset": "PTB-XL fold10"}
    version: str = "0.1.0"
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


class ModelRegistry:
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)
        self._manifest = os.path.join(root, "manifest.json")

    def _load(self) -> dict:
        if not os.path.exists(self._manifest):
            return {}
        with open(self._manifest, encoding="utf-8") as f:
            return json.load(f)

    def _save(self, data: dict) -> None:
        with open(self._manifest, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True)

    def register(self, card: ModelCard) -> ModelCard:
        data = self._load()
        data[card.name] = card.to_dict()
        self._save(data)
        return card

    def get(self, name: str) -> ModelCard | None:
        d = self._load().get(name)
        return ModelCard(**d) if d else None

    def list(self) -> list[dict]:
        return list(self._load().values())

    def remove(self, name: str) -> bool:
        data = self._load()
        if name in data:
            del data[name]
            self._save(data)
            return True
        return False

    def to_backend(self, name: str) -> dict:
        """Bridge a registered model to the inference seam's backend config. Raises KeyError if absent."""
        card = self.get(name)
        if card is None:
            raise KeyError(f"model '{name}' not registered")
        return {"kind": card.fmt, "path": card.path, "labels": card.labels, "inputSpec": card.inputSpec}
