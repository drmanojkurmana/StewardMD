# 🚫 00. Anti-AI Design Protocol (The 100 "AI Tells" & Human Solutions)

### 🚨 THE ABSOLUTE ARCHITECTURAL DIRECTIVE
**01. The "Max-Width Trap" (The Constricted Layout)**
*   **The AI Tell:** Defaulting to `max-w-5xl`, `max-w-7xl`, `max-w-[1400px]`, or `container mx-auto` on every section, leaving huge empty margins on 1920px+ screens and making the content feel unnaturally compressed and rigid.
*   **The Human Solution:** Modern web design demands breathing room. You MUST use completely fluid layouts (`w-[90%] mx-auto` or `w-full px-[5%]`). Only use constrained centered containers when it is a deliberate artistic choice for extreme readability (like a blog post text column), never as a default layout grid for a landing page. This rule supersedes all others.

**02. The "Component Stacking Syndrome" (The Floating Chaos)**
*   **The AI Tell:** Generating a series of disconnected, independent components (a hero window, a grid, a text box) and just stacking them vertically with margins on a bare background. The result is a chaotic, fragmented layout that feels like a random UI kit rather than a real product.
*   **The Human Solution:** Always design the Macro-Container first. Determine the global UX architecture. If the theme is an "App" or an "OS Dashboard", the entire viewport must be a single cohesive interface (e.g., a fixed Sidebar + a scrollable Main View wrapped in a main window). A website is a structural ecosystem, not a vertical pile of isolated widgets.

To pass as premium human work, the AI must aggressively avoid the following 100 "AI Tells" across Layout, Visuals, Typography, Components, Motion, and Code. Every generated output must be evaluated against this protocol.

## A. Layout, Grid & Spatial Tells (1-20)

**1. The Symmetrical Obsession**
*   **The AI Tell:** AI mathematically divides layouts into perfect 50/50 splits or exactly 3 identical columns. It feels robotic because it lacks visual tension and hierarchy.
*   **The Human Solution:** Introduce intentional asymmetry. Use the Golden Ratio (approx. 1:1.618) or 8:4 column splits on a 12-column grid.

**2. Mathematical Centering vs. Optical Centering**
*   **The AI Tell:** Relying purely on `align-items: center`. This creates optical imbalances, especially with asymmetrical icons (like a "Play" triangle) or text with descending letters.
*   **The Human Solution:** Apply optical adjustments. If an icon is visually heavier on the left, add padding to the left to visually center it. The eye decides what is centered, not the DOM.

**3. Homogenous Whitespace (The 16px Trap)**
*   **The AI Tell:** Using `gap: 16px` everywhere. There is no hierarchy of whitespace, leaving elements evenly distributed but completely disconnected.
*   **The Human Solution:** Implement structural tension. Group related items extremely close (`gap: 4px`), and separate distinct sections with massive whitespace (`padding-top: 120px`).

**4. The "Bento Box" Default**
*   **The AI Tell:** Forcing every single layout into an Apple-style grid of rounded boxes, even when a simple list or table would be much more readable.
*   **The Human Solution:** Reserve bento grids exclusively for dashboards. Use clean, open lists for text-heavy data.

**5. Mobile Desktop Scaling (Lazy Responsive)**
*   **The AI Tell:** Simply shrinking text sizes to make a 4-column desktop layout fit on a mobile screen. It becomes microscopic and unreadable.
*   **The Human Solution:** Completely refactor the UI structure for mobile (e.g., turning a data table into stacked, expandable cards).

**6. The "Card Soup" (Inception)**
*   **The AI Tell:** Putting a Card inside a Card inside a Card, creating messy nested borders and muddy drop shadows.
*   **The Human Solution:** Use negative space and typography size to separate nested content, rather than drawing literal boxes around everything.

**7. Ignoring the Fold**
*   **The AI Tell:** Designing a massive hero section that pushes the primary call-to-action (CTA) button below `100vh` on desktop screens.
*   **The Human Solution:** Ensure the main value proposition and the primary CTA are visible instantly without requiring the user to scroll.

**8. The "Floating Header" Disconnect**
*   **The AI Tell:** A sticky navbar that has no shadow or backdrop-blur. When the user scrolls, the text of the site clashes with the text of the menu.
*   **The Human Solution:** Add `backdrop-filter: blur(12px)` and a subtle `1px` bottom border with low opacity to sticky elements.

**9. Text Carousels**
*   **The AI Tell:** Putting crucial text content (like core features) inside an auto-playing carousel, forcing the user to wait or miss information.
*   **The Human Solution:** Stack the content vertically. If a carousel is mandatory, disable auto-play and allow manual swiping.

**10. Unnecessary Full-Width Text Containers**
*   **The AI Tell:** Letting paragraphs stretch from edge to edge on a 4K monitor, causing massive eye fatigue during reading.
*   **The Human Solution:** Cap reading widths to `max-w-prose` (approximately 65-75 characters per line).

**11. Lack of Sub-Grids**
*   **The AI Tell:** Creating independent columns where the inner contents do not align horizontally with the contents of the column next to them.
*   **The Human Solution:** Use CSS Subgrid to align nested components to a master baseline sub-grid across columns.

**12. Trapped Whitespace**
*   **The AI Tell:** Placing elements in a way that leaves weird, unusable white holes trapped in the dead center of the UI.
*   **The Human Solution:** Push whitespace to the outside edges of the layout (macro-spacing) to frame the content.

**13. Over-Padding**
*   **The AI Tell:** Putting `40px` padding inside a tiny card, which squishes the text into a single narrow column.
*   **The Human Solution:** Scale padding proportionally to the container size (e.g., `16px` on mobile cards, `32px` on desktop cards).

**14. Touching Edges (Under-Padding)**
*   **The AI Tell:** Forgetting to add `padding-bottom` on the main `<body>`, leaving the footer glued to the bottom of the scrollbar.
*   **The Human Solution:** Ensure massive breathing room above the footer to signal the end of the page content.

**15. The Wall of Features**
*   **The AI Tell:** Displaying 12 identical feature icons stacked perfectly in a grid without varying sizes or hierarchy.
*   **The Human Solution:** Vary sizes. Feature 3 main selling points prominently, and list the remaining 9 minimally.

**16. Equal Vertical Rhythm**
*   **The AI Tell:** Setting the margin between every single section to exactly `100px`. It feels robotic.
*   **The Human Solution:** Use a musical vertical rhythm scale based on relationship (e.g., `48px` for related sections, `192px` for a complete topic change).

**17. Centered Left-Aligned Text**
*   **The AI Tell:** A container is centered on the page, but the text inside it is left-aligned, creating a weird visual offset on the right side.
*   **The Human Solution:** Either align the text to the center to match the container, or left-align the entire container to the grid.

**18. Floating Footers**
*   **The AI Tell:** On a page with very little content (like a login screen), the footer floats awkwardly in the middle of the screen.
*   **The Human Solution:** Set `min-h-screen` (or `min-h-[100dvh]`) on the main wrapper to push the footer to the absolute bottom.

**19. Broken Optical Margins**
*   **The AI Tell:** Bullet points or quotation marks align perfectly with the text, making the paragraph look indented.
*   **The Human Solution:** Hang punctuation and bullets outside the left text margin to keep the text block perfectly aligned.

**20. Infinite Scroll Trap**
*   **The AI Tell:** Implementing infinite scroll on a page where the user desperately needs to reach the contact info in the footer.
*   **The Human Solution:** Provide a "Load More" button instead, allowing the user to access the footer at any time.

## B. Graphic, 3D & Photography Tells (21-40)

**21. Corporate Memphis (Alegria)**
*   **The AI Tell:** Using flat, faceless vector humans with disproportionately giant limbs and tiny heads. It screams generic "Big Tech 2018".
*   **The Human Solution:** Avoid human illustrations. Use high-contrast photography or abstract geometric visuals.

**22. The "Midjourney Sheen"**
*   **The AI Tell:** AI-generated images with hyper-smooth, glossy, plasticky textures and over-saturated rim lighting.
*   **The Human Solution:** Add heavy film grain (`ISO 400`), reduce global saturation by 10%, and crop tightly to remove the artificial sheen.

**23. Conflicting Light Sources**
*   **The AI Tell:** A UI card casts a drop shadow to the bottom-right, but contains an inner gradient lit from the bottom-right.
*   **The Human Solution:** Enforce a strict, global lighting environment across the entire interface (e.g., universal top-left lighting).

