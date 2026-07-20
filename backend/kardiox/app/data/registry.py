"""Dataset registry — name -> DatasetProvider. Adding a dataset = one entry + one provider module
(the "single DatasetProvider implementation" contract). Lazy import so this module loads without any
data dependency installed."""
from __future__ import annotations

import importlib

# name -> (module, class). All providers subclass app.data.base.DatasetProvider.
_DATASETS: dict[str, tuple[str, str]] = {
    "mimic-iv-ecg": ("app.data.sources.mimic_iv_ecg", "MimicIVECG"),
    "meeti": ("app.data.sources.meeti", "MEETI"),
    "ptb-xl": ("app.data.sources.ptbxl", "PTBXL"),
    "mit-bih": ("app.data.sources.mitbih", "MITBIH"),
    "chapman": ("app.data.sources.chapman", "Chapman"),
    "cpsc": ("app.data.sources.cpsc", "CPSC2018"),
    "code-15": ("app.data.sources.code15", "CODE15"),
}


def list_datasets() -> list[str]:
    return list(_DATASETS)


def get_dataset(name: str, root: str | None = None):
    """Instantiate a DatasetProvider by name. Raises KeyError for an unknown dataset."""
    key = name.lower()
    if key not in _DATASETS:
        raise KeyError(f"unknown dataset '{name}' (have: {sorted(_DATASETS)})")
    mod_name, cls_name = _DATASETS[key]
    cls = getattr(importlib.import_module(mod_name), cls_name)
    return cls(root=root)


def describe_all() -> list[dict]:
    """Static metadata (name/license/access/modalities/availability) for every registered dataset."""
    out = []
    for name in _DATASETS:
        try:
            out.append(get_dataset(name).describe())
        except Exception as e:  # noqa: BLE001 — a provider import problem must not break the registry
            out.append({"name": name, "error": type(e).__name__})
    return out
