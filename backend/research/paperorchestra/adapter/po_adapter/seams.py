"""Runtime seam installation: zero edits to upstream (SEAMS.md, D-5 evidence).

Every upstream agent imports its LLM/search functions BY NAME at module
import (`from utils.gemini_utils import call_gemini_with_contents`), so
patching utils.gemini_utils alone is not enough: each importing module holds
its own binding. install() replaces every binding (table below, with upstream
line numbers at commit d9bae99) and returns an uninstall() that restores the
originals. Nothing in upstream/ is modified on disk.

The LaTeX/PDF machinery of the refinement agent is replaced with text
stand-ins: compile_latex writes the .tex text to the .pdf path, load_paper
reads it back, pdf_to_grid_images returns no images. The adapter pipeline is
text-only end to end (gateway is text-only; figures are deterministic; DOCX
is Phase 5A). The autorater still scores the full draft text, and the hard
gates run BEFORE any score.
"""
from __future__ import annotations

import importlib
import json
import os

from . import gates, repair
from .llm import CeilingError


def _no_provider(*args, **kwargs):
    raise RuntimeError("provider clients are disabled; all calls go through the gateway")


def _compile_latex_stub(cwd, pdf_file, texfile_name="template", timeout=30):
    source = os.path.join(cwd, f"{texfile_name}.tex")
    if os.path.exists(source):
        with open(source, "r", encoding="utf-8") as f:
            text = f.read()
        with open(pdf_file, "w", encoding="utf-8") as f:
            f.write(text)


def _load_paper_text(pdf_path, num_pages=None, min_size=100):
    with open(pdf_path, "r", encoding="utf-8") as f:
        return f.read()


def _no_grid_images(pdf_path, output_dir, scale=2.0):
    os.makedirs(output_dir, exist_ok=True)
    return []


