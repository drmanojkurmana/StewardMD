# 📏 01. UI Laws & Aesthetic Systems (The 100 Principles)

This module dictates the strict visual and mathematical laws governing UI construction.

## A. Grid & Spacing (1-15)
1. **The 8pt Grid:** All dimensions must be multiples of 8 (or 4 for micro-spacing).
2. **Concentric Radii:** Inner border-radius = Outer border-radius minus Padding.
3. **Law of Proximity:** Related elements must be physically closer than unrelated ones.
4. **Law of Common Region:** Elements inside a visible boundary are perceived as a group.
5. **Macro vs Micro Whitespace:** Macro separates layout sections; Micro separates elements within a component.
6. **The Squint Test:** Squint your eyes; the most critical element must remain obvious.
7. **Baseline Grid Alignment:** Text and icons side-by-side must align on their optical baseline.
8. **Asymmetric Tension:** Perfect symmetry is boring; offset elements to create movement.
9. **Optical Margins:** Punctuation (quotes, bullets) should hang outside the left text margin.
10. **Z-Pattern Layout:** For text-heavy pages without images, layout along a "Z" reading path.
11. **F-Pattern Layout:** For scanning web pages, put the most important info top and left.
12. **Rule of Thirds:** Important visual anchors should sit on the intersections of a 3x3 grid.
13. **Responsive Scaling:** Do not stretch components linearly; change their internal structure on mobile.
14. **Container Constraints:** Body text width must never exceed 75 characters (approx `65ch`).
15. **Rhythm:** Consistent repetition of spacing creates an invisible, pleasing rhythm.

## B. Typography (16-35)
16. **The Musical Scale:** Font sizes must follow a mathematical scale (e.g., 1.250 Major Third).
17. **Heading Hierarchy:** Visually distinguish H1 down to H6 via size, weight, and tracking.
18. **Tracking vs Casing:** Uppercase text requires loose tracking (letter-spacing); lowercase requires standard.
19. **Massive Headers, Tight Tracking:** Display text > 48px needs negative tracking (`-0.02em`) and tight line-height (`1.0`).
20. **Reading Line-Height:** Body text must have a line-height of `1.5` to `1.6`.
21. **Font Pairing Tension:** Pair a highly stylized font (Serif) with an invisible, utilitarian font (Sans-serif/Mono).
22. **Limit Typefaces:** Never use more than 2 font families per project.
23. **Avoid Pure Black Text:** Pure `#000000` causes eye strain. Use `#111827` or tinted dark grays.
24. **Variable Fonts:** Use variable fonts to reduce HTTP requests and allow fluid weight animation.
25. **Orphans and Widows:** Avoid single words on the last line of a paragraph.
26. **System Fonts:** Use `system-ui` for complex data dashboards to ensure zero latency loading.
27. **Ligatures:** Enable standard ligatures (`fi`, `fl`) for body text, but disable them for code blocks.
28. **Tabular Figures:** Use `font-variant-numeric: tabular-nums` for tables and counters so numbers align vertically.
29. **Hierarchy via Weight, not just Size:** A `14px Bold` can outrank a `16px Regular`.
30. **Avoid Justified Text:** It creates ugly "rivers" of white space on the web.
31. **Color Contrast:** Text must pass WCAG AA (4.5:1 ratio) against its background.
32. **Tinted Typography:** Subdued text should be a darker shade of the background color, not just generic gray.
33. **Hover States on Links:** Text links must have a visible affordance (underline, color shift) on hover.
34. **Drop Caps:** Use sparingly to draw the eye into long-form editorial content.
35. **The 3-Level Read:** A user should grasp the page in 3 reads: The massive headline, the subtext, the buttons.

## C. Colors & Materials (36-55)
36. **60-30-10 Rule:** 60% dominant color, 30% secondary, 10% accent.
37. **Semantic Locking:** Never use Red for "Next", Green for "Delete", or Yellow for "Success".
38. **Dark Mode Depth:** Do not use shadows in dark mode; use lighter background shades to indicate elevation.
39. **HSL over HEX:** Design using HSL/LCH to easily create monochromatic scales by adjusting Lightness.
40. **Brand Accent Restraint:** The primary brand color should only be used on interactive elements.
41. **Tinted Neutrals:** "Gray" shouldn't be pure `#808080`. Tint it slightly blue, warm, or purple depending on the brand.
42. **Non-Linear Gradients:** Add multiple color stops or easing to gradients to prevent muddy, gray mid-tones.
43. **Skeuomorphic Affordance:** Make clickable things look slightly tactile (raised).
44. **Glassmorphism Constraints:** Only blur the background if there is actual visual complexity behind it; otherwise it's just muddy.
45. **Chromatic Aberration:** Use sparingly in 3D/Imagery to create realism, never on UI text.
46. **Saturate on Hover:** When hovering, increase saturation or shift hue slightly, rather than just changing lightness.
47. **The Light Source:** All drop shadows, inner shadows, and highlights must obey a single, universal light source.
48. **Colored Shadows:** A drop shadow on a blue button should be dark blue, not black.
49. **Glow Effects:** True glow is achieved by layering multiple `box-shadow` properties with increasing blur radii.
50. **Border Consistency:** If cards have a `1px` border, buttons should either have no border or a matching `1px` border.
51. **High Contrast Mode:** Ensure the UI doesn't break when CSS filters or OS-level high contrast is forced.
52. **Vibrancy:** Use the backdrop-filter sparingly, it kills GPU performance on older devices.
53. **OLED Black:** Pure `#000000` is only acceptable as a background in dark mode to save battery on OLED screens.
54. **Warm vs Cool Tension:** Pair cool tech blues with warm fleshy oranges for high-end contrast.
55. **The 50-Shade Scale:** Build a color palette spanning from 50 (lightest) to 900 (darkest) for scalable UI.

