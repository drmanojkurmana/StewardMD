"""Real X-Raydar (XNet38MS, single-scale is512) educational provider.

The model architecture below is a minimal, inference-only vendoring of
``Inception3`` from the official x-raydar/x-raydar-cv repository
(``src/model_20210820_XNet38MS/wt_inception.py``), which implements a
single-channel variant of Inception v3 producing 38 sigmoid outputs (37
radiological findings + 1 meta-class "abnormal_non_clinically_important").
Random-weight init (the repo's scipy.stats truncnorm path) is intentionally
dropped here since real checkpoint weights always overwrite the parameters
via ``load_state_dict`` in ``_model()`` below; the forward computation graph
and module structure are otherwise unchanged so real weights load faithfully.

Attribution: "This software includes Warwick X-Raydar code (C) 2023, The
University of Warwick." Code + weights are licensed for ACADEMIC RESEARCH
AND NON-COMMERCIAL, NON-CLINICAL EVALUATION ONLY — see
https://github.com/x-raydar/x-raydar-cv/blob/main/LICENSE and
https://huggingface.co/dnamodel/xraydar-cv. Not for clinical use; ThoreX only
ever exposes this provider with ``educational=True``.

Paper: Cid, Macpherson et al., "Development and validation of open-source
deep neural networks for comprehensive chest x-ray reading: a retrospective,
multicentre study", The Lancet Digital Health, 2024.
doi:10.1016/S2589-7500(23)00218-2

P1 scope note: the real XNet38MS is a 3-way multi-scale ensemble (is299 +
is512 + is1024, probabilities averaged). This provider loads only the is512
member (single resolution) — the full ensemble is a FUTURE optimization.

Preprocessing: this provider uses its OWN native pipeline, independent of the
shared torchxrayvision-normalized 224x224 array used by the local
TorchXRayVision provider. It decodes ``PreparedImage.outbound_png`` (the
de-identified, full-resolution grayscale PNG produced by
``app/pipeline/preprocess.py``), aspect-preserving pads it to a square,
resizes to 512x512 (X-Raydar's native ``is512`` input size), scales to
[0, 1], and applies X-Raydar's own ``Normalize(mean=0.491, std=0.271)``. This
matches X-Raydar's published preprocessing far more closely than upsampling
the shared 224px xrv-normalized array ever could. See ``_to_model_input``
below.
"""
import io

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageOps

from app.core.config import get_settings
from app.providers.base import InferenceProvider

# ---------------------------------------------------------------------------
# Vendored (inference-only) from
# x-raydar-cv/src/model_20210820_XNet38MS/wt_inception.py::Inception3
# ---------------------------------------------------------------------------


class BasicConv2d(nn.Module):
    def __init__(self, in_channels, out_channels, **kwargs):
        super().__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, bias=False, **kwargs)
        self.bn = nn.BatchNorm2d(out_channels, eps=0.001)

    def forward(self, x):
        x = self.conv(x)
        x = self.bn(x)
        return F.relu(x, inplace=True)


class InceptionA(nn.Module):
    def __init__(self, in_channels, pool_features):
        super().__init__()
        self.branch1x1 = BasicConv2d(in_channels, 64, kernel_size=1)
        self.branch5x5_1 = BasicConv2d(in_channels, 48, kernel_size=1)
        self.branch5x5_2 = BasicConv2d(48, 64, kernel_size=5, padding=2)
        self.branch3x3dbl_1 = BasicConv2d(in_channels, 64, kernel_size=1)
        self.branch3x3dbl_2 = BasicConv2d(64, 96, kernel_size=3, padding=1)
        self.branch3x3dbl_3 = BasicConv2d(96, 96, kernel_size=3, padding=1)
        self.branch_pool = BasicConv2d(in_channels, pool_features, kernel_size=1)

    def forward(self, x):
        branch1x1 = self.branch1x1(x)
        branch5x5 = self.branch5x5_2(self.branch5x5_1(x))
        branch3x3dbl = self.branch3x3dbl_3(self.branch3x3dbl_2(self.branch3x3dbl_1(x)))
        branch_pool = self.branch_pool(F.avg_pool2d(x, kernel_size=3, stride=1, padding=1))
        return torch.cat([branch1x1, branch5x5, branch3x3dbl, branch_pool], 1)


