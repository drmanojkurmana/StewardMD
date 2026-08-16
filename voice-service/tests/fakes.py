"""In-memory fakes so the whole call loop runs offline (no GPU, no Plivo, no network)."""


class FakeTelephony:
    """Drives turn-taking from a scripted list of patient utterances (as text)."""
    def __init__(self, script, answered=True):
        self._script = list(script)
        self._answered = answered
        self.played = []

    async def dial(self, call):
        return self._answered

    async def listen(self, timeout_s):
        if not self._script:
            return None                      # silence / hangup
        return self._script.pop(0).encode("utf-8")

    async def play(self, pcm):
        self.played.append(pcm.decode("utf-8") if isinstance(pcm, (bytes, bytearray)) else str(pcm))

    async def hangup(self):
        pass


class FakeSTT:
    def transcribe(self, pcm, lang="en"):
        return pcm.decode("utf-8") if isinstance(pcm, (bytes, bytearray)) else str(pcm)


class FakeTTS:
    def synth(self, text, lang="en"):
        return text.encode("utf-8")


class FakeNLU:
    """Keyword slot-extractor stand-in (the real one is Gemini)."""
    def interpret(self, question, transcript, lang="en"):
        t = (transcript or "").strip().lower()
        if t in ("yes", "yeah", "yep", "speaking", "that's me", "correct", "yes speaking"):
            return {"intent": "affirm", "value": "yes", "patient_said": transcript, "emergency": False}
        if t in ("no", "nope", "wrong number", "wrong person"):
            return {"intent": "deny", "value": "no", "patient_said": transcript, "emergency": False}
        if t in ("", "...", "hmm"):
            return {"intent": "unclear", "value": "", "patient_said": transcript, "emergency": False}
        emergency = ("breath" in t) or ("chest pain" in t) or ("collaps" in t) or ("severe" in t)
        if "better" in t:
            value = "better"
        elif "worse" in t:
            value = "worse"
        else:
            value = transcript
        return {"intent": "answer", "value": value, "patient_said": transcript, "emergency": emergency}


class FakeClient:
    """Stands in for the Cloudflare FollowCare engine endpoints."""
    def __init__(self, queue=None):
        self.queue = queue or []
        self.statuses = []
        self.results = []

    def get_queue(self):
        return self.queue

    def classify(self, episode_id, answers):
        worse = any("worse" in str(v).lower() for v in (answers or {}).values())
        return {"escalation": "orange" if worse else "green", "askAmbulance": False, "redFlag": worse}

    def post_status(self, call_id, patch):
        self.statuses.append((call_id, patch))

    def post_result(self, payload):
        self.results.append(payload)
        return {"ok": True}
