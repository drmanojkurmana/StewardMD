# 00-design-references

Shared reference library for web design agents. This directory is **not a skill** -- it is a curated collection of DESIGN.md files and the format specification that agents consume during planning and build phases.

## What's Here

```
00-design-references/
  README.md                  # This file
  design-md-format.md        # DESIGN.md format spec + blank template
  design-md-index.md         # Index of all 10 brand references by aesthetic category
  references/
    by-aesthetic/
      luxury-minimal/
        stripe.md
        apple.md
      warm-editorial/
        airbnb.md
        notion.md
      dark-premium/
        linear.md
        vercel.md
      bold-energetic/
        nike.md
        spotify.md
      clean-professional/
        shopify.md
        wise.md
```

## How Agents Should Use This

1. **Read the format spec first.** Open `design-md-format.md` to understand the DESIGN.md structure, all 9 sections, required fields, and the validation checklist. This is essential if you need to generate a DESIGN.md from scratch for a new project.

2. **Browse the index to pick references.** Open `design-md-index.md` to see all 10 brand references organized by aesthetic category (Luxury Minimal, Warm Editorial, Dark Premium, Bold Energetic, Clean Professional). Match the client's industry and vibe to a category.

3. **Read 1-2 reference files for inspiration.** Pull up the actual DESIGN.md files from the matching category. Use them as inspiration for color palettes, typography choices, component styling patterns, and layout approaches. Do not copy them verbatim -- adapt the patterns to the client's brand.

## When to Reference This

- During the **design audit** phase of a website rebuild, to understand what good looks like in the target aesthetic
- During the **rebuild plan** phase, to inform color palette and typography decisions
- When generating a **new DESIGN.md from scratch**, to follow the correct format and see real-world examples of each section
- When reviewing a build for **design quality**, to compare against reference-grade implementations

## Origin

The DESIGN.md format is based on the specification from [VoltAgent/awesome-design-md](https://github.com/AVolkDev/awesome-design-md), inspired by Google Stitch. Individual brand reference files were fetched using `npx getdesign@latest add [brand]`.
