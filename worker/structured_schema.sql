-- StewardMD — STRUCTURED clinical drug schema (NEW model, local only; not applied).
-- Every generic is normalized into clinician-friendly fields (Lexicomp/UpToDate
-- style). The complete official label is PRESERVED in raw_label for verification;
-- the structured fields are the default UI. AI is used only to faithfully
-- restructure/summarize official text — never to invent.
-- List-type fields are stored as JSON arrays (TEXT).

CREATE TABLE IF NOT EXISTS drug_structured (
  composition        TEXT PRIMARY KEY,
  summary            TEXT,   -- 2–3 line clinician summary
  therapeutic_class  TEXT,
  pharm_class        TEXT,
  moa                TEXT,   -- mechanism of action
  rx_otc             TEXT,
  habit_forming      TEXT,
  routes             TEXT,   -- JSON array
  -- dosing
  adult_dose         TEXT,
  ped_dose           TEXT,
  geriatric          TEXT,
  dosage_table       TEXT,   -- JSON array of {indication,route,dose}
  renal_adjust       TEXT,
  hepatic_adjust     TEXT,
  -- administration
  administration     TEXT,   -- JSON array
  food_timing        TEXT,   -- before/after food
  oral_admin         TEXT,
  iv_admin           TEXT,
  im_admin           TEXT,
  dilution_infusion  TEXT,
  -- safety
  pregnancy          TEXT,
  lactation          TEXT,
  contraindications  TEXT,   -- JSON array
  boxed_warning      TEXT,
  precautions        TEXT,   -- JSON array
  common_se          TEXT,   -- JSON array
  serious_se         TEXT,   -- JSON array
  interactions       TEXT,   -- JSON array (major)
  food_interactions  TEXT,
  alcohol            TEXT,
  monitoring         TEXT,   -- JSON array
  -- pharmacokinetics
  onset              TEXT,
  peak               TEXT,
  half_life          TEXT,
  duration           TEXT,
  storage            TEXT,
  -- patient / extras
  counseling         TEXT,   -- JSON array
  missed_dose        TEXT,
  overdose           TEXT,
  offlabel           TEXT,   -- JSON array
  guideline_notes    TEXT,
  -- provenance
  refs               TEXT,   -- JSON array of {title,url}
  sources            TEXT,   -- JSON array of source names (openFDA, DailyMed, EMA, …)
  raw_label          TEXT,   -- FULL official text/JSON preserved for verification
  reviewed           INTEGER DEFAULT 0,  -- clinician sign-off flag
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_struct_class ON drug_structured(therapeutic_class);
