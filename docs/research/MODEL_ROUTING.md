# StewardMD Research — model routing and per-paper cost controls

## Routing design
One internal `ResearchModelRouter` owns every LLM request. Agents never call provider SDKs directly. The router selects:
1. User BYOK provider/model when configured and permitted for this data classification.
2. StewardMD managed provider gateway using server-side credentials.
3. Deterministic fallback or explicit unavailable response. Never silently switch a private-data request to a less trusted/free tier.

The router records provider, model, task class, token usage (including reasoning tokens), latency, cache hit, retry count, data classification and actual/estimated cost. Do not persist prompts, raw patient rows or secrets in usage telemetry.

## Task tiers
| Tier | Work | Default execution | Escalation |
|---|---|---|---|
| T0 deterministic | data validation, statistics, power, effect sizes, citation resolution, reporting checklist, numeric consistency | Python libraries / rules | Never LLM |
| T1 extraction/classification | metadata parsing, abstract field extraction, variable mapping, section outline | low-cost fast model | escalate only on schema/quality failure |
| T2 synthesis/writing | literature synthesis, discussion draft, methods prose, reviewer response | mid-tier model | premium model for bounded final review |
| T3 high-stakes review | contradiction review, methods critique, claim-evidence audit | strong model with independent context | human review remains mandatory |

## Provider strategy
- Managed: use the existing MaiK/AI gateway as the only managed transport. Add research-specific task routing and budgets there rather than duplicating provider secrets and token accounting.
- BYOK: initially support Gemini and OpenAI-compatible keys through a server-side encrypted secret store. Add Anthropic after adapter/security review. BYOK usage is still metered for internal observability but not charged to managed wallet unless user chooses managed mode.
- Model names and prices are config-driven and versioned. Do not hardcode model prices in the orchestration graph.
- Provider terms, retention and training settings must be checked per provider/account tier before enabling confidential research. A paid API plan is not a substitute for a DPA or institutional approval.

## Cost-minimisation rules
- Cache literature metadata, abstracts where licensing permits, query results, embeddings and deterministic transforms by canonical input hash.
- Deduplicate DOI/PMID and avoid repeated full-text retrieval.
- Summarise evidence once into structured evidence cards; downstream agents receive cards + citations, not entire PDFs.
- Use compact shared project context; pass only stage-specific deltas.
- Never send CSV rows to an LLM. Use profiler-generated schema and aggregates only.
- Prefer one outline pass and section-level generation over repeated full-manuscript rewrites.
- Keep agent outputs structured and bounded by JSON schema and max output tokens.
- Use batch/offline provider endpoints for non-interactive jobs when cheaper and permitted.
- One repair attempt per structured output; then surface validation failure instead of looping.
- Do not use an LLM to calculate statistics or resolve bibliographic identifiers.
- Charge from provider-reported usage where available; reconcile estimated vs actual spend.

## Initial routing configuration (proposed defaults; validate with benchmark)
```yaml
research_router:
  default_mode: managed
  max_paper_budget_credits: configurable
  max_retries_per_step: 1
  timeout_seconds: 90
  tiers:
    T1:
      preferred: gemini_flash_lite
      max_output_tokens: 2500
      temperature: 0.1
    T2:
      preferred: gemini_flash
      max_output_tokens: 6000
      temperature: 0.2
    T3:
      preferred: strong_reasoning_model
      max_output_tokens: 5000
      temperature: 0.1
  rules:
    patient_level_data_to_llm: deny
    provider_failover_cross_data_classification: deny
    require_usage_metadata: true
    cache_deterministic_inputs: true
```

These are logical aliases, not pinned model IDs. Resolve them to currently approved model IDs and a dated price table at deployment. Pricing and performance change; benchmark before changing defaults.

## Paper credits
- Use existing MaiK wallet/MT accounting as the balance source of truth; do not create a separate cash wallet.
- Research creates a quote in credits from predicted stage budgets and a configurable safety margin.
- Reserve credits atomically before enqueueing a paid job.
- Settle against actual usage after completion; release unused reserve.
- If a provider reports delayed usage, keep the hold in reconciliation state and do not overcharge.
- A failed provider call with zero billable usage consumes zero credits. A billable failed call may consume only its measured cost.
- Never continue beyond the quoted ceiling without a new user confirmation.
- BYOK runs show estimated infrastructure/usage but do not debit managed AI credits unless explicitly selected.

## Initial cost target and measurement
Treat low per-paper cost as a benchmark objective, not a promise. Measure token cost, retries, embeddings, retrieval, storage, compute and support separately. Establish P50/P90 cost for:
- small retrospective cohort manuscript,
- systematic review,
- meta-analysis,
- long-form protocol/grant.

Release gate: a standard medical paper must meet the published credit quote at P95 in the pilot cohort, or the quote model is revised. Do not advertise a sub-$1 all-in cost until independently measured.
