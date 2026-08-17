"""Model label -> anatomy.

model_labels maps a segmentation model's own label string to one of our structure
ids. Left/Right variants deliberately map to the SAME structure id: the viewer
highlights every pin sharing an id, so one entry plus two components gives the
bilateral behaviour for free.

A label mapped to null is one we have decided NOT to show. Absent and null behave
the same; both are recorded so the decision stays visible.
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))


def load_mapping(module_id):
    with open(os.path.join(_HERE, "labels", module_id + ".json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def categories_block(mapping):
    return mapping.get("categories", {})


def structures_block(mapping):
    return mapping.get("structures", {})


def structure_for_label(mapping, model_label):
    sid = mapping.get("model_labels", {}).get(model_label)
    if not sid:
        return None
    return sid if sid in structures_block(mapping) else None
