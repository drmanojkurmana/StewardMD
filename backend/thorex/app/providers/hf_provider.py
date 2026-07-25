"""ThoreX Lite: free-tier Hugging Face Inference API provider.

Server-side only — the caller must be health-gated (never invoked unless a
recent health check confirms the HF endpoint is actually serving). Sends the
already de-identified, full-resolution PNG (``prepared.outbound_png``,
produced by Task 8b's redaction step) to the HF serverless Inference API for
the pinned chest-X-ray classification model.

Never fabricates a result: any transport failure, non-200 response, or
unexpected payload shape raises ``RuntimeError`` so the caller surfaces
``inference_unavailable`` rather than a made-up prediction.

The HF token is only ever placed in the ``Authorization`` header of the
outbound request — it must never be logged or included in any exception
message.
"""
import httpx

from app.core.config import get_settings
from app.providers.base import InferenceProvider

# Map HF model label strings -> ThoreX shared labels. Extend per the pinned
# model's card as needed; unmapped labels pass through under their own name
# so findings are never silently dropped.
_LABEL_MAP = {
    "Pneumonia": "Pneumonia",
    "Consolidation": "Consolidation",
    "Effusion": "Effusion",
    "Pleural Effusion": "Effusion",
    "Pneumothorax": "Pneumothorax",
    "Edema": "Edema",
    "Atelectasis": "Atelectasis",
    "Cardiomegaly": "Cardiomegaly",
}
_DROP = {"No Finding", "Normal"}


def _default_post(url, data, headers, timeout):
    return httpx.post(url, content=data, headers=headers, timeout=timeout)


class HFInferenceProvider(InferenceProvider):
    name = "hf_vit"
    educational = False

    def __init__(self, post_fn=_default_post):
        self._post = post_fn

    def detect(self, prepared) -> list[tuple[str, float]]:
        s = get_settings()
        url = f"https://api-inference.huggingface.co/models/{s.hf_model}"
        headers = {
            "Authorization": f"Bearer {s.hf_token}",
            "Content-Type": "image/png",
        }
        try:
            r = self._post(url, prepared.outbound_png, headers, s.hf_timeout_s)
        except Exception as e:
            # Never let the token leak into the error message.
            raise RuntimeError(f"hf request failed: {type(e).__name__}") from e

        if r.status_code != 200:
            raise RuntimeError(f"hf unavailable: status {r.status_code}")

        payload = r.json()
        if not isinstance(payload, list):
            raise RuntimeError("hf unexpected payload: expected a list of label/score dicts")

        out: list[tuple[str, float]] = []
        for item in payload:
            if not isinstance(item, dict) or "label" not in item or "score" not in item:
                raise RuntimeError("hf unexpected payload: item missing label/score")
            label = item["label"]
            if label in _DROP:
                continue
            out.append((_LABEL_MAP.get(label, label), float(item["score"])))
        return out
