"""ExperimentTracker — dependency-free, file-based run tracking.

ExChanGeAI persists per-run stats (sample count, label distribution, base model, per-epoch loss + F1,
artifacts) but ships no MLflow/W&B integration. KardioX matches that with a lightweight JSONL tracker
(no external service, works offline + in CI). An MLflow/W&B backend can be added behind this same API
later; nothing here requires it.

Layout under <root>/:
  runs.jsonl                 one line per run (id, name, params, status, summary, timestamps set by caller)
  <run_id>/metrics.jsonl     one line per logged metric/epoch
  <run_id>/artifacts/        copied artifact files
"""
from __future__ import annotations

import json
import os


class ExperimentTracker:
    def __init__(self, root: str, clock=None):
        # clock() -> ISO timestamp; injectable so this stays deterministic in tests (no hidden time calls).
        self.root = root
        self._clock = clock or (lambda: "")
        os.makedirs(root, exist_ok=True)

    def _run_dir(self, run_id: str) -> str:
        return os.path.join(self.root, run_id)

    def start_run(self, run_id: str, name: str, params: dict | None = None) -> str:
        d = self._run_dir(run_id)
        os.makedirs(os.path.join(d, "artifacts"), exist_ok=True)
        rec = {"id": run_id, "name": name, "params": params or {}, "status": "running",
               "startedAt": self._clock(), "summary": {}}
        self._append(os.path.join(self.root, "runs.jsonl"), rec)
        return run_id

    def log_epoch(self, run_id: str, epoch: int, metrics: dict) -> None:
        self._append(os.path.join(self._run_dir(run_id), "metrics.jsonl"),
                     {"epoch": int(epoch), **{k: _num(v) for k, v in metrics.items()}})

    def log_metric(self, run_id: str, key: str, value, step: int | None = None) -> None:
        self._append(os.path.join(self._run_dir(run_id), "metrics.jsonl"),
                     {"metric": key, "value": _num(value), "step": step})

    def log_artifact(self, run_id: str, src_path: str) -> str:
        import shutil
        dst = os.path.join(self._run_dir(run_id), "artifacts", os.path.basename(src_path))
        shutil.copy2(src_path, dst)
        return dst

    def finish_run(self, run_id: str, status: str = "completed", summary: dict | None = None) -> None:
        self._append(os.path.join(self.root, "runs.jsonl"),
                     {"id": run_id, "status": status, "finishedAt": self._clock(),
                      "summary": summary or {}})

    def get_metrics(self, run_id: str) -> list[dict]:
        return self._read(os.path.join(self._run_dir(run_id), "metrics.jsonl"))

    def list_runs(self) -> list[dict]:
        return self._read(os.path.join(self.root, "runs.jsonl"))

    @staticmethod
    def _append(path: str, rec: dict) -> None:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")

    @staticmethod
    def _read(path: str) -> list[dict]:
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return v
