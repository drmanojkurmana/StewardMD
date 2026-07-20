"""Structured (JSON) logging via structlog.

PRIVACY: never log image bytes or patient/finding text. Correlate by the ephemeral `session_id` only
(README: "No PII in URLs or logs"). Use `bind_request(session_id=...)` to attach it to the context.
"""
from __future__ import annotations

import logging
import sys

import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=getattr(logging, level.upper(), logging.INFO))
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.INFO)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "kardiox"):
    return structlog.get_logger(name)


_audit = structlog.get_logger("kardiox.audit")


def audit(event: str, **fields) -> None:
    """Structured audit trail (PII-free). Records WHO/WHAT/OUTCOME by request/session id only — never
    image bytes or clinical text. Emitted for analysis lifecycle + security events."""
    _audit.info(event, audit=True, **fields)


def bind_request(**kwargs) -> None:
    """Attach request-scoped, PII-free fields (session_id, stage, latency_ms) to every log line."""
    structlog.contextvars.bind_contextvars(**kwargs)


def clear_request() -> None:
    structlog.contextvars.clear_contextvars()
