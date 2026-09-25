# OpenMed PharmaDetect used by Drug Interactions

Verified 2026-09-25 from the exact upstream repository model card and Hugging Face API.

- Repository: https://huggingface.co/OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android
- Revision: `58e8e4e79958de9032042ad9a57e788e82f35ea2`
- Model card: https://huggingface.co/OpenMed/OpenMed-NER-PharmaDetect-TinyMed-65M-v1-onnx-android/blob/58e8e4e79958de9032042ad9a57e788e82f35ea2/README.md
- Declared license: Apache-2.0. License text: `openmed-apache-2.0.txt`.
- Attribution: OpenMed / Maziyar Panahi et al., OpenMed NER: Open-Source, Domain-Adapted State-of-the-Art Transformers for Biomedical NER Across 12 Public Datasets (2025), https://arxiv.org/abs/2508.01630.
- Exact sizes and SHA-256 digests are recorded in `ddi-catalog.js` and enforced in `openmed-ner.js` before inference. Model bytes were downloaded and the SHA-256 independently matched the upstream LFS hash.
- Weights are fetched on explicit user action, not bundled. No clinical text is uploaded by this integration.
- The model tags pharmaceutical mentions. It does not determine drug identity, negation, prescriptions, or interaction safety. Confirm each candidate before including it.