## D. Components & Inputs (56-75)
56. **Button Hierarchy:** Primary (Solid), Secondary (Outline), Tertiary (Ghost). Only ONE primary button per view.
57. **The Minimum Hit Area:** Buttons must be at least `44x44px` for touch devices.
58. **Icon Alignment:** Icons in buttons must be optically centered with the text cap height.
59. **Input Focus States:** An active text input must have a highly visible focus ring (e.g., `ring-2 ring-blue-500`).
60. **Floating Labels:** Useful for saving space, but ensure the transition is smooth and legible.
61. **Placeholder Trap:** Never use placeholders as a replacement for actual `<label>` elements; they disappear when typing.
62. **Password Affordance:** Always include a "Show/Hide" toggle for password fields.
63. **Checkbox vs Toggle:** Use checkboxes for selecting multiple items; Use toggles (switches) for immediate state changes.
64. **Radio vs Dropdown:** If < 5 options, use Radio buttons. If > 5, use a Dropdown.
65. **Inline Validation:** Validate forms dynamically as the user types, not just on submit.
66. **Destructive Actions:** "Delete" buttons must be physically separated from "Save" buttons and colored red.
67. **Skeleton Loaders:** Prefer skeletons over spinners for page loads; they establish spatial expectations.
68. **Tooltips:** Only use for secondary, non-critical info. They do not exist on mobile.
69. **Modals vs Drawers:** Use centered modals for warnings; use side-drawers for complex workflows or filters.
70. **Breadcrumbs:** Required for any site structure deeper than 2 levels.
71. **Infinite Scroll Constraints:** Never use infinite scroll if there is a footer the user needs to reach.
72. **Sticky Headers:** If a header is sticky, it must shrink on scroll to save vertical space.
73. **Empty States:** When a list is empty, provide a beautiful illustration and a CTA to create the first item.
74. **Error States:** An error message must explain *what* went wrong and *how* to fix it, not just "Error 500".
75. **Ghosting Text:** Prevent text selection on UI elements (buttons, tabs) using `user-select: none`.

## E. Animation & Interaction (76-100)
76. **The Doherty Threshold:** System response must occur within 400ms to keep the user engaged.
77. **Micro-interactions:** A button should provide immediate physical feedback (scale down slightly) when clicked.
78. **State Transitions:** Morphing a button into a loading spinner provides continuity.
79. **Easing Curves:** Never use `linear`. Use `ease-out` for entering elements, `ease-in` for exiting.
80. **Spring Physics:** Use mass/stiffness/damping instead of raw duration to make animations feel organic.
81. **Staggered Animations:** When a list loads, animate items in sequentially (staggered) rather than all at once.
82. **Parallax Constraints:** Parallax should be subtle. If elements move too fast, it induces motion sickness.
83. **Scroll-Spy:** As the user scrolls down a long document, the table of contents must highlight the active section.
84. **Cursor Takeovers:** Custom cursors are for highly creative sites only; ensure they don't break native text selection.
85. **Progressive Disclosure:** Hide complex settings behind an "Advanced" toggle to reduce initial cognitive load.
86. **Haptic Feedback Visuals:** Visual animations should mimic the weight of physical objects (e.g., a heavy drawer takes longer to close).
87. **The Pull-to-Refresh Affordance:** Standardized interaction for mobile feeds; provide a loading spinner at the top edge.
88. **Snapping:** Use CSS Scroll Snapping for carousels so they don't stop halfway between items.
89. **Hover Reveal:** Use hover to reveal secondary actions (like a delete icon on a list item) to keep the UI clean.
90. **Motion Preference:** Always respect `prefers-reduced-motion` CSS media queries for accessible design.
91. **Directional Logic:** If an item is added to a cart on the right, the animation should flow to the right.
92. **Exit Animations:** Elements leaving the DOM must animate out, not just vanish abruptly.
93. **Skeleton Shimmer:** The gradient angle on a loading skeleton should animate from left to right, matching reading direction.
94. **Fluid Typography:** Scale text size smoothly using `clamp()` based on viewport width, rather than harsh media query breakpoints.
95. **Hero Image Parallax:** A hero image should scroll at 50% the speed of the content overlaid on it.
96. **The Uncanny Valley of Speed:** Animations faster than 100ms are invisible; slower than 500ms feel sluggish.
97. **Magnetic Buttons:** For premium sites, buttons can slightly attract the cursor when it gets close.
98. **Text Reveal:** Animate headers by revealing them line by line from behind a mask, rather than fading the whole block.
99. **Interaction Cost:** Every click, scroll, and drag is a tax. Reduce the interaction cost to achieve the goal.
100. **The Rule of Delight:** At least one interaction per flow should make the user smile or feel deeply satisfied.

## F. Engineering & Accessibility (101-105)
101. **Absolute Accessibility (WCAG & ARIA):** Never sacrifice accessibility for aesthetics. Every interactive element must have `aria-label`, correct `role` attributes, and be fully navigable via keyboard (`tabindex`).
102. **No Raw SVG Clutter:** Never dump hundreds of lines of raw SVG code into your components. You MUST use a clean, modern icon library (like Lucide, Phosphor, or Radix Icons) unless the user explicitly provides a custom SVG.
103. **Design Tokens & CSS Variables:** Always use CSS variables (or Tailwind configuration) for colors, spacing, and typography. Hardcoding hex values across components is forbidden.
104. **Native Dark Mode:** Structure your color tokens so that switching to dark mode simply requires toggling the CSS variables on the `:root` or `html.dark` element.
105. **Semantic HTML5:** Always use `<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, and `<time>` instead of generic `<div>` tags to provide structural meaning to screen readers.
