# 🎨 03. Creative Portfolios & Agency Sites

*This module covers the most experimental and boundary-pushing sector of the web. Agencies and freelancers use these sites not just to show work, but to prove technical and artistic supremacy.*

---

## 1. The "Awwwards" WebGL Immersive (The Metaverse Aesthetic)
**Psychological Intent:** Jaw-dropping technical superiority. The goal is to win design awards and attract ultra-high-budget clients by proving the agency can bend the browser to its will.

*   **Colors:** Often dark, moody, and highly saturated, relying on the lighting of the 3D scene rather than CSS background colors.
*   **Typography:** Massive, screen-filling typography that exists *inside* the 3D space, interacting with light and shadows.
*   **Spacing & Grid:** There is no grid. The entire viewport is a fluid 3D canvas.
*   **Negative Space:** Used as the "atmosphere" or "fog" within the 3D WebGL scene to create a sense of scale.
*   **Assets & Graphics:** High-poly 3D models, custom GLSL shaders (liquid distortion, particle storms, glass refraction), and dynamic lighting that reacts to the mouse position.
*   **Animations:** Entirely driven by the physics engine and the user's scroll/mouse movement. Scroll progress is mapped directly to the camera's path through the 3D space.
*   **Tech Stack:** Three.js, React Three Fiber, custom GLSL Shaders, GSAP ScrollTrigger (mapping scroll to camera `Z` axis), Lenis.

---

## 2. Neo-Brutalism (The "Anti-Design" Aesthetic)
**Psychological Intent:** Rebellion, raw authenticity, and counter-culture. A deliberate middle finger to the polished, boring corporate SaaS UI. It says, "We are artists, not corporate drones."

*   **Colors:** Harsh, uncoordinated primary colors. Pure yellow (`#FFFF00`), pure blue (`#0000FF`), and pure red (`#FF0000`) used brutally against white or black.
*   **Typography:** System fonts un-styled (Times New Roman, Arial) mixed with ultra-heavy brutalist fonts. Text is intentionally overlapping, too large, or running off the screen.
*   **Spacing & Grid:** Completely destroyed. Elements ignore padding, overlap each other maliciously, and break standard container widths.
*   **Negative Space:** Erratic. Sometimes sections are completely empty, other times they are violently cluttered.
*   **Assets & Graphics:** Thick, harsh black borders (`border: 4px solid #000`). Pixelated MS Paint-style illustrations. Exposed grid lines. High-contrast, unedited flash photography.
*   **Animations:** Jagged and raw. CSS marquees moving too fast. Hover states that invert colors instantly without any `transition` duration (0ms).
*   **Tech Stack:** Vanilla HTML/CSS (ironically), native CSS Grid, Marquee elements, CSS `mix-blend-mode: difference`.

---

## 3. Typographic Swiss (The "Grid Master" Aesthetic)
**Psychological Intent:** Extreme intellectualism, order, and timeless graphic design. Inspired by the International Typographic Style (Swiss Design) of the 1950s. It appeals to highly sophisticated branding clients.

*   **Colors:** Strictly limited. Usually Black, White, and one single punchy accent color (like International Orange `#FF4F00` or Yves Klein Blue).
*   **Typography:** The absolute star of the show. Helvetica Neue, Univers, or Neue Haas Grotesk. Typography acts as the primary visual element, replacing images.
*   **Spacing & Grid:** Mathematically perfect. A strict 12 or 16-column grid is visually exposed (you can see the lines). Everything aligns to a strict baseline.
*   **Negative Space:** Calculated and highly structured. It frames the typography like a poster.
*   **Assets & Graphics:** Zero decorative elements. Images are cropped perfectly square or rectangular and fit exactly within the grid tracks. 
*   **Animations:** Extremely understated. Text might reveal itself line by line from behind a mask (`overflow: hidden`), but movement is rigid and linear.
*   **Tech Stack:** Modern CSS Grid (`grid-template-columns`), Tailwind CSS (for strict spacing constraints), Framer Motion for highly controlled text-reveal animations.

---

## 4. The "Bento" Interactive Résumé (The "Product Designer" Aesthetic)
**Psychological Intent:** Hyper-organization, transparency, and modern product mastery. It proves the designer understands systems, components, and responsive behavior.

*   **Colors:** Muted, elegant neutrals (soft grays, off-whites) with pastel gradients inside specific cards. Often supports an immaculate Dark Mode.
*   **Typography:** Clean, geometric sans-serifs (Inter, SF Pro) with perfectly scaled hierarchy (H1 down to H6).
*   **Spacing & Grid:** A perfectly packed masonry or bento box grid. Every gap is exactly `16px` or `24px`. 
*   **Negative Space:** Confined strictly to the padding inside the individual cards.
*   **Assets & Graphics:** Highly polished Figma mockups, subtle glassmorphism (`backdrop-filter`), and animated 3D icons (Spline).
*   **Animations:** Hovering over a bento card triggers a micro-interaction (a 3D icon spins, a mockup scrolls, a video plays).
*   **Tech Stack:** CSS Grid (`grid-template-areas` for complex bento layouts), Framer Motion (for drag-to-rearrange cards), Spline (for embedded 3D assets).

---

## 5. Hyper-Minimalist (Zero-UI)
**Psychological Intent:** Supreme confidence. The agency is so good they don't need UI. The work speaks entirely for itself.

*   **Colors:** Pure white or pure black. Absolutely no UI colors.
*   **Typography:** Minuscule (10px) or invisible until hovered. 
*   **Spacing & Grid:** A single image centered perfectly on the screen.
*   **Negative Space:** 95% of the screen.
*   **Assets & Graphics:** The portfolio piece is the only visual. No navigation bars, no logos, no footers.
*   **Animations:** Smooth, imperceptible fades.
*   **Tech Stack:** Pure semantic HTML, lazy-loaded high-res imagery, invisible hot-spots for navigation.

---

## 6. Scrapbook Web Design (Tumblr Grunge)
**Psychological Intent:** Intimacy, messiness, and personal connection. It rejects the sterile corporate portfolio in favor of a teenager's diary aesthetic.

*   **Colors:** Faded, vintage colors (sepia, faded polaroid pinks).
*   **Typography:** Handwritten scripts, comic fonts, or typewriter fonts.
*   **Spacing & Grid:** Completely destroyed. Elements are rotated randomly (`transform: rotate(-3deg)`).
*   **Negative Space:** Filled with digital masking tape, scribbles, and coffee stains.
*   **Assets & Graphics:** Polaroid frames, torn paper PNGs, hand-drawn arrows.
*   **Animations:** Stop-motion effects (skipping frames to mimic physical animation).
*   **Tech Stack:** CSS `rotate`, absolute positioning, SVG `mask-image`.
