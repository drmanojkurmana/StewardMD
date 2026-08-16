"""StewardMD FollowCare — AI voice fallback service (RunPod).

Phase 2/3. The ONLY things that live here are the voice transport + on-GPU models:
Plivo audio streaming <-> IndicConformer STT <-> Gemini 2.5 Flash (slot extraction ONLY)
<-> the EXISTING FollowCare deterministic engine (over HTTP, via app.followcare.client)
<-> Indic Parler-TTS <-> Plivo.

No clinical reasoning lives here. Every escalation/score decision is the FollowCare
engine on Cloudflare (app.followcare.client.classify / post_result). RunPod runs the GPU
only during a call window and self-stops when the queue drains.
"""

__version__ = "0.2.0"
