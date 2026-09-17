# External monitor photo datasets (internal benchmark only)

Not committed (see `.gitignore`), not shipped in the app, not used to train anything that ships.
Licence as tagged by the Roboflow uploaders: CC BY 4.0. The uploaders do not state that they own the
images, so this data is used ONLY for internal measurement. Before any other use, confirm ownership.

| Dataset | Source | Licence (as tagged) | Credit |
|---|---|---|---|
| model_OCR v1 (1,447 images) | https://universe.roboflow.com/phanraksa-trongmethi-l7imc/model_ocr-r39vl | CC BY 4.0 | phanraksa-trongmethi-l7imc, Roboflow Universe |
| Rios-Monitor-V1 v4 (9,414 images) | https://universe.roboflow.com/nanobioslab/rios-monitor-v1-tqkl8 | CC BY 4.0 | nanobioslab, Roboflow Universe |

Deliberately excluded: Cloudphysician Inter IIT 11.0 competition data and its re-uploads (no licence
from the data owner).

Labels: the datasets give boxes per vital class, NOT the displayed values. Ground-truth values in
`<case>.json` are drafted by reading the image and count only after a human confirms them
(`"labelStatus": "confirmed"`); drafts are scored separately and never reported as accuracy.
