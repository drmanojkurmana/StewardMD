# Phase Details — Complete Instructions

This document contains the detailed instructions for each phase of the website rebuild process. The main SKILL.md provides the overview; this file has the specifics.

## Table of Contents
- [Phase 1: Visual Inspection & Brand Extraction](#phase-1)
- [Phase 2: Data Scraping & Content Classification](#phase-2)
- [Phase 3: Comprehensive SEO Audit](#phase-3)
- [Phase 4: Design & UX/UI Audit](#phase-4)
- [Phase 5: Rebuild Plan](#phase-5)
- [Phase 6: Build the Website](#phase-6)
- [Phase 7: Copy Audit & Optimization](#phase-7)
- [Phase 8: QA Round 1](#phase-8)
- [Phase 9: QA Round 2](#phase-9)
- [Phase 10: QA Round 3](#phase-10)
- [Phase 11a: Competitive Tools Research](#phase-11a)
- [Phase 11b: Tools Build](#phase-11b)
- [Phase 12: QA Round 4](#phase-12)
- [Phase 13: Pre-Deployment Checklist](#phase-13)
- [Phase 14: Deploy](#phase-14)

---

## Phase 1: Visual Inspection & Brand Extraction {#phase-1}

**Objective:** Understand the existing site visually and extract the single hard design constraint — the logo and its branding.

1. Open the Chrome browser tool and navigate to the provided URL.
2. Visit every single page. Click through all navigation links, footer links, and any subpages. Do not skip any page.
3. The logo is the single design anchor. Everything designed later must harmonize with it. Extract:
   - Primary brand colors (exact hex values)
   - Secondary/accent colors
   - Typographic personality
   - Light/dark background compatibility
4. Save the logo file(s) in the highest quality available. Download directly from the site.

**Output:** `BRAND_BRIEF.md` containing:
- Logo analysis
- Color palette (all as hex values)
- Typography direction
- Visual tone and personality keywords

---

## Phase 2: Data Scraping & Content Classification {#phase-2}

**Objective:** Extract ALL content from the existing site and classify it by reusability.

1. Write and run a scraping script extracting:
   - All text content
   - All images
   - All links
   - Navigation structure
   - Contact information
   - Forms
   - Embedded media
   - Meta tags
   - Testimonials
   - Structured data
   From every page.

2. Classify all content:
   - **MUST REUSE:** Logo, team photos, factual business info, testimonials, legal substance
   - **CAN MODIFY/REPLACE:** Hero images, stock photos, generic copy, icons

3. For every image, assess: resolution, compression artifacts, relevance, professionalism. Record in CONTENT_INVENTORY.md.

**Output:** `CONTENT_INVENTORY.md`

---

## Phase 3: Comprehensive SEO Audit {#phase-3}

**Objective:** Exhaustive SEO audit. Document every finding.

### Technical SEO
- Page load speed
- Mobile responsiveness at mobile viewport
- URL structure (clean, descriptive, hierarchical)
- sitemap.xml presence and quality
- robots.txt configuration
- HTTPS status
- Canonical tags
- Hreflang (if multilingual)
- 404 handling
- Redirect chains and broken links

### On-Page SEO
- Every page title tag (unique, descriptive, under 60 chars)
- Every meta description (compelling, under 160 chars)
- Heading hierarchy (one h1 per page, logical)
- Image alt text (descriptive, keyword-relevant)
- Internal linking structure
- Keyword usage
- Content depth

### Content & Strategy
- Blog presence and content gap analysis
- Local SEO elements (schema, NAP consistency)
- Structured data / JSON-LD schema markup
- Independent service/product page ranking potential

**Output:** `SEO_AUDIT.md`

---

## Phase 4: Design & UX/UI Audit {#phase-4}

**Objective:** Evaluate existing site design and UX.

### Visual Design
- Aesthetic assessment (dated? generic?)
- Color usage
- Typography
- Spacing and layout
- Image treatment
- Visual hierarchy

### User Experience
- Navigation clarity
- CTA visibility
- Mobile experience
- Page flow
- Trust signals
- Contact accessibility

### Conversion Optimization
- Primary CTA on every page
- Value proposition clarity
- Social proof placement

**Output:** `DESIGN_AUDIT.md`

---

## Phase 5: Rebuild Plan {#phase-5}

**Objective:** Synthesize Phases 1-4 into a concrete, actionable rebuild plan.

### Required Sections in REBUILD_PLAN.md

1. **Site Architecture**
   - Full page list
   - Navigation structure
   - URL structure
   - Internal linking strategy

2. **Design Direction**
   - Color palette with usage rules
   - Typography selections — specific Google Fonts that complement the logo AND follow the banned-font list
   - Component style guide
   - Overall design personality in one sentence

3. **Design System Commitment**
   - State the chosen aesthetic direction explicitly (e.g., "refined luxury editorial with organic textures and high-contrast accent")
   - Every future agent reading this doc should be able to build a new page that fits seamlessly

4. **Color Accessibility Pre-check**
   - Before finalizing the palette, compute WCAG contrast ratios for every planned text/background combination
   - Document these ratios
   - If any combination fails AA, choose a different color before building starts

5. **Image Strategy**
   - KEEP / ENHANCE / REPLACE WITH UNSPLASH / CREATE NEW decision for each image

6. **Copy Strategy**
   - What needs rewriting vs. keeping
   - Key messaging pillars
   - Tone of voice

7. **SEO Implementation Plan**
   - Target keywords per page
   - Meta strategy
   - Schema types
   - Blog content strategy
   - Sitemap and robots.txt config

8. **Tools Research Placeholder**
   - Initial hypotheses — to be validated and replaced by Phase 11a research

9. **Technical Plan**
   - Tech stack confirmation
   - Third-party integrations
   - Performance targets (Core Web Vitals goals)

10. **Accessibility Targets**
    - Zero axe-core critical/serious violations at launch
    - WCAG AA across all color combinations

**Output:** `REBUILD_PLAN.md`

---

## Phase 6: Build the Website {#phase-6}

**Objective:** Build the entire website from scratch according to the Rebuild Plan.

Read the Design Philosophy section of the main SKILL.md before writing a single line of code. Every aesthetic decision must follow the design rules. The design quality must be exceptional.

### Build Sequence

**Step 1: Initialize the Astro project**
Run the exact initialization commands from the main SKILL.md Tech Stack section:
```bash
npm create astro@latest <project-name> -- --template minimal --no-install
cd <project-name>
npm install
npx astro add tailwind --yes
npx astro add sitemap --yes
npx astro add mdx --yes
npm install -D prettier
```
Do NOT switch frameworks, Node versions, or package managers if something fails. Fix the code.

**Step 2: Build the design system first**
- Create `src/styles/global.css` with CSS custom properties for all brand colors, typography, and spacing
- Document WCAG contrast ratios as comments next to each color pairing:
  ```css
  /* --text-primary: #111827 on --bg-default: #FFFFFF → 18.1:1 AA PASS */
  ```
- Reusable `.astro` components in `src/components/`
- Layout primitives in `src/layouts/`
- Animation patterns (CSS only)
- Add `<ViewTransitions />` to BaseLayout for page transitions

**Step 3: Build every page**
- Each page is a `.astro` file in `src/pages/`
- Per the site architecture from REBUILD_PLAN.md
- Include a polished, branded 404.astro page
- Make each page dramatically better than what existed
- Use `class=` not `className=`, standard HTML not JSX

**Step 4: Handle images**
- KEEP → optimize with Astro `<Image>` from `astro:assets`
- ENHANCE → Nano Banana via OpenRouter (see [nano-banana.md](nano-banana.md))
- REPLACE → Unsplash (download locally to `public/images/` or `src/assets/images/`)
- ALL images must be local files, never external URLs in production
- Use Astro `<Image>` component with proper alt text for optimized images

**Step 5: Implement comprehensive SEO**
- Meta tags (title, description, OG, Twitter Cards) per page in BaseLayout
- JSON-LD schema per page type
- Sitemap via @astrojs/sitemap (already installed)
- `public/robots.txt`
- Canonical URLs
- Semantic HTML throughout
- Image alt text everywhere
- Internal linking — thorough and natural

**Step 6: Generate favicon**
- Complete favicon set from the logo
- At minimum: `public/favicon.svg`

**Step 7: Implement accessibility**
- WCAG AA minimum — verified computationally
- Keyboard navigation
- Focus indicators meeting contrast requirements
- ARIA labels where native HTML is insufficient
- Skip-to-content link as first focusable element
- Verify during QA with axe-core via preview_eval
- Fix all critical and serious violations before proceeding

**Step 8: Optimize performance**
- Astro handles most of this automatically (zero JS, static HTML output)
- Optimized images via Astro `<Image>` component
- Self-hosted fonts via @fontsource packages (no external font requests)
- All pages statically generated by default
- Target Lighthouse 95+ (Astro achieves this easily)

### Visual Quality Bar
This site must be visually stunning. Not good. Stunning. Subtle tasteful animations, beautiful visual composition, generous whitespace, intentional visual rhythm, stunning hero sections, imagery with emotional impact. Think Apple, Stripe, Linear.

---

## Phase 7: Copy Audit & Optimization {#phase-7}

**Objective:** Review and optimize every word for sales effectiveness, clarity, and persuasion.

### Value Proposition
Clear within 5 seconds of landing. Rewrite the hero if not.

### CTA Audit
Every page has a clear, specific, benefit-driven primary CTA. Visible without scrolling.

### Sales Copy Principles
- Lead with benefits, not features
- Address objections early
- Use specific numbers
- 8th-grade reading level
- Short sentences for impact

### Social Proof
Testimonials placed near CTAs and decision points. Include names, titles, photos where available.

### Page Flow
Hook → Problem → Solution → Proof → Action on every page.

**Output:** `COPY_CHANGES.md` documenting every change and why.

---

## Phase 8: QA Round 1 — Functional & Content {#phase-8}

**Objective:** First comprehensive quality check.

1. Run the site locally
2. Open Chrome browser and visit every single page
3. Check every link, image, form, interactive element at every viewport (mobile, tablet, desktop)
4. Run axe-core accessibility scan against every page
5. Document all violations in QA_ROUND_1.md
6. Fix all CRITICAL and SERIOUS violations before proceeding
7. Verify contrast ratios for every text/background combination using wcag-contrast
8. Log contrast results and fix all failures
9. Look for: broken functionality, missing content, placeholder text, typos, layout breaks, visual inconsistencies

**Output:** `QA_ROUND_1.md` + update `ACCESSIBILITY_AUDIT.md`

---

## Phase 9: QA Round 2 — Copy & Messaging {#phase-9}

**Objective:** Second pass focused on copy quality and messaging effectiveness.

Read through the ENTIRE site as a potential customer visiting for the first time. On every page ask:
- Would I understand what this business does within 5 seconds?
- Would I trust them?
- Do I know exactly what to do next?
- Is anything confusing, vague, or unconvincing?

Make final copy adjustments. Document all changes.

**Output:** `QA_ROUND_2.md`

---

## Phase 10: QA Round 3 — Final Visual & Polish {#phase-10}

**Objective:** Final visual quality gate. The site must look like it was built by a world-class agency.

1. View every page at mobile, tablet, and desktop sizes
2. Check: Are animations smooth and tasteful? Is typography beautiful (not from banned list)? Is whitespace balanced? Do colors feel cohesive?
3. Final accessibility pass — re-run axe-core. Verify all previously fixed violations are still fixed. No regressions.
4. Final contrast check — visually inspect all text/background combinations at every viewport. Pay special attention to:
   - Text over images
   - Hover/focus states
   - Form inputs
   - Buttons at all states (default, hover, active, disabled, focus)
5. Compare overall quality to the best websites in this industry. It should be BETTER.
6. Do not proceed until genuinely confident the site is extraordinary.

**Output:** `QA_ROUND_3.md`

---

## Phase 11a: Competitive Tools Research Sprint {#phase-11a}

**Objective:** Deep competitive research to identify the best interactive tools to build.

Do not skip this. Do not abbreviate it. No tool is built without this research.

**Budget assumption:** Unlimited. These tools could cost $20K-$100K+ to build from scratch. Identify the best possible — not just the easiest. Discovery comes first, feasibility assessment second.

### Step 1: Identify Top Competitors
- Use web search to find top-ranking sites for primary keywords this business targets
- Find industry-specific "best of" lists
- Identify 3-5 companies that are the gold standard in this space
- Target: 10-15 competitor sites total

### Step 2: Audit Competitor Tools
Visit each with Chrome browser. Document every:
- Interactive tool
- Calculator
- Quiz
- Configurator
- Estimator
- Widget

For each: URL, what it does, how well it works, what makes it good/bad, estimated complexity.

Look everywhere: footers, resource centers, blog sidebars, landing pages, service pages.

### Step 3: Research Broader Web
- Search: "[industry] calculator," "[industry] estimator," "[industry] tool," "[industry] quote generator"
- Check Product Hunt, G2, Capterra, industry directories
- Search for research reports on "most effective lead generation tools for [industry]"
- Find viral/widely-shared tools in this industry
- Find tools with measurable conversion improvements

### Step 4: Synthesize into TOOLS_RESEARCH.md
Required sections:
1. **Competitor tool inventory** — table of every tool found, site, URL, description
2. **Best-in-class examples** — 3-5 absolute best tools found anywhere for this industry
3. **Tool opportunity analysis** — gaps and competitive advantage opportunities
4. **Ranked shortlist** — top 8-10 ideas ranked by: (a) value to user, (b) conversion impact, (c) uniqueness, (d) feasibility as client-side browser tool
5. **Final selection** — 2-5 tools to build, with reasoning

**Output:** `TOOLS_RESEARCH.md`

---

## Phase 11b: Client-Facing Tools — Build {#phase-11b}

Build only tools approved in TOOLS_RESEARCH.md.

- Create /tools or /resources section. Add to site navigation.
- Each tool gets its own page with:
  - Clear title and description
  - The interactive tool
  - CTA to contact the business
- Tools must be:
  - Mobile-responsive
  - Visually consistent with design system
  - Genuinely useful (not gimmicky)
  - Well-labeled with clear instructions
  - Accessible (contrast + keyboard navigation)
- For interactive tools, use Astro Islands: create a component with `client:load` directive. If using React: `npx astro add react --yes` (only add React at this phase, not before). All computation in the browser.
- Position the tools section as a genuine resource hub, not just lead capture.

---

## Phase 12: QA Round 4 — Tools QA {#phase-12}

**Objective:** Ensure every tool works perfectly.

1. Open each tool in Chrome browser
2. Test with: valid inputs, edge cases (zero, very large numbers, empty fields), mobile viewport
3. Verify:
   - Calculations are correct
   - Input validation works with helpful error messages
   - Tool looks good and is easy to use
   - CTA works
4. Accessibility check on every tool page:
   - Form inputs have labels
   - Error messages announced to screen readers
   - All interactive elements are keyboard-operable

**Output:** `QA_ROUND_4.md`

---

## Phase 13: Pre-Deployment Checklist {#phase-13}

Verify EVERY item before pushing to GitHub:

| Area | Check |
|---|---|
| **SEO** | Every page: unique meta tags, OG tags, structured data, heading hierarchy, image alt text, sitemap, robots.txt, canonicals |
| **Performance** | Images optimized (Astro `<Image>`), fonts self-hosted (@fontsource), all pages static. Lighthouse 95+. |
| **Accessibility** | Zero axe-core CRITICAL/SERIOUS violations. All color combinations meet WCAG AA. Keyboard nav works. ARIA labels in place. prefers-reduced-motion respected. |
| **Contrast** | Every text/bg combination verified with computed ratio. Results documented in ACCESSIBILITY_AUDIT.md. |
| **Functionality** | Every link, form, tool, and interactive element works. Mobile nav works. 404 page in place. |
| **Content** | No placeholders, no typos, all business info accurate, blog infrastructure ready. |
| **Visual** | Animations smooth, design consistent, site polished at every viewport. No banned fonts. |
| **Design System** | No hardcoded color values outside token definitions. Font choices avoid banned fonts. |
| **Favicon** | Complete set generated and displaying correctly. |
| **Docs** | All .md documentation files present and complete. |

---

## Phase 14: Deploy {#phase-14}

1. Initialize git, set up .gitignore
2. Create README.md with:
   - Project overview
   - Tech stack
   - How to run locally
   - How to add blog posts (MDX in src/content/blog/ + push to deploy)
   - Project structure
3. Commit everything and push to new GitHub repository
4. Connect repo to Vercel
   - Astro is auto-detected by Vercel — minimal configuration needed
   - Auto-deploy on push to main
5. Open live Vercel URL in Chrome
   - Spot-check all pages, images, navigation, tools in production
6. Final production accessibility check
   - Run axe-core against the live Vercel URL
   - Catch any production-only issues
