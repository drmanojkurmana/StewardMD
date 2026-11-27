"""Gateway LLM client: the upstream LLM seam (SEAMS.md seam 1).

Same call signatures and response shape upstream expects
({"raw_response": str, "parsed_response": object}), but every call goes to OUR
gateway (env RESEARCH_GATEWAY_URL) with a per-job bearer token (env
RESEARCH_JOB_TOKEN). No provider key is read, held or forwarded; the upstream
get_genai_client / get_openai_client paths are disabled by seams.py.

Every call, after prompt assembly and before the HTTP request:
  1. phi.scan on the exact assembled text (system instruction included).
     Any hit raises PhiBlockedError (job code phi_blocked).
  2. ceilings from contracts/phase-3/ceilings.md: per-call input/output token
     caps, retry caps, refinement-round caps, plus an adapter-local max-calls
     guard (documented in SEAMS.md; ceilings.md has no per-job call count).
Token usage is recorded per call for the callback / credit settlement.

Gateway request/response shape (the 3.5 gateway adapter implements this):
  POST {RESEARCH_GATEWAY_URL}
  Authorization: Bearer <per-job token>
  {"jobId","projectId","userId","tier","model","system","prompt",
   "maxOutputTokens","purpose"}
  -> {"text": str, "model": str,
      "usage": {"inputTokens": int, "outputTokens": int}}
"""
from __future__ import annotations

import json
import os
import time

import httpx

from . import phi

# Frozen defaults from ceilings.md (T1/T2/T3 AI rows). Changing a number is a
# reviewed contract change.
TIER_CEILINGS = {
    "T1": {"max_input_tokens": 8000, "max_output_tokens": 2000,
           "max_retries": 2, "max_refinement_rounds": 1},
    "T2": {"max_input_tokens": 16000, "max_output_tokens": 4000,
           "max_retries": 2, "max_refinement_rounds": 2},
    "T3": {"max_input_tokens": 24000, "max_output_tokens": 4000,
           "max_retries": 1, "max_refinement_rounds": 1},
}
# Adapter-local runaway guard, NOT a ceilings.md row (see SEAMS.md).
DEFAULT_MAX_CALLS = 64


