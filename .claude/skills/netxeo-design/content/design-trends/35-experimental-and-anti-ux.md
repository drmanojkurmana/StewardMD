# 🧪 35. Experimental, Code-Art & Anti-UX

*This module covers the bleeding edge of the web. These are experiences that barely function as websites, acting instead as interactive art pieces or puzzles.*

---

## 1. The "ASCII / Terminal" Aesthetic
**Psychological Intent:** Nostalgia for the command line, extreme geek culture, and intentional difficulty.

*   **Colors:** Black background. Green or Amber text.
*   **Typography:** Strict monospace. The characters themselves form the graphics.
*   **Spacing & Grid:** A strict character grid (e.g., 80x24 characters). No pixels, only letters.
*   **Negative Space:** Filled with periods or underscores to maintain the grid.
*   **Assets & Graphics:** ASCII art (images converted into text characters).
*   **Animations:** Typewriter effects, blinking cursors.
*   **Tech Stack:** JavaScript string manipulation, Canvas API for rendering real-time ASCII video.

---

## 2. Data-Bending / Glitch Art
**Psychological Intent:** Destruction of the medium. Revealing the fragile code beneath the visual surface.

*   **Colors:** Unpredictable, corrupt hex codes. Neon greens slashing across magenta.
*   **Typography:** Font files that have been intentionally corrupted so letters render as blocky artifacts.
*   **Spacing & Grid:** Broken. Elements randomly shift `50px` to the left.
*   **Negative Space:** Filled with digital static.
*   **Assets & Graphics:** Images that look like a broken JPEG or a crashed GPU.
*   **Animations:** Stuttering, frame-dropping, random pixel sorting algorithms.
*   **Tech Stack:** Canvas API `getImageData()` to manipulate raw pixels, WebGL shaders for chromatic aberration.

---

## 3. Teletext / Videotex (1980s TV UI)
**Psychological Intent:** Extreme low-fi retro nostalgia. The era of getting news via your television set.

*   **Colors:** Only 8 standard colors (Black, White, Red, Green, Yellow, Blue, Magenta, Cyan). Absolute maximum saturation.
*   **Typography:** Blocky, low-resolution pixel fonts.
*   **Spacing & Grid:** The 40x24 character grid of 1980s television.
*   **Negative Space:** Black background.
*   **Assets & Graphics:** Pixel art created entirely out of thick rectangular blocks.
*   **Animations:** Flashing text (the original `<blink>` tag equivalent).
*   **Tech Stack:** CSS `image-rendering: pixelated;` to ensure no anti-aliasing occurs on fonts or graphics.

---

## 4. Neurodivergent-Friendly UI (Accessibility Extreme)
**Psychological Intent:** Absolute cognitive calm. Designing for users with ADHD, Autism, or sensory processing disorders.

*   **Colors:** Deeply calm pastel colors (soft creams, muted sage, lavender). Zero high-contrast neon. Dark mode is soft gray, not pure black.
*   **Typography:** OpenDyslexic, Atkinson Hyperlegible, or very clean Sans-Serifs. High line-height (`1.6+`).
*   **Spacing & Grid:** Extremely predictable. Zero overlapping elements.
*   **Negative Space:** Used to separate distinct tasks. One task per screen.
*   **Assets & Graphics:** Soft, non-distracting illustrations. Autoplay is strictly banned.
*   **Animations:** Absolutely zero unexpected animations, pop-ups, or parallax. The user triggers all motion.
*   **Tech Stack:** `prefers-reduced-motion: reduce` enforced globally. Strict WCAG AAA compliance.

---

## 5. Slow UI (Mindfulness Design)
**Psychological Intent:** Forcing the user to stop rushing. Simulating importance, luxury, or processing weight.

*   **Colors:** Muted, meditative colors.
*   **Typography:** Elegant Serifs.
*   **Spacing & Grid:** Centered, breathing layouts.
*   **Negative Space:** Vast.
*   **Assets & Graphics:** Ambient loops (water flowing, incense smoke).
*   **Animations:** Interactions are intentionally delayed. A button might take 2 full seconds to fill up before triggering an action.
*   **Tech Stack:** CSS `transition-duration: 2000ms`, GSAP with complex `ease-in-out` curves.

---

## 6. Single-Page Brutalism
**Psychological Intent:** Absolute focus on the written word. Rejection of all modern web "features".

*   **Colors:** White background, black text, blue links.
*   **Typography:** A single default system font (Times New Roman or Arial).
*   **Spacing & Grid:** One single column of text spanning `800px` max.
*   **Negative Space:** Just the left and right margins.
*   **Assets & Graphics:** None.
*   **Animations:** None.
*   **Tech Stack:** A single `index.html` file with less than 10 lines of CSS.
