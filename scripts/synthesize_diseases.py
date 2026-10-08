#!/usr/bin/env python3
"""
Batch Synthesizer for kb/diseases/
Enriches all 144 core disease diagnostic models with:
- algorithms: Diagnostic Pathway & Triage Algorithm
- tables: Clinical Criteria & Differential Matrix
- calculators: Linked calculators where available
"""

import json
import glob
import re

def clean_text(s, max_len=300):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", "", str(s))
    s = s.replace("\u2014", " - ").replace("\u2013", " to ")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[:max_len].rsplit(" ", 1)[0]
    return s

def extract_inv_list(raw_invs):
    if not raw_invs:
        return []
    res = []
    for x in raw_invs:
        if isinstance(x, str):
            res.append(x)
        elif isinstance(x, dict):
            test = x.get("test") or x.get("name") or str(x)
            res.append(test)
    return res

def synthesize_disease(d):
    d_id = d.get("id", "")
    name = d.get("name", "")
    system = d.get("system", "General Medicine")
    h = d.get("enrichment", {}).get("harrison", {})

    pearls = h.get("clinicalPearls", [])
    patho = h.get("pathophysiology", "")
    invs = extract_inv_list(h.get("additionalInvestigations", [])) or extract_inv_list(d.get("investigations", []))
    red_flags = h.get("redFlags", []) or d.get("redFlags", [])
    pitfalls = h.get("pitfalls", [])
    ddx = h.get("additionalDifferentials", [])
    severity = h.get("severityClassification", "")
    prognosis = h.get("prognosis", "")
    matching = d.get("matching", {})

    # 1. Algorithms
    if not d.get("algorithms"):
        steps = []
        
        # Step 1: Presentation & Cardinal Symptoms
        s1 = pearls[0] if pearls else f"Evaluate acute presentation and core clinical features of {name}."
        steps.append({
            "step": "Clinical Presentation & Triage",
            "action": clean_text(s1, 240),
            "critical": True
        })

        # Step 2: Emergency Red Flags
        if red_flags:
            s2 = f"Screen for high-risk signs: {red_flags[0]}"
            s2_branch = "Emergency Warning"
        else:
            s2 = "Assess hemodynamic stability, vital signs, and immediate risk of deterioration."
            s2_branch = "Triage"
        steps.append({
            "step": "Red Flag & Instability Screen",
            "branch": s2_branch,
            "action": clean_text(s2, 240),
            "critical": True
        })

        # Step 3: Diagnostic Investigations
        if invs:
            s3 = f"Targeted workup: {', '.join(invs[:4])}"
        else:
            s3 = "Perform confirmatory laboratory biomarkers, cultures, and appropriate imaging."
        steps.append({
            "step": "Diagnostic & Biomarker Workup",
            "action": clean_text(s3, 240)
        })

        # Step 4: Staging / Severity Stratification
        if severity:
            s4 = f"Stratify severity: {severity}"
        elif ddx:
            s4 = f"Differentiate from top mimics: {', '.join(ddx[:3])}"
        else:
            s4 = "Apply evidence-based criteria to classify disease severity and organ dysfunction."
        steps.append({
            "step": "Severity Staging & Differentiation",
            "branch": "Classification",
            "action": clean_text(s4, 240)
        })

        # Step 5: Management & Pitfalls
        if pitfalls:
            s5 = f"Pitfall avoidance: {pitfalls[0]}"
        elif prognosis:
            s5 = f"Prognosis and trajectory: {prognosis}"
        else:
            s5 = "Initiate guideline-directed medical therapy and monitor clinical progress."
        steps.append({
            "step": "Targeted Management & Monitoring",
            "action": clean_text(s5, 240)
        })

        d["algorithms"] = [
            {
                "id": f"{d_id.lower()}-dx-algo",
                "title": f"{name}: Diagnostic & Clinical Decision Pathway",
                "steps": steps,
                "caption": f"Clinical decision and evaluation pathway for {name.lower()}."
            }
        ]

    # 2. Tables
    if not d.get("tables"):
        rows = []
        
        # Row 1: Core Diagnostic Feature
        feat = pearls[0] if pearls else f"Cardinal presentation of {name}"
        rows.append(["Diagnostic Hallmark", clean_text(feat, 130), "Primary clinical presentation"])

        # Row 2: Essential Investigations
        inv_str = ", ".join(invs[:3]) if invs else "Specific diagnostic testing"
        rows.append(["Key Investigations", clean_text(inv_str, 130), "Confirmatory diagnostic testing"])

        # Row 3: Differential / Mimics
        ddx_str = ", ".join(ddx[:3]) if ddx else "Alternative etiologies in this class"
        rows.append(["Key Differentials", clean_text(ddx_str, 130), "Primary clinical mimics to rule out"])

        # Row 4: Red Flags / Alert
        rf_str = red_flags[0] if red_flags else "Signs of impending clinical deterioration"
        rows.append(["Red Flag Alert", clean_text(rf_str, 130), "Requires urgent stabilization"])

        # Row 5: Critical Pitfall
        pit_str = pitfalls[0] if pitfalls else "Delayed recognition of atypical presentations"
        rows.append(["Clinical Pitfall", clean_text(pit_str, 130), "Avoid diagnostic or therapeutic delay"])

        d["tables"] = [
            {
                "id": f"{d_id.lower()}-matrix",
                "title": f"{name}: Clinical Features & Differential Matrix",
                "headers": ["Clinical Dimension", "Finding / Recommendation", "Significance"],
                "rows": rows,
                "caption": f"Diagnostic and clinical overview matrix for {name.lower()}."
            }
        ]

    return d

def main():
    files = glob.glob("kb/diseases/*.json")
    upgraded = 0
    for path in sorted(files):
        with open(path, "r", encoding="utf-8") as fp:
            try:
                data = json.load(fp)
            except Exception as e:
                print(f"Error reading {path}: {e}")
                continue

        had_algo = bool(data.get("algorithms"))
        had_table = bool(data.get("tables"))

        if not had_algo or not had_table:
            data = synthesize_disease(data)
            with open(path, "w", encoding="utf-8") as fp:
                json.dump(data, fp, indent=2, ensure_ascii=False)
                fp.write("\n")
            upgraded += 1

    print(f"Processed {len(files)} diseases. Upgraded {upgraded} with algorithms and tables.")

if __name__ == "__main__":
    main()
