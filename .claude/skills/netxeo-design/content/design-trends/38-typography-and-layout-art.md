# 📐 38. Typography, Grids & Generative Art

*This module covers extreme structural layouts, algorithmic design, and typography as the primary artistic medium.*

---

## 1. Typographic Brutalism
**Psychological Intent:** Aggressive, loud, unapologetic.
*   **Colors:** High contrast (Black/White, Black/Yellow).
*   **Typography:** Massive, stretched, or condensed fonts.
*   **Spacing & Grid:** The text fills 100% of the viewport, pushing all images out of frame.
*   **Negative Space:** Non-existent. Letters touch the edges of the screen.
*   **Assets & Graphics:** None. Text is the only graphic.
*   **Animations:** Marquee scrolling at high speeds.
*   **Tech Stack:** CSS `font-size: 20vw; line-height: 0.8`.

## 2. Kinetic Typography (3D)
**Psychological Intent:** Hypnotic, technological mastery.
*   **Colors:** Monochrome or glowing gradients.
*   **Typography:** Bold sans-serifs.
*   **Spacing & Grid:** Infinite 3D space.
*   **Negative Space:** The core of the 3D shapes.
*   **Assets & Graphics:** Words twisting, bending, and rotating into 3D objects (DNA helixes, Mobius strips).
*   **Animations:** Constant infinite looping rotation.
*   **Tech Stack:** Three.js wrapping text around cylinder geometries.

## 3. Brutalist Kinetic Typography
**Psychological Intent:** Chaos, interactive aggression.
*   **Colors:** Pure Red background, Black text.
*   **Typography:** Heavy, blocky.
*   **Spacing & Grid:** Broken grids.
*   **Negative Space:** Dynamic based on mouse movement.
*   **Assets & Graphics:** Massive text that spins, scrolls, or violently scatters when the user's mouse touches it.
*   **Animations:** Physics-based collisions.
*   **Tech Stack:** Matter.js for 2D physics text collisions.

## 4. Swiss Punk (Wolfgang Weingart)
**Psychological Intent:** Rebellion against perfection, complex depth.
*   **Colors:** Grayscale with single pop colors (CMYK cyan/magenta).
*   **Typography:** Helvetica, but distorted and layered.
*   **Spacing & Grid:** Taking the strict Swiss grid and violently breaking it. Overlapping text.
*   **Negative Space:** Dense, cluttered but with purpose.
*   **Assets & Graphics:** Halftone dots, arrows, torn edges.
*   **Animations:** Jittery scrolling.
*   **Tech Stack:** CSS Grid with overlapping grid-areas (`grid-row: 1 / 3`).

## 5. Letterpress Printing
**Psychological Intent:** Heritage, tactile craftsmanship, luxury.
*   **Colors:** Thick cream cotton paper, deep navy or black ink.
*   **Typography:** Classic Serifs (Garamond, Caslon).
*   **Spacing & Grid:** Highly structured, centered.
*   **Negative Space:** Emphasizes the texture of the paper.
*   **Assets & Graphics:** Deep physical debossing (pressed into the paper). Slight vintage ink spread around the letters.
*   **Animations:** None.
*   **Tech Stack:** CSS `text-shadow: 0px 1px 1px rgba(255,255,255,0.5), inset...`.

## 6. Generative / Algorithmic Art
**Psychological Intent:** Infinite complexity, man vs machine.
*   **Colors:** High contrast or calculated HSL spectrums.
*   **Typography:** Minimal UI overlay.
*   **Spacing & Grid:** Mathematical chaos (fractals, boids).
*   **Negative Space:** Dictated by the algorithm.
*   **Assets & Graphics:** Infinite chaotic lines or fluid dynamics that never repeat.
*   **Animations:** Real-time generation.
*   **Tech Stack:** p5.js, Canvas API.

## 7. Tessellation (Escher)
**Psychological Intent:** Infinite loops, mathematical paradoxes.
*   **Colors:** Alternating contrasting colors.
*   **Typography:** Clean, out of the way.
*   **Spacing & Grid:** Perfect interlocking geometry.
*   **Negative Space:** Zero. Every negative space forms the positive space of the next object.
*   **Assets & Graphics:** Interlocking shapes (birds, fish, cubes).
*   **Animations:** Infinite zooming or panning.
*   **Tech Stack:** SVG repeating patterns perfectly calculated.

## 8. Voronoi Patterns
**Psychological Intent:** Organic biology, cellular growth.
*   **Colors:** Bioluminescent neon or stark white webbings.
*   **Typography:** Thin, scientific.
*   **Spacing & Grid:** Cellular, fractured polygons.
*   **Negative Space:** The empty cells within the web.
*   **Assets & Graphics:** Structures that look like cracked dry earth or dragonfly wings.
*   **Animations:** Cells expanding and merging on hover.
*   **Tech Stack:** D3.js Voronoi algorithms.

## 9. Parametric Typography
**Psychological Intent:** Living data, environmental reactivity.
*   **Colors:** Dynamic.
*   **Typography:** Variable fonts (`font-variation-settings`).
*   **Spacing & Grid:** Fluid text wrapping.
*   **Negative Space:** Breathes with the text.
*   **Assets & Graphics:** Fonts that dynamically change weight, serif length, and shape based on mouse movement or scroll velocity.
*   **Animations:** Smooth interpolation of font weights.
*   **Tech Stack:** CSS Variable Fonts (`@font-face` with `wght`, `wdth` axes).
