# 🎞️ 41. Video & Motion Techniques

*This module translates specific film, animation, and optical techniques into UI and interactive constraints.*

---

## 1. Liquid Motion
**Psychological Intent:** Organic fluidity, mesmerism.
*   **Colors:** Solid, highly contrasting colors.
*   **Typography:** Bubbly.
*   **Spacing & Grid:** Fluid, breaking out of boxes.
*   **Negative Space:** The liquid fills it.
*   **Assets & Graphics:** 2D frame-by-frame animation where everything morphs organically (splashing water, slime).
*   **Animations:** Morphing SVGs, gooey effects.
*   **Tech Stack:** SVG `feGaussianBlur` + `feColorMatrix` for gooey menus.

## 2. Stop Motion / Cut-out
**Psychological Intent:** Handmade charm, physical imperfection.
*   **Colors:** Paper textures, craft colors.
*   **Typography:** Ransom note or stamped letters.
*   **Spacing & Grid:** Layered physical paper.
*   **Negative Space:** Casts physical drop shadows.
*   **Assets & Graphics:** Visible paper textures, slight lighting flickers.
*   **Animations:** Choppy frame rates (12fps), no smooth interpolation.
*   **Tech Stack:** CSS `steps()` timing function instead of `ease`.

## 3. Rubber Hose Animation
**Psychological Intent:** 1930s surreal nostalgia, slightly creepy.
*   **Colors:** High contrast black and white (or muted vintage colors).
*   **Typography:** 1930s title cards.
*   **Spacing & Grid:** Centered, theatrical.
*   **Negative Space:** Film grain.
*   **Assets & Graphics:** Characters with pie-cut eyes, bouncing limbs without joints.
*   **Animations:** Constant bouncing to a 4/4 rhythm.
*   **Tech Stack:** CSS looping keyframes.

## 4. Glitch / MTV Bumper
**Psychological Intent:** Teenage rebellion, raw energy.
*   **Colors:** Clashing neons, static grayscale.
*   **Typography:** Ransom note, jagged.
*   **Spacing & Grid:** Rapid-fire editing, chaotic overlapping.
*   **Negative Space:** Filled with VHS static.
*   **Assets & Graphics:** Mixed media, flashing colors, pop art cutouts.
*   **Animations:** Sub-1-second flash cuts.
*   **Tech Stack:** JavaScript interval flashing.

## 5. Cinemagraph
**Psychological Intent:** Subtle magic, endless loops.
*   **Colors:** Cinematic color grading.
*   **Typography:** Elegant, minimal overlay.
*   **Spacing & Grid:** Full-screen photography.
*   **Negative Space:** The frozen parts of the image.
*   **Assets & Graphics:** A still photograph where one minor, repeated movement occurs (flickering candle, flowing water).
*   **Animations:** Endless looping video mask over a still image.
*   **Tech Stack:** HTML5 `<video>` looped underneath a static PNG mask.

## 6. Datamoshing
**Psychological Intent:** Digital corruption, melting reality.
*   **Colors:** Smearing, bleeding pixels.
*   **Typography:** Glitch text.
*   **Spacing & Grid:** Melting transitions between sections.
*   **Negative Space:** Glitched motion vectors.
*   **Assets & Graphics:** Video compression artifacts used intentionally as transitions.
*   **Animations:** Scenes bleeding into the next scene instead of cutting.
*   **Tech Stack:** WebGL displacement shaders.

## 7. Neon Noir / Cyberpunk Film
**Psychological Intent:** Gritty future, isolation in a crowd.
*   **Colors:** Wet asphalt, magenta, cyan.
*   **Typography:** High-tech HUD fonts.
*   **Spacing & Grid:** Widescreen cinematic.
*   **Negative Space:** Deep black shadows.
*   **Assets & Graphics:** High-contrast neon reflections, rain, anamorphic lens flares.
*   **Animations:** Slow pans, flickering neon.
*   **Tech Stack:** CSS `mix-blend-mode: screen`.

## 8. Found Footage / Analog Horror
**Psychological Intent:** Dread, realism, the uncanny valley.
*   **Colors:** Desaturated, green tints, VHS tracking lines.
*   **Typography:** VCR OSD Mono.
*   **Spacing & Grid:** Hand-held camera shake.
*   **Negative Space:** Pure black voids hiding anomalies.
*   **Assets & Graphics:** Heavily degraded VHS filters, stark realism contrasting with terrifying anomalies.
*   **Animations:** Sudden audio peaking, tape glitches.
*   **Tech Stack:** CSS SVG noise filters.

## 9. Motion Comics
**Psychological Intent:** Bringing static art to life dynamically.
*   **Colors:** Comic book halftones.
*   **Typography:** Speech bubbles.
*   **Spacing & Grid:** Comic panels that expand on scroll.
*   **Negative Space:** Gutter space between panels.
*   **Assets & Graphics:** 2D comic panels with slight parallax panning and puppet-pin animation.
*   **Animations:** Scroll-triggered panel reveals.
*   **Tech Stack:** GSAP ScrollTrigger.

## 10. French New Wave (Nouvelle Vague)
**Psychological Intent:** Existentialism, breaking the fourth wall.
*   **Colors:** Gritty black and white.
*   **Typography:** Typewriter fonts.
*   **Spacing & Grid:** Unconventional, off-center.
*   **Negative Space:** Cigarette smoke.
*   **Assets & Graphics:** Hand-held camera aesthetics, raw realism.
*   **Animations:** Jarring jump cuts.
*   **Tech Stack:** Immediate CSS state changes (no transitions).

## 11. Light Painting
**Psychological Intent:** Magical trails, capturing time.
*   **Colors:** Blinding white cores with neon edges.
*   **Typography:** Written with "light" cursors.
*   **Spacing & Grid:** Dark voids.
*   **Negative Space:** Pitch black night.
*   **Assets & Graphics:** Long exposure photography trails.
*   **Animations:** Drawing lines over time.
*   **Tech Stack:** Canvas API cursor trails.
