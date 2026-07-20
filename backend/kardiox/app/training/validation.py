"""ValidationPipeline — data + provider integrity checks (NOT clinical validation).

Before any training/benchmark run, a dataset provider must be trusted to yield well-formed
`Sample`s. This pipeline streams a bounded prefix of a provider's samples and audits their SHAPE and
CONSISTENCY — it says nothing about clinical correctness of labels, only that the data contract holds:
every Sample has an id, waveforms are 2D (leads, samples) arrays whose first axis matches `leads`,
declared labels live inside the provider's `label_space()`, and `report` is `str | None`. It also
surfaces what was actually seen (distinct leads, sampling rates, modalities, splits) so an operator can
eyeball a provider they just pointed at a fresh data root.

Design choices that keep this cheap + safe:
  • STREAMING + BOUNDED — never loads the whole corpus; caps at `sample_limit` (also passed through to
    `iter_samples` so a real provider like MIMIC-IV-ECG stops early instead of walking ~800k records).
  • CRASH-PROOF — a malformed sample, or an exception mid-stream, is recorded as an issue, never raised.
    A provider that simply has no data returns `available=False` with no issues (data-not-provisioned is a
    valid state, distinct from a buggy provider which reports issues).
  • DEPENDENCY-FREE — waveform shape is inspected by duck typing (numpy-style `.shape` or a nested Python
    sequence), so this module imports NOTHING heavy (no numpy) and stays importable without the ML stack.

Fully exercisable with an in-memory `DatasetProvider` subclass whose `available()` returns True and whose
`iter_samples` yields hand-built `Sample`s (no data root, no numpy required).
"""
from __future__ import annotations

from app.data.base import LABELS, WAVEFORM, DatasetProvider, Sample


def _describe_waveform(waveform: object) -> tuple[int, int] | None:
    """Infer the (n_leads, n_samples) shape of a waveform without importing numpy.

    Expected input:  the value of `Sample.waveform` — a numpy/tensor array with a `.shape`, or a nested
                     Python sequence (list of per-lead rows), or anything else.
    Expected output: `(n_leads, n_samples)` when the value is a well-formed 2D rectangular array; `None`
                     when it is not 2D (scalar/1D/higher-rank) or is ragged (rows of unequal length).
    Failure modes:   none — any un-inspectable value simply yields `None` (the caller records an issue).
    """
    shape = getattr(waveform, "shape", None)
    if shape is not None:                              # numpy array / torch tensor / array-like
        try:
            dims = tuple(int(d) for d in shape)
        except (TypeError, ValueError):
            return None
        return (dims[0], dims[1]) if len(dims) == 2 else None
    try:                                               # nested Python sequence (list of rows)
        rows = list(waveform)  # type: ignore[call-overload]
    except TypeError:
        return None
    if not rows:
        return (0, 0)
    lengths: list[int] = []
    for row in rows:
        if isinstance(row, (str, bytes)) or not hasattr(row, "__len__"):
            return None                                # a "row" is a scalar/str → this is 1D, not 2D
        lengths.append(len(row))
    if len(set(lengths)) != 1:                         # ragged → not a rectangular 2D array
        return None
    return (len(rows), lengths[0])


def _safe_sorted(items) -> list:
    """Sort a collection, falling back to string-key order for heterogeneous/uncomparable values."""
    try:
        return sorted(items)
    except TypeError:
        return sorted(items, key=str)


