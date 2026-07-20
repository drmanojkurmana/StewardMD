"""Model-integration seam (Phase 6F). A trained ECG model plugs in as a ModelBackend, selected by config
— no change to providers, orchestrator, routes, or the iOS app. See docs/MODEL_INTEGRATION.md."""
from __future__ import annotations

from app.services.models.adapters import (INPUT_SPECS, LABEL_MAPS, LabelMap, ModelInputSpec,
                                          adapt_signal, get_input_spec, get_label_map, resolve_entrypoint)
from app.services.models.backends import (EnsembleBackend, OnnxBackend, SavedModelBackend,
                                          StateDictBackend, TorchScriptBackend, load_backend)
from app.services.models.base import STANDARD_LEADS, ModelBackend, signal_tensor, softmax
from app.services.models.encoders import (DeepECGSSLEncoder, ECGFMEncoder, FoundationEncoder,
                                          HeartGPTEncoder, build_encoders, get_encoder)

__all__ = ["ModelBackend", "signal_tensor", "softmax", "STANDARD_LEADS", "load_backend",
           "TorchScriptBackend", "OnnxBackend", "StateDictBackend", "SavedModelBackend", "EnsembleBackend",
           "ModelInputSpec", "adapt_signal", "INPUT_SPECS", "get_input_spec",
           "LabelMap", "LABEL_MAPS", "get_label_map", "resolve_entrypoint",
           "FoundationEncoder", "ECGFMEncoder", "DeepECGSSLEncoder", "HeartGPTEncoder",
           "build_encoders", "get_encoder"]
