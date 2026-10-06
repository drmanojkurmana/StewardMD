---
tags: [module, settings, ui]
---
# Settings

Settings has a scoped presentation refresh that preserves StewardMD’s existing theme, fonts, teal accent, saved preferences and clinical behavior. It does not introduce a new global design system.

## Architecture and rollback

- `sidebar-redesign.js` remains the Settings and Experimental page builder and action/toggle owner (`SMD_openSettings`, `SMD_openExperimental`, `SMD_SETTINGS_INDEX`).
- `settings-ui.js` exports `SMD_SETTINGS_UI.enhance(root)` and `enabled()`. It rearranges existing control nodes after page construction, before module wiring, without cloning controls or replacing persistence handlers.
- `settings-ui.css` styles enhanced overlays and the Display sheet; `index.html` loads it and the enhancer before `sidebar-redesign.js`.
- `home.js` retains Display & Accessibility settings, persistence, reset and application to the app.

The local-storage flag `smd_settings_redesign` is **default ON**. Set it to the string `0` and reopen Settings (or reload) to disable the enhancement; remove the key to restore the default. This is a presentation kill switch, not a rollback of all surrounding navigation fixes.

## Grouping and discovery

Existing sections become labeled groups with an All/category selector. AI model rows move into **AI & voice** and use native `details` disclosures. Experimental’s duplicate quick toggles are removed from the enhanced main page; its dedicated page keeps the canonical controls and access notices.

Search matches whole sections, including model text, indexed Experimental feature names and Display keywords. A match reveals the section and opens its disclosures. Clearing search restores their previous open state; selecting a category clears the query. Results are announced through a polite status region, including an explicit empty state. Category/query state survives reconstruction during the current page session; it is not saved as a user preference.

Display keeps common controls visible and puts MaiK background/motion controls in a disclosure. Selected Display options expose `aria-pressed`. Layout retains saved theme/font choices, wraps option groups, provides visible focus treatment, respects reduced motion and includes bottom safe-area padding.

## Navigation and focus

Settings and Experimental expose dialog labels, focus their Back control, wrap keyboard Tab navigation and support Escape. Escape in a nonempty search first clears the query. Closing Experimental restores its connected opener; closing Settings restores its opener or the Home menu fallback.

Display opened from Settings receives an `onClose` callback and a **Back to Settings** control. Closing the sheet recreates Settings with its retained category/query. Display opened independently uses **Done**. Other destinations continue through their existing module navigation; this refresh does not add a universal return stack.

## Preserved ownership

The original builders and modules still own saved keys/defaults, model selection/download logic, notification permissions, OTA actions, native companion behavior, authentication, owner-only rows and experimental access gates. Clinical draft notices and reload requirements remain part of those controls. Search only indexes navigation text; it does not grant feature access or change clinical content. See [[OTA Updates]], [[Push]], [[Flags]] and [[AI Control Center]].

## Verification and platform limits

Run from the repository root:

```sh
node --check settings-ui.js
node --check sidebar-redesign.js
node --check home.js
node test/run-settings-ota.mjs
node test/run-display-scale.mjs
node test/watch-settings.test.mjs
node test/image-engine-local.test.mjs
```

The browser harnesses require Chrome and a Node runtime with global WebSocket support; they start their local server when needed. Record the actual pass/fail results in the delivery report rather than interpreting this command list as a completed test run.

The existing `test/run-graphite-dark-ui.mjs` harness has a syntax issue that prevents its intended check; its failure is not evidence of a Settings rendering regression. Browser inspection cannot establish native permission prompts, haptic output, Apple Watch/Wear OS pairing, on-device model execution or native update behavior. No physical native-device testing was performed for this refresh; those platform paths retain their existing implementation and require device verification separately.
