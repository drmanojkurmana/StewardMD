"""End-of-call structured extraction + posting the result to FollowCare (the clinical source of truth).

The LIVE call spoke plain Telugu for speed. Here, ONCE, we turn the transcript into the strict JSON the
deterministic FollowCare engine expects and POST it to /voice/result (same contract the old RunPod path used).
Extraction uses Sarvam's OpenAI-compatible chat endpoint directly (one short HTTP call, hard timeout).
"""
import json
import urllib.request
import urllib.error

from persona import EXTRACT_SYSTEM


def _sarvam_chat(cfg, system, user, timeout=20):
    """One-shot Sarvam chat completion (OpenAI-compatible). Returns text or "" on any failure."""
    body = json.dumps({
        "model": cfg.get("extract_model", "sarvam-105b-conversations"),
        "temperature": 0.1,
        "max_tokens": 400,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.sarvam.ai/v1/chat/completions", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["sarvam_key"]})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            obj = json.loads(resp.read().decode("utf-8"))
            return (obj.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    except Exception:
        return ""


def _parse_json(text):
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return {}
    return {}


def extract(transcript_pairs, cfg):
    """transcript_pairs: [("PATIENT"|"YOU", text)]. Returns dict {facts, doctor_note, emergency, ambulance}."""
    convo = "\n".join("%s: %s" % (who, txt) for who, txt in transcript_pairs if txt)
    data = _parse_json(_sarvam_chat(cfg, EXTRACT_SYSTEM, convo)) if convo else {}
    return {
        "facts": data.get("facts") if isinstance(data.get("facts"), dict) else {},
        "doctor_note": str(data.get("doctor_note") or ""),
        "emergency": bool(data.get("emergency")),
        "ambulance": bool(data.get("ambulance_requested")),
    }


def post_result(client, call, transcript_pairs, duration_ms, cfg):
    """Extract facts from the transcript and POST the final result to FollowCare. Never raises."""
    try:
        info = extract(transcript_pairs, cfg)
    except Exception:
        info = {"facts": {}, "doctor_note": "", "emergency": False, "ambulance": False}
    try:
        client.post_result({
            "episodeId": call.get("episodeId"), "callId": call.get("callId"),
            "answers": info["facts"], "patientStatement": info["doctor_note"],
            "transcript": transcript_pairs, "conversational": True,
            "ambulanceRequested": info["ambulance"], "emergency": info["emergency"],
            "status": "completed", "durationMs": duration_ms, "lang": call.get("lang", "te")})
    except Exception:
        pass
    return info
