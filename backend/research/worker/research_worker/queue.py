"""Cloudflare Queues HTTP pull client.

Endpoints (verified against the pull-consumer docs, 2026-11-23):
  POST /accounts/{acct}/queues/{queue_id}/messages/pull
  POST /accounts/{acct}/queues/{queue_id}/messages/ack
Bearer token needs queues read AND write (ack mutates state).

Lease extension: the HTTP pull API has NO extension or heartbeat endpoint.
Visibility is set once per pull (visibility_timeout_ms, max 12 h). Long jobs
must fit the lease chosen at pull time; see worker-runtime.md for the lease
math and why redelivery is safe (idempotent results plus callback replay).
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass

import httpx

API_BASE = "https://api.cloudflare.com/client/v4"


class QueueError(Exception):
    """Queue API call failed (transport, non-2xx, or success=false)."""


@dataclass
class Message:
    id: str
    lease_id: str
    attempts: int
    body: dict | None  # decoded JSON; None when the body is malformed
    raw_body: str
    content_type: str = ""


def _decode_body(raw: str, content_type: str) -> dict | None:
    """Pull delivers json/bytes content types base64-encoded, text as UTF-8."""
    # Try both forms for every type: production delivered json messages that the base64-only path could not
    # read, so every job was retried to the dead-letter queue (2026-11-27).
    candidates = ["base64", "plain"] if content_type in ("json", "bytes") else ["plain", "base64"]
    for mode in candidates:
        text = raw
        if mode == "base64":
            try:
                text = base64.b64decode(raw).decode("utf-8")
            except Exception:
                continue
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict):
            return value
    return None


class QueueClient:
    def __init__(
        self,
        account_id: str | None = None,
        queue_id: str | None = None,
        token: str | None = None,
        *,
        client: httpx.Client | None = None,
        api_base: str = API_BASE,
        timeout: float = 30.0,
    ):
        self.account_id = account_id or os.environ["CF_ACCOUNT_ID"]
        self.queue_id = queue_id or os.environ["CF_QUEUE_ID"]
        self._token = token or os.environ["CF_QUEUES_TOKEN"]
        self._api_base = api_base.rstrip("/")
        self._client = client or httpx.Client(timeout=timeout)
        self._owns_client = client is None

    def close(self):
        if self._owns_client:
            self._client.close()

    def _url(self, action: str) -> str:
        return f"{self._api_base}/accounts/{self.account_id}/queues/{self.queue_id}/messages/{action}"

    def _post(self, action: str, payload: dict) -> dict:
        try:
            resp = self._client.post(
                self._url(action),
                json=payload,
                headers={"Authorization": f"Bearer {self._token}"},
            )
        except httpx.HTTPError as exc:
            raise QueueError(f"queue {action} transport error") from exc
        if resp.status_code != 200:
            raise QueueError(f"queue {action} HTTP {resp.status_code}")
        data = resp.json()
        if not data.get("success"):
            raise QueueError(f"queue {action} rejected: {data.get('errors')}")
        return data.get("result") or {}

    def pull(self, batch_size: int = 5, visibility_timeout_ms: int = 900_000) -> list[Message]:
        result = self._post(
            "pull",
            {"visibility_timeout_ms": visibility_timeout_ms, "batch_size": batch_size},
        )
        messages = []
        for raw in result.get("messages") or []:
            body_text = raw.get("body") or ""
            content_type = (raw.get("metadata") or {}).get("CF-Content-Type", "")
            messages.append(
                Message(
                    id=raw.get("id", ""),
                    lease_id=raw.get("lease_id", ""),
                    attempts=int(raw.get("attempts", 1)),
                    body=_decode_body(body_text, content_type),
                    raw_body=body_text,
                    content_type=content_type,
                )
            )
        return messages

    def ack(self, lease_ids: list[str]) -> None:
        if not lease_ids:
            return
        self._post("ack", {"acks": [{"lease_id": lid} for lid in lease_ids], "retries": []})

    def retry(self, lease_id: str, delay_seconds: int = 0) -> None:
        entry: dict = {"lease_id": lease_id}
        if delay_seconds > 0:
            entry["delay_seconds"] = delay_seconds
        self._post("ack", {"acks": [], "retries": [entry]})