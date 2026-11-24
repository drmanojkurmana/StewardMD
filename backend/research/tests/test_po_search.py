"""Search seam tests: our connectors through the API, callback-style HMAC,
upstream S2 record shape with DOI/PMID. No network (MockTransport)."""
from __future__ import annotations

import json

import pytest

from paperorchestra.adapter.po_adapter.search import (
    ConnectorSearch, cutoff_to_date_to, record_to_s2)
from research_worker.jobs import sign_callback
from test_po_common import make_search, pubmed_record


def test_callback_contract_test_vector():
    # contracts/phase-3/callback.md: both sides must reproduce this in CI.
    raw = (b'{"jobId":"job_1","idempotencyKey":"k1","status":"done",'
           b'"resultKey":"projects/p1/jobs/job_1/result.json",'
           b'"usage":{"pages":2,"seconds":1.5}}')
    assert sign_callback("test-secret", "1763900000", raw) == (
        "d9526eaa7328d6c49e32502c09811b05d46cdea2f82ec680ab29afe838c487e5")


def test_request_is_signed_like_the_callback():
    search, requests = make_search([pubmed_record()])
    search.discover("intervention X outcome Y")
    request = requests[0]
    assert request.url.path == "/api/research/v1/internal/literature-search"
    timestamp = request.headers["X-Research-Timestamp"]
    assert timestamp == "1763900000"
    expected = sign_callback("test-secret", timestamp, request.content)
    assert request.headers["X-Research-Signature"] == expected
    body = json.loads(request.content)
    assert body["projectId"] == "p1" and body["jobId"] == "job_1"
    assert "pubmed" in body["databases"]
    # Compact JSON, no spaces: the signature covers exactly these bytes.
    assert b", " not in request.content


def test_s2_title_search_returns_upstream_shape_with_identifiers():
    search, _ = make_search([pubmed_record()])
    result = search.s2_title_search("Effect of intervention X on outcome Y",
                                    year_hint=2019, cutoff_date="2024-11")
    assert result is not None
    assert result["title"] == "Effect of intervention X on outcome Y"
    assert result["authors"] == [{"name": "Smith J"}, {"name": "Doe A"}]
    assert result["year"] == 2019
    assert result["abstract"].startswith("Background")
    assert result["externalIds"]["PMID"] == "12345678"
    assert result["externalIds"]["DOI"] == "10.1000/example"
    assert result["publicationDate"] == "2019-06-01"
    ids = search.identifiers["effectofinterventionxonoutcomey"]
    assert ids["pmid"] == "12345678" and ids["doi"] == "10.1000/example"


def test_s2_title_search_fuzzy_threshold():
    search, _ = make_search([pubmed_record(title="A completely unrelated paper")])
    assert search.s2_title_search("Effect of intervention X on outcome Y") is None


def test_cutoff_filters_later_papers():
    search, _ = make_search([pubmed_record(year=2025, publicationDate="2025-02-01")])
    assert search.s2_title_search("Effect of intervention X on outcome Y",
                                  cutoff_date="2024-11") is None


def test_cutoff_to_date_to():
    assert cutoff_to_date_to("2024-11") == "2024-11-30"
    assert cutoff_to_date_to("2024-12") == "2024-12-31"
    assert cutoff_to_date_to("2024-02") == "2024-02-29"
    assert cutoff_to_date_to(None) is None


def test_record_to_s2_crossref_doi_only():
    rec = {"source": "crossref", "externalId": "10.1000/cr", "title": "T",
           "authors": [], "year": 2020, "doi": "10.1000/cr", "extra": {}}
    s2 = record_to_s2(rec)
    assert s2["externalIds"]["DOI"] == "10.1000/cr"
    assert s2["externalIds"]["PMID"] == ""
    assert s2["citationCount"] == 0


def test_discover_keeps_normalised_records():
    records = [pubmed_record(), pubmed_record(externalId="87654321",
                                              title="Second paper")]
    search, _ = make_search(records)
    out = search.discover("q")
    assert out == records
    assert len(search.identifiers) == 2


def test_unconfigured_search_raises():
    search = ConnectorSearch(api_url="", secret="")
    with pytest.raises(Exception) as exc:
        search.discover("q")
    assert exc.value.code == "search_unconfigured"
