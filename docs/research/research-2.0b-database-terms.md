# ResearchMD Database Integration Terms and Compliance Guide

This document defines the legal, commercial, and technical requirements for integrating four core scholarly literature databases into ResearchMD, a systematic-review module inside the paid StewardMD mobile medical application:
1. PubMed / NCBI Entrez Programming Utilities (E-utilities)
2. Europe PMC RESTful Web Service
3. Crossref REST API
4. Semantic Scholar Academic Graph API (S2AG)

Phase 1 enrichment adds two further sources, documented in sections 4.9 and 7:
5. Crossref retraction and expression-of-concern data (includes the Retraction Watch dataset acquired by Crossref in 2023)
6. OpenAlex (works metadata, citation counts and open-access links)

Each section cites current official documentation pages, specifies terms for commercial use inside a paid mobile app, details rate limits and parameters, sets caching and retention boundaries, and outlines attribution rules. The document concludes with a numbered list of strict implementation rules for the connector builder.

Where a fact cannot be confirmed directly from an official documentation page, it is explicitly marked UNCONFIRMED.

---

## 1. Executive Comparison

| Dimension | PubMed / NCBI E-utilities | Europe PMC REST | Crossref REST | Semantic Scholar (S2AG) |
|---|---|---|---|---|
| Commercial use allowed | Yes (no royalties or fees) | Yes (metadata); full text depends on license | Yes (CC0 metadata) | No by default; requires separate commercial agreement |
| Formal agreement needed | None | None | None (unless paying for Metadata Plus) | Yes (commercial/expanded license agreement with AI2) |
| API key status | Optional (strongly recommended) | Not applicable (no key system exists) | Optional (polite pool via email; token for Plus) | Practically required (free key for testing; commercial key for prod) |
| Rate limit without key | 3 req/sec per IP | ~10 req/sec fair use (UNCONFIRMED hard cap) | 5 req/sec (concurrency 1) | Shared global 1,000 req/sec pool (heavy throttling) |
| Rate limit with key | 10 req/sec | N/A | 10 req/sec (concurrency 5) in Polite Pool; 64+ in Plus | 1 req/sec standard key; higher limits custom/negotiated |
| Required identification | `tool` and `email` params | Descriptive `User-Agent` | `User-Agent` and/or `mailto` query param | `x-api-key` header |
| Metadata storage allowed | Yes (must maintain freshness or disclaim) | Yes | Yes (CC0 dedication) | No for commercial redistribution under default terms |
| Abstract storage allowed | Yes, subject to third-party copyright | Yes, subject to publisher copyright | Yes, subject to publisher copyright | No for commercial redistribution under default terms |
| Full text retrieval | None (PMID only; PMC OA via separate tools) | Yes (XML/PDF for Open Access subset) | None (metadata and publisher links only) | None (abstracts and citation graphs only) |
| Blockers for paid app | None (must avoid endorsement claim and credit NLM) | Ingesting CC-BY-NC full text violates license | None for metadata | Default license strictly forbids commercial use |

### 1.1 Phase 1 enrichment sources

