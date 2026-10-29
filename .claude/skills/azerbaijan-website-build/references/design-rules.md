# Design Rules — Azerbaijan Website Build

These rules are non-negotiable and apply to every component, page, and pixel. Adapted from the core frontend-design skill with Azerbaijan-specific requirements.

## 1. Bold Aesthetic Direction

Before building anything, define the site's aesthetic across four dimensions:

- **Purpose:** What problem does this site solve? Who is the customer? What emotion within 3 seconds of landing?
- **Tone:** Pick one extreme and own it. Examples:
  - Brutally minimal
  - Maximalist
  - Retro-futuristic
  - Organic/natural
  - Luxury/refined
  - Playful/toy-like
  - Editorial/magazine
  - Brutalist/raw
  - Art deco/geometric
  - Soft/pastel
  - Industrial/utilitarian
  Design one that is true to THIS specific business.
- **Constraints:** Framework (Astro 5.x + Tailwind v4), performance targets (Lighthouse 95+), accessibility (WCAG AA), tri-lingual support (AZ/RU/EN).
- **Differentiation:** The single unforgettable thing someone will remember.

Bold maximalism and refined minimalism both work. The key is intentionality, not intensity. Execute the chosen direction with total commitment.

## 2. Typography Rules

Choose fonts that are beautiful, unique, and interesting. Pair a distinctive display/heading font with a refined, readable body font.

### CRITICAL: Multi-Script Support Required
Every font used MUST support:
- **Latin Extended** — Azerbaijani characters: Ə ə, Ğ ğ, İ ı, Ö ö, Ü ü, Ç ç, Ş ş
- **Cyrillic** — Full Russian character set

**VERIFICATION TEST:** Before using ANY font, render this test string:
`"Əlaqə üçün bizə zəng edin. Ğəbul saatları: Ş. 09:00-18:00 | Связаться с нами"`

If ANY character renders as a box, square, or fallback glyph, the font is UNUSABLE.

### BANNED Fonts (Never Use)
- Inter, Roboto, Arial, Helvetica, System fonts
- Space Grotesk, Lato, Open Sans, Source Sans Pro
- Any font lacking Cyrillic or Azerbaijani character support

### Verified Body Font Candidates (Latin Extended + Cyrillic)
- DM Sans — clean geometric, excellent Cyrillic
- Manrope — modern geometric, good Cyrillic
- Nunito Sans — friendly, round, full Cyrillic
- Outfit — geometric variable font, Cyrillic support

### Verified Display Font Candidates (Latin Extended + Cyrillic)
- Playfair Display — elegant serif, full Cyrillic
- Unbounded — bold, modern display, Cyrillic
- Cormorant — elegant serif, Cyrillic
- Bitter — slab serif, full Cyrillic

### Requirements
- Use @fontsource packages for self-hosting (no external requests)
- Import with correct subsets: `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`
- Establish a clear typographic scale: display/hero, h1, h2, h3, body, small/caption
- Body text: minimum 16px, line-height 1.5–1.65 (light bg) or 1.6–1.75 (dark bg)
- Use FULL typographic range (56-80px+ heroes with extreme weight contrast)
- Use `text-wrap: balance` on headings, `font-variant-numeric: tabular-nums` on numbers
- Use fluid typography with `clamp()` — not fixed pixel sizes

## 3. Color System Rules

