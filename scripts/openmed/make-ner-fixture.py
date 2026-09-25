"""Generate the test fixtures for openmed-ner.js (test/fixtures/openmed-ner/<kind>/).

NOT an OpenMed model. A lookup-table ONNX graph with the exact I/O contract of OpenMed's
`-onnx-android` token-classification export (openmed/onnx/convert.py): int64 inputs `input_ids` and
`attention_mask` shaped [batch, sequence], float `logits` [batch, sequence, labels]. Each vocab id maps
to one fixed logit row, so the tokenizer, windowing, BIO decoding and onnxruntime-web plumbing can be
tested end to end without the real weights. Usage: python3 scripts/openmed/make-ner-fixture.py
"""
import json, os
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

SPECIAL = ["[PAD]", "[UNK]", "[CLS]", "[SEP]"]
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "test", "fixtures", "openmed-ner")

def build(kind, labels, words):
    vocab = {t: i for i, t in enumerate(SPECIAL)}
    tags = {}
    for tok, tag in words:
        if tok not in vocab:
            vocab[tok] = len(vocab)
        tags[vocab[tok]] = tag
    table = np.full((len(vocab), len(labels)), -4.0, dtype=np.float32)
    for i in range(len(vocab)):
        table[i, labels.index(tags.get(i, "O"))] = 4.0
    ids = helper.make_tensor_value_info("input_ids", TensorProto.INT64, ["batch", "sequence"])
    mask = helper.make_tensor_value_info("attention_mask", TensorProto.INT64, ["batch", "sequence"])
    out = helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", "sequence", len(labels)])
    maskf = helper.make_node("Cast", ["attention_mask"], ["mask_f"], to=TensorProto.FLOAT)
    masku = helper.make_node("Unsqueeze", ["mask_f", "axes"], ["mask_u"])
    gather = helper.make_node("Gather", ["table", "input_ids"], ["raw"], axis=0)
    mul = helper.make_node("Mul", ["raw", "mask_u"], ["logits"])
    graph = helper.make_graph([maskf, masku, gather, mul], "openmed_ner_fixture", [ids, mask], [out],
                              initializer=[numpy_helper.from_array(table, "table"),
                                           numpy_helper.from_array(np.array([-1], dtype=np.int64), "axes")])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="stewardmd-fixture")
    model.ir_version = 8
    onnx.checker.check_model(model)
    d = os.path.join(ROOT, kind)
    os.makedirs(d, exist_ok=True)
    onnx.save(model, os.path.join(d, "model_int8.onnx"))
    tok = {"version": "1.0", "normalizer": {"type": "BertNormalizer", "clean_text": True, "handle_chinese_chars": True,
           "strip_accents": None, "lowercase": True}, "pre_tokenizer": {"type": "BertPreTokenizer"},
           "model": {"type": "WordPiece", "unk_token": "[UNK]", "continuing_subword_prefix": "##",
                     "max_input_chars_per_word": 100, "vocab": vocab}}
    with open(os.path.join(d, "tokenizer.json"), "w") as f:
        json.dump(tok, f, indent=0, sort_keys=True)
    with open(os.path.join(d, "id2label.json"), "w") as f:
        json.dump({str(i): l for i, l in enumerate(labels)}, f, indent=0)

# Drugs: whole-word tokens and ones only reachable through sub-words (para ##ceta ##mol).
build("pharma", ["O", "B-CHEM", "I-CHEM"], [
    ("start", "O"), ("give", "O"), ("the", "O"), ("patient", "O"), ("on", "O"), ("and", "O"), ("with", "O"),
    ("mg", "O"), ("500", "O"), ("600", "O"), ("5", "O"), ("bd", "O"), ("od", "O"), ("for", "O"), ("fever", "O"),
    (".", "O"), (",", "O"),
    ("warfarin", "B-CHEM"), ("aspirin", "B-CHEM"), ("digoxin", "B-CHEM"),
    ("para", "B-CHEM"), ("##ceta", "I-CHEM"), ("##mol", "I-CHEM"),
    ("line", "B-CHEM"), ("##zol", "I-CHEM"), ("##id", "I-CHEM"),
    ("insulin", "B-CHEM"), ("glargine", "I-CHEM"),
])
# Diseases: multi-word spans separated by O words, as in a combined provisional diagnosis.
build("disease", ["O", "B-DISEASE", "I-DISEASE"], [
    ("with", "O"), ("and", "O"), (",", "O"), (".", "O"), ("known", "O"), ("case", "O"), ("of", "O"),
    ("community", "B-DISEASE"), ("acquired", "I-DISEASE"), ("pneumonia", "I-DISEASE"),
    ("type", "B-DISEASE"), ("2", "I-DISEASE"), ("diabetes", "I-DISEASE"), ("mellitus", "I-DISEASE"),
    ("chronic", "B-DISEASE"), ("kidney", "I-DISEASE"), ("disease", "I-DISEASE"), ("stage", "I-DISEASE"), ("3", "I-DISEASE"),
    ("hypertension", "B-DISEASE"),
])
print("fixtures written to", os.path.abspath(ROOT))
