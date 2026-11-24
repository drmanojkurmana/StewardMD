"""Literature search seam (SEAMS.md seam 2): our connectors instead of S2.

Replaces utils.scholar_utils.s2_title_search (bound into
methods.agents.literature_review_agent at import) with a client that calls the
ResearchMD API (env RESEARCH_API_URL), which runs the Phase 2.3 connectors
(PubMed, Europe PMC, Crossref; S2 only if its terms allow). The worker never
calls a database directly and holds no database keys.

Auth: HMAC signed exactly like the Phase 3 callback contract
(contracts/phase-3/callback.md): X-Research-Timestamp + X-Research-Signature =
hex HMAC-SHA256(RESEARCH_CALLBACK_SECRET, timestamp + "." + rawBody).
sign_callback is reused from research_worker.jobs so both sides share one
implementation and the contract test vector.

API endpoint (PENDING the API builder, functions/** is another package):
  POST {RESEARCH_API_URL}/api/research/v1/internal/literature-search
  {"jobId","projectId","query","databases","dateTo","limit"}
  -> {"records":[{source, externalId, title, authors, year, doi, abstract,
                  publicationDate, venue, journal, extra}]}
Records use the Phase 2 normalised shape (contracts/phase-2/connector-api.md)
plus abstract/publicationDate/venue when the database returns them. The
endpoint must verify the HMAC before parsing, like the callback handler.

The return value of s2_title_search keeps upstream's expected S2 record shape
(title, authors [{name}], venue, year, abstract, citationCount, journal,
publicationDate) and adds externalIds with DOI/PMID. Upstream's PaperData
drops unknown keys, so identifiers are also kept in self.identifiers keyed by
normalised title; seams.py injects them into citation_map.json for the gates.
"""
from __future__ import annotations

import datetime
import json
import os
import re
import time

import httpx
from thefuzz import fuzz

from research_worker.jobs import sign_callback

SEARCH_PATH = "/api/research/v1/internal/literature-search"
DEFAULT_DATABASES = ["pubmed", "europe_pmc", "crossref"]


class SearchError(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(code + (": " + detail if detail else ""))


def normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (title or "").lower())


def _date_valid(pub_date, year, cutoff_str) -> bool:
    """Same cutoff semantics as upstream scholar_utils.is_date_valid."""
    if not cutoff_str:
        return True
    try:
        c_year, c_month = map(int, cutoff_str.split("-")[:2])
        cutoff = datetime.datetime(c_year, c_month, 1)
        if pub_date:
            try:
                return datetime.datetime.strptime(str(pub_date)[:10], "%Y-%m-%d") < cutoff
            except ValueError:
                pass
        if year:
            year = int(year)
            if year < c_year:
                return True
            if year == c_year and c_month > 1:
                return True
            return False
        return True
    except Exception:
        return True


def cutoff_to_date_to(cutoff_date):
    """YYYY-MM cutoff -> YYYY-MM-DD upper bound (last day of that month)."""
    if not cutoff_date:
        return None
    parts = str(cutoff_date).split("-")
    year, month = int(parts[0]), int(parts[1]) if len(parts) > 1 else 12
    if month == 12:
        nxt = datetime.date(year + 1, 1, 1)
    else:
        nxt = datetime.date(year, month + 1, 1)
    return (nxt - datetime.timedelta(days=1)).isoformat()


def record_to_s2(rec: dict) -> dict:
    """Phase 2 normalised record -> upstream's expected S2 search record."""
    extra = rec.get("extra") or {}
    source = rec.get("source", "")
    external_id = str(rec.get("externalId", ""))
    doi = rec.get("doi") or extra.get("doi") or ""
    pmid = ""
    if source == "pubmed":
        pmid = external_id
    elif extra.get("pmid"):
        pmid = str(extra["pmid"])
    journal_name = (rec.get("journal") or extra.get("fulljournalname")
                    or extra.get("journalTitle") or extra.get("container-title") or "")
    if isinstance(journal_name, list):
        journal_name = journal_name[0] if journal_name else ""
    venue = rec.get("venue") or journal_name or source
    abstract = (rec.get("abstract") or extra.get("abstract")
                or extra.get("abstractText") or "")
    year = rec.get("year")
    return {
        "title": rec.get("title", ""),
        "authors": [{"name": a} for a in (rec.get("authors") or [])],
        "venue": venue,
        "year": int(year) if year else None,
        "abstract": abstract,
        "citationCount": int(extra.get("citationCount") or 0),
        "journal": {"name": journal_name,
                    "volume": extra.get("volume"),
                    "pages": extra.get("pages")},
        "publicationDate": rec.get("publicationDate") or extra.get("publicationDate") or "",
        "externalIds": {"DOI": doi, "PMID": pmid,
                        **({"CorpusId": external_id} if source == "semantic_scholar" else {})},
        "doi": doi,
        "pmid": pmid,
        "source": source,
        "externalId": external_id,
    }


