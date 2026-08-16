"""Runtime config from environment. No heavy deps — safe to import anywhere (incl. tests)."""
import os


def _int(name, default):
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


class Config:
    def __init__(self, env=None):
        e = env if env is not None else os.environ
        # FollowCare (Cloudflare) — the source of truth for eligibility, script, classify, results.
        self.followcare_base = e.get("FOLLOWCARE_BASE", "https://stewardmd.in/api/followcare")
        self.voice_service_token = e.get("FOLLOWCARE_VOICE_SERVICE_TOKEN", "")
        self.app_token = e.get("FOLLOWCARE_APP_TOKEN", "")  # X-App-Token for the app gate, if required
        # Telephony (Plivo) — India account with the required KYC/DID.
        self.plivo_auth_id = e.get("PLIVO_AUTH_ID", "")
        self.plivo_auth_token = e.get("PLIVO_AUTH_TOKEN", "")
        self.plivo_from = e.get("PLIVO_FROM", "")            # caller ID (a Plivo India number)
        self.public_base = e.get("VOICE_PUBLIC_BASE", "")    # https URL Plivo reaches this service at
        self.audio_format = e.get("VOICE_AUDIO_FORMAT", "mulaw")  # plivo stream: "mulaw" | "l16"
        self.sample_rate = _int("VOICE_SAMPLE_RATE", 8000)
        # Automatic Machine Detection (Plivo add-on, FREE): "hangup" drops the call if a machine/voicemail
        # answers, so we never read the wellbeing script to an answering machine. "" disables it.
        self.amd = e.get("VOICE_AMD", "hangup")
        # NLU (Gemini 2.5 Flash) — slot extraction ONLY, never a clinical decision.
        self.gemini_api_key = e.get("GEMINI_API_KEY", "")
        self.gemini_model = e.get("SCRIBE_MODEL", "") or "gemini-2.5-flash"
        # Models on this GPU.
        self.stt_model = e.get("STT_MODEL", "ai4bharat/indic-conformer-600m-multilingual")
        self.tts_model = e.get("TTS_MODEL", "ai4bharat/indic-parler-tts")
        self.device = e.get("VOICE_DEVICE", "cuda")
        # Call behaviour.
        self.max_concurrent = _int("VOICE_MAX_CONCURRENT", 5)
        self.turn_timeout_s = _int("VOICE_TURN_TIMEOUT_S", 8)     # silence window before we treat a turn as done
        self.no_answer_timeout_s = _int("VOICE_NO_ANSWER_TIMEOUT_S", 30)
        self.max_reasks = _int("VOICE_MAX_REASKS", 1)
        self.idle_shutdown_s = _int("VOICE_IDLE_SHUTDOWN_S", 180)  # self-stop the GPU after this idle gap
        # RunPod self-stop (spec §12/§15). The service stops its own pod when the queue drains.
        self.runpod_api_key = e.get("RUNPOD_API_KEY", "")
        # RunPod injects RUNPOD_POD_ID into every pod, so we don't need it set by hand.
        self.runpod_pod_id = e.get("RUNPOD_POD_ID", "")
        # If the public URL wasn't given, derive RunPod's proxy URL from the pod id — this is the address
        # Plivo reaches us at. Saves a manual "paste the URL back in and restart" step during setup.
        if not self.public_base and self.runpod_pod_id:
            self.public_base = "https://" + self.runpod_pod_id + "-8080.proxy.runpod.net"

    def followcare_configured(self):
        return bool(self.followcare_base and self.voice_service_token)

    def telephony_configured(self):
        return bool(self.plivo_auth_id and self.plivo_auth_token and self.plivo_from and self.public_base)
