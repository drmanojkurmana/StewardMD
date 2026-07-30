# StewardMD Vault

An [Obsidian](https://obsidian.md) knowledge vault for the StewardMD project — the *knowledge around
the code*, not the code. Open this `vault/` folder as an Obsidian vault ("Open folder as vault").

## What's here
- **[[Home]]** — the map of content (start here).
- `modules/` — one note per module: what it does, key files, flag + default, deps, status, gotchas.
- `decisions/` — the [[Decisions]] log (dated architectural calls + why).
- **[[Infra]]** — Cloudflare / Firebase / signing / hosting.
- **[[Roadmap]]** — pending / deferred work per module.

## Conventions
- Link modules with `[[Wikilinks]]`; a link to a note that doesn't exist yet is fine — it's a stub to fill.
- Each module note has frontmatter (`status`, `flag`, `tags`) so you can query with Dataview later.
- **Never put secrets or PHI here** — keys live in gitignored files outside the repo; patient data never leaves the app.

## Safety note
This vault lives in the repo but is **blocked from public serving** by `functions/_middleware.js`
(internal-paths 404). Same block now hides `docs/` and `CLAUDE.md`, which were previously public.
