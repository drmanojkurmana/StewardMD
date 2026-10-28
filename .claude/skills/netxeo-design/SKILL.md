---
name: netxeo-design
description: Netxeo "Autonomous Art Director" design laws. 100+ anti-AI design rules, UI laws (Fitts, Hick, type scales), UX psychology, creative technologies (GSAP, CSS Grid), 121 anti-AI copywriting rules, and 44 industry/aesthetic trend references (incl. healthcare-and-medical, dashboards-and-data). Use when designing, building or reviewing frontend UI and you want a checklist of AI design tells or a domain-specific visual direction.
---

# Netxeo Design Skill

Source: https://github.com/Netxeo/skill-file-design (MIT). Packaged here as an on-demand skill instead of
running its `npx @netxeo/design-skill` installer, which appends a mandatory "Art Director" block to
CLAUDE.md / AGENTS.md / .cursorrules. Project conventions in CLAUDE.md take precedence over these rules.

## Core pillars (read the ones relevant to the task)
- `content/core/00-anti-ai-design.md` : 100 "AI tells" across layout, visuals, type, components, motion, code, each with the human fix.
- `content/core/01-ui-laws-and-systems.md` : Fitts, Hick, typography scales, hierarchy.
- `content/core/02-ux-human-psychology.md` : cognitive biases and persuasion patterns.
- `content/core/03-creative-technologies.md` : GSAP, CSS Grid and other advanced techniques.
- `content/core/04-anti-ai-copywriting.md` : 121 copywriting rules (banned filler words, no bracket templates).

## Trend library
`content/design-trends/NN-<topic>.md`: 44 industry and aesthetic references. Pick the one matching the
product (for a clinical app: `08-healthcare-and-medical.md`, `07-dashboards-and-data.md`,
`20-kids-and-accessibility.md`).

## Workflow
1. Identify industry, mood and audience from the task.
2. Read `00-anti-ai-design.md` plus the matching trend file(s).
3. Build or review against them; call out which tells were found and how each was fixed.
