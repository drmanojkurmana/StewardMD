"""Stage 12 — Clinical explanation. Library: google-generativeai (Gemini). README stage 12.

SAFETY: the LLM is constrained to the ALREADY-VALIDATED findings — it explains, it never adds a
diagnosis beyond what the deterministic rules validated. The prompt passes only validated findings +
measurements; the model returns plain language only."""
from __future__ import annotations

from app.services.base import GeminiProvider


class NoneGemini(GeminiProvider):
    name = "none"

    async def explain(self, validated: dict) -> str:
        self._ni()


class GeminiExplainer(GeminiProvider):
    name = "gemini"
    implemented = False

    async def explain(self, validated: dict) -> str:
        # TODO(models): call Gemini with a STRICT system prompt: "Explain ONLY these validated findings in
        # plain clinical language for a physician; do NOT introduce any diagnosis or finding not listed;
        # end with the mandated disclaimer." Pass validated["findings"]/["measurements"]. Return the text.
        # Key comes from settings.gemini_api_key (server-side only — never the client).
        self._ni()
