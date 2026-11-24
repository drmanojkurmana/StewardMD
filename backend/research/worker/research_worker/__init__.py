"""ResearchMD Phase 3 worker: PDF extraction jobs from the research-jobs pull queue.

Contracts: docs/research/contracts/phase-3/. No user tokens, no PHI in logs
or callbacks, no LLM calls in this package (the PHI gate and gateway arrive
in 3.5).
"""

__version__ = "0.2.0"