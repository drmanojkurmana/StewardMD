"""Hyperparameter configuration (training + fine-tuning).

Defaults adopt the ExChanGeAI (MIT) platform's validated choices — AdamW + ExponentialLR(gamma=0.9),
50-epoch cap with early stopping, 80/20 stratified split, and normalization that depends on the model
(z-score for pretrained foundation models like ECG-FM; none for de-novo). KardioX keeps this
CONFIG/CODE-driven (reproducible, versionable) rather than ExChanGeAI's UI-form driven approach.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class HyperparameterConfig:
    # optimizer / schedule (ExChanGeAI defaults)
    optimizer: str = "adamw"              # adamw | adam | sgd
    lr: float | None = None               # None => run the LR finder before training
    lr_gamma: float = 0.9                 # ExponentialLR decay
    weight_decay: float = 1e-4
    batch_size: int = 32
    max_epochs: int = 50
    early_stop_patience: int = 5          # epochs of no weighted-val-loss improvement
    # data
    target_fs: int = 100                  # ExChanGeAI default resample target
    seconds: float = 10.0
    normalize: str = "zscore"             # zscore (pretrained) | none (de-novo)
    val_fraction: float = 0.2             # 80/20 stratified split
    stratified: bool = True
    # fine-tuning
    mode: str = "full"                    # full | head_only
    freeze_encoder: bool = False
    seed: int = 42
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "HyperparameterConfig":
        known = {k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def validate(self) -> list[str]:
        issues = []
        if self.optimizer not in ("adamw", "adam", "sgd"):
            issues.append(f"unknown optimizer {self.optimizer!r}")
        if self.mode not in ("full", "head_only"):
            issues.append(f"unknown mode {self.mode!r}")
        if self.normalize not in ("zscore", "none", "minmax"):
            issues.append(f"unknown normalize {self.normalize!r}")
        if not (0.0 < self.val_fraction < 1.0):
            issues.append("val_fraction must be in (0,1)")
        if self.max_epochs < 1 or self.batch_size < 1:
            issues.append("max_epochs and batch_size must be >= 1")
        return issues