**24. The "AI Glow"**
*   **The AI Tell:** Massive, blurred cyan and purple radial gradients floating randomly in dark mode backgrounds to create fake depth.
*   **The Human Solution:** Use solid deep colors (`#0A0A0B`) and rely on subtle SVG noise overlays (`url('noise.png')`) for texture.

**25. Random Isometric 3D**
*   **The AI Tell:** Placing floating 3D glass spheres or abstract shapes to fill empty space without narrative purpose.
*   **The Human Solution:** Leave the space empty (negative space is luxury) or use purposeful, highly literal functional graphics.

**26. Text Rendering Hallucinations**
*   **The AI Tell:** Using AI-generated images that contain gibberish alien text or warped symbols in the background.
*   **The Human Solution:** Strictly use real photography from Unsplash or pure abstract visuals with zero lettering.

**27. Perfect Organic Symmetry**
*   **The AI Tell:** AI draws leaves, human faces, or natural textures perfectly symmetrically, triggering the uncanny valley.
*   **The Human Solution:** Intentionally skew, rotate, or deform organic assets slightly. Nature is never perfectly mirrored.

**28. Fake Film Grain**
*   **The AI Tell:** Digital noise overlays that look like harsh, pixelated TV static rather than analog film.
*   **The Human Solution:** Use SVG `<feTurbulence>` filters with a low frequency and `multiply` blend mode for true organic texture.

**29. Geometric Hexagon Logos**
*   **The AI Tell:** Defaulting to an overlapping transparent hexagon or a generic infinity symbol for "Tech" logos.
*   **The Human Solution:** Use pure typography (Logotypes) or extremely simple, bold brutalist shapes.

**30. Inconsistent Icon Sets**
*   **The AI Tell:** Mixing icons with a `1px` stroke next to icons with a `2px` stroke, or mixing filled icons with outline icons.
*   **The Human Solution:** Strictly use one unified icon library (e.g., Lucide, Phosphor) and enforce identical stroke widths.

**31. The 6-Fingered Hand**
*   **The AI Tell:** Using AI images with severe anatomical errors in hands, teeth, or background limbs.
*   **The Human Solution:** Never use AI-generated human anatomy without manual retouching or heavy cropping.

**32. Meaningless Dashboards**
*   **The AI Tell:** AI images of dashboards with fake, illogical UI graphs where the X and Y axes make zero mathematical sense.
*   **The Human Solution:** Build real CSS charts with libraries (like Recharts) or use precise, logical UI vectors.

**33. Over-blurred Backgrounds (Fake Bokeh)**
*   **The AI Tell:** Portrait-mode blurring that incorrectly blurs subjects on the same focal plane as the main subject.
*   **The Human Solution:** Use realistic depth-of-field logic or avoid artificial blurring entirely.

**34. Shadows on Flat Vectors**
*   **The AI Tell:** Slapping a literal drop shadow on a completely flat, 2D illustration.
*   **The Human Solution:** Keep 2D art strictly flat; apply shadows only to structural UI layers (like cards).

**35. Redundant Icons**
*   **The AI Tell:** Putting a 🏠 icon immediately next to the word "Home" on a modern website.
*   **The Human Solution:** Drop the icon. Text alone is faster to read and looks cleaner.

**36. The Stock Photo Grin**
*   **The AI Tell:** Using images of unnaturally happy people pointing aggressively at computer screens.
*   **The Human Solution:** Use candid, moody, or highly editorial lifestyle photography with natural lighting.

**37. Over-Detailed Small Icons**
*   **The AI Tell:** Shrinking a complex vector meant for `64x64px` down to `16x16px`, turning it into an illegible black blob.
*   **The Human Solution:** Use simplified icon variants specifically designed for small dimensions.

**38. Misaligned SVG Viewboxes**
*   **The AI Tell:** Generating SVGs with huge internal padding inside the `viewBox`, making CSS alignment impossible.
*   **The Human Solution:** Crop the SVG `viewBox` tightly to the exact boundaries of the vector path.

**39. The "Tech Dots"**
*   **The AI Tell:** Using random networks of connecting dots and lines to symbolize "AI" or "Blockchain".
*   **The Human Solution:** Find a specific, unique visual metaphor. The connecting dots are universally despised as generic.

**40. Aspect Ratio Mixing**
*   **The AI Tell:** Randomly mixing 1:1, 16:9, and 4:3 images in the exact same grid, breaking the layout.
*   **The Human Solution:** Force strict `aspect-ratio` rules via CSS (e.g., `aspect-video object-cover`).

## C. Color, Lighting & Contrast Tells (41-55)

**41. Toxic Vibrancy**
*   **The AI Tell:** Using `#FF0000` (Pure Red) or `#00FF00` (Pure Green) for system alerts, causing eye strain.
*   **The Human Solution:** Desaturate and darken functional colors slightly (`#EF4444` or `#10B981`) to look professional.

**42. Default Dark Mode**
*   **The AI Tell:** Generating a dark mode UI for every prompt, even for industries like hospitals, daycares, or banks.
*   **The Human Solution:** Analyze the industry. Use airy, white/light UIs to convey trust, health, and B2B security.

**43. Muddy Mid-Tones**
*   **The AI Tell:** Creating a gradient from Red to Green, resulting in a dirty brown/gray color in the dead center.
*   **The Human Solution:** Add a third, bright color stop in the middle, or use HSL color interpolation spaces.

**44. Blinding White**
*   **The AI Tell:** Using `#FFFFFF` for massive backgrounds or body text, causing halation and burning the retina.
*   **The Human Solution:** Use tinted off-whites (`#F4F4F5` or `#FAFAFA`) for backgrounds, and soft grays (`#E2E8F0`) for dark mode text.

**45. Gradient Border Abuse**
*   **The AI Tell:** Using iridescent gradient borders on every single card to look "Web3".
*   **The Human Solution:** Use subtle 1px solid borders (`rgba(255,255,255,0.1)`) for premium minimalism.

**46. Muted Text Contrast Failure**
*   **The AI Tell:** Using `#999` text on a `#FFF` background, completely failing accessibility standards.
*   **The Human Solution:** Check all text against WCAG 4.5:1 ratio rules. Muted text should usually be `#555` or `#666` at minimum.

**47. Colored Drop Shadows in Dark Mode**
*   **The AI Tell:** Using colored shadows in dark mode themes. Shadows do not exist in the dark.
*   **The Human Solution:** Indicate elevation in dark mode using lighter background shades (e.g., `#1A1A1A` over `#000000`).

**48. The "Color Picker" Palette**
*   **The AI Tell:** Using raw, mathematical primary colors like `#0000FF` (Blue) or `#FFFF00` (Yellow).
*   **The Human Solution:** Tweak hues slightly (e.g., add warmth to a yellow, or coolness to a blue) using HSL/LCH for harmony.

**49. Color Blindness Ignorance**
*   **The AI Tell:** Relying solely on color (Red vs Green) to indicate a success/error state.
*   **The Human Solution:** Always add a secondary indicator, like an icon (an "X" or a checkmark) or a text label.

**50. Hard Transition Shadows**
*   **The AI Tell:** Drop shadows with a `0px` spread and heavy opacity (like `rgba(0,0,0,0.5)`), looking like MS Word.
*   **The Human Solution:** Use layered, ultra-soft shadows with very low opacity (e.g., `0.05` to `0.02`).

**51. Multiple Primary Colors**
*   **The AI Tell:** Having a Green "Buy" button and a Red "Sign Up" button of equal visual weight on the same page.
*   **The Human Solution:** Designate only ONE primary brand color per view. All other actions must be secondary (outline/ghost).

**52. Neon Text Trap**
*   **The AI Tell:** Glowing neon text on a dark background without a supporting text-shadow, making it bleed and become illegible.
*   **The Human Solution:** Add `text-shadow: 0 0 10px rgba(brand-color, 0.5)` to anchor the glow to the text.

**53. Mixing Warm/Cool Grays**
*   **The AI Tell:** Using a cool blue-gray for the background but a warm yellow-gray for the card borders.
*   **The Human Solution:** Strictly align the hue of all neutral colors. Build a unified 50-900 color scale.

**54. Inverted Dark Mode**
*   **The AI Tell:** Creating a dark mode by algorithmically inverting all the light mode colors.
*   **The Human Solution:** Hand-pick semantic dark mode scales; dark mode requires inherently lower contrast to be readable.

