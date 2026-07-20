"""API version + wire-format constants. The iOS RemoteAnalyzer pins the MAJOR schema version and sends
the versioned Accept media type; keep these in lockstep with the frontend contract (kardiox-net.js)."""
from __future__ import annotations

API_VERSION = "1.0"          # response schemaVersion; bump MINOR for additive, MAJOR for breaking
SCHEMA_VERSION = "1.0"
V1_PREFIX = "/v1"
MEDIA_TYPE = "application/vnd.kardiox.v1+json"   # Accept header the client sends
