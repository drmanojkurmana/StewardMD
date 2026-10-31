# 📊 07. Dashboards & Data Visualization

*This module covers interfaces where data density and cognitive load management are the absolute priorities. These interfaces range from financial trading to consumer fitness tracking.*

---

## 1. B2B Analytics (The "Stripe" Dashboard)
**Psychological Intent:** Clarity, calm, and financial trust. The user needs to understand complex data at a glance without feeling overwhelmed or anxious.

*   **Colors:** Soft, cool grays (`#F7F9FC`) for backgrounds to reduce eye strain over 8-hour sessions. Pure white cards (`#FFFFFF`) for data containers. Primary actions and charts use a highly legible, vibrant blue (`#635BFF`) or green for positive metrics.
*   **Typography:** Geometric sans-serifs (Inter, Roboto) optimized for numbers. All numbers must use "tabular figures" (`font-variant-numeric: tabular-nums`) so that data columns align perfectly on the decimal point.
*   **Spacing & Grid:** Expansive 12-column grids with massive padding inside the data cards (`24px - 32px`). 
*   **Negative Space:** Used surgically to separate different chart types and prevent data bleeding.
*   **Assets & Graphics:** Soft drop shadows (`box-shadow: 0 4px 6px rgba(0,0,0,0.05)`) to elevate data cards off the background.
*   **Animations:** Smooth, easing chart reveals (e.g., bar charts growing from `0` to their value on load over `800ms`).
*   **Tech Stack:** React, Recharts / D3.js (for SVG-based data viz), CSS Grid.

---

## 2. Developer / Terminal Dashboard (Linear / Vercel style)
**Psychological Intent:** Absolute speed, efficiency, and keyboard-first navigation. Designed for power users who hate marketing fluff.

*   **Colors:** Deep obsidian dark mode (`#000000` to `#111111`). Text is high-contrast white. Accents are glowing cyan or purple.
*   **Typography:** Sans-serifs mixed heavily with Monospace fonts (Fira Code) for IDs, hashes, and code blocks.
*   **Spacing & Grid:** Extremely dense. 1px borders separate everything. Cards often touch each other directly in a masonry or split-pane layout.
*   **Negative Space:** Minimal. The screen is packed with actionable tables and command palettes.
*   **Assets & Graphics:** Glowing radial gradients mimicking cursor tracking. SVG icons are thin (1.5px stroke) and sharp.
*   **Animations:** Instant. Hover states change background colors in `<100ms`.
*   **Tech Stack:** Tailwind CSS, Framer Motion (for rapid layout shifts).

---

## 3. Gamified / Consumer Dashboard (Duolingo / Strava)
**Psychological Intent:** Habit building, dopamine hits, and friendly encouragement. Data is simplified to spark joy rather than provide deep analytics.

*   **Colors:** Bright, highly saturated primary colors. Orange (fire/streaks), Green (success), and Yellow (gold/rewards).
*   **Typography:** Thick, rounded sans-serifs (Varela Round) that feel bouncy and approachable.
*   **Spacing & Grid:** Chunky, oversized elements. Massive buttons with thick borders and heavy shadows (`box-shadow: 0px 4px 0px #CCCCCC`).
*   **Negative Space:** Generous, to keep the cognitive load extremely low (often only 1 or 2 metrics shown at a time).
*   **Assets & Graphics:** Circular progress bars (rings), fire emojis, animated mascots, and unlockable badges.
*   **Animations:** Bouncy spring physics (`stiffness: 300, damping: 15`). Progress bars fill up dynamically with a satisfying sound.
*   **Tech Stack:** SVG path animations (`stroke-dashoffset` for drawing circular rings), CSS spring animations.

---

## 4. Bloomberg Terminal (Hyper-Data Fintech)
**Psychological Intent:** Raw, unfiltered data dominance. For Wall Street traders who need to process thousands of variables a second. Scrolling is considered inefficient.

*   **Colors:** Pitch black background (`#000000`). Text is pure, blinding neon: Green (`#00FF00`) for gains, Red (`#FF0000`) for losses, and Yellow (`#FFFF00`) for neutral data. 
*   **Typography:** Dense, tiny (`11px` or `12px`), un-aliased monospace or highly legible system fonts.
*   **Spacing & Grid:** Completely packed. The screen is split into dozens of tiny interlocking rectangular windows (tiles).
*   **Negative Space:** Eradicated completely. Every pixel must display a number or a chart.
*   **Assets & Graphics:** Highly complex candlestick charts, depth-of-market graphs. No borders, just colored text acting as separators.
*   **Animations:** Flashing text (prices blinking yellow when updating).
*   **Tech Stack:** WebSockets (handling 1000+ messages per second), Canvas API or WebGL for rendering thousands of chart points without DOM lag.

---

## 5. Minimalist Data-Viz
**Psychological Intent:** Academic calm, high intellectualism, and artistic data representation. 

*   **Colors:** Dark, muted backgrounds (deep navy or charcoal) with very slow-moving, elegant lines in pale gold, white, or cyan.
*   **Typography:** Very small, elegant Serifs or thin Sans-Serifs. Often rotated 90 degrees for axis labels.
*   **Spacing & Grid:** A massive, single chart taking up the entire screen.
*   **Negative Space:** Vast. The data points float in an ocean of emptiness.
*   **Assets & Graphics:** Very thin (`0.5px`) SVG lines, scatter plots that look like starfields.
*   **Animations:** Incredibly slow, hypnotic bezier curve morphing.
*   **Tech Stack:** D3.js, GSAP.

---

## 6. Super App Dashboard (WeChat / Grab)
**Psychological Intent:** Utilitarian maximalism. Putting 50 different apps into one single screen so the user never has to leave the ecosystem.

*   **Colors:** Highly vibrant. The top half is usually a solid brand color (Green or Red) containing the user's wallet balance.
*   **Typography:** Dense, localized fonts. Icon labels are tiny to fit within the grid.
*   **Spacing & Grid:** The "Massive Icon Grid". A 4x4 or 5x5 grid of highly colorful, distinct icons dominating the top half of the screen.
*   **Negative Space:** Very tight.
*   **Assets & Graphics:** Highly detailed 3D or flat vector icons for every mini-app (Ride, Food, Pay, Chat).
*   **Animations:** Horizontal swiping between different grids.
*   **Tech Stack:** React Native, CSS Grid, Horizontal scroll-snapping.

---

## 7. TUI (Text-Based User Interface)
**Psychological Intent:** Hacker nostalgia, absolute zero bloat, keyboard-only speed.

*   **Colors:** Black background. 16 ANSI colors (Cyan, Magenta, Yellow, Blue, Green, Red, White, Black).
*   **Typography:** Strict monospace.
*   **Spacing & Grid:** 80x24 character grid. Borders are drawn using ASCII box-drawing characters (`┌ ─ ┐ │ └ ┘`).
*   **Negative Space:** Filled with blank spaces or periods.
*   **Assets & Graphics:** Bar charts built out of block characters (`█ ▆ ▄ ▂`).
*   **Animations:** Blinking cursors.
*   **Tech Stack:** HTML/CSS mapping to a monospace grid.