**55. Brand Color Exhaustion**
*   **The AI Tell:** Making every header, every link, every icon, and every button the primary brand color.
*   **The Human Solution:** Follow the 60-30-10 rule. The brand color should be used for less than 10% of the UI.

## D. Typography, Copywriting & Content Tells (56-75)

**56. The ChatGPT Vocabulary**
*   **The AI Tell:** Relying on overused words like: *Delve, Elevate, Seamless, Unlock, Robust, Foster, Symphony, Tapestry.*
*   **The Human Solution:** Use direct verbs and nouns. ("Make faster payments" instead of "Unlock seamless financial symphonies").

**57. Structural Monotony**
*   **The AI Tell:** Writing exactly 3 paragraphs, each containing exactly 3 sentences of the exact same length. It feels robotic.
*   **The Human Solution:** Vary text rhythm dynamically. Use a 1-word sentence. Then a long explanation. Break it up with lists.

**58. No Font Pairing Tension**
*   **The AI Tell:** Using a single font (like Inter) everywhere with no contrast between headers and body text.
*   **The Human Solution:** Create tension. Pair a highly stylized, brutalist Serif display font with an ultra-utilitarian Mono font.

**59. Ignoring Letter-Spacing Rules**
*   **The AI Tell:** Using the default browser letter-spacing (tracking) for everything.
*   **The Human Solution:** Tighten tracking for massive headers (`-0.03em`), widen tracking for uppercase metadata or buttons (`0.05em`).

**60. Missing Typographic Hierarchy**
*   **The AI Tell:** Hierarchy is determined solely by font size (e.g., H1 is larger than H2).
*   **The Human Solution:** Use weight, color (muted grays), and casing to establish order. A tiny uppercase bold text can outrank a large thin text.

**61. Meaningless Microcopy**
*   **The AI Tell:** Using generic button text like "Click Here", "Submit", or "Learn More".
*   **The Human Solution:** Use descriptive, action-oriented verbs. ("Deploy to Vercel", "Read Documentation").

**62. The Lorem Ipsum Evasion**
*   **The AI Tell:** Refusing to write copy and just putting "Lorem ipsum dolor sit amet" everywhere.
*   **The Human Solution:** Use realistic, contextual "fake" data to test text wrapping and user intent.

**63. Gradient Text Abuse**
*   **The AI Tell:** Putting `background-clip: text` gradients on small 16px body text, destroying legibility.
*   **The Human Solution:** Restrict text gradients strictly to massive `H1` headlines.

**64. Orphan Words**
*   **The AI Tell:** The last word of a headline falls alone onto a new line, creating an ugly shape.
*   **The Human Solution:** Apply `text-wrap: balance` to CSS to ensure even, beautiful line lengths for headers.

**65. Emojis as Formatting**
*   **The AI Tell:** 🚀 Putting emojis at the start of every bullet point or heading to look "friendly". ✨
*   **The Human Solution:** Rely on pure typography, layout, or custom SVG icons. Emojis look amateurish in premium UI.

**66. Hardcoded Dates**
*   **The AI Tell:** Outputting database timestamps like `2026-05-04T00:22` directly into the UI.
*   **The Human Solution:** Parse and humanize dates (e.g., "Just now", "2 days ago", or "May 4, 2026").

**67. Unformatted Numbers**
*   **The AI Tell:** Displaying raw numbers like `$10000` or `1000000 views`.
*   **The Human Solution:** Use `Intl.NumberFormat` to output `$10,000.00` or `1M views`.

**68. System Font Fallback Failure**
*   **The AI Tell:** Specifying an obscure font like `font-family: "CustomFont";` without providing a safe fallback.
*   **The Human Solution:** Always end font stacks with system-safe defaults: `system-ui, -apple-system, sans-serif`.

**69. Capitalization Inconsistency**
*   **The AI Tell:** Mixing Title Case ("Sign Up Now") and Sentence case ("Sign up now") randomly across buttons.
*   **The Human Solution:** Pick one casing standard for the entire app and enforce it strictly.

**70. Fake Trust Badges**
*   **The AI Tell:** Slapping generic "100% Secure" text with a lock icon without any context.
*   **The Human Solution:** Explain *why* it's secure (e.g., "Secured via AES-256 Encryption by Stripe").

**71. The "Are you sure?" Spam**
*   **The AI Tell:** Triggering a confirmation dialogue for every single non-destructive action.
*   **The Human Solution:** Allow "Undo" (toast notifications) for non-destructive actions. Use modals only for permanent deletions.

**72. Fake Testimonial Names**
*   **The AI Tell:** Writing testimonials signed by "John Doe - CEO".
*   **The Human Solution:** Use highly specific, realistic placeholder names and job titles ("Sarah Jenkins - VP of Ops at Acme").

**73. Unscannable Text Walls**
*   **The AI Tell:** Presenting massive blocks of unbroken text without visual relief.
*   **The Human Solution:** Break it up with pull quotes, bolded keywords, bullet points, and generous line-heights.

**74. All-Caps Body Text**
*   **The AI Tell:** Using `text-transform: uppercase` on paragraphs longer than 3 words.
*   **The Human Solution:** Never uppercase long text blocks; it removes the shape of words, destroying readability.

**75. Straight Quotes**
*   **The AI Tell:** Using straight typewriter quotes (`" "`) instead of proper typographic smart quotes (`“ ”`).
*   **The Human Solution:** Run copy through a typography formatter or use HTML entities for smart quotes.

## E. UI Components, Interaction & Motion Tells (76-90)

**76. The "Bootstrap" Radius**
*   **The AI Tell:** Slapping `8px` rounded corners indiscriminately. Mixing pill buttons with square cards incorrectly.
*   **The Human Solution:** Follow the Law of Concentric Radii: Inner Radius = Outer Radius - Padding.

**77. Over-Animation (The Jiggle)**
*   **The AI Tell:** Adding `transition: all 0.3s ease` to cards, making them blow up massively and scale down on hover.
*   **The Human Solution:** Animate `transform` only. Hover should be a subtle `translateY(-2px)` shift. Fast in, slow out.

**78. Linear Easing**
*   **The AI Tell:** Movement uses `linear` easing, feeling robotic and lacking physical mass.
*   **The Human Solution:** Use custom cubic-beziers (`cubic-bezier(0.16, 1, 0.3, 1)`) or physics-based springs so objects accelerate organically.

**79. Missing Focus States**
*   **The AI Tell:** Removing focus rings (`outline: none`), breaking accessibility and keyboard navigation completely.
*   **The Human Solution:** Always implement highly visible `:focus-visible` offset rings (e.g., a 2px blue ring).

**80. The Floating Input**
*   **The AI Tell:** Form fields without visible boundaries, relying only on placeholder text.
*   **The Human Solution:** Ensure inputs have a distinct background tint or a clear `1px` border to provide click affordance.

**81. Excessive Glassmorphism**
*   **The AI Tell:** Blurring every background indiscriminately (`backdrop-filter: blur`), killing GPU performance.
*   **The Human Solution:** Use solid colors with opacity, unless there is a vibrant moving element directly behind the glass.

**82. Z-Index Wars**
*   **The AI Tell:** Assigning `z-index: 9999` randomly to fix stacking context issues.
*   **The Human Solution:** Establish a strict, documented scale (e.g., Modals=50, Tooltips=60) and restructure the DOM to avoid conflicts.

**83. The "Everything Fades Up" Entry**
*   **The AI Tell:** Every single element on the page does the exact same `fade-up` animation on scroll.
*   **The Human Solution:** Stagger animations sequentially. Use masks to reveal elements, or scale elements in from `0.95`.

**84. Lack of Haptic Mass**
*   **The AI Tell:** A massive modal animates in at the exact same speed (300ms) as a tiny tooltip.
*   **The Human Solution:** Large objects have more mass and take longer to move. Adjust duration based on component size.

**85. Vomit Parallax**
*   **The AI Tell:** Foreground and background layers moving at completely random, fast speeds, causing motion sickness.
*   **The Human Solution:** Keep parallax extremely subtle (e.g., background moves at 15% the speed of foreground).

**86. Hover States without Cursors**
*   **The AI Tell:** Missing `cursor: pointer` on interactive divs or custom buttons.
*   **The Human Solution:** Ensure every single clickable element changes the cursor to signify interactivity.

