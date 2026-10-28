# 🏢 19. Real Estate & Architecture UI

*This module covers interfaces for property search, architectural portfolios, and luxury real estate. The goal is combining massive data filtering with highly aspirational, spatial imagery.*

---

## 1. The "Zillow / Aggregator" Aesthetic
**Psychological Intent:** Infinite inventory, data comparison, and location-based decision making. It must process massive amounts of data without overwhelming the homebuyer.

*   **Colors:** Highly trustworthy blues (`#006AFF`) and stark whites. Map pins use semantic colors (Red for sold, Green for available, Purple for new).
*   **Typography:** Utilitarian, highly legible Sans-Serifs (Open Sans, Roboto). Price is the most dominant typographic element on any screen.
*   **Spacing & Grid:** The classic split-screen architecture. 50% of the screen is an interactive Mapbox/Google Map, and 50% is a scrollable grid of property cards.
*   **Negative Space:** Minimized. The UI is packed with search filters, mortgage calculators, and tags ("3 Beds, 2 Baths").
*   **Assets & Graphics:** User-generated property photos (often of varying quality). High reliance on map APIs and 3D floor plan vectors.
*   **Animations:** Smooth map clustering. As the user zooms out, 100 pins smoothly merge into a single circle labeled "100".
*   **Tech Stack:** Mapbox GL JS, WebGL for rendering thousands of map pins without crashing, React, complex URL routing (to save search states).

---

## 2. The "Luxury Architecture Portfolio" Aesthetic
**Psychological Intent:** Monumentalism, high design, and spatial awareness. The website must feel like the physical buildings the architect designs.

*   **Colors:** Raw materials. Concrete grays, stark whites, and deep blacks. Warmth comes strictly from the photography of wood or lighting in the buildings.
*   **Typography:** Architectural geometry. Very thin, extremely wide Sans-Serifs, or timeless brutalist fonts (Helvetica Neue). Text is often rotated 90 degrees or used as framing elements.
*   **Spacing & Grid:** Completely bespoke, editorial grids. Images are massive, often full-bleed.
*   **Negative Space:** Monumental. It creates a feeling of luxury and massive physical space.
*   **Assets & Graphics:** Immaculate, color-graded architectural photography (perfectly straight vertical lines). Subtle, looping drone videos of exteriors.
*   **Animations:** Extremely slow, sweeping parallax. Reveal animations that mimic curtains opening or doors sliding.
*   **Tech Stack:** GSAP ScrollTrigger, Lenis (smooth scroll), WebGL for custom image distortions or fluid transitions between pages.
