# ResearchMD Phase 6: institution workspaces (6.5), module `_institutions.js`

Migration 0005 adds `research_institutions.seats`,
`research_institution_members.role` ('admin'|'member'),
`research_projects.institution_id` and `research_institution_onboarding`.
Phase 3 institution tables and the token-only admin routes
(`/v1/admin/institutions*`, `_credits.js`) are untouched.

## adminAuth (shared by 6.1 / 6.3 / 5C incident routes)

Exported from `_institutions.js`. Accepts EITHER existing admin credential:
1. `x-research-admin-token` equal to `env.RESEARCH_ADMIN_TOKEN`
   (constant-time; the Phase 3 research admin credential), OR
2. a Firebase ID token (verifyFirebaseClaims) whose VERIFIED email
   (`verifiedEmailOf`) is in `ownerEmails(env)` (the app's existing owner/admin
   claim, `_adminauth.js`).
No credential -> 401 `unauthorized`; a valid Firebase user who is not an owner
-> 403 `admin_only`. Admin routes are hooked before the pilot-mode gate, like
the Phase 3 admin routes.

## Routes

| Method | Path | Gate | Notes |
|---|---|---|---|
| POST | `/v1/institutions` | adminAuth | `{name, seats?}` (seats 1-500, default 10); 201 |
| GET | `/v1/admin/institutions` | adminAuth | all institutions + seat usage |
| GET | `/v1/institutions` | Firebase | the caller's memberships |
| GET | `/v1/institutions/{id}` | member | outsider 404 |
| GET | `/v1/institutions/{id}/seats` | member | `{seats, used, members:[{uid, role, createdTs}]}` |
| POST | `/v1/institutions/{id}/members` | inst admin or adminAuth | `{uid, role}`; seat cap -> 409 `seats_full` |
| PUT | `/v1/institutions/{id}/members/{uid}` | inst admin or adminAuth | `{role}` |
| DELETE | `/v1/institutions/{id}/members/{uid}` | inst admin or adminAuth | removing the last admin -> 409 `last_admin` |
| GET | `/v1/institutions/{id}/projects` | member | institution-owned projects (metadata) |
| POST | `/v1/institutions/{id}/projects` | member | `{title, discipline?, specialty?, studyType?, researchQuestion?}`; creator becomes project owner; `institution_id` set |
| GET | `/v1/institutions/{id}/onboarding` | member | checklist state |
| PUT | `/v1/institutions/{id}/onboarding` | inst admin or adminAuth | `{items:{pilot_agreement_signed?, training_completed?}}` |

Project-level access is still governed by `research_members`: institution
membership alone never grants a project role (tenant isolation, plan 11).
Institution admins see the seat list and project metadata, not project data.

## Onboarding checklist

Computed live (source `computed`): `workspace_created` (always),
`members_added` (member count > 0), `credits_granted` (ledger grant sum > 0),
`first_project` (institution project count > 0), `first_review` (any
institution project has a saved run). Manual flags (source `manual`, stored in
`items_json`): `pilot_agreement_signed`, `training_completed`. GET returns
`{items:[{key, label, done, source}], updatedTs}`; no LLM.
