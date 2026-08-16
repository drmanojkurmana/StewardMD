"""Slot extraction with Gemini 2.5 Flash — SPEECH UNDERSTANDING ONLY.

Given a FollowCare question + the patient's transcribed reply, return a structured value the deterministic
engine can score. Gemini NEVER makes a clinical decision here (no diagnosis, no escalation) — escalation is
the engine's job (app.followcare.client.classify). `emergency` is only a fast heuristic hint to let the state
machine offer help sooner; the authoritative call still comes from the engine.

The model call is injectable: `model_call(prompt:str) -> str` (returns the model's text). The default lazily
imports google-generativeai so this module imports with no ML/SDK deps (tests inject a fake model_call).
"""
import json
import re

INTENTS = ("affirm", "deny", "answer", "unclear")

_PROMPT = """You convert a patient's spoken reply into structured data for a post-discharge follow-up call.
You do NOT give medical advice, diagnosis, or decisions. Output STRICT JSON only, no prose.

Question to the patient: {qtext}
Question type: {qtype}
Allowed option values (if any): {options}
Patient's language: {lang}
Patient said (transcribed): "{transcript}"

Return JSON with exactly these keys:
- "intent": one of "affirm","deny","answer","unclear"  (affirm/deny for yes/no; answer if they gave content; unclear if unintelligible or off-topic)
- "value": the value for the engine. For yesno -> "yes"/"no". For scale/number -> a number as a string. For choice/overall -> one allowed option value. Else a short phrase. Use "" if unclear.
- "patient_said": a short faithful paraphrase of what they reported (<=120 chars)
- "emergency": true only if they describe an acute emergency (e.g. severe breathing difficulty, chest pain, collapse), else false
"""


def _default_model_call(config):
    def call(prompt):
        import google.generativeai as genai  # lazy: not needed for tests
        genai.configure(api_key=config.gemini_api_key)
        model = genai.GenerativeModel(config.gemini_model)
        resp = model.generate_content(prompt, generation_config={"temperature": 0, "response_mime_type": "application/json"})
        return resp.text or ""
    return call


def _extract_json(text):
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)  # tolerate stray prose around the JSON
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}
    return {}


class SlotExtractor:
    def __init__(self, config, model_call=None):
        self.cfg = config
        self.model_call = model_call or _default_model_call(config)

    def interpret(self, question, transcript, lang="en"):
        q = question or {}
        prompt = _PROMPT.format(
            qtext=q.get("text", ""), qtype=q.get("type", "text"),
            options=",".join([str(o.get("value", o)) if isinstance(o, dict) else str(o) for o in (q.get("options") or [])]) or "none",
            lang=lang, transcript=(transcript or "").replace('"', "'"),
        )
        try:
            raw = self.model_call(prompt)
        except Exception:
            raw = ""
        data = _extract_json(raw)
        intent = data.get("intent")
        if intent not in INTENTS:
            intent = "unclear" if not transcript else "answer"
        return {
            "intent": intent,
            "value": ("" if data.get("value") is None else str(data.get("value"))),
            "patient_said": str(data.get("patient_said") or transcript or "")[:200],
            "emergency": bool(data.get("emergency")),
        }
