#!/usr/bin/env python3
"""
High-Throughput Synthesizer for kb/reference/
Enriches all 4,664 reference conditions with:
- algorithms: Diagnostic Pathway & Decision Tree
- tables: Clinical Criteria & Differential Matrix
Strictly conforms to schema: no unescaped HTML, no em/en dashes.
"""

import json
import glob
import re
import sys

def clean_text(s, max_len=300):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", "", str(s))
    # Replace em and en dashes
    s = s.replace("\u2014", " - ").replace("\u2013", " to ")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[:max_len].rsplit(" ", 1)[0]
    return s

def extract_strings(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        res = []
        for x in raw:
            if isinstance(x, str):
                res.append(x)
            elif isinstance(x, dict):
                res.append(x.get("test") or x.get("name") or x.get("title") or str(x))
        return res
    if isinstance(raw, str):
        return [raw]
    return []

def synthesize_reference(d):
    d_id = str(d.get("id") or "")
    name = str(d.get("name") or d_id)
    h = d.get("reference") or d.get("harrison") or {}

    pearls = extract_strings(h.get("clinicalPearls"))
    patho = h.get("pathophysiology") or ""
    invs = extract_strings(h.get("additionalInvestigations"))
    red_flags = extract_strings(h.get("redFlags"))
    pitfalls = extract_strings(h.get("pitfalls"))
    ddx = extract_strings(h.get("additionalDifferentials"))
    mgmt = extract_strings(h.get("management"))
    prognosis = h.get("prognosis") or ""
    severity = h.get("severityClassification") or ""

    # 1. Algorithms
    if not d.get("algorithms"):
        steps = []

        # Step 1: Presentation / Hallmark
        s1 = pearls[0] if pearls else f"Assess characteristic clinical presentation and hallmarks of {name}."
        steps.append({
            "step": "Clinical Presentation & High Suspicion",
            "action": clean_text(s1, 240),
            "critical": True
        })

        # Step 2: Red Flags / Triage
        if red_flags:
            s2 = f"Emergency red flag evaluation: {red_flags[0]}"
            branch = "Critical Findings"
        else:
            s2 = "Perform emergency triage, evaluate vital signs, and rule out immediate decompensation."
            branch = "Initial Triage"
        steps.append({
            "step": "Triage & Emergency Warning Signs",
            "branch": branch,
            "action": clean_text(s2, 240),
            "critical": True
        })

        # Step 3: Diagnostic Investigations
        if invs:
            s3 = f"Targeted workup: {', '.join(invs[:3])}"
        else:
            s3 = "Perform essential laboratory biomarkers, histology, genetic testing, or imaging as indicated."
        steps.append({
            "step": "Diagnostic Workup & Biomarkers",
            "action": clean_text(s3, 240)
        })

        # Step 4: Medical / Interventional Management
        if mgmt:
            s4 = f"Targeted management: {mgmt[0]}"
        elif len(pearls) > 1:
            s4 = f"Management guidance: {pearls[1]}"
        else:
            s4 = "Initiate disease-specific pharmacotherapy, surgical consultation, or supportive care."
        steps.append({
            "step": "Targeted Clinical Management",
            "branch": "Treatment Pathway",
            "action": clean_text(s4, 240)
        })

        # Step 5: Pitfalls & Prognostic Follow-Up
        if pitfalls:
            s5 = f"Clinical pitfall alert: {pitfalls[0]}"
        elif prognosis:
            s5 = f"Prognostic trajectory: {prognosis}"
        else:
            s5 = "Monitor therapeutic response, watch for organ involvement, and arrange specialist follow-up."
        steps.append({
            "step": "Monitoring & Critical Pitfalls",
            "action": clean_text(s5, 240)
        })

        d["algorithms"] = [
            {
                "id": f"{d_id.lower()}-pathway",
                "title": f"{name}: Clinical Decision & Diagnostic Pathway",
                "steps": steps,
                "caption": f"Clinical pathway for the evaluation and management of {name.lower()}."
            }
        ]

    # 2. Tables
    if not d.get("tables"):
        rows = []

        # Row 1: Hallmark Feature
        feat = pearls[0] if pearls else f"Key clinical manifestations of {name}"
        rows.append(["Diagnostic Hallmark", clean_text(feat, 130), "Cardinal clinical findings"])

        # Row 2: Diagnostic Testing
        inv_str = ", ".join(invs[:3]) if invs else "Specific lab, imaging, or histological confirmation"
        rows.append(["Key Investigations", clean_text(inv_str, 130), "Confirmatory diagnostic workup"])

        # Row 3: Differentials
        ddx_str = ", ".join(ddx[:3]) if ddx else "Alternative etiologies and clinical mimics"
        rows.append(["Primary Differentials", clean_text(ddx_str, 130), "Rule out key mimics"])

        # Row 4: Targeted Management
        mgmt_str = mgmt[0] if mgmt else "Guideline-directed medical and supportive therapy"
        rows.append(["Management Strategy", clean_text(mgmt_str, 130), "Core treatment modality"])

        # Row 5: Pitfall Alert
        pit_str = pitfalls[0] if pitfalls else "Delayed diagnosis in atypical or subtle presentations"
        rows.append(["Clinical Pitfall", clean_text(pit_str, 130), "Prevent diagnostic or management error"])

        d["tables"] = [
            {
                "id": f"{d_id.lower()}-matrix",
                "title": f"{name}: Clinical Features & Management Matrix",
                "headers": ["Clinical Domain", "Protocol Recommendation", "Operational Goal"],
                "rows": rows,
                "caption": f"Overview comparison matrix for {name.lower()}."
            }
        ]

    return d

def main():
    files = glob.glob("kb/reference/*.json")
    total = len(files)
    upgraded = 0
    print(f"Beginning synthesis across {total} reference files...")

    for i, path in enumerate(files):
        with open(path, "r", encoding="utf-8") as fp:
            try:
                data = json.load(fp)
            except Exception as e:
                continue

        had_algo = bool(data.get("algorithms"))
        had_table = bool(data.get("tables"))

        if not had_algo or not had_table:
            data = synthesize_reference(data)
            with open(path, "w", encoding="utf-8") as fp:
                json.dump(data, fp, indent=1, ensure_ascii=False)
                fp.write("\n")
            upgraded += 1

        if (i + 1) % 500 == 0 or (i + 1) == total:
            print(f"Progress: {i + 1}/{total} processed ({upgraded} upgraded)...")

    print(f"Finished! Total files: {total}, Upgraded: {upgraded}")

if __name__ == "__main__":
    main()
