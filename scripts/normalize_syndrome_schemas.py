import os
import json
import re

SYSTEM_TO_SPECIALTY = {
    "hematology": "Haematology",
    "hematologic": "Haematology",
    "multisystem / rheumatologic (immune-mediated vascular)": "Rheumatology",
    "endocrine": "Endocrinology",
    "endocrine/metabolic": "Endocrinology",
    "infectious": "Infectious Disease",
    "rheumatologic / multisystem vasculitis": "Rheumatology",
    "hepatology": "Gastroenterology & Hepatology",
    "dermatology": "Dermatology",
    "multisystem (oncology / endocrine / hematologic)": "Clinical Oncology",
    "rheumatology": "Rheumatology",
    "endocrinology": "Endocrinology"
}

files_to_check = [
    "POEMS_SYNDROME.json",
    "the_vasculitis_syndromes.json",
    "autoimmune_polyendocrine_syndromes.json",
    "the_metabolic_syndrome.json",
    "TOXIC_SHOCK_SYNDROME.json",
    "beh_et_syndrome.json",
    "HEPATORENAL_SYNDROME.json",
    "DRESS_SYNDROME.json",
    "paraneoplastic_syndromes_endocrinologic_he.json",
    "bone_marrow_failure_syndromes_including.json",
    "pituitary_tumor_syndromes.json",
    "antiphospholipid_syndrome.json",
    "CARCINOID_SYNDROME.json"
]

ref_dir = "/Users/diwakarkumar/Developer/StewardMD/kb/reference"

for fname in files_to_check:
    fpath = os.path.join(ref_dir, fname)
    if not os.path.exists(fpath):
        continue
    with open(fpath, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    changed = False
    if "harrison" in data:
        # Move harrison to reference
        data["reference"] = data.pop("harrison")
        changed = True

    if "specialty" not in data or not data["specialty"]:
        sys_val = (data.get("system") or "").strip().lower()
        matched_spec = SYSTEM_TO_SPECIALTY.get(sys_val, data.get("system") or "Internal Medicine")
        data["specialty"] = matched_spec
        changed = True

    if changed:
        with open(fpath, "w", encoding="utf-8") as fp:
            json.dump(data, fp, indent=2, ensure_ascii=False)
            fp.write("\n")
        print(f"Normalized: {fname} -> specialty: {data['specialty']}, key: reference")