**87. The Disappearing Scrollbar**
*   **The AI Tell:** Hiding scrollbars completely via CSS `::-webkit-scrollbar { display: none; }`, breaking UX context.
*   **The Human Solution:** Style scrollbars elegantly to match the theme, but never hide them entirely.

**88. Infinite Spinners**
*   **The AI Tell:** Loading states with no timeout or error handling. If the API fails, it spins forever.
*   **The Human Solution:** Always show an error message if the API doesn't respond within 10 seconds.

**89. Un-clickable Touch Targets**
*   **The AI Tell:** Icons that require clicking exactly on the `1px` SVG path line to register a click.
*   **The Human Solution:** Wrap icons in a `<button>` with a minimum `44x44px` invisible padding hit area.

**90. The Instant Tooltip**
*   **The AI Tell:** Tooltips that appear with 0ms delay, flashing annoyingly when the mouse moves across the screen.
*   **The Human Solution:** Add a `300ms` delay before showing tooltips to ensure intentional hovering.

## F. Code Architecture, DOM & UX Engineering Tells (91-100)

**91. Div Soup**
*   **The AI Tell:** Wrapping everything in meaningless `<div>` tags, creating a massive, inaccessible DOM tree.
*   **The Human Solution:** Use semantic HTML5. Wrap articles in `<article>`, sidebars in `<aside>`, and navigation in `<nav>`.

**92. Arbitrary Inline Styles**
*   **The AI Tell:** Hardcoding CSS values (e.g., `margin-top: 17px;`) randomly throughout the codebase.
*   **The Human Solution:** Strictly enforce the 8pt design system scale and use tokens (e.g., `mt-4`).

**93. No CSS Variables**
*   **The AI Tell:** Hardcoded hex colors making system-wide theme switching (light/dark mode) impossible.
*   **The Human Solution:** Abstract all colors to CSS variables (e.g., `--bg-primary`, `--text-muted`).

**94. The 100vh Mobile Trap**
*   **The AI Tell:** Using `100vh`, causing bottom elements to be cut off by Safari's dynamic address bar.
*   **The Human Solution:** Use `100dvh` (Dynamic Viewport Height) for full-screen mobile layouts.

**95. Cumulative Layout Shift (CLS)**
*   **The AI Tell:** Loading skeletons that are smaller than the real content, causing the page to jump violently when data loads.
*   **The Human Solution:** Ensure skeletons map 1:1 to the exact final loaded heights of the components.

**96. The `.map()` Without Empty States**
*   **The AI Tell:** Rendering lists via `.map()` without checking if the array length is 0.
*   **The Human Solution:** Always return a beautiful `<EmptyState />` component if data is null or empty.

**97. `!important` Abuse**
*   **The AI Tell:** Forcing CSS properties with `!important` instead of understanding CSS specificity.
*   **The Human Solution:** Write cleaner CSS specificity or leverage modern CSS cascade layers (`@layer`).

**98. Missing Aria Labels**
*   **The AI Tell:** Icon-only buttons without text, making them completely invisible to screen readers.
*   **The Human Solution:** Always add `aria-label="Action name"` to all graphical buttons.

**99. The Un-submittable Form**
*   **The AI Tell:** Forms that rely entirely on JS `onClick` for submission, breaking the "Enter" key functionality.
*   **The Human Solution:** Use native `<form onSubmit>` so users can submit via keyboard natively.

**100. Hardcoded Strings**
*   **The AI Tell:** Writing textual content like "Submit" directly into the DOM tree.
*   **The Human Solution:** Abstract all strings into localization files (`i18n.t('submit')`) for easy translation.

## G. Structural, Layout & Archetype Cliches (The "Tailwind-GPT" Syndrome) (101-150)

**101. The "Centered Hero" Default**
*   **The AI Tell:** H1 centered, subtitle centered, exactly two buttons centered (Primary solid, Secondary outline). This is the #1 AI tell in the world.
*   **The Human Solution:** Align left. Make typography massive. Break the grid. Use an asymmetrical layout where text interacts with the environment.

**102. The "Sparkle Pill" Badge**
*   **The AI Tell:** A pill-shaped badge above the H1 containing a ✨ sparkle icon and "Introducing [Feature]". 
*   **The Human Solution:** Remove it. If you need a label, use a harsh, brutalist monospace tag or integrate it into the typography itself.

**103. The 3-Column Feature Grid**
*   **The AI Tell:** Exactly 3 identical cards side-by-side. Each has a circular icon with a tinted background, a title, and 2 lines of gray text.
*   **The Human Solution:** Use a bento grid with varying spans (e.g., one huge feature card spanning 2 columns, two smaller ones). Hierarchy matters.

**104. The Zig-Zag (Z-Pattern) Layout**
*   **The AI Tell:** Section 1: Text Left, Image Right. Section 2: Image Left, Text Right. Section 3: Text Left, Image Right.
*   **The Human Solution:** Break the pattern. Use overlapping elements, sticky scrolling sidebars, or full-width immersive media sections.

**105. The "Trusted By" Gray Logo Strip**
*   **The AI Tell:** A row of 5-6 desaturated, monochrome logos immediately below the hero section.
*   **The Human Solution:** Integrate social proof organically into the design (e.g., quotes embedded inside the hero graphic) or use high-contrast, brutalist logo presentations.

**106. The "Most Popular" Pricing Trap**
*   **The AI Tell:** 3 pricing cards. The middle one is scaled to `1.05`, has a primary brand color border, and a "Most Popular" badge.
*   **The Human Solution:** Challenge the layout. Use a horizontal slider, a minimal receipt-style breakdown, or a single dynamic interactive calculator.

**107. The Accordion FAQ**
*   **The AI Tell:** A list of 5 questions with a Chevron icon that rotates 180 degrees on click.
*   **The Human Solution:** Display FAQs in an editorial, multi-column magazine format so users don't have to click to read.

**108. The Floating Isometric Dashboard**
*   **The AI Tell:** The hero image is a web app screenshot tilted at exactly 15 degrees, floating with a soft shadow.
*   **The Human Solution:** Show extreme, abstract macro-crops of the UI, or use raw, flat, edge-to-edge brutalist screenshots without fake perspective.

**109. The "Get Started Today" Footer Block**
*   **The AI Tell:** A massive `bg-indigo-600` block right above the footer with a centered H2 and a white button.
*   **The Human Solution:** Integrate the final CTA directly into the footer layout using massive typography that spans the entire width of the screen.

**110. The 4-Column Boring Footer**
*   **The AI Tell:** 4 columns of tiny gray text links ("Company", "Resources", "Legal") that nobody reads.
*   **The Human Solution:** Make the footer a design statement. Use giant typography, ASCII art, interactive elements, or a massive email signup form.

**111. The "Stats Bar"**
*   **The AI Tell:** A horizontal bar containing 4 numbers counting up from 0 to 1M+ using a JS library.
*   **The Human Solution:** Contextualize data. Show the impact of the stat visually using dynamic charts or timeline scrubbers.

**112. The "Avatar Pile" (Facepile)**
*   **The AI Tell:** 5 overlapping circular avatars with a white border and "+99 joined" next to them.
*   **The Human Solution:** Show actual verifiable proof instead of generic circles, or use raw data visualization.

**113. The Generic Testimonial Grid**
*   **The AI Tell:** A masonry grid of white cards with 5 gold stars and "Best app ever" written by "John D.".
*   **The Human Solution:** Treat testimonials like editorial pull-quotes. Make them massive, use custom typography, and integrate them into the narrative flow.

**114. The Sticky Glass Navbar**
*   **The AI Tell:** `fixed top-0 w-full bg-white/80 backdrop-blur-md border-b`. 
*   **The Human Solution:** Try an auto-hiding navbar, a side-navigation menu, or a floating pill-shaped dock at the bottom of the screen.

**115. The "Blog Grid"**
*   **The AI Tell:** 3 identical cards with a thumbnail image on top, a category tag, a title, and a "Read More ->" link.
*   **The Human Solution:** Design it like a real newspaper or avant-garde magazine. Use asymmetrical list views with varying image sizes.

**116. The "How It Works" 1-2-3 Steps**
*   **The AI Tell:** 3 horizontal blocks with giant numbers "1", "2", "3" in circles.
*   **The Human Solution:** Create an interactive, scroll-linked sticky timeline where the UI transforms as the user scrolls down.

**117. The Contact Form Cliche**
*   **The AI Tell:** Name, Email, Message, Submit Button. In a white box with a shadow.
*   **The Human Solution:** Make it conversational ("Hi, my name is [input] and I want to talk about [dropdown]"). Or make it a terminal interface.

