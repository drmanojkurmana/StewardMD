---
tags: [module, ios, native]
status: BUILT, NOT YET RUN ON DEVICE. Ask MaiK ships three surfaces (Paper / Night / Field) picked in Edit Widget via an `AppIntentConfiguration`; Drugs follows light/dark automatically. Swift has NOT been compiled in this session (no toolchain in the cloud container) - needs a native rebuild + reinstall before it can be called working.
flag: none - widgets are a native extension target, there is no JS flag to gate them
---
# Widgets (iOS home screen + Lock Screen)

The widget extension target `StewardMDWidget` (bundle id `in.stewardmd.app.StewardMDWidget`,
deployment target **27.0**). It reads the SAME `GlanceState` snapshot the watch reads, out of the
App Group `group.in.stewardmd.app`, so there is one source of truth across watch and phone.

Design language: `design/ASK-MAIK-WIDGET-PHILOSOPHY.md` ("Held Breath"), rendered for selection as
`design/ask-maik-widgets-variants.png` (source `design/sheet.html`, which inlines its own fonts and
the mark and renders with headless Chromium).

## Key files
- `ios/App/StewardMDWidget/AssistantWidgetViews.swift` — Ask MaiK + Drugs database. The three
  surfaces, the style picker, `CriticalParts`, `MaikPrompt`.
- `ios/App/StewardMDWidget/HomeWidgetViews.swift` — the four clinical tiles (critical labs, ICU
  watchlist, tasks, census) and `smdWatermark()`.
- `ios/App/StewardMDWidget/StewardMDWidgetsBundle.swift` — the `WidgetBundle`, `HomeGlanceProvider`
  (the shared `TimelineProvider`) and `HomeGlanceProvider.sample` (what the widget GALLERY shows).
- `Packages/StewardMDWatchCore/.../Widgets/GlanceState.swift` — the shared snapshot struct.
- `native-watch.js` — the PRODUCER. Builds the glance payload in the web app and hands it to the
  native side.
- `test/widget-critical-parse.test.mjs` — pins the `topCritical` string contract (below).

## Ask MaiK: three surfaces, chosen by the owner
`AskMaikHomeWidget` is an **`AppIntentConfiguration`**, not a `StaticConfiguration`: long-press the
widget → Edit Widget → **Style**.
- **Automatic** (default) — Paper in light appearance, Night in dark.
- **Paper** — white clinical card. Severity is a dot PLUS words, never colour alone.
- **Night** — `#0B1512`. The VALUE is the hero at 44/48pt. One red rule carries urgency.
- **Field** — the brand gradient. The severity chip is `lineLimit(1)` so it can never wrap; the mark
  is debossed at 7.5% rather than floated.

Adding a style means: a case on `MaikSurface`, a `Skin` static, and nothing else — the views branch
on `skin`, not on the enum. `Skin.heroNumeral` and `Skin.severityIsCapsule` are the only two layout
switches, so a new surface picks a layout rather than needing one.

## GOTCHA: `topCritical` is a cross-language display-string contract
`native-watch.js` builds it as

```js
top = [c0.analyte, [c0.value, c0.units].filter(Boolean).join(" "), c0.patientLabel]
        .filter(Boolean).join(" · ")     //  "K⁺ · 6.8 mmol/L · Bed 12"
```

Three middle-dot segments, not two. Swift only ever sees a `String?`, so when this shape changes
**nothing fails to compile and no test fails** — the tile just quietly stops finding a number and
falls back to the sentence. Three real bugs came out of this in one sitting:

1. The first parser read only segment 0 (`"K⁺"`), found no number, and so **never** showed a hero
   numeral on real data. It worked only against the stale gallery sample, which was the older
   two-segment shape. `HomeGlanceProvider.sample` now matches the producer.
2. Scanning every segment then promoted the **bed number**: `"Blood culture positive · Bed 4"`
   rendered a 44pt **4** as if it were a result. The last segment is the patient label, so a
   multi-segment payload is now searched everywhere EXCEPT its final segment.
3. `watchlistTop` is `[bed, name].join(" · ")` — `"Bed 12 · Ramesh K"`. Any generic parser reads
   `12` as a value. `MaikPrompt` therefore builds `CriticalParts(value:analyte:place:)` explicitly
   from the `watchlistNews` the app already published, and never parses that string.

Also: a comparator is part of the result. `"<0.01"` displayed as `"0.01"` is a different number, so
the scan tests `Double(stripped)` but keeps the ORIGINAL token for display.

`test/widget-critical-parse.test.mjs` mirrors the Swift and asserts the producer's shape from
`native-watch.js` directly. A mirror cannot prove the Swift is right; it proves the RULES are right
against the real formats, and it fails loudly if the producer moves.

## Assets
- `StewardMDMark` — the original artwork, with transparent margin. Used by `smdWatermark()` at large
  sizes where the margin does not matter.
- `StewardMDMarkTight` — the same artwork cropped to its ink and squared (329×329), added for the
  corner monogram: at 12pt the untrimmed asset renders ~8pt of mark and 4pt of nothing.

## Type
The presentation sheet is set in Bricolage Grotesque, the brand display face. The widgets use **SF
Pro** at matching weights and tracking instead — it is what iOS renders natively at widget sizes and
it avoids shipping a font resource into the extension bundle. If the brand face is ever wanted here,
it needs a TTF/OTF in the target plus `UIAppFonts` in the extension's own `Info.plist` (woff2, which
is what `assets/fonts/` ships for the web, will not load).

## Still open
- **Not compiled.** No Swift toolchain in the cloud container, so `AssistantWidgetViews.swift` has
  been checked for delimiter balance and dead references only. First real verification is a native
  rebuild. Remember CLAUDE.md: installing wipes app data, including SURGX notes.
- `ios/StewardMDWatchWidgets/GlanceProvider.swift:42` still carries the OLD two-segment sample
  string. Different target, left alone deliberately — fix it when that target is next touched.
- `Link()` is only valid in `systemMedium`/`systemLarge`; small tiles rely on `.widgetURL`. The chip
  and row views are used only on medium for that reason.

Deps: [[MaiK Ask]], [[Scan-Meds and Drug Index]], [[WardSynQ]]. Producer lives in `native-watch.js`.
