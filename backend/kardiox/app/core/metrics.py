"""Lightweight, dependency-free metrics (Prometheus text exposition).

Avoids pulling prometheus_client into the base image. Thread-safe counters/gauges + a latency
accumulator (sum + count per series). Rendered at GET /metrics. Series names use snake_case with a
`kardiox_` prefix; labels are rendered inline. For high-cardinality production monitoring, swap in
prometheus_client behind the same call sites — this module is intentionally minimal.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict


class _Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, float] = defaultdict(float)
        self._gauges: dict[str, float] = defaultdict(float)
        self._lat_sum: dict[str, float] = defaultdict(float)
        self._lat_count: dict[str, float] = defaultdict(float)

    @staticmethod
    def _key(name: str, labels: dict | None) -> str:
        if not labels:
            return name
        lbl = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
        return f"{name}{{{lbl}}}"

    def inc(self, name: str, labels: dict | None = None, value: float = 1.0) -> None:
        with self._lock:
            self._counters[self._key(name, labels)] += value

    def set_gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        with self._lock:
            self._gauges[self._key(name, labels)] = value

    def add_gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        with self._lock:
            self._gauges[self._key(name, labels)] += value

    def observe(self, name: str, seconds: float, labels: dict | None = None) -> None:
        k = self._key(name, labels)
        with self._lock:
            self._lat_sum[k] += seconds
            self._lat_count[k] += 1

    @staticmethod
    def _suffix(key: str, suffix: str) -> str:
        if "{" in key:
            name, rest = key.split("{", 1)
            return f"{name}{suffix}{{{rest}"
        return key + suffix

    def render(self) -> str:
        lines: list[str] = []
        with self._lock:
            for k, v in sorted(self._counters.items()):
                lines.append(f"{k} {v}")
            for k, v in sorted(self._gauges.items()):
                lines.append(f"{k} {v}")
            for k in sorted(self._lat_count):
                lines.append(f"{self._suffix(k, '_sum')} {self._lat_sum[k]}")
                lines.append(f"{self._suffix(k, '_count')} {self._lat_count[k]}")
        return "\n".join(lines) + "\n"


METRICS = _Metrics()


class latency:
    """Context manager: records elapsed monotonic seconds into a latency series."""

    def __init__(self, name: str, labels: dict | None = None) -> None:
        self._name, self._labels = name, labels

    def __enter__(self):
        self._t = time.monotonic()
        return self

    def __exit__(self, *exc) -> None:
        METRICS.observe(self._name, time.monotonic() - self._t, self._labels)
