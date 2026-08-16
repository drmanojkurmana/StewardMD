"""RunPod self-stop (spec §12/§15): when the call queue drains, the service stops its OWN pod so the GPU
never runs idle. RunPod ONLY (no Google Cloud GPU). Fail-safe: no-op if RunPod env is unset."""
import json
import urllib.request

_RUNPOD_GQL = "https://api.runpod.io/graphql"


class RunPodController:
    def __init__(self, config):
        self.cfg = config

    def configured(self):
        return bool(self.cfg.runpod_api_key and self.cfg.runpod_pod_id)

    def stop_self(self):
        if not self.configured():
            return {"ok": False, "skipped": True}
        query = 'mutation { podStop(input: { podId: "%s" }) { id desiredStatus } }' % self.cfg.runpod_pod_id
        body = json.dumps({"query": query}).encode()
        req = urllib.request.Request(
            _RUNPOD_GQL + "?api_key=" + self.cfg.runpod_api_key, data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return {"ok": r.status == 200}
        except Exception as e:
            return {"ok": False, "error": str(e)}