class ValidationPipeline:
    """Audit a `DatasetProvider` for structural integrity (see module docstring).

    Stateless: construct once and reuse across providers. All configuration is per-call.
    """

    def __init__(self) -> None:
        # No state: kept as a class (not a bare function) to mirror the other training pipelines and to
        # leave room for future per-instance policy without changing call sites.
        pass

    def validate_provider(self, provider: DatasetProvider, sample_limit: int = 200) -> dict:
        """Stream up to `sample_limit` samples and return a structural-integrity report.

        Expected input:  a `DatasetProvider` instance (real, or a synthetic in-memory subclass) and a
                         positive `sample_limit` (max samples to inspect; also passed to `iter_samples`).
        Expected output: a report dict::

            {
              "available":   bool,          # provider.available() (guarded)
              "nSampled":    int,           # samples actually inspected
              "issues":      [str, ...],    # every anomaly found (empty == clean)
              "labelSpace":  [str, ...],    # provider.label_space()
              "modalities":  [str, ...],    # provider.modalities
              "splits":      [str, ...],    # provider.splits()
              "waveformShapes": {"leadsSeen": [str, ...], "fsSeen": [int, ...]},
              "ok":          bool,          # available and no issues
            }

        Checks per sample: id present (non-empty str); if a waveform is present it is a 2D
        (leads, samples) array whose first axis equals `len(leads)`; every label is in `label_space()`
        (when that space is non-empty); `report` is `str | None`. Dataset-level anomalies: a declared
        `labels` modality with an empty label space; inconsistent lead counts across samples; a declared
        `waveform` modality that never produced a waveform in the sampled prefix; an "available" provider
        that streamed zero samples.
        Failure modes:   NONE raised. A bad sample, or an exception from `label_space()`/`splits()`/
                         `available()`/`iter_samples()` (including `DatasetUnavailable`), is captured as an
                         issue string; the report is always returned.
        """
        issues: list[str] = []

        modalities: list[str] = list(getattr(provider, "modalities", ()) or ())

        try:
            label_space: list[str] = list(provider.label_space())
        except Exception as exc:                       # noqa: BLE001 — report, never raise
            label_space = []
            issues.append(f"label_space() raised {type(exc).__name__}: {exc}")
        label_set = set(label_space)

        try:
            splits: list[str] = list(provider.splits())
        except Exception as exc:                       # noqa: BLE001
            splits = []
            issues.append(f"splits() raised {type(exc).__name__}: {exc}")

        try:
            available = bool(provider.available())
        except Exception as exc:                       # noqa: BLE001
            available = False
            issues.append(f"available() raised {type(exc).__name__}: {exc}")

        # dataset-level anomaly known before streaming
        if LABELS in modalities and not label_space:
            issues.append("modality 'labels' declared but label_space() is empty")

        leads_seen: dict[str, None] = {}               # ordered set (insertion order preserved)
        fs_seen: set = set()
        lead_counts: set[int] = set()
        waveform_seen = False
        n_sampled = 0

        if available:
            for sample in self._stream(provider, sample_limit, issues):
                n_sampled += 1
                try:
                    saw_wf = self._check_sample(
                        sample, label_set, bool(label_space),
                        leads_seen, fs_seen, lead_counts, issues,
                    )
                    waveform_seen = waveform_seen or saw_wf
                except Exception as exc:               # noqa: BLE001 — a bad sample must not crash the run
                    sid = getattr(sample, "id", None)
                    issues.append(f"{sid or '<sample>'}: check raised {type(exc).__name__}: {exc}")

            # dataset-level anomalies observable only after the stream
            if len(lead_counts) > 1:
                issues.append(f"inconsistent lead counts across samples: {_safe_sorted(lead_counts)}")
            if WAVEFORM in modalities and n_sampled > 0 and not waveform_seen:
                issues.append("modality 'waveform' declared but no sample carried a waveform")
            if n_sampled == 0:
                issues.append("provider reports available but streamed 0 samples")

        return {
            "available": available,
            "nSampled": n_sampled,
            "issues": issues,
            "labelSpace": label_space,
            "modalities": modalities,
            "splits": splits,
            "waveformShapes": {
                "leadsSeen": list(leads_seen.keys()),
                "fsSeen": _safe_sorted(fs_seen),
            },
            "ok": available and not issues,
        }

    # ── internals ─────────────────────────────────────────────────────────────────────────────────
    def _stream(self, provider: DatasetProvider, limit: int, issues: list[str]):
        """Yield up to `limit` samples, converting any streaming error into an issue (never raising).

        The `limit` is enforced twice: passed to `iter_samples` (so a real provider stops early) AND
        bounded here (so a provider that ignores its `limit` argument still cannot run away).
        """
        try:
            iterator = iter(provider.iter_samples(limit=limit))
        except Exception as exc:                       # noqa: BLE001 — e.g. DatasetUnavailable
            issues.append(f"iter_samples() raised {type(exc).__name__}: {exc}")
            return
        count = 0
        while limit is None or count < limit:
            try:
                sample = next(iterator)
            except StopIteration:
                return
            except Exception as exc:                   # noqa: BLE001 — mid-stream failure
                issues.append(f"iter_samples stream raised {type(exc).__name__}: {exc}")
                return
            count += 1
            yield sample

    def _check_sample(
        self,
        sample: Sample,
        label_set: set,
        has_label_space: bool,
        leads_seen: dict[str, None],
        fs_seen: set,
        lead_counts: set[int],
        issues: list[str],
    ) -> bool:
        """Validate one `Sample` and fold its leads/fs into the running tallies.

        Returns True if the sample carried a (present) waveform, else False. Appends one issue per defect;
        it does not stop at the first (a single sample may have several problems).
        """
        sid = getattr(sample, "id", None)
        tag = sid if (sid and isinstance(sid, str)) else "<sample>"

        if not sid or not isinstance(sid, str):
            issues.append(f"{tag}: missing/invalid id (got {sid!r})")

        report = getattr(sample, "report", None)
        if report is not None and not isinstance(report, str):
            issues.append(f"{tag}: report must be str|None, got {type(report).__name__}")

        labels = getattr(sample, "labels", None) or []
        if has_label_space:
            unknown = [str(lb) for lb in labels if lb not in label_set]
            if unknown:
                issues.append(f"{tag}: labels outside label_space: {unknown}")

        leads = getattr(sample, "leads", None)
        waveform = getattr(sample, "waveform", None)
        has_waveform = waveform is not None
        if has_waveform:
            shape = _describe_waveform(waveform)
            if shape is None:
                issues.append(f"{tag}: waveform is not a 2D (leads, samples) array")
            else:
                n_leads, _n_samples = shape
                lead_counts.add(n_leads)
                if not leads:
                    issues.append(f"{tag}: waveform present but leads is empty/None")
                elif n_leads != len(leads):
                    issues.append(
                        f"{tag}: waveform lead count {n_leads} != len(leads) {len(leads)}")

        if leads:
            for name in leads:
                leads_seen.setdefault(str(name), None)
        fs = getattr(sample, "fs", None)
        if fs is not None:
            fs_seen.add(fs)

        return has_waveform