**118. The Newsletter "Subscribe" Bar**
*   **The AI Tell:** A short text input next to a button saying "Subscribe" in the footer.
*   **The Human Solution:** Promise value. "Get 1 elite design tip a week." Make the input massive and interactive.

**119. The Dual-Tone Gradient Background**
*   **The AI Tell:** `bg-gradient-to-r from-blue-500 to-purple-500`. The default AI fallback for anything "modern".
*   **The Human Solution:** Use mesh gradients with 4+ colors, or stick to stark, solid colors with high-contrast noise.

**120. The "Features Tab" Component**
*   **The AI Tell:** A list of words on the left. Clicking one changes a generic image on the right.
*   **The Human Solution:** Build a continuous scroll experience where the background changes contextually.

**121. The "Meet the Team" Circles**
*   **The AI Tell:** A grid of perfect circles showing employee faces with their Twitter/LinkedIn icons underneath.
*   **The Human Solution:** Use full-bleed, cinematic photography or interactive hover states that reveal team personalities.

**122. The "Timeline" with a Vertical Line**
*   **The AI Tell:** A single gray vertical line down the center of the screen with alternating dots left and right.
*   **The Human Solution:** Use horizontal scrolling or 3D depth to show progression over time.

**123. The "Video Modal" Play Button**
*   **The AI Tell:** A large circular "Play" icon with a pulse animation floating over a darkened thumbnail.
*   **The Human Solution:** Autoplay a silent, high-quality background loop. Hide the play controls until hover.

**124. The "Language Switcher" Globe**
*   **The AI Tell:** A tiny globe icon in the top right next to "EN / FR".
*   **The Human Solution:** Make language selection a deliberate, beautiful full-screen modal or a sleek bottom sheet.

**125. The "404 Page" Astronaut/Alien**
*   **The AI Tell:** "Oops! You're lost in space" with an SVG illustration of an astronaut.
*   **The Human Solution:** Be useful. Provide a search bar, a sitemap, or a creative interactive mini-game.

**126. The "Dark Mode Toggle" Sun/Moon**
*   **The AI Tell:** A literal sun and moon icon that flips.
*   **The Human Solution:** Match the system preference by default. If a toggle is needed, make it an elegant, abstract switch without literal icons.

**127. The "Breadcrumb" Trail**
*   **The AI Tell:** `Home > Category > Subcategory > Page`.
*   **The Human Solution:** Rethink navigation. If the user is that deep, the UI structure might be too complex. Use dynamic back buttons.

**128. The "Pagination" Numbers**
*   **The AI Tell:** `[Prev] 1 2 3 ... 10 [Next]`.
*   **The Human Solution:** Use cursor-based "Load More" or a highly stylized visual progress indicator.

**129. The "Search Bar" with Magnifying Glass**
*   **The AI Tell:** A gray pill with a magnifying glass icon and "Search...".
*   **The Human Solution:** Implement a global command palette (CMD+K) that is invisible until summoned.

**130. The "Tag Cloud"**
*   **The AI Tell:** A messy block of different sized pill tags.
*   **The Human Solution:** Use an elegant, horizontally scrollable filter bar with precise typography.

**131. The "Progress Bar" Loader**
*   **The AI Tell:** A thin blue line at the very top of the screen (NProgress).
*   **The Human Solution:** Use skeleton screens or highly custom, brand-specific loading animations.

**132. The "Tooltips" everywhere**
*   **The AI Tell:** Putting a `?` icon next to every label.
*   **The Human Solution:** Write clearer copy so tooltips aren't necessary.

**133. The "Hamburger Menu" on Desktop**
*   **The AI Tell:** Hiding the main navigation behind a hamburger icon even on 4K monitors to look "minimalist".
*   **The Human Solution:** Expose the navigation. Whitespace is good, but hiding core functions is bad UX.

**134. The "Dropdown Menu" on Hover**
*   **The AI Tell:** A massive mega-menu that appears instantly when the mouse accidentally brushes over a link.
*   **The Human Solution:** Require a click, or use a deliberate delay (`300ms`) and smooth fade-in.

**135. The "Scroll to Top" Arrow**
*   **The AI Tell:** A floating button in the bottom right corner that appears after scrolling 500px.
*   **The Human Solution:** Unnecessary. Users know how to scroll up natively.

**136. The "Cookie Banner" Bar**
*   **The AI Tell:** A massive black bar at the bottom saying "We use cookies" with an "Accept All" button.
*   **The Human Solution:** Integrate it cleanly into the layout (e.g., a sleek floating notification pill in the bottom left).

**137. The "Skeleton Loader" Pulsing Gray Boxes**
*   **The AI Tell:** The exact same light gray pulsing rectangles for everything.
*   **The Human Solution:** Use a subtle shimmer effect on boxes that match the final background color, not pure gray.

**138. The "Empty State" Ghost/Box Icon**
*   **The AI Tell:** A gray illustration of an empty cardboard box with "No data found".
*   **The Human Solution:** Provide a clear "Create New" CTA and explain the value of adding data.

**139. The "Success Toast" Green Notification**
*   **The AI Tell:** A green box sliding in from the top right saying "Success! Item saved."
*   **The Human Solution:** Design custom, elegant notifications. Use subtle checkmarks and keep the background dark/neutral.

**140. The "Password Strength" Meter**
*   **The AI Tell:** A bar that changes from Red to Yellow to Green.
*   **The Human Solution:** Give real-time, checklist-style feedback on exactly what characters are missing.

**141. The "Drag and Drop" Dashed Box**
*   **The AI Tell:** A massive gray dashed border box with a cloud upload icon.
*   **The Human Solution:** Make the entire screen or relevant container a dropzone seamlessly upon drag enter.

**142. The "Range Slider" with a Blue Dot**
*   **The AI Tell:** The default HTML5 `<input type="range">` styled slightly blue.
*   **The Human Solution:** Create custom, thick, highly tactile sliders with visible numeric tooltips.

**143. The "Toggle Switch" Green/Gray**
*   **The AI Tell:** A pill-shaped toggle that turns green when active (like iOS).
*   **The Human Solution:** Customize it. Use brand colors, sharp corners, or checkmark icons inside the toggle.

**144. The "Checkbox" Blue Square**
*   **The AI Tell:** The default blue browser checkbox.
*   **The Human Solution:** Build custom SVG checkboxes that match the exact aesthetic of the UI laws (e.g., brutalist sharp squares).

**145. The "Radio Button" Circles**
*   **The AI Tell:** Standard circular radio buttons.
*   **The Human Solution:** Use selectable, massive, clickable UI cards instead of tiny radio circles for important choices.

**146. The "Select Dropdown" Default**
*   **The AI Tell:** A native `<select>` element that looks different on Mac, Windows, and iOS.
*   **The Human Solution:** Build a custom accessible dropdown (using Radix/Headless UI) for pixel-perfect consistency.

**147. The "Date Picker" Calendar**
*   **The AI Tell:** A massive pop-up calendar with a 7x7 grid.
*   **The Human Solution:** Provide quick presets ("Today", "Tomorrow", "Next Week") alongside the calendar.

**148. The "Color Picker" Rainbow Box**
*   **The AI Tell:** A standard HSV rainbow gradient box.
*   **The Human Solution:** Offer a curated palette of 10 perfect brand colors before offering a custom picker.

**149. The "Stepper" Horizontal Line**
*   **The AI Tell:** `Step 1 ---- Step 2 ---- Step 3`.
*   **The Human Solution:** Consolidate steps if possible, or use a vertical, narrative-driven flow.

**150. The "Glow" on Everything**
*   **The AI Tell:** Adding a box-shadow with a brand color to every active state, hover state, and button.
*   **The Human Solution:** Restrict glow effects strictly to critical primary actions or errors. Restraint is key.

## H. The "Midjourney & Generative Asset" Tells (151-175)

**151. The "Rim Light" Obsession**
*   **The AI Tell:** Every 3D or photo subject has a glowing, artificial bright purple/cyan rim light coming from behind.
*   **The Human Solution:** Prompt for natural, single-source studio lighting or flat ambient daylight.

**152. Hyper-Detailed Backgrounds**
*   **The AI Tell:** The background is as perfectly in-focus and detailed as the subject, flattening the image depth.
*   **The Human Solution:** Use shallow depth of field (e.g., "f/1.4", "bokeh") or completely solid studio backdrops.

