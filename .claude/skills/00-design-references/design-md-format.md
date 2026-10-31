# DESIGN.md Format Specification

## What is DESIGN.md

DESIGN.md is a structured, LLM-native design system specification. It captures a complete design system -- colors, typography, components, layout, depth, responsive behavior, and agent prompting hints -- in a single machine-readable document that agents can consume during code generation.

The format originates from [VoltAgent/awesome-design-md](https://github.com/AVolkDev/awesome-design-md), inspired by Google Stitch. The goal: eliminate the gap between design intent and generated code by giving agents a precise, parseable reference instead of vague instructions like "make it look modern."

A well-written DESIGN.md means an agent can generate pixel-accurate components on the first pass without guessing at colors, spacing, or typography.

---

## The 9 Sections

Every DESIGN.md contains these 9 sections in order. Each section has required fields and a specific structure.

---

### Section 1: Visual Theme & Atmosphere

**What it contains:** A narrative description of the brand's visual identity -- mood, design philosophy, and key aesthetic characteristics.

**Required fields:**
- Design philosophy statement (1-2 sentences)
- Key visual characteristics (bulleted list, 4-8 items)
- Overall mood/feeling description

**Format:**

```markdown
## 1. Visual Theme & Atmosphere

[Brand Name] embodies [design philosophy statement]. The interface communicates
[mood/feeling] through [key approach].

**Key Characteristics:**
- [Characteristic 1 -- e.g., "Generous whitespace that lets content breathe"]
- [Characteristic 2 -- e.g., "Sharp geometric forms with precise 4px radius corners"]
- [Characteristic 3 -- e.g., "Monochromatic palette with a single vibrant accent"]
- [Characteristic 4 -- e.g., "Subtle depth through layered shadows, never gradients"]
- [Characteristic 5]
- [Characteristic 6]
```

---

### Section 2: Color Palette & Roles

**What it contains:** Every color in the system, organized by role, with hex values, CSS variable names, and usage descriptions.

**Required fields:**
- Primary colors (brand colors, 1-3)
- Accent colors (CTAs, highlights, 1-3)
- Interactive colors with hover states (links, buttons)
- Neutral scale (at least 5 steps from lightest to darkest)
- Surface and border colors
- Shadow colors (rgba values)

**Format:**

```markdown
## 2. Color Palette & Roles

### Primary
- **Brand Primary** (`#XXXXXX`): `--color-primary` -- Main brand color, used for [usage]
- **Brand Secondary** (`#XXXXXX`): `--color-secondary` -- [usage]

### Accent
- **Accent** (`#XXXXXX`): `--color-accent` -- CTAs, key actions, [usage]
- **Accent Hover** (`#XXXXXX`): `--color-accent-hover` -- Hover state for accent elements

### Interactive
- **Link Default** (`#XXXXXX`): `--color-link` -- Inline text links
- **Link Hover** (`#XXXXXX`): `--color-link-hover` -- Link hover state
- **Focus Ring** (`#XXXXXX`): `--color-focus` -- Keyboard focus indicator

### Neutral Scale
- **White** (`#FFFFFF`): `--color-neutral-0` -- Page background
- **Gray 50** (`#XXXXXX`): `--color-neutral-50` -- Subtle backgrounds
- **Gray 100** (`#XXXXXX`): `--color-neutral-100` -- Card backgrounds
- **Gray 200** (`#XXXXXX`): `--color-neutral-200` -- Borders, dividers
- **Gray 400** (`#XXXXXX`): `--color-neutral-400` -- Placeholder text
- **Gray 600** (`#XXXXXX`): `--color-neutral-600` -- Secondary text
- **Gray 800** (`#XXXXXX`): `--color-neutral-800` -- Primary text
- **Gray 900** (`#XXXXXX`): `--color-neutral-900` -- Headings

### Surface & Borders
- **Surface Primary** (`#XXXXXX`): `--surface-primary` -- Main content background
- **Surface Elevated** (`#XXXXXX`): `--surface-elevated` -- Cards, modals
- **Border Default** (`#XXXXXX`): `--border-default` -- Standard borders
- **Border Subtle** (`#XXXXXX`): `--border-subtle` -- Dividers, separators

### Shadow Colors
- **Shadow SM** (`rgba(0, 0, 0, 0.XX)`): `--shadow-color-sm` -- Subtle depth
- **Shadow MD** (`rgba(0, 0, 0, 0.XX)`): `--shadow-color-md` -- Card elevation
- **Shadow LG** (`rgba(0, 0, 0, 0.XX)`): `--shadow-color-lg` -- Modal/dropdown elevation
```

---

### Section 3: Typography Rules

**What it contains:** Font families with full fallback stacks, OpenType features, and a hierarchy table covering every text role in the system.

**Required fields:**
- Primary font family with fallback stack
- Secondary/mono font family with fallback stack (if used)
- OpenType feature settings
- Typography hierarchy table with ALL columns

**Format:**

```markdown
## 3. Typography Rules

**Primary Font:** [Font Name], [fallback1], [fallback2], sans-serif
**Secondary Font:** [Font Name], [fallback1], monospace (if applicable)

**OpenType Features:** `font-feature-settings: '[feature1]', '[feature2]';`

### Type Scale

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display / Hero | [Font] | 64px / 4rem | 700 | 1.1 | -0.02em | Homepage hero only |
| H1 | [Font] | 48px / 3rem | 700 | 1.15 | -0.015em | Page titles |
| H2 | [Font] | 36px / 2.25rem | 600 | 1.2 | -0.01em | Section headers |
| H3 | [Font] | 28px / 1.75rem | 600 | 1.25 | -0.005em | Subsections |
| H4 | [Font] | 22px / 1.375rem | 600 | 1.3 | 0 | Card titles |
| Body Large | [Font] | 18px / 1.125rem | 400 | 1.6 | 0 | Lead paragraphs |
| Body | [Font] | 16px / 1rem | 400 | 1.6 | 0 | Default body text |
| Body Small | [Font] | 14px / 0.875rem | 400 | 1.5 | 0.005em | Captions, metadata |
| Label | [Font] | 12px / 0.75rem | 500 | 1.4 | 0.05em | Form labels, tags |
| Code | [Mono Font] | 14px / 0.875rem | 400 | 1.6 | 0 | Inline code, pre blocks |
```

---

### Section 4: Component Stylings

**What it contains:** Detailed styling specs for core UI components, including all interactive states.

**Required fields:**
- Buttons: primary, secondary, each with hover, focus, and active states
- Cards: background, border, shadow, radius, padding
- Inputs: background, border, focus ring, padding, placeholder color
- Navigation: background, link colors, active state indicator

**Format:**

```markdown
## 4. Component Stylings

### Buttons

**Primary Button**
- Default: `bg: #XXXXXX; color: #XXXXXX; padding: Xpx Xpx; border-radius: Xpx; shadow: [value]; font-weight: 600; font-size: 16px;`
- Hover: `bg: #XXXXXX; shadow: [value]; transform: translateY(-1px);`
- Focus: `outline: 2px solid #XXXXXX; outline-offset: 2px;`
- Active: `bg: #XXXXXX; transform: translateY(0); shadow: [value];`

**Secondary Button**
- Default: `bg: transparent; color: #XXXXXX; border: 1px solid #XXXXXX; padding: Xpx Xpx; border-radius: Xpx;`
- Hover: `bg: #XXXXXX; border-color: #XXXXXX;`
- Focus: `outline: 2px solid #XXXXXX; outline-offset: 2px;`
- Active: `bg: #XXXXXX;`

### Cards

- Background: `#XXXXXX`
- Border: `1px solid #XXXXXX`
- Shadow: `[shadow value]`
- Border Radius: `Xpx`
- Padding: `Xpx`

### Inputs

- Background: `#XXXXXX`
- Border: `1px solid #XXXXXX`
- Border (Focus): `1px solid #XXXXXX`
- Focus Ring: `0 0 0 3px rgba(XX, XX, XX, 0.XX)`
- Padding: `Xpx Xpx`
- Placeholder Color: `#XXXXXX`
- Border Radius: `Xpx`
- Font Size: `16px` (prevents iOS zoom)

### Navigation

- Background: `#XXXXXX`
- Link Color: `#XXXXXX`
- Link Hover: `#XXXXXX`
- Active Indicator: `[description -- e.g., "2px bottom border in accent color"]`
- Mobile Menu Background: `#XXXXXX`
```

---

### Section 5: Layout Principles

**What it contains:** The spatial system -- base unit, spacing scale, container widths, grid setup, and border-radius scale.

**Required fields:**
- Base spacing unit
- Spacing scale (at least 6 steps)
- Max container width
- Grid column count and gutter
- Section vertical spacing
- Border-radius scale

**Format:**

```markdown
## 5. Layout Principles

- **Base Unit:** Xpx
- **Spacing Scale:** Xpx / Xpx / Xpx / Xpx / Xpx / Xpx / Xpx / Xpx
  (e.g., 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96)
- **Max Container Width:** XXXXpx
- **Grid Columns:** XX columns, Xpx gutter
- **Section Spacing:** Xpx vertical padding between major sections
- **Border-Radius Scale:**
  - Small (tags, badges): Xpx
  - Medium (buttons, inputs): Xpx
  - Large (cards, modals): Xpx
  - XL (hero sections, feature cards): Xpx
  - Full (avatars, pills): 9999px
```

---

### Section 6: Depth & Elevation

**What it contains:** A leveled shadow system that defines visual hierarchy through elevation.

**Required fields:**
- At least 4 levels (Level 0 through Level 3+)
- Each level: name, CSS shadow value, when to use

**Format:**

```markdown
## 6. Depth & Elevation

| Level | Name | Shadow Value | Usage |
|---|---|---|---|
| 0 | Flat | `none` | Inline elements, flat cards, text content |
| 1 | Low | `0 1px 2px rgba(0,0,0,0.XX), 0 1px 3px rgba(0,0,0,0.XX)` | Cards, subtle separation from surface |
| 2 | Medium | `0 4px 6px rgba(0,0,0,0.XX), 0 2px 4px rgba(0,0,0,0.XX)` | Hovered cards, dropdowns, popovers |
| 3 | High | `0 10px 15px rgba(0,0,0,0.XX), 0 4px 6px rgba(0,0,0,0.XX)` | Modals, sticky headers, floating elements |
| 4 | Highest | `0 20px 25px rgba(0,0,0,0.XX), 0 10px 10px rgba(0,0,0,0.XX)` | Toast notifications, command palettes |
```

---

### Section 7: Do's and Don'ts

**What it contains:** Bulleted guardrails that prevent common design mistakes and keep the system consistent.

**Required fields:**
- At least 5 Do's
- At least 5 Don'ts

**Format:**

```markdown
## 7. Do's and Don'ts

### Do
- Use the spacing scale exclusively -- never use arbitrary pixel values
- Maintain consistent border-radius within component categories
- Use the shadow elevation system for all depth -- never use border hacks for depth
- Test all color combinations against WCAG AA contrast ratios (4.5:1 for text, 3:1 for large text)
- Use the neutral scale for text -- avoid pure black (#000000) on white backgrounds
- [Additional project-specific guidelines]

### Don't
- Don't mix font families beyond the defined primary/secondary pair
- Don't use more than 3 font weights on a single page
- Don't apply shadows to text (text-shadow) -- reserve shadows for surface elevation
- Don't use color alone to convey meaning -- always pair with icons or text labels
- Don't exceed the max container width for content areas
- [Additional project-specific guidelines]
```

---

### Section 8: Responsive Behavior

**What it contains:** Breakpoint definitions, touch target rules, font scaling approach, and layout collapsing strategy.

**Required fields:**
- Breakpoints table with name, width, and key changes
- Touch target minimum sizes
- Font scaling rules across breakpoints
- Collapsing strategy for navigation, grids, and content blocks

**Format:**

```markdown
## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | Single column, stacked cards, hamburger nav, reduced section padding |
| Tablet | 640px - 1023px | 2-column grid, side nav collapses, font scale adjusts |
| Desktop | 1024px - 1279px | Full grid, persistent nav, standard spacing |
| Wide | >= 1280px | Max container width enforced, content centered |

### Touch Targets
- Minimum touch target: 44x44px (WCAG 2.5.8)
- Minimum spacing between targets: 8px

### Font Scaling
- Mobile: Body 15px, H1 32px, H2 26px
- Tablet: Body 16px, H1 40px, H2 30px
- Desktop+: Full type scale as defined in Section 3

### Collapsing Strategy
- **Navigation:** Hamburger menu below 1024px, slide-out drawer on mobile
- **Grid:** 12-col -> 6-col (tablet) -> single column (mobile)
- **Cards:** Horizontal -> stacked below 640px
- **Hero:** Reduce vertical padding 50% on mobile, scale hero image to 100vw
- **Tables:** Horizontal scroll wrapper on mobile, or collapse to card layout
```

---

### Section 9: Agent Prompt Guide

**What it contains:** Quick-reference color blocks and example component prompts with exact CSS values that agents can copy directly into code generation.

**Required fields:**
- Quick color reference block (compact format for easy scanning)
- 3-4 example component prompts with exact CSS values

**Format:**

```markdown
## 9. Agent Prompt Guide

### Quick Color Reference
```
Primary:    #XXXXXX    Accent:     #XXXXXX
Text:       #XXXXXX    Subtle:     #XXXXXX
Surface:    #XXXXXX    Border:     #XXXXXX
Link:       #XXXXXX    Focus:      #XXXXXX
```

### Component Prompts

**"Build a hero section"**
- Container: max-width [X]px, padding [X]px vertical
- Heading: [Font], [size], weight [X], color #XXXXXX, letter-spacing [X]
- Subheading: [Font], [size], weight [X], color #XXXXXX, max-width [X]ch
- CTA: bg #XXXXXX, color #XXXXXX, padding [X]px [X]px, radius [X]px, shadow Level 1
- Background: #XXXXXX or gradient from #XXXXXX to #XXXXXX

**"Build a feature card grid"**
- Grid: [X] columns, [X]px gap, responsive to single column at 640px
- Card: bg #XXXXXX, border 1px solid #XXXXXX, radius [X]px, padding [X]px, shadow Level 1
- Card Hover: shadow Level 2, translateY(-2px), transition 200ms ease
- Card Title: [Font], [size], weight [X], color #XXXXXX
- Card Body: [Font], [size], weight [X], color #XXXXXX, line-height [X]

**"Build a pricing table"**
- Container: max-width [X]px, centered
- Columns: [X] plans side by side, equal width, [X]px gap
- Highlighted Plan: border 2px solid #XXXXXX (accent), shadow Level 2
- Price: [Font], [size], weight [X], color #XXXXXX
- CTA per plan: primary button styling from Section 4

**"Build a testimonial section"**
- Background: #XXXXXX (subtle surface color)
- Quote text: [Font], [size] italic, color #XXXXXX, max-width [X]ch
- Attribution: [Font], [size], weight [X], color #XXXXXX
- Avatar: [X]px circle, border 2px solid #XXXXXX
- Layout: carousel on mobile, 3-column grid on desktop
```

---

## Extension: Section 10 -- Multi-Lingual Considerations

For tri-lingual sites (AZ/RU/EN), add this as Section 10. This is particularly relevant for Azerbaijani business websites.

### Font Verification

Include a test string that validates glyph coverage for Azerbaijani and Cyrillic:

```
Azerbaijani: Azərbaycan Respublikası -- check for ə, Ə, ı, İ, ö, Ö, ü, Ü, ş, Ş, ç, Ç, ğ, Ğ
Cyrillic: Республика Азербайджан -- verify full Cyrillic block coverage
Combined: Qarabağ Azərbaycandır / Карабах -- это Азербайджан
```

### Russian Text Expansion

Russian text runs approximately 30% longer than equivalent English text. Accommodate this with:

- Buttons: Use `min-width` instead of fixed width; add `padding-inline: 24px` minimum
- Navigation items: Allow wrapping or test with longest Russian label
- Cards: Ensure text containers use `min-height` not fixed height
- Headlines: Test with Russian translation at every breakpoint -- line breaks will differ
- Form labels: Allow 40% extra width compared to English labels

### Cultural Color Notes

- Red + green together carry national flag associations in Azerbaijan -- use intentionally or avoid
- Green is broadly positive (Islam, nature, growth) -- safe as primary accent
- Blue is associated with the Turkic world and modernization -- works well for corporate/tech
- Avoid color combinations that too closely mirror Armenian, Iranian, or Russian flags in political or business contexts

### Per-Language Content Tone

| Language | Tone | Formality | Notes |
|---|---|---|---|
| Azerbaijani (AZ) | Warm, direct | Semi-formal | Use Latin script exclusively (not Cyrillic Azeri). Avoid overly academic Azerbaijani. |
| Russian (RU) | Professional, clear | Formal | Use "вы" (formal you). Many Baku residents read Russian as L2 -- keep sentences shorter than you would for Moscow audience. |
| English (EN) | Modern, confident | Business casual | International audience. Avoid idioms that don't translate. |

---

## Validation Checklist

Before finalizing any DESIGN.md, verify all of the following:

- [ ] All 9 sections present and non-empty
- [ ] All hex values are valid 6-digit format (#XXXXXX)
- [ ] All text/background color combinations computed for contrast ratio and pass WCAG AA (4.5:1 for normal text, 3:1 for large text and UI components)
- [ ] Typography table includes all columns: Role, Font, Size, Weight, Line Height, Letter Spacing, Notes
- [ ] Component stylings include buttons (primary + secondary, each with hover/focus/active states), cards, inputs, and navigation
- [ ] At least 4 shadow elevation levels defined (Level 0 through Level 3+)
- [ ] Spacing scale uses consistent base unit multiplication
- [ ] Breakpoints table includes mobile, tablet, and desktop at minimum
- [ ] Agent Prompt Guide includes at least 3 component prompts with exact CSS values
- [ ] No banned fonts used (Comic Sans, Papyrus, Impact for body text)
- [ ] No banned color schemes (neon on neon, pure black on pure white for large text areas)
- [ ] All CSS variable names follow consistent naming convention
- [ ] If multi-lingual: Section 10 present with font verification strings and expansion rules

---

## Blank Template

Copy the template below and fill in all placeholder values for your project.

```markdown
# DESIGN.md -- [Project Name]

## 1. Visual Theme & Atmosphere

[Project Name] embodies [design philosophy]. The interface communicates [mood]
through [approach].

**Key Characteristics:**
- [Characteristic 1]
- [Characteristic 2]
- [Characteristic 3]
- [Characteristic 4]
- [Characteristic 5]

---

## 2. Color Palette & Roles

### Primary
- **Brand Primary** (`#______`): `--color-primary` -- [usage]
- **Brand Secondary** (`#______`): `--color-secondary` -- [usage]

### Accent
- **Accent** (`#______`): `--color-accent` -- [usage]
- **Accent Hover** (`#______`): `--color-accent-hover` -- [usage]

### Interactive
- **Link Default** (`#______`): `--color-link` -- [usage]
- **Link Hover** (`#______`): `--color-link-hover` -- [usage]
- **Focus Ring** (`#______`): `--color-focus` -- [usage]

### Neutral Scale
- **White** (`#FFFFFF`): `--color-neutral-0` -- [usage]
- **Gray 50** (`#______`): `--color-neutral-50` -- [usage]
- **Gray 100** (`#______`): `--color-neutral-100` -- [usage]
- **Gray 200** (`#______`): `--color-neutral-200` -- [usage]
- **Gray 400** (`#______`): `--color-neutral-400` -- [usage]
- **Gray 600** (`#______`): `--color-neutral-600` -- [usage]
- **Gray 800** (`#______`): `--color-neutral-800` -- [usage]
- **Gray 900** (`#______`): `--color-neutral-900` -- [usage]

### Surface & Borders
- **Surface Primary** (`#______`): `--surface-primary` -- [usage]
- **Surface Elevated** (`#______`): `--surface-elevated` -- [usage]
- **Border Default** (`#______`): `--border-default` -- [usage]
- **Border Subtle** (`#______`): `--border-subtle` -- [usage]

### Shadow Colors
- **Shadow SM** (`rgba(0, 0, 0, 0.__)`): `--shadow-color-sm` -- [usage]
- **Shadow MD** (`rgba(0, 0, 0, 0.__)`): `--shadow-color-md` -- [usage]
- **Shadow LG** (`rgba(0, 0, 0, 0.__)`): `--shadow-color-lg` -- [usage]

---

## 3. Typography Rules

**Primary Font:** [Font Name], [fallback], [fallback], sans-serif
**Secondary Font:** [Font Name], [fallback], monospace

**OpenType Features:** `font-feature-settings: '____', '____';`

### Type Scale

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display / Hero | | | | | | |
| H1 | | | | | | |
| H2 | | | | | | |
| H3 | | | | | | |
| H4 | | | | | | |
| Body Large | | | | | | |
| Body | | | | | | |
| Body Small | | | | | | |
| Label | | | | | | |
| Code | | | | | | |

---

## 4. Component Stylings

### Buttons

**Primary Button**
- Default: `bg: #______; color: #______; padding: __px __px; border-radius: __px; shadow: ______; font-weight: 600; font-size: 16px;`
- Hover: `bg: #______; shadow: ______; transform: translateY(-1px);`
- Focus: `outline: 2px solid #______; outline-offset: 2px;`
- Active: `bg: #______; transform: translateY(0); shadow: ______;`

**Secondary Button**
- Default: `bg: transparent; color: #______; border: 1px solid #______; padding: __px __px; border-radius: __px;`
- Hover: `bg: #______; border-color: #______;`
- Focus: `outline: 2px solid #______; outline-offset: 2px;`
- Active: `bg: #______;`

### Cards

- Background: `#______`
- Border: `1px solid #______`
- Shadow: `______`
- Border Radius: `__px`
- Padding: `__px`

### Inputs

- Background: `#______`
- Border: `1px solid #______`
- Border (Focus): `1px solid #______`
- Focus Ring: `0 0 0 3px rgba(__, __, __, 0.__)`
- Padding: `__px __px`
- Placeholder Color: `#______`
- Border Radius: `__px`
- Font Size: `16px`

### Navigation

- Background: `#______`
- Link Color: `#______`
- Link Hover: `#______`
- Active Indicator: [description]
- Mobile Menu Background: `#______`

---

## 5. Layout Principles

- **Base Unit:** __px
- **Spacing Scale:** __ / __ / __ / __ / __ / __ / __ / __
- **Max Container Width:** ____px
- **Grid Columns:** __ columns, __px gutter
- **Section Spacing:** __px vertical padding between major sections
- **Border-Radius Scale:**
  - Small (tags, badges): __px
  - Medium (buttons, inputs): __px
  - Large (cards, modals): __px
  - XL (hero sections, feature cards): __px
  - Full (avatars, pills): 9999px

---

## 6. Depth & Elevation

| Level | Name | Shadow Value | Usage |
|---|---|---|---|
| 0 | Flat | `none` | |
| 1 | Low | `0 1px 2px rgba(0,0,0,0.__), 0 1px 3px rgba(0,0,0,0.__)` | |
| 2 | Medium | `0 4px 6px rgba(0,0,0,0.__), 0 2px 4px rgba(0,0,0,0.__)` | |
| 3 | High | `0 10px 15px rgba(0,0,0,0.__), 0 4px 6px rgba(0,0,0,0.__)` | |
| 4 | Highest | `0 20px 25px rgba(0,0,0,0.__), 0 10px 10px rgba(0,0,0,0.__)` | |

---

## 7. Do's and Don'ts

### Do
- [Guideline]
- [Guideline]
- [Guideline]
- [Guideline]
- [Guideline]

### Don't
- [Guideline]
- [Guideline]
- [Guideline]
- [Guideline]
- [Guideline]

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 640px | |
| Tablet | 640px - 1023px | |
| Desktop | 1024px - 1279px | |
| Wide | >= 1280px | |

### Touch Targets
- Minimum touch target: 44x44px
- Minimum spacing between targets: 8px

### Font Scaling
- Mobile: Body __px, H1 __px, H2 __px
- Tablet: Body __px, H1 __px, H2 __px
- Desktop+: Full type scale as defined in Section 3

### Collapsing Strategy
- **Navigation:** [strategy]
- **Grid:** [strategy]
- **Cards:** [strategy]
- **Hero:** [strategy]
- **Tables:** [strategy]

---

## 9. Agent Prompt Guide

### Quick Color Reference
```
Primary:    #______    Accent:     #______
Text:       #______    Subtle:     #______
Surface:    #______    Border:     #______
Link:       #______    Focus:      #______
```

### Component Prompts

**"Build a hero section"**
- Container: max-width ____px, padding __px vertical
- Heading: [Font], __px, weight ___, color #______, letter-spacing ____
- Subheading: [Font], __px, weight ___, color #______, max-width __ch
- CTA: bg #______, color #______, padding __px __px, radius __px, shadow Level 1
- Background: #______

**"Build a feature card grid"**
- Grid: _ columns, __px gap, responsive to single column at 640px
- Card: bg #______, border 1px solid #______, radius __px, padding __px, shadow Level 1
- Card Hover: shadow Level 2, translateY(-2px), transition 200ms ease
- Card Title: [Font], __px, weight ___, color #______
- Card Body: [Font], __px, weight ___, color #______, line-height ___

**"Build a pricing table"**
- Container: max-width ____px, centered
- Columns: _ plans side by side, equal width, __px gap
- Highlighted Plan: border 2px solid #______ (accent), shadow Level 2
- Price: [Font], __px, weight ___, color #______
- CTA per plan: primary button styling from Section 4

**"Build a testimonial section"**
- Background: #______ (subtle surface)
- Quote text: [Font], __px italic, color #______, max-width __ch
- Attribution: [Font], __px, weight ___, color #______
- Avatar: __px circle, border 2px solid #______
- Layout: carousel on mobile, 3-column grid on desktop
```