class CeilingError(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(code + (": " + detail if detail else ""))


class GatewayError(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(code + (": " + detail if detail else ""))


GATEWAY_FRAMING_TOKENS = 1000
# Must stay above the gateway's own call deadline (LLM_CALL_DEADLINE_MS = 120 s in _gateway.js).
GATEWAY_HTTP_TIMEOUT_SECONDS = 150.0


def estimate_tokens(text: str) -> int:
    """Deterministic pre-call estimate (~4 chars/token). The gateway's actual
    usage is what gets recorded and checked against the output ceiling."""
    return len(text) // 4 + 1


def _part_text(part) -> str:
    """Extract text from a str or a google.genai types.Part. Binary parts are
    refused except the application/pdf text stand-in written by the seams.py
    compile_latex replacement (the adapter pipeline never renders real PDFs)."""
    if isinstance(part, str):
        return part
    text = getattr(part, "text", None)
    if text:
        return text
    inline = getattr(part, "inline_data", None)
    if inline is not None:
        mime = getattr(inline, "mime_type", "") or ""
        data = getattr(inline, "data", b"") or b""
        if mime == "application/pdf":
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                raise GatewayError("gateway_text_only",
                                   "binary PDF part; adapter pipeline is text-only")
        raise GatewayError("gateway_text_only", "binary part mime " + mime)
    raise GatewayError("gateway_text_only", "unsupported content part")


class GatewayLLMClient:
    def __init__(self, *, gateway_url=None, job_token=None, job_id="job_local",
                 project_id="proj_local", user_id="user_local", tier="T2",
                 max_calls=DEFAULT_MAX_CALLS, http_client=None,
                 sleep=time.sleep, now=time.time):
        if tier not in TIER_CEILINGS:
            raise ValueError("unknown tier " + str(tier))
        self.gateway_url = gateway_url or os.environ.get("RESEARCH_GATEWAY_URL", "")
        self.job_token = job_token or os.environ.get("RESEARCH_JOB_TOKEN", "")
        self.job_id = job_id
        self.project_id = project_id
        self.user_id = user_id
        self.tier = tier
        self.ceilings = dict(TIER_CEILINGS[tier])
        self.max_calls = max_calls
        self.calls = 0
        self.refinement_rounds = 0
        self.usage = []  # per-call token records (plan section 6 logging)
        self._http = http_client
        self._sleep = sleep
        self._now = now

    # -- upstream-compatible entry points -----------------------------------

    def call_contents(self, contents, model_name, max_retries=None,
                      base_interval_sec=None, result_parsing_func=None,
                      generation_configs=None, check_parsed_response_not_none=True,
                      purpose="write"):
        configs = dict(generation_configs or {})
        system = configs.pop("system_instruction", None)
        # Upstream literature discovery asks for the google_search tool. The
        # gateway has no such tool; candidates stay unverified suggestions and
        # are enriched only through our connectors (search.py).
        configs.pop("tools", None)
        configs.pop("temperature", None)  # gateway owns sampling per tier
        text = "\n\n".join(_part_text(p) for p in contents)
        return self._call(text, system, model_name, result_parsing_func,
                          check_parsed_response_not_none, purpose)

    def call_text(self, prompt, model_name, result_parsing_func=None,
                  generation_configs=None, check_parsed_response_not_none=True,
                  max_retries=None, base_interval_sec=None, purpose="write"):
        configs = dict(generation_configs or {})
        system = configs.pop("system_instruction", None)
        configs.pop("tools", None)
        configs.pop("temperature", None)
        return self._call(prompt, system, model_name, result_parsing_func,
                          check_parsed_response_not_none, purpose)

    def call_images(self, prompt, images, model_name, generation_configs=None,
                    check_parsed_response_not_none=True, return_json=True,
                    result_parsing_func=None, purpose="write"):
        if images:
            raise GatewayError("gateway_text_only",
                               "image inputs are not sent; figures are deterministic")
        return self.call_text(prompt, model_name,
                              result_parsing_func=result_parsing_func,
                              generation_configs=generation_configs,
                              check_parsed_response_not_none=check_parsed_response_not_none,
                              purpose=purpose)

    def call_pdf(self, pdf_path, prompt, model_name, system_instruction=None,
                 temperature=0.7, check_parsed_response_not_none=True,
                 return_json=True, result_parsing_func=None, purpose="write"):
        with open(pdf_path, "r", encoding="utf-8") as f:
            paper_text = f.read()
        configs = {"system_instruction": system_instruction} if system_instruction else {}
        return self.call_text("Paper Content:\n" + paper_text + "\n\nTask:\n" + prompt,
                              model_name, result_parsing_func=result_parsing_func,
                              generation_configs=configs,
                              check_parsed_response_not_none=check_parsed_response_not_none,
                              purpose=purpose)

    # -- core ----------------------------------------------------------------

    def _default_parser(self, raw):
        from utils.gemini_utils import parse_gemini_json_results
        return parse_gemini_json_results(raw)

    def _call(self, prompt, system, model_name, result_parsing_func,
              check_not_none, purpose):
        if not self.gateway_url or not self.job_token:
            raise GatewayError("gateway_unconfigured",
                               "RESEARCH_GATEWAY_URL and RESEARCH_JOB_TOKEN required")
        assembled = (system + "\n\n" if system else "") + prompt

        # 1. PHI gate on the exact text about to leave (phi-gate.md placement).
        report = phi.scan(assembled)
        if report["blocked"]:
            raise phi.PhiBlockedError(report["hits"])

        # 2. Ceilings, before any network call.
        if purpose == "refinement":
            if self.refinement_rounds >= self.ceilings["max_refinement_rounds"]:
                raise CeilingError("ceiling_refinement_rounds",
                                   f"tier {self.tier} allows "
                                   f"{self.ceilings['max_refinement_rounds']}")
            self.refinement_rounds += 1
        if self.calls >= self.max_calls:
            raise CeilingError("ceiling_calls", f"max {self.max_calls} calls per job")
        # The gateway prepends its own framing (RESEARCH_FRAMING in _gateway.js, well under 1,000 tokens) before
        # its ceiling check, so reserve that here or a call just under the ceiling fails there with HTTP 400.
        est_in = estimate_tokens(assembled) + GATEWAY_FRAMING_TOKENS
        if est_in > self.ceilings["max_input_tokens"]:
            raise CeilingError("ceiling_input_tokens",
                               f"estimate {est_in} > {self.ceilings['max_input_tokens']}")

        body = {
            "jobId": self.job_id, "projectId": self.project_id, "userId": self.user_id,
            "tier": self.tier, "model": model_name,
            "prompt": prompt, "maxOutputTokens": self.ceilings["max_output_tokens"],
            "purpose": purpose,
        }
        # The gateway accepts a string or no system field; JSON null is a 400 invalid_body.
        if isinstance(system, str) and system:
            body["system"] = system
        raw_body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        # job_token may be a callable that mints a fresh token per call: the gateway
        # caps a token at 15 minutes and a full draft can run longer than that.
        token = self.job_token() if callable(self.job_token) else self.job_token
        headers = {"Content-Type": "application/json",
                   "Authorization": "Bearer " + token}
        client = self._http or httpx.Client()
        owns_client = self._http is None
        attempts = 1 + self.ceilings["max_retries"]
        try:
            last_error = None
            for attempt in range(attempts):
                # A retried unparseable reply already counted a call, so the
                # max-calls guard must hold on retries too, not only pre-loop.
                if attempt and self.calls >= self.max_calls:
                    raise CeilingError("ceiling_calls",
                                       f"max {self.max_calls} calls per job")
                try:
                    resp = client.post(self.gateway_url, content=raw_body,
                                       headers=headers, timeout=GATEWAY_HTTP_TIMEOUT_SECONDS)
                except httpx.HTTPError as exc:
                    last_error = GatewayError("gateway_transport", str(exc))
                else:
                    if 200 <= resp.status_code < 300:
                        try:
                            return self._finish(resp, model_name, purpose,
                                                result_parsing_func, check_not_none)
                        except GatewayError as exc:
                            # A reply we cannot decode is retryable, like 429/5xx.
                            # CeilingError (output tokens) is not a GatewayError
                            # and keeps failing fast.
                            if exc.code not in ("unparseable_response",
                                                "gateway_bad_response"):
                                raise
                            last_error = exc
                    elif resp.status_code == 429 or resp.status_code >= 500:
                        last_error = GatewayError("gateway_http_" + str(resp.status_code))
                    else:
                        # Keep the gateway's own error code (e.g. ceiling_input_tokens) so a failed job says why.
                        detail = ""
                        try:
                            detail = str(((resp.json() or {}).get("error") or {}).get("code") or "")
                            detail = "".join(ch for ch in detail.lower() if ch.isalnum() or ch == "_")[:40]
                        except Exception:
                            # Not our JSON envelope (an edge or proxy page): keep a short, sanitised hint.
                            raw = (resp.text or "")[:60].lower().replace(" ", "_")
                            hint = "".join(ch for ch in raw if ch.isalnum() or ch == "_")[:30]
                            detail = ("nj_" + hint) if hint else ""
                        raise GatewayError("gateway_http_" + str(resp.status_code) + ("__" + detail if detail else ""),
                                           "non-retryable")
                if attempt < attempts - 1:
                    self._sleep(2 ** attempt)
            raise last_error
        finally:
            if owns_client:
                client.close()

    def _finish(self, resp, model_name, purpose, result_parsing_func, check_not_none):
        try:
            payload = resp.json()
            raw = payload["text"]
        except (ValueError, KeyError, TypeError):
            raise GatewayError("gateway_bad_response")
        usage = payload.get("usage") or {}
        in_tok = int(usage.get("inputTokens", usage.get("input_tokens", 0)))
        out_tok = int(usage.get("outputTokens", usage.get("output_tokens", 0)))
        if out_tok > self.ceilings["max_output_tokens"]:
            raise CeilingError("ceiling_output_tokens",
                               f"{out_tok} > {self.ceilings['max_output_tokens']}")
        self.calls += 1
        self.usage.append({
            "jobId": self.job_id, "projectId": self.project_id, "userId": self.user_id,
            "tier": self.tier, "modelRequested": model_name,
            "model": payload.get("model", model_name), "purpose": purpose,
            "inputTokens": in_tok, "outputTokens": out_tok, "ts": int(self._now()),
        })
        parser = result_parsing_func if result_parsing_func is not None else self._default_parser
        parsed = parser(raw)
        if check_not_none and parsed is None:
            raise GatewayError("unparseable_response")
        return {"raw_response": raw, "parsed_response": parsed}

    def total_usage(self) -> dict:
        return {"calls": self.calls,
                "inputTokens": sum(u["inputTokens"] for u in self.usage),
                "outputTokens": sum(u["outputTokens"] for u in self.usage)}