class InceptionB(nn.Module):
    def __init__(self, in_channels):
        super().__init__()
        self.branch3x3 = BasicConv2d(in_channels, 384, kernel_size=3, stride=2)
        self.branch3x3dbl_1 = BasicConv2d(in_channels, 64, kernel_size=1)
        self.branch3x3dbl_2 = BasicConv2d(64, 96, kernel_size=3, padding=1)
        self.branch3x3dbl_3 = BasicConv2d(96, 96, kernel_size=3, stride=2)

    def forward(self, x):
        branch3x3 = self.branch3x3(x)
        branch3x3dbl = self.branch3x3dbl_3(self.branch3x3dbl_2(self.branch3x3dbl_1(x)))
        branch_pool = F.max_pool2d(x, kernel_size=3, stride=2)
        return torch.cat([branch3x3, branch3x3dbl, branch_pool], 1)


class InceptionC(nn.Module):
    def __init__(self, in_channels, channels_7x7):
        super().__init__()
        c7 = channels_7x7
        self.branch1x1 = BasicConv2d(in_channels, 192, kernel_size=1)
        self.branch7x7_1 = BasicConv2d(in_channels, c7, kernel_size=1)
        self.branch7x7_2 = BasicConv2d(c7, c7, kernel_size=(1, 7), padding=(0, 3))
        self.branch7x7_3 = BasicConv2d(c7, 192, kernel_size=(7, 1), padding=(3, 0))
        self.branch7x7dbl_1 = BasicConv2d(in_channels, c7, kernel_size=1)
        self.branch7x7dbl_2 = BasicConv2d(c7, c7, kernel_size=(7, 1), padding=(3, 0))
        self.branch7x7dbl_3 = BasicConv2d(c7, c7, kernel_size=(1, 7), padding=(0, 3))
        self.branch7x7dbl_4 = BasicConv2d(c7, c7, kernel_size=(7, 1), padding=(3, 0))
        self.branch7x7dbl_5 = BasicConv2d(c7, 192, kernel_size=(1, 7), padding=(0, 3))
        self.branch_pool = BasicConv2d(in_channels, 192, kernel_size=1)

    def forward(self, x):
        branch1x1 = self.branch1x1(x)
        branch7x7 = self.branch7x7_3(self.branch7x7_2(self.branch7x7_1(x)))
        branch7x7dbl = self.branch7x7dbl_1(x)
        branch7x7dbl = self.branch7x7dbl_2(branch7x7dbl)
        branch7x7dbl = self.branch7x7dbl_3(branch7x7dbl)
        branch7x7dbl = self.branch7x7dbl_4(branch7x7dbl)
        branch7x7dbl = self.branch7x7dbl_5(branch7x7dbl)
        branch_pool = self.branch_pool(F.avg_pool2d(x, kernel_size=3, stride=1, padding=1))
        return torch.cat([branch1x1, branch7x7, branch7x7dbl, branch_pool], 1)


class InceptionD(nn.Module):
    def __init__(self, in_channels):
        super().__init__()
        self.branch3x3_1 = BasicConv2d(in_channels, 192, kernel_size=1)
        self.branch3x3_2 = BasicConv2d(192, 320, kernel_size=3, stride=2)
        self.branch7x7x3_1 = BasicConv2d(in_channels, 192, kernel_size=1)
        self.branch7x7x3_2 = BasicConv2d(192, 192, kernel_size=(1, 7), padding=(0, 3))
        self.branch7x7x3_3 = BasicConv2d(192, 192, kernel_size=(7, 1), padding=(3, 0))
        self.branch7x7x3_4 = BasicConv2d(192, 192, kernel_size=3, stride=2)

    def forward(self, x):
        branch3x3 = self.branch3x3_2(self.branch3x3_1(x))
        branch7x7x3 = self.branch7x7x3_1(x)
        branch7x7x3 = self.branch7x7x3_2(branch7x7x3)
        branch7x7x3 = self.branch7x7x3_3(branch7x7x3)
        branch7x7x3 = self.branch7x7x3_4(branch7x7x3)
        branch_pool = F.max_pool2d(x, kernel_size=3, stride=2)
        return torch.cat([branch3x3, branch7x7x3, branch_pool], 1)


