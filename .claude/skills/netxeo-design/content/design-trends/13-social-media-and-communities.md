# 💬 13. Social Media, Communities & Forums UI

*This module covers interfaces designed for human interaction. The primary goals are user retention, habit formation, and content creation (UGC). The UI must handle infinite, unpredictable data.*

---

## 1. The "Algorithmic Feed" Aesthetic (TikTok / Instagram Reels)
**Psychological Intent:** Infinite scroll, dopamine loops, and complete visual absorption. It eliminates UI friction to keep the user in a flow state.

*   **Colors:** Absolute Black (`#000000`). The UI is strictly dark mode by default because the content is primarily video. Text is pure white, with shadows to ensure it's readable over any video background.
*   **Typography:** Thick, highly legible sans-serifs (Proxima Nova, TikTok Sans). Text is kept to an absolute minimum; hashtags and brief captions only.
*   **Spacing & Grid:** Full-screen viewport. There is no grid. Each item is exactly `100dvh` and `100vw`. The UI is overlaid directly on top of the content.
*   **Negative Space:** Non-existent. The video is the space.
*   **Assets & Graphics:** User-Generated Content (UGC) video. UI icons (Like, Comment, Share) are thick, white, filled SVGs with heavy drop shadows, stacked vertically on the right edge (where the thumb naturally rests).
*   **Animations:** Physics-based vertical snapping. When a user swipes, the next video snaps into place instantly. Liking a video triggers a massive, satisfying particle explosion (hearts) in the center of the screen.
*   **Tech Stack:** React Native / Native Swift. Highly advanced video streaming (HLS), aggressive pre-caching of the next 5 videos in the feed, CSS Scroll Snapping.

---

## 2. The "Real-Time Chat" Aesthetic (Discord / Slack)
**Psychological Intent:** Utility, tribal belonging, and high-speed communication. It must handle thousands of messages a minute without overwhelming the user cognitively.

*   **Colors:** A distinct, branded dark mode (Discord's `#313338` "Not-Quite-Black"). Active channels and unread badges use highly saturated primary colors (Discord Blurple or Red).
*   **Typography:** Clean, compact sans-serifs (Whitney, gg sans). Text is dense. Usernames are bolded and color-coded based on roles.
*   **Spacing & Grid:** The classic "Three-Pane" layout. Left (Server List), Middle (Channel List), Right (Chat Canvas). Margins between messages are incredibly tight (`4px` to `8px`) to maximize data density.
*   **Negative Space:** Used only to separate structural panels. The chat itself is a wall of text.
*   **Assets & Graphics:** Custom emojis, animated GIF avatars, and sticker packs. Media (images/videos) are heavily compressed and cropped to fit within the text flow without breaking the vertical rhythm.
*   **Animations:** Instantaneous. The only animations are the subtle slide-in of a new message or the popping of a reaction emoji. Performance is prioritized over flair.
*   **Tech Stack:** Electron (for desktop apps), React, WebSockets for instant messaging, WebRTC for voice/video calls, massive database sharding (Cassandra/ScyllaDB).

---

## 3. The "Curated Forum" Aesthetic (Reddit Redesign / Hacker News)
**Psychological Intent:** Information density, debate, and crowdsourced curation. The design favors text and hierarchy over visual flash.

*   **Colors:** Utilitarian. Hacker News uses brutalist Orange (`#FF6600`) and Beige (`#F6F6EF`). Reddit uses a soft gray background with white cards to separate distinct topics.
*   **Typography:** System fonts (Arial, Verdana) or highly legible sans-serifs (IBM Plex). The font sizes are often smaller (`13px` or `14px`) to fit more headlines on a single screen.
*   **Spacing & Grid:** Dense, vertical lists. The most important metric (Upvotes) is visually separated and placed on the left edge.
*   **Negative Space:** Minimal. Threaded comments use indentation (left margins) to show hierarchy, which naturally creates a staircase of negative space on the left side of deep conversations.
*   **Assets & Graphics:** Tiny thumbnails. Text is the primary asset.
*   **Animations:** None. Fast page loads are the only requirement. Expanding/collapsing comment threads is instant.
*   **Tech Stack:** React/Next.js, complex nested recursive components (for rendering infinite comment threads), GraphQL.

---

## 4. Dating App UI (The "Tinder Swipe" Aesthetic)
**Psychological Intent:** Gamification of human connection. Rapid decision making based on pure visual impact. The interface is reduced to a binary choice.

*   **Colors:** Highly vibrant, passionate gradients. Hot Pink to Fiery Orange, set against clean white or dark gray backgrounds.
*   **Typography:** Large, bold Sans-Serifs for the name and age overlaying the bottom of the photo. Bios are secondary and often hidden.
*   **Spacing & Grid:** The "Stack of Cards" layout. A single massive card takes up 80% of the screen. Controls (X and Heart) are huge circular buttons pinned to the bottom.
*   **Negative Space:** The background behind the card is blurred or solid, forcing 100% focus on the central image.
*   **Assets & Graphics:** User photography. Massive, chunky vector icons for rejecting or accepting.
*   **Animations:** Complex touch gestures. Dragging the card left triggers a red overlay, dragging right triggers a green overlay. Releasing the card snaps it off the screen with spring physics.
*   **Tech Stack:** React Native, Hammer.js (or native gesture handlers) for complex swipe physics and rotation calculations based on finger position.
