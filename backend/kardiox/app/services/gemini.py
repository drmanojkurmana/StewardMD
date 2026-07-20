"""Stage 12 — Clinical explanation (Gemini). REAL implementation.

SAFETY is the whole point of this stage: the LLM must ONLY put the deterministically-validated findings
into plain clinical language. It must not introduce any diagnosis or finding the rule engine did not
validate. We enforce that three ways:
  1. the prompt is built ONLY from validated findings + measurements (build_explanation_prompt);
  2. a strict system instruction forbids adding anything;
  3. the mandated disclaimer is appended SERVER-SIDE (never trusted to the model).

The Gemini API call is real (google-generativeai); it needs a server-side key (settings.gemini_api_key)
and is never exposed to the client. Pure helpers (build_explanation_prompt / enforce_disclaimer) are unit
tested; the network call is validated once a key is configured.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.errors import UpstreamUnavailable
from app.services.base import GeminiProvider

DISCLAIMER = "AI decision support - not a diagnosis. Confirm clinically."

_SYSTEM = (
    "You are an ECG decision-support explainer for physicians. You will be given a list of findings and "
    "measurements that have ALREADY been validated by a deterministic rule engine. Explain ONLY those "
    "validated findings in clear, concise clinical language. You MUST NOT introduce, suggest, or imply "
    "any diagnosis, finding, or recommendation that is not in the provided list. Do not speculate. If the "
    "evidence is limited, say so plainly. Keep it under 120 words."
)


def build_explanation_prompt(validated: dict) -> str:
    """Pure: assemble the constrained prompt from validated findings + measurements only."""
    validated = validated or {}
    inner = validated.get("validated", validated)
    matched = inner.get("matched", []) if isinstance(inner, dict) else []
    features = validated.get("features", {}) if isinstance(validated, dict) else {}

    lines = ["Validated findings (explain only these):"]
    if matched:
        for m in matched:
            w = f" (weight {m['weight']})" if m.get("weight") else ""
            lines.append(f"- {m.get('title', '')}: {m.get('detail', '')}{w}")
    else:
        lines.append("- (none)")
    if features:
        keep = {k: v for k, v in features.items() if v is not None and k in ("ventRateBpm", "qrsMs", "qtcMs", "prMs", "axisDeg", "rhythmLabel", "regularity")}
        if keep:
            lines.append("Measurements: " + ", ".join(f"{k}={v}" for k, v in keep.items()))
    wtv = inner.get("whatToVerify") if isinstance(inner, dict) else None
    if wtv:
        lines.append(f"What to verify: {wtv}")
    lines.append("\nWrite the explanation now. Do NOT add any finding or diagnosis beyond the list above.")
    return _SYSTEM + "\n\n" + "\n".join(lines)


def enforce_disclaimer(text: str) -> str:
    """Guarantee the mandated disclaimer is present, regardless of what the model returned."""
    text = (text or "").strip()
    if DISCLAIMER.lower() in text.lower():
        return text
    return (text + "\n\n" + DISCLAIMER).strip()


class NoneGemini(GeminiProvider):
    name = "none"

    async def explain(self, validated: dict) -> str:
        self._ni()


class GeminiExplainer(GeminiProvider):
    name = "gemini"
    implemented = True

    async def explain(self, validated: dict) -> str:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise UpstreamUnavailable("Gemini API key not configured (KARDIOX_GEMINI_API_KEY)", stage=self.stage)
        prompt = build_explanation_prompt(validated)
        try:
            import google.generativeai as genai  # lazy; only needed when this provider is active
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("google-generativeai not installed", stage=self.stage) from e
        try:
            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel(settings.gemini_model)
            resp = await model.generate_content_async(prompt)
            return enforce_disclaimer(getattr(resp, "text", "") or "")
        except Exception as e:  # network / quota / safety block
            raise UpstreamUnavailable(f"Gemini explanation failed: {type(e).__name__}", stage=self.stage) from e
