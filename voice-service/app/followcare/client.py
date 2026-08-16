"""Client for the FollowCare (Cloudflare) voice endpoints — the source of truth.

This is the ONLY bridge between the voice service and the clinical engine. It never decides anything
clinical; it fetches the call queue + question script, asks the engine to classify answers mid-call,
posts status transitions, and posts the final result (which the engine scores). Auth = X-Voice-Token.

The HTTP transport is injectable: `transport(method, url, headers, json_body) -> (status:int, obj:dict)`.
The default uses urllib (stdlib) so there is no third-party HTTP dependency; tests inject a fake.
"""
import json
import urllib.request
import urllib.error


def _urllib_transport(method, url, headers, obj):
    data = json.dumps(obj).encode("utf-8") if obj is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read()
            return resp.status, _parse(body)
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read())
    except Exception:
        return 0, {}


def _parse(body):
    try:
        return json.loads(body.decode("utf-8"))
    except Exception:
        return {}


class FollowCareClient:
    def __init__(self, config, transport=None):
        self.cfg = config
        self.transport = transport or _urllib_transport

    def _headers(self):
        h = {"Content-Type": "application/json", "X-Voice-Token": self.cfg.voice_service_token}
        if self.cfg.app_token:
            h["X-App-Token"] = self.cfg.app_token
        return h

    def _url(self, path):
        return self.cfg.followcare_base.rstrip("/") + path

    # GET /voice/queue -> { count, calls:[{callId, episodeId, phone, lang, firstName, questions:[...], ...}] }
    def get_queue(self):
        status, obj = self.transport("GET", self._url("/voice/queue"), self._headers(), None)
        if status != 200:
            return []
        return obj.get("calls", [])

    # POST /voice/classify {episodeId, answers} -> { escalation, redFlag, askAmbulance, needsReview }
    def classify(self, episode_id, answers):
        status, obj = self.transport("POST", self._url("/voice/classify"), self._headers(),
                                     {"episodeId": episode_id, "answers": answers})
        if status != 200 or not obj.get("ok"):
            return {"escalation": "", "askAmbulance": False, "redFlag": False}
        return obj

    # POST /voice/status {callId, status, startedMs?, endedMs?, durationMs?}
    def post_status(self, call_id, patch):
        body = dict(patch or {})
        body["callId"] = call_id
        self.transport("POST", self._url("/voice/status"), self._headers(), body)

    # POST /voice/result {episodeId, callId, answers, patientStatement, ambulanceRequested, durationMs, status}
    def post_result(self, payload):
        status, obj = self.transport("POST", self._url("/voice/result"), self._headers(), payload)
        return obj if status == 200 else {"ok": False, "status_code": status}