class InceptionE(nn.Module):
    def __init__(self, in_channels):
        super().__init__()
        self.branch1x1 = BasicConv2d(in_channels, 320, kernel_size=1)
        self.branch3x3_1 = BasicConv2d(in_channels, 384, kernel_size=1)
        self.branch3x3_2a = BasicConv2d(384, 384, kernel_size=(1, 3), padding=(0, 1))
        self.branch3x3_2b = BasicConv2d(384, 384, kernel_size=(3, 1), padding=(1, 0))
        self.branch3x3dbl_1 = BasicConv2d(in_channels, 448, kernel_size=1)
        self.branch3x3dbl_2 = BasicConv2d(448, 384, kernel_size=3, padding=1)
        self.branch3x3dbl_3a = BasicConv2d(384, 384, kernel_size=(1, 3), padding=(0, 1))
        self.branch3x3dbl_3b = BasicConv2d(384, 384, kernel_size=(3, 1), padding=(1, 0))
        self.branch_pool = BasicConv2d(in_channels, 192, kernel_size=1)

    def forward(self, x):
        branch1x1 = self.branch1x1(x)
        branch3x3 = self.branch3x3_1(x)
        branch3x3 = torch.cat([self.branch3x3_2a(branch3x3), self.branch3x3_2b(branch3x3)], 1)
        branch3x3dbl = self.branch3x3dbl_2(self.branch3x3dbl_1(x))
        branch3x3dbl = torch.cat(
            [self.branch3x3dbl_3a(branch3x3dbl), self.branch3x3dbl_3b(branch3x3dbl)], 1
        )
        branch_pool = self.branch_pool(F.avg_pool2d(x, kernel_size=3, stride=1, padding=1))
        return torch.cat([branch1x1, branch3x3, branch3x3dbl, branch_pool], 1)


class InceptionAux(nn.Module):
    def __init__(self, in_channels, num_classes):
        super().__init__()
        self.conv0 = BasicConv2d(in_channels, 128, kernel_size=1)
        self.conv1 = BasicConv2d(128, 768, kernel_size=5)
        self.fc = nn.Linear(768, num_classes)

    def forward(self, x):
        x = F.avg_pool2d(x, kernel_size=5, stride=3)
        x = self.conv1(self.conv0(x))
        x = F.adaptive_avg_pool2d(x, (1, 1))
        x = torch.flatten(x, 1)
        return self.fc(x)


class Inception3(nn.Module):
    """Single-channel Inception v3 variant used by X-Raydar's XNet38 head.

    38-way multi-label sigmoid output (37 findings + 1 meta-class). Matches
    the checkpoint's module names/shapes exactly so ``load_state_dict``
    loads real weights, not near-empty ``strict=False`` noise.
    """

    def __init__(self, num_classes=38, aux_logits=True, transform_input=True, in_channels=1):
        super().__init__()
        self.aux_logits = aux_logits
        self.transform_input = transform_input
        self.Conv2d_1a_3x3 = BasicConv2d(in_channels, 32, kernel_size=3, stride=2)
        self.Conv2d_2a_3x3 = BasicConv2d(32, 32, kernel_size=3)
        self.Conv2d_2b_3x3 = BasicConv2d(32, 64, kernel_size=3, padding=1)
        self.Conv2d_3b_1x1 = BasicConv2d(64, 80, kernel_size=1)
        self.Conv2d_4a_3x3 = BasicConv2d(80, 192, kernel_size=3)
        self.Mixed_5b = InceptionA(192, pool_features=32)
        self.Mixed_5c = InceptionA(256, pool_features=64)
        self.Mixed_5d = InceptionA(288, pool_features=64)
        self.Mixed_6a = InceptionB(288)
        self.Mixed_6b = InceptionC(768, channels_7x7=128)
        self.Mixed_6c = InceptionC(768, channels_7x7=160)
        self.Mixed_6d = InceptionC(768, channels_7x7=160)
        self.Mixed_6e = InceptionC(768, channels_7x7=192)
        if aux_logits:
            self.AuxLogits = InceptionAux(768, num_classes)
        self.Mixed_7a = InceptionD(768)
        self.Mixed_7b = InceptionE(1280)
        self.Mixed_7c = InceptionE(2048)
        self.fc = nn.Linear(2048, num_classes)

    def _transform_input(self, x):
        if self.transform_input:
            # X-Raydar's own second-stage re-normalization (applied on top of
            # transforms.Normalize(mean=0.491, std=0.271) in their pipeline).
            img_mean, img_std = 0.5, 0.25
            x = x * (img_std / 0.5) + (img_mean - 0.5) / 0.5
        return x

    def forward(self, x):
        x = self._transform_input(x)
        x = self.Conv2d_1a_3x3(x)
        x = self.Conv2d_2a_3x3(x)
        x = self.Conv2d_2b_3x3(x)
        x = F.max_pool2d(x, kernel_size=3, stride=2)
        x = self.Conv2d_3b_1x1(x)
        x = self.Conv2d_4a_3x3(x)
        x = F.max_pool2d(x, kernel_size=3, stride=2)
        x = self.Mixed_5b(x)
        x = self.Mixed_5c(x)
        x = self.Mixed_5d(x)
        x = self.Mixed_6a(x)
        x = self.Mixed_6b(x)
        x = self.Mixed_6c(x)
        x = self.Mixed_6d(x)
        x = self.Mixed_6e(x)
        x = self.Mixed_7a(x)
        x = self.Mixed_7b(x)
        x = self.Mixed_7c(x)
        x = F.adaptive_avg_pool2d(x, (1, 1))
        x = torch.flatten(x, 1)
        return self.fc(x)