**153. The Over-Textured Surface**
*   **The AI Tell:** Every surface (skin, concrete, metal) is covered in microscopic pores, scratches, and dirt that look mathematically generated.
*   **The Human Solution:** Prompt for "clean", "minimalist", "smooth surfaces", or "matte finish".

**154. The Centered Subject (Always)**
*   **The AI Tell:** The generated object is always perfectly in the dead center of the frame.
*   **The Human Solution:** Prompt for "Rule of thirds", "asymmetrical composition", or "extreme close-up macro crop".

**155. The "Cinematic Lighting" Cliché**
*   **The AI Tell:** Adding "cinematic lighting" to every prompt yields the exact same dark, moody, teal-and-orange Hollywood blockbuster look.
*   **The Human Solution:** Prompt for specific photographic lighting: "flash photography", "harsh noon sunlight", or "softbox lighting".

**156. The Symmetrical Human Face**
*   **The AI Tell:** Faces are mathematically perfectly symmetrical, lacking the slight imperfections of a real human.
*   **The Human Solution:** Use prompts like "candid photography", "slight asymmetry", "documentary style".

**157. The "Future Tech" Hologram**
*   **The AI Tell:** Floating blue holographic circles representing "AI" or "Data".
*   **The Human Solution:** Use physical representations of technology (servers, wiring, macro chips) or pure typography.

**158. Overly Emotional Expressions**
*   **The AI Tell:** Subjects are smiling way too hard or staring intensely into the soul of the viewer.
*   **The Human Solution:** Prompt for "neutral expression", "looking away from camera", "profile profile".

**159. The "Volumetric Fog" Abuse**
*   **The AI Tell:** Every dark scene is filled with thick, dusty fog catching light rays.
*   **The Human Solution:** Remove atmospheric prompts entirely for clear, stark, high-fashion or editorial looks.

**160. The 3D Rendered Desk**
*   **The AI Tell:** A perfectly clean desk with a MacBook, a succulent plant, and a coffee cup, rendered in Blender.
*   **The Human Solution:** Photograph a real, slightly messy workspace or focus strictly on the digital UI itself.

**161. The Floating Abstract Spheres**
*   **The AI Tell:** Matte or glass spheres floating in an empty room with a pedestal.
*   **The Human Solution:** Use purposeful geometric compositions that frame content, not just random floating objects.

**162. The "Synthwave" Grid**
*   **The AI Tell:** A glowing pink/purple 80s grid stretching into the horizon.
*   **The Human Solution:** If retro is needed, use pure UI brutalism or 90s Web 1.0 aesthetics, not 80s outrun cliches.

**163. Text in Images (Hallucinations)**
*   **The AI Tell:** An image containing a sign or screen with alien, warped, misspelled text.
*   **The Human Solution:** Prompt specifically: "No text", "no typography", "blank screen".

**164. The "Liquid Metal" Cliché**
*   **The AI Tell:** Chrome, liquid blobs distorting and reflecting a colorful gradient.
*   **The Human Solution:** Move away from 2021 web3 trends. Use matte ceramics, rough concrete, or frosted glass.

**165. The Impossible Architecture**
*   **The AI Tell:** Buildings where stairs lead to nowhere or structural beams merge into walls illogically.
*   **The Human Solution:** Prompt for "Architectural Digest photography", "functional brutalism", "hyper-realistic structural engineering".

**166. The Oversaturated Cyberpunk**
*   **The AI Tell:** Tokyo-style neon signs dominating every frame when "tech" is prompted.
*   **The Human Solution:** Use daylight tech prompts: "Solarpunk", "clean energy", "minimalist lab".

**167. The "Isometric City"**
*   **The AI Tell:** A low-poly 3D block representing a city or a factory.
*   **The Human Solution:** Use abstract data lines or high-end topographic maps.

**168. The "Golden Hour" Default**
*   **The AI Tell:** Everything is lit with a warm, orange sunset glow.
*   **The Human Solution:** Explore other times of day: "blue hour", "overcast", "midnight flash".

**169. The "Plastic" Hair**
*   **The AI Tell:** Hair strands clump together and look like solid molded plastic.
*   **The Human Solution:** Avoid AI close-ups of hair, or use "editorial high-fashion photography, blowing in wind".

**170. The "Levitating" Object without Shadow**
*   **The AI Tell:** An object sits on a surface but lacks ambient occlusion, making it look pasted on.
*   **The Human Solution:** Explicitly prompt for "ambient occlusion", "contact shadows", "realistic raytracing".

**171. The Vector Illustration "Flat" Style**
*   **The AI Tell:** 2D vectors that look like cheap microstock vectors from 2015.
*   **The Human Solution:** Use high-end analog illustration prompts: "screenprint", "risograph", "linocut".

**172. The "Glass Sphere" Macro**
*   **The AI Tell:** A close-up of a glass sphere reflecting a landscape upside down.
*   **The Human Solution:** It's a dated photography trope. Use pure UI framing instead.

**173. The "Abstract Fluid" Background**
*   **The AI Tell:** Swirling paint colors mixed together like oil and water.
*   **The Human Solution:** Extremely overused (Apple did it a decade ago). Use high-contrast gradients or solid noise.

**174. The "Bokeh" Hearts/Stars**
*   **The AI Tell:** Light blurs in the background shaped like stars or hearts.
*   **The Human Solution:** Use strictly circular, natural lens bokeh (`f/1.2 50mm lens`).

**175. The "Perfectly Clean" Environment**
*   **The AI Tell:** A street or room with zero scuffs, dirt, dust, or wear and tear.
*   **The Human Solution:** Add prompts for "lived-in", "subtle wear", "realistic patina".

## I. Creative Portfolio & Agency Cliches (176-195)

**176. The "Hi, I'm a Developer" Typewriter Effect**
*   **The AI Tell:** The hero text deletes and types "I am a Designer | Developer | Creator" in an infinite loop.
*   **The Human Solution:** Just state the primary value proposition directly with massive, beautiful typography.

**177. The Floating 3D Avatar (Memoji)**
*   **The AI Tell:** Using an Apple Memoji or a generic 3D character of the creator floating in the hero.
*   **The Human Solution:** Use a real, high-quality editorial photo, or stick to pure typography.

**178. The "Skills" Progress Bars**
*   **The AI Tell:** Showing "HTML 90%", "CSS 80%", "React 70%" using horizontal loading bars.
*   **The Human Solution:** List the technologies cleanly. Arbitrary percentages mean nothing to clients.

**179. The Custom Cursor that Lags**
*   **The AI Tell:** A red dot cursor that follows the mouse with a 300ms delay, breaking native OS interactions.
*   **The Human Solution:** Keep the native cursor. If doing a custom cursor, make it instantly responsive (0 delay) and blend it contextually (`mix-blend-mode: difference`).

**180. The "About Me" Coffee/Pizza Joke**
*   **The AI Tell:** "Powered by coffee and pizza" in the bio.
*   **The Human Solution:** Write a professional, sharp, and unique bio that highlights real personality, not internet tropes.

**181. The Horizontal Scroll Hijack**
*   **The AI Tell:** Forcing the user to scroll vertically to make a container move horizontally, but breaking mobile UX.
*   **The Human Solution:** Only use scroll-hijacking if accompanied by a clear progress indicator, or just use native `overflow-x-scroll`.

**182. The "Dark Mode" ONLY Portfolio**
*   **The AI Tell:** The portfolio is extremely dark, full of neon purple, but lacks any actual creative work in the thumbnails.
*   **The Human Solution:** Let the work breathe. Use a light or neutral theme so the colors of the actual projects pop.

**183. The "Send me an Email" Form that doesn't work**
*   **The AI Tell:** A complex contact form that just links to `mailto:` when you click submit.
*   **The Human Solution:** Just provide the email address directly as a massive clickable link. 

**184. The "Awards" Marquee**
*   **The AI Tell:** An infinite scrolling marquee of awards that the developer hasn't actually won.
*   **The Human Solution:** Only list real accolades, and list them in a structured, static grid.

**185. The "My Services" Grid with 3 Icons**
*   **The AI Tell:** "Web Design" (Paintbrush), "Development" (Code tag), "SEO" (Rocket).
*   **The Human Solution:** Describe the exact problems you solve using bold case studies, not generic service buckets.

