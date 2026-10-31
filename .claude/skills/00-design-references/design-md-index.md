# DESIGN.md Reference Index

Index of all 10 curated brand reference files, organized by aesthetic category. Use this to find the right references for your project's design direction.

## Brand References by Aesthetic Category

| Category | Brand | File Path | Best For |
|---|---|---|---|
| Luxury Minimal | Stripe | `references/by-aesthetic/luxury-minimal/stripe.md` | Fintech, premium SaaS, precision |
| Luxury Minimal | Apple | `references/by-aesthetic/luxury-minimal/apple.md` | Premium consumer, minimal, cinematic |
| Warm Editorial | Airbnb | `references/by-aesthetic/warm-editorial/airbnb.md` | Hospitality, marketplace, photography-driven |
| Warm Editorial | Notion | `references/by-aesthetic/warm-editorial/notion.md` | Productivity, warm minimal, soft surfaces |
| Dark Premium | Linear | `references/by-aesthetic/dark-premium/linear.md` | Developer tools, SaaS, ultra-precise |
| Dark Premium | Vercel | `references/by-aesthetic/dark-premium/vercel.md` | Developer infra, black/white, Geist font |
| Bold Energetic | Nike | `references/by-aesthetic/bold-energetic/nike.md` | Retail, sports, massive typography, full-bleed |
| Bold Energetic | Spotify | `references/by-aesthetic/bold-energetic/spotify.md` | Entertainment, vibrant green, dark-first |
| Clean Professional | Shopify | `references/by-aesthetic/clean-professional/shopify.md` | E-commerce, cinematic dark, neon accent |
| Clean Professional | Wise | `references/by-aesthetic/clean-professional/wise.md` | Fintech, bright green, friendly, clear |

## How to Pick References

**Step 1: Match the client's industry and vibe to a category.**

- **Luxury Minimal** -- The client wants to feel premium, precise, and restrained. Think fintech dashboards, high-end SaaS, or products where trust and polish matter more than energy. Lots of whitespace, careful typography, muted palettes with one accent color.

- **Warm Editorial** -- The client wants to feel approachable, human, and story-driven. Think marketplaces, hospitality brands, or productivity tools where content and photography take center stage. Rounded corners, warm neutrals, generous spacing.

- **Dark Premium** -- The client wants to feel technical, cutting-edge, and sophisticated. Think developer tools, infrastructure products, or anything targeting engineers and power users. Dark backgrounds, monospace accents, sharp precision, subtle gradients.

- **Bold Energetic** -- The client wants to feel dynamic, confident, and attention-grabbing. Think retail, entertainment, sports, or consumer brands where energy and personality drive engagement. Oversized typography, vivid colors, full-bleed imagery, strong contrast.

- **Clean Professional** -- The client wants to feel trustworthy, clear, and business-ready. Think e-commerce platforms, fintech services, or B2B tools where clarity and usability beat flashiness. Clean layouts, readable type scales, green/blue accents, balanced whitespace.

**Step 2: Read 1-2 files from that category.**

Open the actual DESIGN.md files and study the color palettes, typography hierarchies, component styles, and layout principles. Pay attention to the specific hex values, font stacks, shadow systems, and spacing scales.

**Step 3: Use them as inspiration, not a template.**

Adapt the patterns to the client's actual brand colors, content needs, and target audience. The reference files show you what world-class execution looks like in each aesthetic -- your job is to translate that level of quality into the client's specific context.

## Category Pairing Guide

Some projects blend categories. Common pairings:

- **Fintech startup** -- Start with Clean Professional (Wise), cross-reference Luxury Minimal (Stripe) for premium touches
- **Developer tool** -- Start with Dark Premium (Linear or Vercel), pull Bold Energetic (Spotify) elements if the brand is less austere
- **Local business rebuild** -- Start with Clean Professional (Shopify or Wise), add Warm Editorial (Airbnb) warmth for hospitality/service businesses
- **Creative agency** -- Start with Bold Energetic (Nike), mix in Luxury Minimal (Apple) restraint for the portfolio sections
- **Marketplace / platform** -- Start with Warm Editorial (Airbnb or Notion), layer in Clean Professional structure for trust signals

## Credits

All DESIGN.md reference files are based on the format from [VoltAgent/awesome-design-md](https://github.com/AVolkDev/awesome-design-md), inspired by Google Stitch. Files were fetched using:

```bash
npx getdesign@latest add [brand]
```