- Commit to a cohesive color system
- Use CSS custom properties for EVERY color value — never hardcode hex outside token definitions
- Pick 1–2 dominant colors and 1 sharp accent. Let the accent do the heavy lifting.
- Tint neutrals toward brand hue (oklch or warm grays)
- Off-white backgrounds (#faf9f6 or similar), near-black text (#1a1a2e or similar)
- Every color combination MUST pass WCAG AA (4.5:1 body, 3:1 large text)
- Document contrast ratios as CSS comments: `/* --text-primary on --bg-default → 18.1:1 AA PASS */`

### BANNED Color Schemes
- Purple gradients on white backgrounds
- Generic blue-on-white corporate palettes
- Rainbow/multicolor schemes with no hierarchy
- Pure black (#000) or pure white (#fff) as main backgrounds
- Cyan "developer aesthetic"
- Gradient text

### Azerbaijan-Specific Color Notes
- Blue, red, and green are flag colors — use subtly if at all, never as the whole palette
- Gold/amber connotes luxury and prosperity — works well for premium businesses
- Warm tones generally resonate more than cold/clinical palettes

No two sites built with this system should share a color palette.

## 4. Motion & Animation Rules

- CSS-only animations and transitions. No JavaScript animation libraries.
- Exponential easing: `cubic-bezier(0.16, 1, 0.3, 1)`
- Staggered reveals with `animation-delay`
- Minimum 3 distinct animation types per site
- Scroll-triggered reveals on at least 2 sections (Intersection Observer)
- Astro View Transitions for smooth page-to-page animations
- All animations must run at 60fps — `transform` and `opacity` only
- Respect `prefers-reduced-motion`: wrap all animations in media query

### BANNED
- Bounce/elastic easing
- `transition: all`
- Animating `width`, `height`, `top`, `left`, or `margin`
- Identical fadeInUp everywhere
- Carousel slideshows and bouncing icons

## 5. Layout Rules — BREAK THE GRID

Use 4+ different layout patterns per site:
- **Pattern A:** Asymmetric split (2fr/1fr, not 50/50)
- **Pattern B:** Full-bleed break (edge-to-edge, clip-path diagonal)
- **Pattern C:** Overlapping elements (negative margins, translate)
- **Pattern D:** Bento/masonry (varying card sizes, grid-row span)
- **Pattern E:** Staggered/offset (alternating image-left/text-right)
- **Pattern F:** Pull quote/callout (oversized, different background, rotated)

**RULE:** No two consecutive sections share the same column structure.

### BANNED Layouts
- Every section centered max-w-7xl
- Identical 3-column grids repeated
- Uniform padding on every section
- Everything in rounded cards

### Russian Text Accommodation
Russian text is ~30% longer than English. ALL layouts must:
- Use flexible containers (not fixed widths for text)
- Use `clamp()` for font sizing
- Be tested at every viewport in ALL THREE LANGUAGES
- Avoid designs that break when text wraps to an extra line

## 6. Background & Visual Depth Rules

- Never default to flat solid backgrounds across the entire site
- Use at least 2 of these per site:
  - Subtle noise/grain texture overlay
  - Gradient meshes or radial gradients
  - Decorative SVG shapes (blobs, waves, diagonals)
  - Colored box-shadows (not just gray)
  - Subtle background patterns (dots, lines, topographic)
  - Layered z-index compositions

These must enhance readability — never compete with it.

## 7. Component Architecture

MANDATORY: Each visually distinct homepage section must be its own `.astro` component.
Minimum: Hero.astro, About.astro, Services.astro, Testimonials.astro, CTA.astro + Header/Footer.
A 250-line monolithic index.astro is a design failure.

## 8. Image Rules

### Text Over Images
Text over hero/banner images MUST have overlay for contrast:
- Dark overlay: `bg-black/50` or `bg-gradient-to-t from-black/70 to-black/30`
- Overlay must cover ENTIRE text area
- Add `text-shadow: 0 2px 4px rgba(0,0,0,0.5)` as insurance on hero headings
- Verify contrast with actual image content, not just overlay math

### Image Sources (Priority Order)
1. Their actual business photos (from scraped assets or provided files)
2. Carefully chosen Unsplash stock (culturally appropriate for Azerbaijan)
3. AI-generated via NanoBanana 2 (hero backgrounds, product imagery)

### Image Rules
- ALL images must be local files — never external/hotlinked URLs
- Use Astro `<Image>` component for optimization (WebP/AVIF)
- Every image must have descriptive alt text in the page's language
- Download Unsplash images to `src/assets/images/` or `public/images/`
- Verify cultural appropriateness: people, architecture, food, landscape must feel Azerbaijani

## 9. The AI Slop Test

If someone saw the site and was told "AI made this," would they believe it? If yes, you failed. Redesign until the answer is no.

No generic template aesthetics. No overused patterns. No cookie-cutter components. Every site must feel custom-designed for THIS specific business in THIS specific market.