# 38-class taxonomy, index-aligned with the model's output — verbatim from
# x-raydar-cv/src/utils/report_utils.py::load_list_radiologicalfindings(38)
_XRAYDAR_LABELS_38 = [
    "abnormal_non_clinically_important", "aortic_calcification", "apical_changes",
    "atelectasis", "axillary_abnormality", "bronchial_changes", "bulla",
    "cardiomegaly", "cavity", "clavicle_fracture", "consolidation",
    "cardiac_calcification", "dextrocardia", "dilated_bowel", "emphysema",
    "ground_glass_opacification", "hemidiaphragm_elevated", "hernia",
    "hyperexpanded_lungs", "interstitial_shadowing", "mediastinum_displaced",
    "mediastinum_widened", "object", "paraspinal_mass",
    "paratracheal_hilar_enlargement", "parenchymal_lesion", "pleural_abnormality",
    "pleural_effusion", "pneumomediastinum", "pneumoperitoneum", "pneumothorax",
    "rib_fracture", "rib_lesion", "scoliosis", "subcutaneous_emphysema",
    "tortuosity_aorta", "pulmonary_bloodflow_redistribution", "volume_loss",
]

# Map X-Raydar's raw taxonomy names -> ThoreX shared label vocabulary where an
# equivalent exists; findings without a shared-label mapping pass through
# under their X-Raydar name so probabilities are never silently dropped.
_SHARED_LABEL_MAP = {
    "atelectasis": "Atelectasis",
    "cardiomegaly": "Cardiomegaly",
    "consolidation": "Consolidation",
    "emphysema": "Emphysema",
    "hernia": "Hernia",
    "pleural_effusion": "Effusion",
    "pneumothorax": "Pneumothorax",
    "cavity": "Cavity",
    "mediastinum_widened": "Mediastinal_Widening",
}

_INPUT_SIZE = 512  # single-resolution P1 slice of the is{299,512,1024} ensemble
_HF_REPO = "dnamodel/xraydar-cv"
_HF_FILENAME = f"cv/is{_INPUT_SIZE}/model_best.pth.tar"
# Pinned commit SHA of dnamodel/xraydar-cv, reviewed 2026-07-25. This pin IS
# the trust boundary: weights_only=False below executes arbitrary pickle
# opcodes from whatever this revision resolves to, so we never resolve
# "main" (which could change under us) — only this exact, reviewed commit.
# Re-review and bump deliberately if the upstream weights are ever updated.
_HF_REVISION = "34aec5a6a8d639b4ebe717f2e5a5499b8f00c493"
_MIN_MATCH_FRACTION = 0.9  # below this, treat the architecture as mismatched (never fabricate)

_MODEL = None
_KEY_MATCH_INFO: dict | None = None  # populated on first load attempt, for honest diagnostics


def _strip_module_prefix(state_dict: dict) -> dict:
    if state_dict and all(k.startswith("module.") for k in state_dict):
        return {k[len("module."):]: v for k, v in state_dict.items()}
    return state_dict


