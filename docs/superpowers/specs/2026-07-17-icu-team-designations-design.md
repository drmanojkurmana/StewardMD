# ICU Team — clinical designations (display title + auto-permission)

**Date:** 2026-07-17 · **Status:** approved

## Problem
The ICU care team assigns each member a `role` that is simultaneously a display
label and the permission tier (`head/professor/assistant/senior_resident/junior_resident/intern`,
mirrored in `firestore.rules` `canInstruct`). The head wants richer clinical titles —
Consultant (numbered), Associate Professor, Assistant Professor, Senior/Junior Resident,
Intern, Head Nurse, and free-text custom — without weakening the enforced permission model.

## Approach (chosen)
Add a **display `designation`** string to the member doc, decoupled from permission. Permission
(`role`) is auto-derived from the designation and remains the enforced primitive. No
`firestore.rules` change (admin create/update on member docs is not key-whitelisted; self-update
stays locked to `notif` only, so members can't set their own title).

## Designation → permission map (`icu-collab.js` `DESIGNATIONS`)
| Designation (shown) | `role` written | Instruct? | Admin? | Assignable by |
|---|---|---|---|---|
| Consultant 1–6 | `professor` | ✅ | ✅ | Head only |
| Associate Professor | `professor` | ✅ | ✅ | Head only |
| Assistant Professor | `assistant` | ✅ | ❌ | Head/Prof |
| Senior Resident | `senior_resident` | ✅ | ❌ | Head/Prof |
| Junior Resident | `junior_resident` | ❌ | ❌ | Head/Prof |
| Intern | `intern` | ❌ | ❌ | Head/Prof |
| Head Nurse | `junior_resident` | ❌ | ❌ | Head/Prof |
| Custom title | `assistant` (instruct) / `junior_resident` (execute) | toggle | ❌ | Head/Prof |

`professor` grant is head-only in the existing rules, so Consultant/Associate-Professor are
inherently head-only — no extra gating needed.

## Changes
**`icu-collab.js`**
- `DESIGNATIONS` presets + `roleForDesignation(label)` + `normDesignation(str)` (cap 60 chars).
- `mapMemberDoc` returns `designation`.
- `setDesignation(gid, uid, designation, role)` — admin update writing `{role, designation}`.
- `addByIdOrEmail(gid, idOrEmail, role, designation)` — extra param, writes `designation`.
- Export `DESIGNATIONS`, `roleForDesignation`, `setDesignation`.

**`icu.js`**
- `grpDisplayTitle(m)` = `m.designation || grpRoleLabel(m.role)`.
- Roster rows: use `grpDisplayTitle`; admin (non-head, non-self) rows get a "✎" edit-title button.
- Add-member sheet: role `<select>` → **designation** `<select>` (head-filtered) + optional custom
  text box with a "can give instructions" checkbox (non-empty custom wins).
- New designation sheet for existing members (`grpdesig:<uid>` → picker → `setDesignation`).
- Dispatcher: `grpdesig`, `grpdesigsave`.
- Timeline attribution + on-behalf chips: show live designation looked up by `event.by` uid.

**Unchanged:** invite links (still confer a permission role; designation defaults from it, head
refines later); the create-unit flow; timeline/push data.

## Testing
- `node --check` icu.js + icu-collab.js.
- Verify each preset maps to the correct role/instruct/admin; custom instruct→assistant,
  execute→junior_resident.
- Non-head admin cannot assign Consultant/Associate-Professor (professor grant is head-only).
- Designation persists + displays in roster; falls back to role label when unset.
- No rules deploy; web/native unaffected.