**186. The Image Hover "Glitch" Effect**
*   **The AI Tell:** Hovering over a portfolio project triggers a generic RGB split glitch effect.
*   **The Human Solution:** Use smooth, elegant scaling, or a subtle crossfade to a video preview.

**187. The "Loading 0 to 100%" Screen**
*   **The AI Tell:** A fake preloader that counts to 100% for 3 seconds before showing a simple static site.
*   **The Human Solution:** Remove the preloader. Optimize the code so it loads instantly.

**188. The "Follow Me" Sticky Sidebar**
*   **The AI Tell:** Social media icons floating permanently on the left side of the screen.
*   **The Human Solution:** Put social links in the footer or in a dedicated "Contact" menu.

**189. The "Projects" Carousel**
*   **The AI Tell:** Hiding the best work inside a carousel that users have to click to discover.
*   **The Human Solution:** Stack the best projects vertically. Force the user to scroll past your best work.

**190. The "Case Study" without Context**
*   **The AI Tell:** A case study page that just shows 5 screenshots of a website with no text.
*   **The Human Solution:** Explain the problem, the technical stack, the design decisions, and the business impact.

**191. The "Interactive" Canvas Background**
*   **The AI Tell:** A canvas background of dots that connect when the mouse gets near them (particles.js).
*   **The Human Solution:** Very 2014. Remove it. Use a clean, solid background.

**192. The "My Journey" Timeline**
*   **The AI Tell:** A vertical timeline starting from "Born in 1995" to "Learned React".
*   **The Human Solution:** Focus on recent, relevant professional milestones.

**193. The "Quote" from a Famous Designer**
*   **The AI Tell:** Putting a Paul Rand or Steve Jobs quote in massive text on the homepage.
*   **The Human Solution:** Use your own words to define your design philosophy.

**194. The "Coming Soon" Project Placeholder**
*   **The AI Tell:** Having 3 empty blocks in the portfolio that say "Coming Soon".
*   **The Human Solution:** Only show finished, polished work. 1 great project is better than 1 great project and 3 empty blocks.

**195. The "Resume Download" Button**
*   **The AI Tell:** A prominent button to download a PDF resume that looks completely different from the site.
*   **The Human Solution:** Make the website itself the resume. If a PDF is needed, ensure it is visually identical to the website's branding.

## J. Advanced Motion, GSAP & WebGL Tells (196-215)

**196. The "Scroll-Triggered Everything"**
*   **The AI Tell:** Every single div, text, and image fades up when scrolling into view, creating an exhausting visual noise.
*   **The Human Solution:** Only animate key elements (headers, massive images). Let body text and structural elements load naturally.

**197. The Generic Simplex Noise Shader**
*   **The AI Tell:** A WebGL canvas showing a slow-moving, trippy colored noise fluid (like the Stripe homepage circa 2020).
*   **The Human Solution:** Custom WebGL should be interactive and tied to the user's scroll or mouse velocity, not just an infinite loop.

**198. The "Spring Physics" Bounce**
*   **The AI Tell:** Using generic spring animations on buttons that bounce 5 times before settling.
*   **The Human Solution:** High-end UIs use critically damped springs (no bounce) or very subtle overshoot.

**199. The "Text Reveal" by Letter**
*   **The AI Tell:** A headline that types out letter-by-letter on scroll.
*   **The Human Solution:** Animate text by lines (using a clipping mask) or by words for a much smoother, premium feel.

**200. The Jumpy Parallax**
*   **The AI Tell:** Parallax effects that use `margin-top` or `top` in JS, causing massive stuttering.
*   **The Human Solution:** ONLY use `transform: translate3d()` or `translateY()` for hardware-accelerated animations.

**201. The "Rotate on Hover" Image**
*   **The AI Tell:** Hovering an image makes it tilt wildly using 3D perspective based on mouse coordinates.
*   **The Human Solution:** Unless done with extreme subtlety, it feels cheap. Stick to a gentle scale (`scale(1.03)`).

**202. The "Infinite Marquee" Stutter**
*   **The AI Tell:** A scrolling text marquee that jumps visibly when it resets to the beginning.
*   **The Human Solution:** Clone the content perfectly and use seamless CSS keyframes or GSAP modifiers to wrap seamlessly.

**203. The Un-synced Video Background**
*   **The AI Tell:** A video background that takes 3 seconds to load, showing a blank white box before playing.
*   **The Human Solution:** Set a high-quality `poster` image that perfectly matches the first frame of the video.

**204. The Hover State that breaks Layout**
*   **The AI Tell:** Adding a border on hover (`border: 2px solid`) that causes the entire layout to shift by 2px.
*   **The Human Solution:** Use `box-shadow: inset 0 0 0 2px` or add a transparent border by default.

**205. The Missing "Will-Change"**
*   **The AI Tell:** Complex GSAP animations that drop frames on Safari because the browser isn't prepared.
*   **The Human Solution:** Apply `will-change: transform, opacity` to elements before they animate.

**206. The "Scrubbing" Video Trap**
*   **The AI Tell:** Scrolling down scrubs a video forward, but it's low resolution and stutters between keyframes.
*   **The Human Solution:** Use an image sequence (Canvas) instead of a video file for perfect frame-by-frame scroll scrubbing.

**207. The "Cursor Follower" lagging behind**
*   **The AI Tell:** A custom cursor that loses sync with the actual system cursor during fast movements.
*   **The Human Solution:** Read mouse coordinates natively and apply transforms instantly, or don't use custom cursors.

**208. The "Hover Reveal" Z-Index Bug**
*   **The AI Tell:** Hovering a menu item reveals an image, but the image gets cut off by the section below it.
*   **The Human Solution:** Ensure the parent container has a sufficiently high `z-index` and `overflow: visible`.

**209. The "Lenis" Double Scrollbar**
*   **The AI Tell:** Implementing Lenis smooth scroll but forgetting to hide or style the native browser scrollbar.
*   **The Human Solution:** Apply the Lenis CSS reset to hide the duplicate track.

**210. The "Magnetic Button" Overshoot**
*   **The AI Tell:** Magnetic buttons that trap the mouse and refuse to let go smoothly.
*   **The Human Solution:** Only apply magnetic attraction when the mouse is very close (e.g., 20px radius) and release it naturally.

**211. The "Color Change" Flash**
*   **The AI Tell:** Changing a theme from light to dark via state, causing all elements to flash white for 1 frame.
*   **The Human Solution:** Use CSS transitions on the `body` background and color properties for smooth theme switching.

**212. The "Skeleton to Content" Jump**
*   **The AI Tell:** The skeleton loader fades out, and 0.5s later the content pops in abruptly.
*   **The Human Solution:** Crossfade the skeleton and the content seamlessly using absolute positioning.

**213. The "Accordion" Height Animation Failure**
*   **The AI Tell:** Trying to animate `height: auto`, which snaps instantly instead of animating.
*   **The Human Solution:** Animate `grid-template-rows: 0fr` to `1fr` in CSS, or use JS to measure thescrollHeight.