def _model():
    global _MODEL, _KEY_MATCH_INFO
    if _MODEL is None:
        try:
            from huggingface_hub import hf_hub_download

            ckpt = hf_hub_download(
                repo_id=_HF_REPO,
                filename=_HF_FILENAME,
                revision=_HF_REVISION,
                cache_dir=get_settings().model_cache_dir,
            )
            # weights_only=False: this is a legacy pickle checkpoint (numpy
            # scalars in the state dict). This is only acceptable because
            # _HF_REVISION above pins the exact reviewed commit SHA — the
            # trust boundary is that pinned commit, not "whatever main is
            # today". Do not remove the pin without re-reviewing.
            raw = torch.load(ckpt, map_location="cpu", weights_only=False)
            state = raw["state_dict"] if isinstance(raw, dict) and "state_dict" in raw else raw
            state = _strip_module_prefix(state)

            net = Inception3(num_classes=38, aux_logits=True, transform_input=True, in_channels=1)
            result = net.load_state_dict(state, strict=False)
            n_ckpt = len(state)
            n_unexpected = len(result.unexpected_keys)
            n_missing = len(result.missing_keys)
            matched_fraction = (n_ckpt - n_unexpected) / n_ckpt if n_ckpt else 0.0
            _KEY_MATCH_INFO = {
                "checkpoint_keys": n_ckpt,
                "model_keys": len(net.state_dict()),
                "missing_keys": n_missing,
                "unexpected_keys": n_unexpected,
                "matched_fraction": matched_fraction,
            }
        except Exception as e:  # weights download / import failure
            raise RuntimeError(f"xraydar unavailable: {e}")

        if matched_fraction < _MIN_MATCH_FRACTION:
            # Honest failure: do NOT serve sigmoid noise as a real prediction.
            # Raised outside the try/except above so this clear message
            # propagates as-is, without being re-wrapped as "xraydar
            # unavailable: xraydar checkpoint/model architecture mismatch...".
            raise RuntimeError(
                f"xraydar checkpoint/model architecture mismatch: only "
                f"{matched_fraction:.1%} of checkpoint keys matched "
                f"({n_unexpected} unexpected, {n_missing} missing model keys)"
            )
        net.eval()
        _MODEL = net
    return _MODEL


def key_match_info() -> "dict | None":
    """Diagnostics populated after the first load attempt (success or failure
    up to the point of computing the match fraction). Used by the smoke test
    and by ops to verify this provider is loading real weights, not stubs."""
    return _KEY_MATCH_INFO


def _pad_to_square(pil_img: Image.Image) -> Image.Image:
    """Aspect-preserving pad to a square canvas (centered, black padding).

    X-Raydar's own preprocessing (x-raydar-cv) pads the source image to
    square before its resize-to-target-size step, rather than a plain
    aspect-distorting resize, so long/narrow chest films aren't squashed.
    The exact pad color/anchor of the upstream repo's implementation isn't
    pinned here; center-anchored zero-padding is the documented convention
    used when that detail is uncertain.
    """
    w, h = pil_img.size
    side = max(w, h)
    return ImageOps.pad(pil_img, (side, side), color=0, centering=(0.5, 0.5))


def _to_model_input(outbound_png: bytes) -> torch.Tensor:
    """X-Raydar's native is512 preprocessing, from the full-resolution,
    de-identified grayscale PNG (``PreparedImage.outbound_png``) — NOT the
    shared 224x224 torchxrayvision-normalized array used by the local
    TorchXRayVision provider.

    Pipeline: decode -> grayscale (single channel, matches the vendored
    ``Inception3(in_channels=1)``) -> aspect-preserving pad to square ->
    resize to 512x512 -> scale to [0, 1] -> X-Raydar's own
    ``Normalize(mean=0.491, std=0.271)``.
    """
    pil = Image.open(io.BytesIO(outbound_png)).convert("L")
    pil = _pad_to_square(pil)
    pil = pil.resize((_INPUT_SIZE, _INPUT_SIZE), resample=Image.BILINEAR)
    arr = np.asarray(pil).astype("float32") / 255.0  # -> [0, 1]
    t = torch.from_numpy(arr[None, None, ...])
    t = (t - 0.491) / 0.271  # X-Raydar's own Normalize(mean, std)
    return t


class XRaydarProvider(InferenceProvider):
    name = "xraydar"
    educational = True

    def detect(self, prepared) -> list[tuple[str, float]]:
        m = _model()
        t = _to_model_input(prepared.outbound_png)
        try:
            with torch.no_grad():
                logits = m(t)
                probs = torch.sigmoid(logits)[0].cpu().numpy()
        except Exception as e:
            raise RuntimeError(f"xraydar inference failed: {e}")
        n = min(len(_XRAYDAR_LABELS_38), probs.shape[0])
        out = []
        for i in range(n):
            raw_label = _XRAYDAR_LABELS_38[i]
            label = _SHARED_LABEL_MAP.get(raw_label, raw_label)
            out.append((label, float(probs[i])))
        return out