| Dimension | Crossref retractions / Retraction Watch | OpenAlex |
|---|---|---|
| Commercial use allowed | Crossref metadata is CC0. Rights in the Retraction Watch assertions beyond the Crossref API are UNCONFIRMED (the public dataset repository carries no licence file). | Yes. Every record is released under CC0 (https://help.openalex.org/access/pricing/). |
| Formal agreement needed | None for the public Crossref API. | None. |
| API key status | Optional; the existing Crossref polite-pool contact applies. | Free API key required by us (`OPENALEX_API_KEY`). A missing key makes the feature unavailable. |
| Rate limit with key | 10 req/sec polite pool (shared with the Crossref connector). | 30 req/sec for a free key; 10 req/sec keyless. We use a conservative 5 req/sec bucket. |
| Required identification | `mailto` and the polite `User-Agent`. | `api_key` query parameter. |
| Metadata storage allowed | Yes. Crossref metadata is CC0. Retraction Watch-specific retention terms UNCONFIRMED; we cache for 24 hours. | Yes, CC0. We cache each work for 7 days. |
| Attribution | "Retraction data: Crossref / Retraction Watch" wherever the badge appears. | "Data: OpenAlex" wherever the fields appear. |
| Blockers for paid app | None identified for the Crossref API path. Retraction Watch standalone dataset licensing is UNCONFIRMED. | None. |

---

## 2. PubMed / NCBI Entrez Programming Utilities (E-utilities)

### 2.1 Official Documentation and Policy URLs
- NCBI E-utilities General Introduction: https://www.ncbi.nlm.nih.gov/books/NBK25497/
- NCBI E-utilities In-Depth Syntax and Parameters: https://www.ncbi.nlm.nih.gov/books/NBK25501/
- NCBI Website and Data Usage Policies and Disclaimers: https://www.ncbi.nlm.nih.gov/home/about/policies/
- NLM Terms and Conditions for Downloading Data: https://www.nlm.nih.gov/databases/download/terms_and_conditions.html
- PubMed Central (PMC) Copyright Notice: https://www.ncbi.nlm.nih.gov/pmc/about/copyright/
- NCBI Account Management for API Keys: https://www.ncbi.nlm.nih.gov/account/

### 2.2 Commercial Use and Agreement Requirements
- Commercial use allowed: Yes. The National Library of Medicine (NLM) charges no usage fees, licensing charges, or royalties for programmatic access to PubMed via E-utilities or downloaded MEDLINE/PubMed dataset files.
- Agreement needed: No formal bilateral contract or signed agreement is required. Use of the service is governed by the published NLM Terms and Conditions for Downloading Data, accepted by querying the service.
- Endorsement prohibition: The U.S. Government, NLM, and NCBI do not endorse or recommend any commercial products, services, processes, or manufacturers. ResearchMD must never state, imply, or suggest that NLM or NCBI endorses StewardMD or its systematic review outputs.
- Warranty and liability disclaimer: NLM data is provided without express or implied warranties. Users agree to hold NLM and the U.S. Government harmless from any liability resulting from errors, omissions, or downstream interpretation.

### 2.3 API Key Details
- Status: Optional, but mandatory in practice for reliable production operations.
- How to get:
  1. Register for a free personal My NCBI account at https://www.ncbi.nlm.nih.gov/account/.
  2. Navigate to "Account Settings".
  3. Scroll to the "API Key Management" section and select "Create an API Key".
  4. Each user account is entitled to generate one API key.
- Effect:
  - Raises the allowed request frequency from 3 requests per second to 10 requests per second.
  - Associates requests with a recognized developer identity, mitigating sudden IP-level blocking.

### 2.4 Rate Limits
- Without API key: Maximum 3 requests per second per IP address. Exceeding this triggers HTTP 429 throttling errors or IP-level firewall blocks.
- With API key: Maximum 10 requests per second.
- Peak hours restriction: NCBI requests that automated scripts, bulk pipelines, or jobs posting more than 100 requests run outside peak hours. Off-peak hours are defined as weekdays between 9:00 PM and 5:00 AM Eastern Time (ET), or anytime on weekends.
- Batch minimization rule: Developers must minimize request volume by using `epost.fcgi` or batching identifiers into comma-separated lists in `esummary.fcgi` and `efetch.fcgi` rather than issuing single-record calls.

### 2.5 Required Parameters and Headers
- Base URL: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`
- `tool`: Required parameter in URL query string. Must be a string identifying the client application without internal spaces (for example: `tool=StewardMD_ResearchMD`).
- `email`: Required parameter in URL query string. Must be a valid email address belonging to the technical maintainer (for example: `email=support@stewardmd.in`), allowing NCBI to contact the team if traffic anomalies arise.
- `api_key`: Query parameter in URL (`&api_key=YOUR_KEY`). Note: In the core E-utilities, `api_key` is passed as a URL query parameter; passing it via HTTP headers is UNCONFIRMED for legacy E-utilities CGI endpoints.
- Headers: HTTP GET and POST are supported. Standard `User-Agent` identifying the application is recommended practice. POST requests with large ID lists must specify `Content-Type: application/x-www-form-urlencoded`.

### 2.6 Data Storage, Retention, and Redistribution Rules
- Metadata: Citation metadata (PMID, title, authors, journal, volume, year, DOI, MeSH terms) may be stored locally and cached inside ResearchMD databases (D1 / SQLite). NLM specifies no mandatory maximum time-to-live (TTL), but imposes a freshness rule:
  - Anyone redistributing or republishing NLM data must either maintain the most current version of all distributed data, or make known in a clear and conspicuous manner that the product does not reflect the most current or accurate data available from NLM.
- Abstracts: Abstracts indexed in PubMed are contributed by journal publishers. NLM holds no copyright over publisher-authored abstracts and assumes no liability for their commercial reuse. Caching and displaying abstracts inside ResearchMD for user screening and study selection falls within accepted fair-use medical review workflows, but wholesale bulk redistribution of copyrighted abstracts to third parties outside the app context is legally restricted by the original publishers.
- Full text: PubMed is strictly a bibliographic database and does NOT supply full-text articles. Full-text biomedical articles reside in PubMed Central (PMC). Under the PMC Copyright Notice:
  - Systematic automated downloading of full-text articles from the main PMC website is strictly prohibited.
  - Programmatic access must use authorized PMC channels (such as the PMC Open Access Subset via AWS Cloud Service, BioC API, or PMC OAI-PMH service).
  - Full-text reuse rights in PMC depend on the license of each paper: open access articles under Creative Commons licenses (such as CC BY or CC0) permit commercial storage and display, whereas articles under CC-BY-NC or traditional publisher copyright cannot be commercially exploited or redistributed within a paid product without explicit publisher permission.

### 2.7 Attribution Rules
- Mandatory attribution statement: Any display or output using NLM data must feature the phrase:
  "Courtesy of the U.S. National Library of Medicine"
  displayed in a clear and conspicuous manner.
- Endorsement disclaimer: Must never state or imply that the app or any conclusion reached by the user has been endorsed, validated, or certified by NLM, NCBI, or the U.S. National Institutes of Health.

### 2.8 Paid App Feasibility and Blockers
- Anything blocking use in a paid app: None. NLM does not restrict use to non-commercial entities, nor does it require payment of license fees.
- Critical compliance conditions:
  1. Always supply valid `tool`, `email`, and `api_key` parameters.
  2. Throttle connector outgoing requests to <= 10 req/sec.
  3. Display "Courtesy of the U.S. National Library of Medicine".
  4. Display a clear disclaimer if cached data is not updated continuously against NLM updates.
  5. Do not attempt full-text article scraping from PubMed.

---

## 3. Europe PMC RESTful Web Service

### 3.1 Official Documentation and Policy URLs
- Europe PMC RESTful Web Service Developer Guide: https://europepmc.org/RestfulWebService
- Europe PMC About and Governance: https://europepmc.org/About
- Europe PMC Open Access Subset and Downloads: https://europepmc.org/downloads/openaccess
- EMBL-EBI Terms of Use: https://www.ebi.ac.uk/about/terms-of-use/

### 3.2 Commercial Use and Agreement Requirements
- Commercial use allowed: Yes. The Europe PMC REST API and bibliographic metadata are provided freely as open scientific infrastructure by EMBL's European Bioinformatics Institute (EMBL-EBI) and an international funder coalition. Commercial use of the API and search metadata is permitted without royalties or fees.
- Agreement needed: No formal agreement, contract, or license registration is required for standard REST API usage.
- Content license caveat: While metadata and search queries are free and open, the full text of articles hosted by Europe PMC remains governed by individual author and publisher licenses (specifically Creative Commons licenses). Commercial reuse of full text must respect these individual licenses.

### 3.3 API Key Details
- Status: Neither required nor available.
- How to get: Not applicable. Europe PMC operates a completely open, unauthenticated REST API. There is no account registration, developer dashboard, or API key mechanism.
- Effect: Not applicable. All clients access the same endpoints without key-based tiering.

### 3.4 Rate Limits
- Without API key: There is no single published hard numeric rate limit on the official documentation page (UNCONFIRMED exact hard quota). However, EMBL-EBI enforces fair-use traffic controls at the gateway level.
- Practical rate limit: Best practice across client libraries and community wrappers is to limit request rates to approximately 10 requests per second per IP address, or insert polite pauses of 100 to 200 milliseconds between sequential requests.
- Bulk harvesting policy: High-volume automated pipelines, mass full-text downloads, or corpus extraction jobs must NOT hammer the live REST API. Europe PMC explicitly instructs high-volume users to either contact `helpdesk@europepmc.org` to coordinate access or download pre-packaged archives via the Europe PMC Open Access FTP / Cloud dumps.
- Gateway error behavior: Excessive concurrent connections or unthrottled requests trigger gateway-level HTTP 429 (Too Many Requests) or HTTP 503 (Service Unavailable) responses.

### 3.5 Required Parameters and Headers
- Base URL: `https://europepmc.org/RestfulWebService/rest/`
- Headers: Standard HTTP GET requests. No proprietary authentication headers.
- User-Agent: EMBL-EBI guidelines recommend passing a descriptive `User-Agent` header containing the software name, version, and maintainer contact email (for example: `User-Agent: StewardMD-ResearchMD/1.0 (mailto:support@stewardmd.in)`).
- Search parameters:
  - `query`: The search term (supports boolean logic and field tags such as `AUTH:`, `TITLE:`, `SRC:med`).
  - `resultType`: Output verbosity (`lite`, `core`, `idlist`). `core` provides complete metadata including abstracts and licensing info.
  - `format`: Output format (`json` or `xml`). Default is XML; JSON should be explicitly requested via `format=json`.
  - `pageSize`: Number of results per request (default 25; maximum 1000).
  - `cursorMark`: Cursor token for reliable pagination through large result sets (recommended over offset paging).

### 3.6 Data Storage, Retention, and Redistribution Rules
- Metadata: Bibliographic metadata (titles, authors, journal, DOI, PMCID, citations, affiliations) can be stored locally and redistributed within ResearchMD without restriction. Europe PMC specifies no expiration period for cached metadata.
- Abstracts: Abstracts returned in `resultType=core` can be stored and displayed during screening. Third-party publisher copyright applies to non-open-access abstracts.
- Full text: Europe PMC hosts both open-access full-text XML and full-text PDFs. Whether full text can be stored, processed by AI, or shown to users in a paid app depends strictly on the `license` field returned in the article record:
  - Commercial permitted: Articles licensed under `cc by` (Creative Commons Attribution) or `cc0` (Public Domain) can be stored, parsed, extracted, and displayed inside a paid commercial application, provided credit is given.
  - Commercial prohibited: Articles marked with Non-Commercial clauses (`cc by-nc`, `cc by-nc-nd`, `cc by-nc-sa`) forbid commercial exploitation. Storing or serving full text of NC-licensed articles inside a paid mobile app represents copyright infringement unless explicit publisher permission is granted.
  - Non-OA / All rights reserved: Articles available only as free-to-read author manuscripts or under restricted publisher terms must not be systematically stored or redistributed.

### 3.7 Attribution Rules
- Platform attribution: In compliance with EMBL-EBI Terms of Use, ResearchMD must acknowledge Europe PMC as the data source in application views and output documentation (for example: "Data provided by Europe PMC").
- Article attribution: Author names, journal citations, and DOI links must be preserved when displaying or exporting record summaries.

### 3.8 Paid App Feasibility and Blockers
- Anything blocking use in a paid app:
  1. API and metadata access: No blocker. Freely usable in commercial and paid products.
  2. Full-text processing blocker: Storing or redistributing full-text articles bearing `NC` (Non-Commercial) licenses inside a paid app is prohibited by the underlying copyright licenses.
  3. Connector mitigation: The connector builder must inspect the `license` property of each Europe PMC record before caching or displaying full-text content. Non-commercial records must be restricted to metadata and direct external links to Europe PMC.

---

## 4. Crossref REST API

### 4.1 Official Documentation and Policy URLs
- Crossref REST API Overview: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- Crossref Rate Limits and Pools: https://www.crossref.org/documentation/retrieve-metadata/rest-api/rate-limits/
- Crossref API Etiquette and Best Practices: https://www.crossref.org/documentation/retrieve-metadata/rest-api/etiquette/
- Crossref Terms of Service: https://www.crossref.org/terms/
- Crossref Metadata Plus Information: https://www.crossref.org/services/metadata-retrieval/metadata-plus/

### 4.2 Commercial Use and Agreement Requirements
- Commercial use allowed: Yes. Crossref bibliographic metadata is dedicated to the public domain under the Creative Commons CC0 1.0 Universal waiver. Anyone is legally entitled to search, retrieve, store, modify, redistribute, and commercially exploit Crossref metadata without paying fees or requesting permission.
- Agreement needed: No agreement or contract is needed for accessing the public Crossref REST API or the free "polite" pool. A formal contract is required only if an organization chooses to subscribe to the optional paid "Metadata Plus" tier.
- Publisher abstracts caveat: While basic bibliographic metadata is CC0, individual publisher-contributed abstracts deposited into Crossref may carry publisher copyright.

### 4.3 API Key Details
- Status: Optional. The public and polite pools require no API key or token.
- Paid service (Metadata Plus): Organizations that require guaranteed service level agreements (SLAs), priority processing, and monthly snapshot dumps pay an annual fee to receive a Metadata Plus API token.
- Header for paid token: `crossref-api-key: Bearer YOUR_TOKEN`.
- Effect:
  - Without token (Polite Pool): Free access with high reliability, 10 req/sec rate limit, and up to 5 concurrent connections.
  - With token (Metadata Plus): Dedicated hardware pool, guaranteed SLA, 64+ req/sec rate limits, and access to bulk JSON/XML data snapshots.

### 4.4 Rate Limits
- Access Pools: Crossref partitions traffic into three distinct service pools based on client identification:
  1. Public Pool (Anonymous / Unidentified):
     - Rate limit: Typically 5 requests per second (per IP).
     - Concurrency limit: 1 simultaneous request.
     - Prone to aggressive throttling during platform traffic spikes.
  2. Polite Pool (Identified via `mailto` or `User-Agent`):
     - Rate limit: 10 requests per second.
     - Concurrency limit: 5 simultaneous requests for single-record DOI lookups; 3 simultaneous requests for list queries and filters.
     - Significantly more stable and isolated from anonymous abusive traffic.
  3. Metadata Plus (Paid Subscribers):
     - Rate limit: Starts at 64 requests per second (UNCONFIRMED exact ceiling for high-tier enterprise contracts).
     - Higher concurrency and dedicated cluster isolation.
- Rate limit response headers: Crossref returns live quota tracking in HTTP response headers:
  - `x-rate-limit-limit`: Maximum allowed requests in the active interval.
  - `x-rate-limit-interval`: Time window for the quota (typically 1s).
  - `x-concurrency-limit`: Maximum simultaneous connections permitted.
  - `x-api-pool`: Identifies which pool handled the request (`public`, `polite`, or `plus`).
- Handling limit violations: Exceeding rate or concurrency limits returns HTTP 429 (Too Many Requests). Clients must implement exponential backoff upon receiving a 429 response. Repeated abuse without backoff leads to automated IP blocking (HTTP 403 Forbidden).

### 4.5 Required Parameters and Headers
- Base URL: `https://api.crossref.org/`
- Polite pool routing: To route requests into the Polite Pool, the client must supply contact information through either:
  1. `User-Agent` header (strongly recommended):
     Format: `User-Agent: ToolName/Version (URL; mailto:email@example.com)`
     Example: `User-Agent: StewardMD-ResearchMD/1.0 (https://stewardmd.in; mailto:support@stewardmd.in)`
  2. `mailto` query parameter:
     Format: `https://api.crossref.org/works?query=...&mailto=support@stewardmd.in`
- Query optimization parameters:
  - `select`: Limit returned fields to reduce payload size (for example: `select=DOI,title,author,published,abstract,URL,container-title`).
  - `rows`: Number of records to return per page (default 20, maximum 1000).
  - `cursor`: Use cursor-based deep paging (`cursor=*` on first call, followed by `cursor=NEXT_CURSOR`) rather than high `offset` values for large retrievals.
  - `filter`: Server-side filtering by publication year, type, or license.

### 4.6 Data Storage, Retention, and Redistribution Rules
- Metadata: All Crossref bibliographic metadata is released under CC0 1.0 Universal (Public Domain Dedication). ResearchMD may store metadata permanently in local device databases or backend stores, cache it indefinitely, redistribute it to users, and include it in fee-based features. There are no expiration, deletion, or synchronization requirements under CC0.
- Abstracts: If present in the payload (in JATS XML `<jats:abstract>` tags), abstracts are supplied by publishers. Some publishers dedicate abstracts to CC0, but others retain copyright. Abstracts should be treated as copyrighted text unless confirmed open access.
- Full text: The Crossref REST API does NOT store or serve full text. It provides metadata and publisher URLs (including Text and Data Mining URLs inside the `link` field). Obtaining full text requires negotiating publisher access or navigating to publisher landing pages.

### 4.7 Attribution Rules
- Legal requirement: Because metadata is CC0, legal attribution is not strictly mandated by copyright law.
- Professional etiquette: Crossref requests that downstream services cite Crossref as a metadata source (for example: "Metadata provided by Crossref via Crossref REST API") and provide DOI links resolving to the registered work (`https://doi.org/...`).

### 4.8 Paid App Feasibility and Blockers
- Anything blocking use in a paid app: None. Crossref metadata is CC0 and explicitly intended for open commercial integration.
- Connector requirements: Always provide a well-formed `User-Agent` containing a valid `mailto:` address to stay within the Polite Pool, observe the 10 req/sec and 3 to 5 concurrency limits, and check the `x-rate-limit-*` headers.

### 4.9 Retraction and expression-of-concern data (Retraction Watch)
- Official documentation and announcements:
  - Crossref and Retraction Watch announcement (2023-09-12): https://www.crossref.org/blog/news-crossref-and-retraction-watch/
  - Public dataset repository (updated every working day): https://gitlab.com/crossref/retraction-watch-data
  - Crossref REST filters: https://github.com/Crossref/rest-api-doc (filter names: `updates`, `is-update`)
- Commercial use: Crossref bibliographic metadata is CC0. The Retraction Watch dataset was acquired by Crossref in September 2023 and is distributed alongside Crossref works records. The public dataset repository README does not state a separate licence for the Retraction Watch assertions, so the licence of the standalone dataset is UNCONFIRMED. Inside ResearchMD we read it only through the public Crossref works API, under Crossref's CC0 metadata terms.
- Ingestion path used: `GET https://api.crossref.org/works?filter=updates:{DOI}`. Each returned notice work carries `update-to` entries with `DOI` (the affected work), `type` (`retraction`, `expression_of_concern`, and also non-retraction values such as `correction`, `erratum`, `corrigendum`, `withdrawal`, `new_version`, `new_edition`), `label`, `source` (`publisher` or `retraction-watch`) and `updated.date-parts`. Verified against a live Crossref response on 2026-11-26.
- Only `retraction` and `expression_of_concern` are surfaced. Corrections, errata, corrigenda, withdrawals and removals are not retractions. When both exist for one DOI, a retraction outranks an expression of concern; ties use the latest notice date.
- Rate limit: the same Crossref polite pool (10 req/sec, 3 concurrent list queries). Batched lookups use repeated `updates:` filters joined with commas; 20 DOIs per request keeps URLs short (the documented OR ceiling is 100 for the marker syntax but Crossref publishes no explicit cap for repeated filters, so 20 is a deliberate conservative choice).
- Storage: cached in the Cloudflare Cache API for 24 hours, keyed by the normalised DOI.
- Attribution: display "Retraction data: Crossref / Retraction Watch" next to every retraction or expression-of-concern badge, with the notice DOI linked through `https://doi.org/{noticeDoi}`.

---

## 5. Semantic Scholar Academic Graph API (S2AG)

### 5.1 Official Documentation and Policy URLs
- Semantic Scholar API Product Overview: https://www.semanticscholar.org/product/api
- Semantic Scholar API License Agreement: https://www.semanticscholar.org/product/api/terms
- Semantic Scholar Datasets API Documentation: https://www.semanticscholar.org/product/api#datasets-api
- Semantic Scholar API Tutorials and Guides: https://www.semanticscholar.org/product/api/tutorial

### 5.2 Commercial Use and Agreement Requirements
- Commercial use allowed under default terms: NO. This is a critical legal boundary. Under Section 2 and Section 3 of the Semantic Scholar API License Agreement, standard access to the API and datasets is granted strictly for internal, non-commercial, research, and educational purposes.
- Explicit prohibitions: The standard agreement explicitly prohibits:
  - Selling, renting, leasing, licensing, or distributing the API or data to any third party for monetary or commercial gain.
  - Embedding or installing the API or data into products for commercial gain.
  - Using the API or data in connection with commercial business operations without express written authorization.
- Agreement needed: YES. To use the Semantic Scholar API, Academic Graph, or data within StewardMD / ResearchMD (a paid mobile medical app), StewardMD must execute an Expanded License or a specialized commercial partnership agreement directly with the Allen Institute for Artificial Intelligence (AI2). Applications for commercial arrangements are submitted via the partner form at https://www.semanticscholar.org/product/api.

### 5.3 API Key Details
- Status: Optional for unauthenticated test calls, but practically mandatory for development and strictly mandatory for commercial deployment.
- How to get:
  - Fill out the API Key Request form on the Semantic Scholar API product page.
  - Note in the application that the integration is for a commercial medical mobile app to initiate the commercial licensing review process.
- How to pass key:
  - Must be passed in the HTTP request header:
    `x-api-key: YOUR_API_KEY`
  - The header name is case-sensitive and must be lowercase `x-api-key`.
- Effect:
  - Routes traffic to an authenticated tier with dedicated rate limits.
  - Removes client requests from the volatile public pool.

### 5.4 Rate Limits
- Unauthenticated (Public / Anonymous):
  - Shared pool: All unauthenticated users across the globe share a single global pool capped at approximately 1,000 requests per second across all endpoints.
  - Volatility: Unauthenticated requests are subject to aggressive, unpredictable throttling and HTTP 429 errors during platform peak usage. Unauthenticated access is unsuitable for production.
- Authenticated (Standard API Key):
  - Introductory rate limit: 1 request per second across all endpoints.
  - S2AG endpoints strictly enforce this ceiling per key. Exceeding 1 req/sec immediately returns HTTP 429.
- Authenticated (Commercial / Partner Key):
  - Rate limits under an Expanded Commercial License are custom-negotiated with AI2 (UNCONFIRMED default commercial rate limit).
- Corpus-scale work: AI2 explicitly states that the REST API is intended for targeted, real-time lookups rather than large-scale corpus synchronization. For bulk extraction or mass ingestion, developers must use the Semantic Scholar Datasets API (which provides bulk JSONL snapshots and incremental daily diffs).

### 5.5 Required Parameters and Headers
- Base URL: `https://api.semanticscholar.org/graph/v1/`
- Request header:
  `x-api-key: YOUR_API_KEY`
- URL parameters:
  - `fields`: Comma-separated list of required fields. The S2AG API returns minimal fields by default (paperId and title); all additional fields must be explicitly requested.
    Example: `fields=paperId,title,abstract,venue,year,authors,citationCount,influentialCitationCount,externalIds,openAccessPdf`
  - `query`: The search keyword string.
  - `limit`: Number of results to return (default 10, maximum 100 per call).
  - `offset`: Offset index for pagination (or `token` for graph pagination).

### 5.6 Data Storage, Retention, and Redistribution Rules
- Metadata:
  - Under the standard default agreement: Storing metadata for third-party commercial distribution is strictly prohibited. Transient local caching strictly for end-user display performance is permitted, but permanent storage or commercial dissemination is banned without an expanded agreement.
  - Under an Expanded Commercial License: Storage and redistribution terms are dictated by the negotiated commercial contract.
- Abstract storage: Abstracts provided by S2AG are subject to original publisher and author copyrights. Under default terms, redistributing S2AG abstracts inside a commercial product is prohibited.
- Full text: S2AG does NOT provide full-text articles directly. It returns an `openAccessPdf` object containing a direct URL to an open-access PDF where available, or external identifiers (DOI, PubMed, ArXiv).
- Bulk dataset deletion compliance: If ResearchMD utilizes the Semantic Scholar Datasets API for bulk synchronization, the developer must monitor the incremental diffs endpoint (`/datasets/v1/diffs/...`). Any record appearing in the `delete files` list must be removed from the local store to comply with takedown notices and corpus updates.

### 5.7 Attribution Rules
- Mandatory attribution statement: Under Section 4 of the API License Agreement, licensees must include clear attribution to:
  "Semantic Scholar"
  on any application interface, website, or published output displaying data derived from S2AG.
- Scientific publications: If results or systematic reviews prepared with the tool are published in academic literature, the licensee must cite the official paper:
  "The Semantic Scholar Open Data Platform" (Kinney et al., 2023).
- Linking and branding: Display of S2 Data must comply with AI2 branding guidelines. Web and app links pointing back to Semantic Scholar should include tracking parameters (for example: `https://www.semanticscholar.org/paper/{paperId}?utm_source=api`).

### 5.8 Paid App Feasibility and Blockers
- MAJOR BLOCKER: Standard API access strictly prohibits commercial exploitation and use within paid software products. Launching the ResearchMD connector using a standard free API key or unauthenticated endpoint breaches AI2's API License Agreement.
- Path to unblock:
  1. The business team must execute an Expanded Commercial License Agreement with AI2 prior to production release.
  2. The connector builder must configure the connector behind a configuration flag that remains disabled until the commercial agreement is in place.
  3. Strict client-side rate limiting (default 1 req/sec until higher limits are granted) and exponential backoff must be enforced.
  4. Explicit "Semantic Scholar" attribution must be displayed on every card or record sourced from S2AG.

---

## 6. Numbered Implementation Rules for the Connector Builder

The connector builder must implement the literature search and extraction pipeline in compliance with the following rules:

1. Centralize outbound HTTP traffic:
   All database requests must originate from the server-side API or designated pull-worker layer (or dedicated gateway), never directly from client mobile devices, ensuring unified rate limiting, secure API key custody, and centralized logging.

2. Enforce per-source request token-bucket rate limiters:
   - PubMed / NCBI: Maximum 10 requests per second when `api_key` is configured; fallback to 3 requests per second if key is absent.
   - Europe PMC: Maximum 10 requests per second per outbound IP.
   - Crossref: Maximum 10 requests per second for Polite Pool; maximum 5 concurrent connections for DOI single lookups, and maximum 3 concurrent connections for list queries.
   - Semantic Scholar: Maximum 1 request per second for standard authenticated key; custom limit only when verified in commercial agreement.

3. Configure mandatory identity parameters on all PubMed requests:
   Every NCBI E-utilities request must append `&tool=StewardMD_ResearchMD`, `&email=support@stewardmd.in`, and `&api_key={NCBI_API_KEY}` directly in the URL query string.

4. Schedule heavy PubMed jobs off-peak:
   Any automated batch pipeline or systematic review search exceeding 100 requests on NCBI E-utilities must be dispatched during off-peak hours (between 9:00 PM and 5:00 AM Eastern Time on weekdays, or anytime on weekends).

5. Formulate standard Polite User-Agent for Crossref and Europe PMC:
   Every outgoing request to Crossref and Europe PMC must include the HTTP header:
   `User-Agent: StewardMD-ResearchMD/1.0 (https://stewardmd.in; mailto:support@stewardmd.in)`

6. Route Crossref traffic into the Polite Pool:
   In addition to the `User-Agent` header, append `mailto=support@stewardmd.in` to all Crossref request query strings as a fail-safe to guarantee polite pool routing.

7. Monitor Crossref rate limit response headers:
   The connector must inspect `x-rate-limit-limit`, `x-rate-limit-interval`, `x-concurrency-limit`, and `x-api-pool` on every Crossref response. If available capacity drops below 20 percent, pause outgoing workers.

8. Secure Semantic Scholar key header:
   When calling Semantic Scholar, pass the API key strictly via the HTTP header `x-api-key: {S2_API_KEY}`. The header key must be strictly lowercase.

9. Gate Semantic Scholar behind a commercial license configuration flag:
   Because Semantic Scholar's standard terms prohibit commercial use in paid products, the S2AG connector module must remain behind a feature flag (`ENABLE_SEMANTIC_SCHOLAR=false`). This flag must not be toggled to `true` in production until an Expanded Commercial License Agreement with AI2 is executed and signed.

10. Handle HTTP 429 with randomized exponential backoff:
    Any HTTP 429 response from any provider must immediately pause the worker queue for that specific domain. Implement exponential backoff starting at 1.0 second, doubling with jitter (for example: 1s, 2s, 4s, 8s, up to 60s) before retrying.

11. Implement local metadata caching:
    Cache bibliographic metadata (PMID, DOI, title, authors, year, journal, volume, page) in the `stewardmd-research` D1 / SQLite database. Crossref metadata is CC0 and can be stored indefinitely. PubMed metadata can be stored permanently provided the freshness policy is satisfied.

12. Enforce the PubMed freshness disclosure rule:
    To comply with NLM redistribution terms, the user interface must display the date/timestamp when citations were retrieved from PubMed. If cached citations are older than 30 days without re-synchronization, display a visible note: "Citation metadata cached on {DATE}; may not reflect the most recent updates from NLM."

13. Protect against Non-Commercial (NC) full-text infringement:
    When retrieving full text via Europe PMC or PMC Open Access, the connector must inspect the article's `license` field:
    - If the license is `cc by` or `cc0`: Full text may be parsed, stored in R2, and displayed to users.
    - If the license contains `nc` (`cc by-nc`, `cc by-nc-nd`, `cc by-nc-sa`): Full text must NOT be stored in R2 or redistributed within the paid app. Provide the user only with a direct outbound link to the article at Europe PMC or publisher landing page.
    - If no open access license is confirmed: Treat the full text as all-rights-reserved; do not ingest into internal storage.

14. Render mandatory NLM attribution:
    Every view, report, or export in ResearchMD containing data retrieved from PubMed / NCBI must visibly display:
    "Courtesy of the U.S. National Library of Medicine"
    along with a disclaimer stating that NLM does not endorse the application.

15. Render Europe PMC attribution:
    Displays showing records or annotations retrieved from Europe PMC must include:
    "Data provided by Europe PMC"
    with a link to the corresponding Europe PMC record.

16. Render Crossref attribution:
    Displays or exports using Crossref metadata should include:
    "Metadata provided by Crossref"
    and ensure all work identifiers resolve via `https://doi.org/{DOI}`.

17. Render Semantic Scholar attribution and citations:
    When S2AG is active, every paper card or summary derived from S2AG must include the "Semantic Scholar" label with a link back to Semantic Scholar carrying `utm_source=api`. If the user exports a formal academic manuscript, the export engine must append the citation: "The Semantic Scholar Open Data Platform (Kinney et al., 2023)".

18. Field selection minimization for payload efficiency:
    - In Crossref, always use `select=` to query only necessary fields (`DOI,title,author,published,abstract,URL,container-title`).
    - In Semantic Scholar, always pass explicit `fields=` (`paperId,title,abstract,venue,year,authors,citationCount,externalIds,openAccessPdf`).
    - In Europe PMC, use `resultType=core` only when abstracts or licensing data are required; use `resultType=lite` for broad search indexing.

19. Cursor pagination for large result sets:
    - In Europe PMC, use `cursorMark` for result sets spanning multiple pages.
    - In Crossref, use `cursor=*` deep pagination rather than numeric `offset` jumps.
    - In NCBI, use `epost` to stage ID lists on the Entrez History server and retrieve records using `WebEnv` and `query_key` in batches of 200 to 500 records.

20. Retractions and expressions of concern (Crossref / Retraction Watch):
    - Look up notices with the `updates:{DOI}` filter and read `update-to` on each notice work. Surface only `retraction` and `expression_of_concern`; ignore corrections, errata, corrigenda, withdrawals and removals.
    - Cache each DOI result for 24 hours. Return `{status, date, noticeDoi, source}` with `status` one of `retracted`, `expression_of_concern` or `none`.
    - When Crossref is unreachable or the contact email is missing, return an unavailable result and render nothing. Display "Retraction data: Crossref / Retraction Watch".

21. OpenAlex identifiers only:
    - Send only DOIs and PMIDs to OpenAlex, never case text, thesis text or any project document. Read the key from `OPENALEX_API_KEY` and put it in the `api_key` query parameter. A missing key means the feature is unavailable.
    - Batch with OR (`doi:a|b|c`, `pmid:1|2`); never mix different filters with `|`. Request at most 50 identifiers per call (documented OR limit is 100). Cache each work for 7 days.
    - Return `citedByCount`, `oaStatus`, `bestOaUrl` and up to five `relatedWorks` (`id`, `title`, `year`, `doi`). Display "Data: OpenAlex".

22. Hide on failure, never error:
    - Every enrichment route answers HTTP 200 with `{available:false}` when its provider is down, times out, or its key/contact is missing. The app renders no banner, no empty box and no badge in that state.

---

## 7. OpenAlex API

### 7.1 Official Documentation and Policy URLs
- OpenAlex documentation: https://help.openalex.org/
- Authentication and rate limits: https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication
- Pricing and CC0 data licence: https://help.openalex.org/access/pricing/
- Filter syntax and OR limits: https://help.openalex.org/how-to-use-the-api/get-lists-of-entities/filter-entity-lists
- Work attributes: https://help.openalex.org/data/works/attributes
- Open access fields: https://help.openalex.org/data/works/open-access

### 7.2 Commercial Use and Agreement Requirements
- Commercial use allowed: Yes. Official pricing documentation states: "Every record is released under a CC0 public-domain license, with no 'personal use only' carve-out and no permission to ask."
- Agreement needed: None. OpenAlex sells services (bigger daily budgets, sync), not the data.

### 7.3 API Key Details
- Status: A free key is not required for light use, but ResearchMD treats it as required: if `OPENALEX_API_KEY` is absent the server returns `{available:false}` and the app hides the feature.
- How to send: `api_key` query parameter, or `Authorization: Bearer`. This connector uses the documented `api_key` query parameter.
- Effect: a free key raises the daily budget 10x and is required for cursor paging past the first page. Budgets are measured in dollars per day (free tier: $1/day). Spending a day's budget returns HTTP 429 with reason `daily_budget`.

### 7.4 Rate Limits
- Published per-second limits: no key 10 req/sec per IP; free key or prepaid 30 req/sec; Member 50 req/sec; Member+ or Partner 50 req/sec. Verified from the authentication page on 2026-11-26.
- Filters joining more than 10 values with `|` on topic/concept IDs are limited to 1 req/sec; our `doi` and `pmid` filters are not in that list.
- ResearchMD uses a conservative 5 req/sec token bucket and the shared `fetchWithRetry` backoff.

### 7.5 Required Parameters and Headers
- Base URL: `https://api.openalex.org/works`
- `filter`: `doi:` matches a work's own DOI or any location DOI, case-insensitively; up to 100 values can be OR-ed. `doi:10.1/a|10.1/b` and `pmid:123|456` are the batch forms used here. Mixing different filter names with `|` is invalid.
- `select`: limits fields. This connector requests `id,doi,ids,title,publication_year,cited_by_count,open_access,best_oa_location,related_works`.
- `per_page`: 1-100 (100 is the supported maximum; 200 is deprecated legacy behaviour).
- Related-works expansion uses `filter=openalex_id:W1|W2...` with `select=id,title,publication_year,doi`.

### 7.6 Data Storage, Retention, and Redistribution Rules
- Metadata: CC0. ResearchMD may cache and redistribute it commercially. Each work is cached in the Cloudflare Cache API for 7 days, keyed by the normalised DOI or PMID that was looked up.
- Related works: `related_works` is a list of up to 10 OpenAlex IDs. ResearchMD resolves at most the first five to `{id,title,year,doi}` and stores them with the work.

### 7.7 Attribution Rules
- CC0 does not require legal attribution, but OpenAlex's community norm is to credit the source. ResearchMD displays "Data: OpenAlex" wherever citation counts, OA status or related works appear, and links OpenAlex IDs through `https://openalex.org/{id}`.

### 7.8 Paid App Feasibility and Blockers
- Nothing blocks commercial use: the data is CC0 and the API is intended for third-party products.
- Operational conditions: keep the key server-side, stay inside the daily budget and per-second limits, and hide the feature when the key is missing or the API fails.