def install(client, search=None, gate_context=None):
    """Patch all upstream bindings. gate_context (mutable dict) carries
    {token_table, citation_map, manifest, gate_hits} for the pre-score gates.
    Returns uninstall()."""
    mods = {name: importlib.import_module(name) for name in (
        "utils.gemini_utils", "utils.openai_utils", "utils.llm_backend_utils",
        "utils.scholar_utils", "utils.content_parsing_utils",
        "methods.agents.outline_agent", "methods.agents.literature_review_agent",
        "methods.agents.section_writing_agent", "methods.agents.content_refinement_agent",
        "autoraters.agent_review",
    )}
    gem = mods["utils.gemini_utils"]
    oai = mods["utils.openai_utils"]
    backend = mods["utils.llm_backend_utils"]
    outline = mods["methods.agents.outline_agent"]
    lit = mods["methods.agents.literature_review_agent"]
    section = mods["methods.agents.section_writing_agent"]
    refine = mods["methods.agents.content_refinement_agent"]
    review = mods["autoraters.agent_review"]
    parsing = mods["utils.content_parsing_utils"]
    scholar = mods["utils.scholar_utils"]

    def openai_text_wrapper(prompt, model_name, generation_configs=None,
                            result_parsing_func=None,
                            check_parsed_response_not_none=True, system_prompt=None):
        configs = dict(generation_configs or {})
        if system_prompt:
            configs["system_instruction"] = system_prompt
        return client.call_text(prompt, model_name,
                                result_parsing_func=result_parsing_func,
                                generation_configs=configs,
                                check_parsed_response_not_none=check_parsed_response_not_none)

    def openai_content_wrapper(content, model_name, generation_configs=None,
                               result_parsing_func=None,
                               check_parsed_response_not_none=True, system_prompt=None):
        texts = [p["text"] for p in content if p.get("type") == "text"]
        if len(texts) != len(content):
            from .llm import GatewayError
            raise GatewayError("gateway_text_only", "image content parts")
        return openai_text_wrapper("\n\n".join(texts), model_name, generation_configs,
                                   result_parsing_func, check_parsed_response_not_none,
                                   system_prompt)

    def record_ceiling(exc):
        # Upstream catches Exception in its refinement loop and in
        # _get_peer_review; pipeline.run_refinement re-raises this afterwards.
        if gate_context is not None:
            gate_context["ceiling_error"] = exc

    def repairing_parser(result_parsing_func):
        # The refinement agent stores this latex verbatim, so repair it here
        # as well as in gated_review: otherwise a repaired review would score
        # text that the accepted draft does not keep.
        def parse_and_repair(raw):
            parsed = result_parsing_func(raw)
            try:
                obj = json.loads(parsed)
            except (TypeError, ValueError):
                return parsed
            latex = obj.get("latex") if isinstance(obj, dict) else None
            if not isinstance(latex, str) or not latex.strip():
                return parsed
            try:
                repaired, _remaining = repair.apply_repair(
                    client, latex, gate_context.get("token_table"),
                    gate_context.get("citation_map"),
                    gate_context.get("manifest"), gate_context)
            except CeilingError as exc:
                record_ceiling(exc)
                raise
            obj["latex"] = repaired
            return json.dumps(obj)
        return parse_and_repair

    def refinement_contents_wrapper(contents, model_name, max_retries=5,
                                    base_interval_sec=5, result_parsing_func=None,
                                    generation_configs=None,
                                    check_parsed_response_not_none=True):
        # The content loop passes parse_gemini_json_latex_response; the
        # formatting loop passes a lambda. Only content rounds count against
        # the refinement-round ceiling.
        is_content = result_parsing_func is refine.parse_gemini_json_latex_response
        purpose = "refinement" if is_content else "format"
        parser = result_parsing_func
        if (is_content and gate_context is not None
                and gate_context.get("token_table") is not None):
            parser = repairing_parser(result_parsing_func)
        return client.call_contents(contents, model_name,
                                    result_parsing_func=parser,
                                    generation_configs=generation_configs,
                                    check_parsed_response_not_none=check_parsed_response_not_none,
                                    purpose=purpose)

    original_review = refine.perform_review_agentreview

    def gated_review(text, model_name, num_review_ensemble=3, temperature=0.75,
                     reviewer_system_prompt=None, review_instruction_form=None):
        if gate_context and gate_context.get("token_table") is not None:
            try:
                repaired, violations = repair.apply_repair(
                    client, text, gate_context["token_table"],
                    gate_context.get("citation_map"),
                    gate_context.get("manifest"), gate_context)
            except CeilingError as exc:
                record_ceiling(exc)
                raise
            if violations:
                raise gates.GateError(violations)
            text = repaired
        kwargs = {}
        if review_instruction_form is not None:
            kwargs["review_instruction_form"] = review_instruction_form
        return original_review(text, model_name,
                               num_review_ensemble=num_review_ensemble,
                               temperature=temperature,
                               reviewer_system_prompt=reviewer_system_prompt,
                               **kwargs)

    def citation_map_wrapper(self, papers):
        base = original_citation_map(self, papers)
        if search is not None:
            from .search import normalize_title
            for entry in base.values():
                ids = search.identifiers.get(normalize_title(entry.get("title", "")))
                if ids:
                    entry["doi"] = ids.get("doi", "")
                    entry["pmid"] = ids.get("pmid", "")
                    entry["externalIds"] = {"DOI": ids.get("doi", ""),
                                            "PMID": ids.get("pmid", "")}
        return base

    lit_cls = lit.HybridLiteratureAgent
    original_citation_map = lit_cls._generate_citation_map

    s2 = search.s2_title_search if search is not None else scholar.s2_title_search

    patches = [
        (gem, "call_gemini_with_contents", client.call_contents),
        (gem, "call_gemini_with_text_prompt", client.call_text),
        (gem, "call_gemini_with_images", client.call_images),
        (gem, "get_genai_client", _no_provider),
        (oai, "get_openai_client", _no_provider),
        (oai, "call_openai_models_with_text_prompt", openai_text_wrapper),
        (oai, "call_openai_models_with_content", openai_content_wrapper),
        (backend, "call_llm_with_text_prompt", client.call_text),
        (backend, "call_llm_with_images", client.call_images),
        (backend, "call_llm_with_pdf", client.call_pdf),
        (outline, "call_gemini_with_contents", client.call_contents),
        (lit, "call_gemini_with_contents", client.call_contents),
        (lit, "s2_title_search", s2),
        (section, "call_llm_with_images", client.call_images),
        (refine, "call_gemini_with_contents", refinement_contents_wrapper),
        (refine, "call_gemini_with_images",
         lambda *a, **k: client.call_images(*a, purpose="format", **k)),
        (refine, "compile_latex", _compile_latex_stub),
        (refine, "load_paper", _load_paper_text),
        (refine, "pdf_to_grid_images", _no_grid_images),
        (refine, "perform_review_agentreview", gated_review),
        (review, "call_gemini_with_text_prompt",
         lambda *a, **k: client.call_text(*a, purpose="review", **k)),
        (parsing, "call_gemini_with_text_prompt", client.call_text),
        (scholar, "s2_title_search", s2),
        (lit_cls, "_generate_citation_map", citation_map_wrapper),
    ]

    originals = [(obj, name, getattr(obj, name)) for obj, name, _ in patches]
    for obj, name, replacement in patches:
        setattr(obj, name, replacement)

    def uninstall():
        for obj, name, original in originals:
            setattr(obj, name, original)

    return uninstall