class ConnectorSearch:
    def __init__(self, *, api_url=None, secret=None, project_id="proj_local",
                 job_id="job_local", databases=None, http_client=None,
                 sleep=time.sleep, now=time.time, limit=10):
        self.api_url = (api_url or os.environ.get("RESEARCH_API_URL", "")).rstrip("/")
        self.secret = secret or os.environ.get("RESEARCH_CALLBACK_SECRET", "")
        self.project_id = project_id
        self.job_id = job_id
        self.databases = list(databases or DEFAULT_DATABASES)
        self.limit = limit
        self.identifiers = {}  # normalised title -> {doi, pmid, source, externalId}
        self._http = http_client
        self._sleep = sleep
        self._now = now

    def _post(self, payload: dict) -> dict:
        if not self.api_url or not self.secret:
            raise SearchError("search_unconfigured",
                              "RESEARCH_API_URL and RESEARCH_CALLBACK_SECRET required")
        raw_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(self._now()))
        signature = sign_callback(self.secret, timestamp, raw_body)
        client = self._http or httpx.Client()
        owns = self._http is None
        try:
            resp = client.post(
                self.api_url + SEARCH_PATH, content=raw_body,
                headers={"Content-Type": "application/json",
                         "X-Research-Timestamp": timestamp,
                         "X-Research-Signature": signature},
                timeout=30.0)
        except httpx.HTTPError as exc:
            raise SearchError("search_transport", str(exc))
        finally:
            if owns:
                client.close()
        if not (200 <= resp.status_code < 300):
            raise SearchError("search_http_" + str(resp.status_code))
        try:
            return resp.json()
        except ValueError:
            raise SearchError("search_bad_response")

    def discover(self, query: str, date_to=None, limit=None) -> list:
        """Run our connectors through the API; returns normalised records.
        Also the entry point for the literature suggester into screening (3.7):
        suggestions are unverified until a human accepts them."""
        payload = {"jobId": self.job_id, "projectId": self.project_id,
                   "query": query, "databases": self.databases,
                   "dateTo": date_to, "limit": limit or self.limit}
        records = self._post(payload).get("records") or []
        for rec in records:
            s2 = record_to_s2(rec)
            self.identifiers[normalize_title(s2["title"])] = {
                "doi": s2["doi"], "pmid": s2["pmid"],
                "source": s2["source"], "externalId": s2["externalId"],
            }
        return records

    def s2_title_search(self, title_query: str, year_hint=None, cutoff_date=None):
        """Drop-in for utils.scholar_utils.s2_title_search: best fuzzy title
        match above ratio 70 (+10 for a year-hint match), cutoff filtered,
        or None. Same thresholds as upstream lines 87-97."""
        records = self.discover(title_query, date_to=cutoff_to_date_to(cutoff_date))
        best, highest = None, 0
        for rec in records:
            s2 = record_to_s2(rec)
            if not s2["title"]:
                continue
            if not _date_valid(s2["publicationDate"], s2["year"], cutoff_date):
                continue
            ratio = fuzz.ratio(title_query.lower(), s2["title"].lower())
            if year_hint and s2["year"] == year_hint:
                ratio += 10
            if ratio > highest:
                highest, best = ratio, s2
        if highest > 70:
            self.identifiers[normalize_title(best["title"])] = {
                "doi": best["doi"], "pmid": best["pmid"],
                "source": best["source"], "externalId": best["externalId"],
            }
            return best
        return None
