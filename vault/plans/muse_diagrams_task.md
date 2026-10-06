# Task: Implement Clinical Diagrams & Diagnostic Imaging Engine for StewardMD KB

You are an expert full-stack medical software engineer working on StewardMD.
Your goal is to implement the **Clinical Diagrams and Diagnostic Imaging Engine** across the Knowledge Base so conditions feature annotated diagrams, ECGs, and X-rays (e.g. STEMI with diagnostic ECG tracing, Pneumonia with chest X-ray consolidation, Tension Pneumothorax, Aortic Dissection CT schematic, etc.).

## 1. Objectives & Requirements

### A. Extend Protocol Schema in `scripts/build-clinical-protocols.mjs`:
1. Add `"diagrams"` to `TOP_KEYS`.
2. Add validation rules for `diagrams` in `validateProtocol`:
   - `diagrams` must be an array of objects.
   - Each diagram must have:
     - `id`: string (kebab-case or alphanumeric)
     - `title`: string
     - `type`: string (e.g., `"ecg"`, `"xray"`, `"ct"`, `"diagram"`, `"ultrasound"`)
     - `src`: string (relative path, e.g., `/assets/kb-diagrams/...` or inline SVG identifier)
     - `caption`: string (explanation of the clinical findings)
     - Optional `annotations`: array of `{ label: string, description: string }`
   - Strings must strictly avoid unescaped em dashes (`—`), en dashes (`–`), and raw HTML tags (as enforced by `textErrors`).

### B. Update Renderers & Styles:
1. **`kb-protocols.js`**:
   - In `readerHTML(p, opts)`: Add rendering for `p.diagrams`:
     - Render `.kbp-sec-diagrams` with `.kbp-diagram-card`
     - Render the image or vector with figure/caption and structured callout badges for annotations.
     - Add jump button in Table of Contents (`p.diagrams.forEach(...)`).
2. **`kb-protocols.css`**:
   - Style `.kbp-sec-diagrams`, `.kbp-diagram-card`, `.kbp-diagram-img`, `.kbp-diagram-meta`, and responsive full-width frames.
   - Ensure clean dark-mode support and mobile overflow safety.
3. **`reasoning.js`**:
   - In `evHarrisonSrc(id)`: Ensure if an entity has `diagrams`, they are rendered in the clinical reasoning drawer.
4. **`kb/tools/build-kb-enrichment.mjs`**:
   - Carry `d.diagrams || h.diagrams || []` into `byId` in `kb.enrichment.js` / `kb.enrichment.2.js`.

### C. Author Clinical Diagrams for High-Yield Visual Protocols:
Create rich SVG/diagram vectors or web-ready assets in `assets/kb-diagrams/`:
1. **`kb/clinical-protocols/community-acquired-pneumonia.json`**:
   - Add diagram for Chest X-ray demonstrating right middle/lower lobe consolidation, air bronchograms, and silhouette sign.
2. **`kb/clinical-protocols/spontaneous-pneumothorax.json`**:
   - Add diagram demonstrating pleural line, absent lung markings, and tension features (tracheal/mediastinal shift).
3. **`kb/clinical-protocols/acute-aortic-syndrome.json`**:
   - Add diagram illustrating Stanford A vs B aortic dissection, intimal flap, true vs false lumen.
4. **`kb/clinical-protocols/cardiac-arrest` / Arrhythmia protocols**:
   - Add diagnostic ECG rhythm tracings (Ventricular Fibrillation, STEMI, Hyperkalemia tented T waves).

### D. Verification Gates:
1. Run `node scripts/build-clinical-protocols.mjs` — must pass with index updated and version token synchronized.
2. Run `node kb/tools/build-kb-enrichment.mjs` — must bundle cleanly.
3. Run `node --experimental-test-module-mocks test/kb-clinical-protocols.test.mjs` — must pass 14/14 tests.
4. Run `node test/kb-loader.test.mjs` — must pass 5/5 tests.

Ensure all code adheres strictly to the repo's no-em/en dash rules and test constraints.