**214. The "Dropdown" without Exit Animation**
*   **The AI Tell:** A dropdown menu fades in beautifully, but disappears instantly when clicked outside.
*   **The Human Solution:** Always implement exit animations (e.g., using Framer Motion's `AnimatePresence`).

**215. The "Page Transition" Flash**
*   **The AI Tell:** A complex Next.js page transition that flashes the unstyled HTML for a millisecond.
*   **The Human Solution:** Wait for the new route's CSS chunks to load before unmounting the exit animation of the old route.

## K. Form, Data & Interaction UX Tells (216-235)

**216. The "Silent" Form Submission**
*   **The AI Tell:** Clicking submit freezes the button, with no spinner or text change.
*   **The Human Solution:** Always change the button text to "Submitting..." and disable the button to prevent double-clicks.

**217. The "Red Outline" Validation Abuse**
*   **The AI Tell:** Making the entire input border bright red when the user hasn't even finished typing their email.
*   **The Human Solution:** Validate `onBlur` (when the user leaves the field), not `onChange`.

**218. The "Alert()" Error**
*   **The AI Tell:** Using the native browser `alert()` pop-up to show a form error.
*   **The Human Solution:** Build a custom, elegant Toast notification system (e.g., Sonner).

**219. The "Select" without Search**
*   **The AI Tell:** A `<select>` dropdown with 200 countries, forcing the user to scroll endlessly.
*   **The Human Solution:** Implement a searchable combobox for any list longer than 15 items.

**220. The "Password Reset" Dead End**
*   **The AI Tell:** A reset form that just says "Email sent" but offers no button to return to the login page.
*   **The Human Solution:** Always provide a clear path forward ("Return to Login").

**221. The "Required Field" Asterisk Explosion**
*   **The AI Tell:** Putting a red `*` next to every single field in a form where 100% of fields are required.
*   **The Human Solution:** If all fields are required, state "All fields are required" at the top. Only mark optional fields.

**222. The "Placeholder as Label" Trap**
*   **The AI Tell:** Using the `placeholder` attribute as the only label. When the user types, the label vanishes.
*   **The Human Solution:** Use floating labels or explicit, permanent `<label>` tags above the input.

**223. The "Date Picker" for Birthdays**
*   **The AI Tell:** Forcing a user to click back through 30 years of months on a calendar UI just to enter their birthday.
*   **The Human Solution:** Use 3 simple text inputs (DD / MM / YYYY) for dates far in the past.

**224. The "Phone Number" Validation Hell**
*   **The AI Tell:** Rejecting a phone number because the user included dashes or spaces.
*   **The Human Solution:** Accept any format. Strip the non-numeric characters automatically in the backend.

**225. The "Address" Autocomplete Missing**
*   **The AI Tell:** Asking for Address Line 1, City, State, and Zip code manually without Google Maps autocomplete.
*   **The Human Solution:** Integrate an address autocomplete API to save the user 4 fields of typing.

**226. The "Credit Card" without Formatting**
*   **The AI Tell:** A card input that doesn't automatically add spaces every 4 digits.
*   **The Human Solution:** Use an input mask to format `XXXX XXXX XXXX XXXX` dynamically.

**227. The "Captcha" Interruption**
*   **The AI Tell:** Forcing the user to select traffic lights before submitting a basic contact form.
*   **The Human Solution:** Use invisible reCAPTCHA v3 or honeypot fields to trap bots without punishing humans.

**228. The "Success Page" Vacuum**
*   **The AI Tell:** A blank page that just says "Payment Successful" with no receipt or next steps.
*   **The Human Solution:** Provide a summary of what was purchased, an order number, and a clear CTA to the dashboard.

**229. The "Tooltip" on Mobile**
*   **The AI Tell:** Relying on `hover` tooltips to explain complex data, which are completely inaccessible on touch screens.
*   **The Human Solution:** Use an `(i)` icon that opens a bottom sheet or inline text on mobile.

**230. The "Infinite Loading" Table**
*   **The AI Tell:** A data table that fetches 10,000 rows at once, freezing the browser.
*   **The Human Solution:** Implement server-side pagination or virtualized scrolling (e.g., TanStack Virtual).

**231. The "Delete" without Confirmation**
*   **The AI Tell:** A red trash icon that instantly deletes a crucial database record on click.
*   **The Human Solution:** Always require a confirmation modal (or typing the item name) for destructive actions.

**232. The "Filter" without Reset**
*   **The AI Tell:** A complex sidebar of filters but no simple "Clear All Filters" button.
*   **The Human Solution:** Provide a persistent "Clear" button that appears as soon as 1 filter is active.

**233. The "Empty Search" Crash**
*   **The AI Tell:** Searching for a term with no results yields a completely blank page or a 500 error.
*   **The Human Solution:** Show a friendly "No results found for 'X'" with suggestions for popular searches.

**234. The "Tab" Trap**
*   **The AI Tell:** Pressing the `Tab` key skips important custom buttons because they were built with `<div>` instead of `<button>`.
*   **The Human Solution:** Use semantic interactive elements or explicitly add `tabindex="0"`.

**235. The "Copy to Clipboard" Mystery**
*   **The AI Tell:** Clicking a "Copy" icon does nothing visually, leaving the user wondering if it worked.
*   **The Human Solution:** Change the icon to a Checkmark and show a quick "Copied!" tooltip for 2 seconds.

## L. Mobile, Responsive & Edge-Case Architecture Tells (236-250)

**236. The "Bottom Safe Area" Ignorance**
*   **The AI Tell:** Placing a fixed button at `bottom-0`, causing it to overlap with the iPhone's home indicator bar.
*   **The Human Solution:** Always use `padding-bottom: env(safe-area-inset-bottom)`.

**237. The "Hover Menu" on Tablets**
*   **The AI Tell:** A navigation menu that requires hover, but iPad users click it and it instantly triggers the link instead of opening the sub-menu.
*   **The Human Solution:** Detect touch capabilities. On touch, the first tap opens the sub-menu, the second tap follows the link.

**238. The "Tiny Touch Target"**
*   **The AI Tell:** An "X" close button in a modal that is exactly `16x16px`.
*   **The Human Solution:** Apple Human Interface Guidelines mandate a minimum `44x44px` physical touch area.

**239. The "Horizontal Scroll" Break**
*   **The AI Tell:** A single long word or non-breaking preformatted code block causes the entire mobile page to scroll left and right.
*   **The Human Solution:** Apply `overflow-wrap: break-word` and `max-w-full overflow-hidden` to the body.

**240. The "Mobile Keyboard" Squeeze**
*   **The AI Tell:** When the mobile keyboard opens, it pushes fixed bottom headers to the middle of the screen, breaking the layout.
*   **The Human Solution:** Use `100dvh` or listen to visual viewport resizing to adjust absolute elements dynamically.

**241. The "Input Zoom" Trap**
*   **The AI Tell:** Setting the `font-size` of an input to `14px` on mobile, causing iOS Safari to aggressively zoom in when clicked.
*   **The Human Solution:** All inputs must have a font size of at least `16px` on mobile to prevent auto-zooming.

**242. The "Landscape Mode" Disaster**
*   **The AI Tell:** The mobile site looks fine in portrait, but turning the phone horizontally squishes everything into a 200px tall box.
*   **The Human Solution:** Ensure flexible grid structures that adapt to `orientation: landscape`.

**243. The "Modal Behind Modal"**
*   **The AI Tell:** Opening a dropdown menu from inside a modal causes the dropdown to render behind the modal backdrop.
*   **The Human Solution:** Use React Portals or native `<dialog>` elements to strictly manage top-layer contexts.

**244. The "Missing Active State"**
*   **The AI Tell:** Tapping a button on mobile provides no visual feedback until the next page loads.
*   **The Human Solution:** Implement CSS `:active` states (e.g., `scale: 0.98`) to provide instant haptic-like visual feedback on tap.

**245. The "Swipe Back" Breakage**
*   **The AI Tell:** Implementing a custom full-screen slider that accidentally triggers the iOS "Swipe back to previous page" gesture.
*   **The Human Solution:** Use `touch-action: pan-y` on horizontal sliders to prevent browser navigation conflicts.

**246. The "Hidden Error Message"**
*   **The AI Tell:** A form validation error appears at the very top of the page, but the user is scrolled to the bottom at the Submit button.
*   **The Human Solution:** Auto-scroll the user smoothly up to the first input field containing an error.

**247. The "Double Tap to Zoom" Interference**
*   **The AI Tell:** Fast-clicking a custom counter button triggers the browser's "double tap to zoom" accessibility feature.
*   **The Human Solution:** Apply `touch-action: manipulation` to interactive buttons.

**248. The "Desktop-only" Hover Effects on Mobile**
*   **The AI Tell:** A card requires a hover state to reveal a "Buy Now" button. On mobile, this button is impossible to access.
*   **The Human Solution:** Always expose crucial actions permanently on mobile devices.

**249. The "Notch" Overlap**
*   **The AI Tell:** A full-screen horizontal video player puts the "Back" button perfectly underneath the iPhone camera notch.
*   **The Human Solution:** Utilize `safe-area-inset-left` and `safe-area-inset-right` for absolute positioning.

**250. The "Un-cancelable" Network Request**
*   **The AI Tell:** A user navigates away from a page while a slow API request is loading, causing a React "memory leak" state update error when it finally finishes.
*   **The Human Solution:** Use `AbortController` to cancel pending fetch requests when components unmount.

**251. Iconography Hallucination (Broken SVGs)**
*   **The AI Tell:** Generating massive, complex, and often broken raw SVG paths randomly for icons in the code.
*   **The Human Solution:** ALWAYS use a human, open-source icon library that fits the DA (e.g., `lucide-react`, `phosphor-icons`, `@radix-ui/react-icons`). Import them properly and use them consistently. Never generate raw SVG paths unless it is a very specific, simple geometric shape.
