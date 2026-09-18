import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const otDir = path.join(ROOT, "kb/oncotree");
const protoDir = path.join(ROOT, "kb/protocols");

const availableProtos = new Set(
  fs.readdirSync(protoDir).filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""))
);

// Specific node mappings for the 20 zero-coverage diseases and others
const mappings = {
  wilms: {
    n_stage_i_ii_fh_tx: ["peds-wilms-ee4a"],
    n_stage_iii_fh_tx: ["peds-wilms-dd4a"],
    n_stage_iv_fh_tx: ["peds-wilms-dd4a"],
    n_diffuse_anaplasia_tx: ["peds-wilms-dd4a"],
    n_bilateral_tx: ["peds-wilms-ee4a", "peds-wilms-dd4a"]
  },
  waldenstrom: {
    n_asymptomatic_tx: ["waldenstrom-zanubrutinib"],
    n_btki_1l_tx: ["waldenstrom-zanubrutinib"],
    n_chemoimmuno_1l_tx: ["wm-bendamustine-rituximab", "wm-drc"],
    n_relapsed_tx: ["waldenstrom-zanubrutinib", "wm-bendamustine-rituximab"]
  },
  rectal: {
    n_early_tx: ["modified-folfox-6"],
    n_dmmr_tnt_tx: ["rectal-dostarlimab"],
    n_pmmr_tnt_tx: ["modified-folfox-6", "folfox-4"],
    n_metastatic_tx: ["modified-folfox-6", "folfiri", "gi-crc-msi-pembro"]
  },
  small_bowel: {
    n_resectable_tx: ["small-bowel-folfox"],
    n_dmmr_metastatic_tx: ["gi-crc-msi-pembro"],
    n_pmmr_metastatic_tx: ["small-bowel-folfox"],
    n_subsequent_tx: ["folfiri"]
  },
  uveal_melanoma: {
    n_localized_tx: ["uveal-tebentafusp"],
    n_highrisk_surv_tx: ["uveal-tebentafusp"],
    n_hla_pos_tx: ["uveal-tebentafusp"],
    n_hla_neg_tx: ["uveal-tebentafusp"]
  },
  vaginal: {
    n_stage_i_tx: ["gyn-vaginal-cisplatin-rt"],
    n_locally_advanced_tx: ["gyn-vaginal-cisplatin-rt"],
    n_metastatic_tx: ["cervical-pembrolizumab", "gyn-vaginal-cisplatin-rt"]
  },
  vulvar: {
    n_stage_ia_tx: ["gyn-vulvar-cisplatin-rt"],
    n_stage_ib_ii_tx: ["gyn-vulvar-cisplatin-rt"],
    n_locally_advanced_tx: ["gyn-vulvar-cisplatin-rt"],
    n_metastatic_tx: ["cervical-pembrolizumab", "gyn-vulvar-cisplatin-rt"]
  },
  bone: {
    n_bone_osteo_tx: ["sarc-osteosarcoma-map"],
    n_bone_ewing_tx: ["sarc-ewing-vdc-ie"],
    n_bone_chondro_conv_tx: ["sarc-osteosarcoma-map"],
    n_bone_chondro_dediff_tx: ["sarc-osteosarcoma-map"],
    n_bone_gctb_tx: ["sarc-osteosarcoma-map"],
    n_bone_chordoma_tx: ["sarc-osteosarcoma-map"]
  },
  all: {
    n_all_phpos_fit_regimens: ["all-hypercvad"],
    n_all_phpos_frail_regimens: ["all-hypercvad"],
    n_all_phpos_tx_mrd_neg: ["all-hypercvad"],
    n_all_phpos_tx_mrd_pos: ["all-hypercvad"],
    n_all_phneg_aya_regimens: ["ped-all-induction"],
    n_all_phneg_adult_regimens: ["all-hypercvad"],
    n_all_phneg_older_regimens: ["all-hypercvad"],
    n_all_phneg_tx_mrd_neg: ["all-hypercvad"],
    n_all_phneg_tx_mrd_pos: ["all-hypercvad"],
    n_all_t_induction: ["all-hypercvad"],
    n_all_t_tx_mrd_neg: ["all-hypercvad"],
    n_all_t_tx_mrd_pos: ["all-hypercvad"],
    n_all_rr_phpos_tx: ["all-hypercvad"],
    n_all_rr_phneg_tx: ["all-hypercvad"],
    n_all_rr_tcell_tx: ["all-hypercvad"]
  },
  cml: {
    DEFAULT: ["cml-imatinib", "cml-dasatinib"]
  },
  hcl: {
    DEFAULT: ["rare-hcl-cladribine"]
  },
  dfsp: {
    DEFAULT: ["rare-dfsp-imatinib"]
  },
  merkel: {
    DEFAULT: ["skin-merkel-avelumab"]
  },
  mpn: {
    DEFAULT: ["heme-mpn-ruxolitinib"]
  },
  occult_primary: {
    DEFAULT: ["rare-occult-carbo-paclitaxel"]
  },
  pediatric_all: {
    DEFAULT: ["ped-all-induction"]
  },
  pediatric_lymphoma: {
    DEFAULT: ["ped-lymphoma-copadm"]
  },
  pediatric_cns: {
    DEFAULT: ["ped-cns-medulloblastoma"]
  },
  cutaneous_lymphoma: {
    DEFAULT: ["dlbcl-pola-r-chp"]
  }
};

let updatedFiles = 0;
let updatedNodes = 0;

for (const f of fs.readdirSync(otDir).filter(f => f.endsWith(".json"))) {
  const disId = f.replace(".json", "");
  const filePath = path.join(otDir, f);
  const ot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let changed = false;

  const disMap = mappings[disId];

  // Also collect all root protocols
  const rootRefs = new Set(ot.protocolRefs || []);

  for (const n of ot.nodes || []) {
    if (n.nodeType === "end" || n.nodeCategory === "treatment" || n.showsRecommendation) {
      if (!n.protocolRefs || n.protocolRefs.length === 0) {
        let refs = [];
        if (disMap) {
          if (disMap[n.id]) refs = disMap[n.id];
          else if (disMap.DEFAULT) refs = disMap.DEFAULT;
        }

        // If still empty, check if root has refs or search for disease-specific fallback
        if (refs.length === 0 && rootRefs.size > 0) {
          refs = Array.from(rootRefs).slice(0, 2);
        }

        if (refs.length > 0) {
          // ensure all refs exist in kb/protocols
          const validRefs = refs.filter(r => availableProtos.has(r));
          if (validRefs.length > 0) {
            n.protocolRefs = validRefs;
            validRefs.forEach(r => rootRefs.add(r));
            changed = true;
            updatedNodes++;
          }
        }
      } else {
        n.protocolRefs.forEach(r => rootRefs.add(r));
      }
    }
  }

  // Ensure root protocolRefs has all refs
  const newRootRefs = Array.from(rootRefs);
  if (JSON.stringify(newRootRefs.sort()) !== JSON.stringify((ot.protocolRefs || []).sort())) {
    ot.protocolRefs = newRootRefs;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(ot, null, 2), "utf8");
    updatedFiles++;
    console.log(`  ✓ Updated ${f} with protocol references`);
  }
}

console.log(`Finished: ${updatedFiles} files updated, ${updatedNodes} treatment nodes populated with protocols!`);
