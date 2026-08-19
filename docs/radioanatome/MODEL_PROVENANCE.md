# Model and weights provenance

GENERATED on 2026-08-19.

**The distinction that matters:** an Apache-2.0 repository does NOT mean every
checkpoint in it is Apache-2.0. TotalSegmentator is the worked example — its code
and its `total` weights are Apache-2.0, but 18 subtask checkpoints are licence-
gated. That was verified in code rather than inferred:
`registry.requires_license(task)` is literally `task in commercial_models`.

| model | code licence | WEIGHTS licence | commercial | verdict |
|---|---|---|---|---|
| `fastsurfer-segonly` | Apache-2.0 | Apache-2.0 | yes | **CLEAR** |
| `freesurfer` | FreeSurfer v1.0 | FreeSurfer Software License v1.0 | yes | **BLOCKED** |
| `fsl` | FSL Licence | FSL Licence | NO | **BLOCKED** |
| `nv-segment-ct` | Apache-2.0 | Code Apache-2.0; weights under the NVIDIA Open Model License (commercial-friendly) | yes | **CLEAR** |
| `nv-segment-ctmr` | Apache-2.0 (code only) | Non-commercial | NO | **BLOCKED** |
| `synthseg-v1` | Apache-2.0 | Apache-2.0 (v1.0 weights are in-repo) | yes | **CLEAR** |
| `totalsegmentator-appendicular-bones` | Apache-2.0 (code only) | Proprietary subtask weights; free licence for non-commercial use, commercial requires contacting the author | NO | **PENDING_LICENCE** |
| `totalsegmentator-brain-structures` | Apache-2.0 (code only) | Proprietary; free for non-commercial, paid commercial licence required | NO | **BLOCKED** |
| `totalsegmentator-open-subtasks` | Apache-2.0 | Apache-2.0 (the subtask weights NOT marked with an asterisk in the upstream subtask list) | yes | **CLEAR** |
| `totalsegmentator-total` | Apache-2.0 | Apache-2.0 (code and the total / total_mr weights) | yes | **CLEAR** |

## Unverified points, stated rather than hidden

- `fastsurfer-segonly` — the WEIGHTS licence as distinct from the code licence
  is not separately stated upstream, and its training labels are FreeSurfer-
  derived. Recorded in sources.json as UNVERIFIED.
- `synthseg-v1` — only the v1.0 in-repo weights are covered. The 2.0 / robust /
  parc weights come from a separate link with no licence statement: unused.

