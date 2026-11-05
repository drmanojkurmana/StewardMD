/* ipad-native.js: hardware-keyboard support for iPad (Magic Keyboard, Smart Keyboard, any Bluetooth keyboard), owner
 * 2026-11-04: "polish it to fit and work like a native iPad app". Runs only where the boot script in index.html put
 * html.smd-tablet (a large touch screen; kill switch localStorage smd_ipad_native=0). The layout half is ipad-native.css.
 *
 * Shortcuts (Command on iPad, Ctrl on an Android tablet keyboard):
 *   Cmd+1 .. Cmd+5   the five tab bar buttons, left to right (Home screen only, so a tab never opens over a module)
 *   Cmd+[            back one screen (the same goBack() the edge swipe uses)
 *   Cmd+,            Settings
 *   Cmd+K            Search (search.js owns it; listed here for the card only)
 *   Esc              closes the More / Display sheet and this card
 *   Cmd+/ or hold Cmd   the shortcuts card
 * Navigation only: no shortcut writes, saves, sends or deletes anything. Keys typed into a field are left alone,
 * except Cmd+[ and Cmd+, which no text field uses. */
(function () {
  "use strict";
  var seam = { keyAction: keyAction, SHORTCUTS: null };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!document.documentElement.classList.contains("smd-tablet")) return;

  var SHORTCUTS = [
    ["Search", "⌘ K"],
    ["Back", "⌘ ["],
    ["Settings", "⌘ ,"],
    ["Tab bar: Hospital, Cases, Ask Maik, Drugs, More", "⌘ 1 to 5"],
    ["Close a sheet", "Esc"],
    ["Show these shortcuts", "⌘ /"]
  ];
  seam.SHORTCUTS = SHORTCUTS;

  function typing(t) {
    if (!t || !t.tagName) return false;
    var n = t.tagName;
    return n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || !!t.isContentEditable;
  }

  /* Pure: which action a keydown asks for, or null. Exposed for the unit test. */
  function keyAction(e, ctx) {
    ctx = ctx || {};
    if (!e || e.isComposing || e.altKey) return null;
    var cmd = !!(e.metaKey || e.ctrlKey), k = e.key;
    if (cmd && !e.shiftKey && (k === "/" || k === "?")) return "help";
    if (cmd && !e.shiftKey && k === "[") return "back";
    if (cmd && !e.shiftKey && k === ",") return "settings";
    if (!cmd && k === "Escape" && !e.shiftKey) return ctx.helpOpen ? "help-close" : (ctx.sheetOpen ? "sheet-close" : null);
    if (ctx.typing) return null;
    if (cmd && !e.shiftKey && /^[1-5]$/.test(k)) return "tab" + k;
    return null;
  }

  function sheetOpen() { var s = document.getElementById("hvSheet"); return !!(s && s.classList.contains("on")); }
  function homeFront() {
    try { var sb = window.SMD_SWIPE_BACK; if (sb && sb.canGoBack) return !sb.canGoBack(); } catch (e) {}
    return false;
  }

  var help = null, lastFocus = null;
  function helpOpen() { return !!(help && !help.hidden); }
  function showHelp(on) {
    if (!help) {
      if (!on) return;
      help = document.createElement("div");
      help.id = "smdKeyHelp"; help.hidden = true;
      help.setAttribute("role", "dialog"); help.setAttribute("aria-modal", "true"); help.setAttribute("aria-label", "Keyboard shortcuts");
      var html = '<div class="kh-card" tabindex="-1"><h2>Keyboard shortcuts</h2>';
      for (var i = 0; i < SHORTCUTS.length; i++) html += '<div class="kh-row"><span>' + SHORTCUTS[i][0] + '</span><kbd>' + SHORTCUTS[i][1] + '</kbd></div>';
      help.innerHTML = html + "</div>";
      help.addEventListener("click", function (e) { if (e.target === help) showHelp(false); });
      document.body.appendChild(help);
    }
    if (on === helpOpen()) return;
    help.hidden = !on;
    if (on) { lastFocus = document.activeElement; try { help.firstChild.focus({ preventScroll: true }); } catch (e) {} }
    else if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} lastFocus = null; }
  }

  function run(a) {
    if (a === "help") { byHold = false; showHelp(!helpOpen()); return true; }
    if (a === "help-close") { showHelp(false); return true; }
    if (a === "sheet-close") { var sc = document.getElementById("hvScrim"); if (sc) { sc.click(); return true; } return false; }
    if (a === "back") { try { var sb = window.SMD_SWIPE_BACK; if (sb && sb.goBack) { sb.goBack(); return true; } } catch (e) {} return false; }
    if (a === "settings") { if (typeof window.SMD_openSettings === "function") { if (sheetOpen()) run("sheet-close"); window.SMD_openSettings(); return true; } return false; }
    if (a.indexOf("tab") === 0) {
      if (!homeFront()) return false;
      var tabs = document.querySelectorAll("#homeV2 .rnav-tabbar .rnav-tab"), b = tabs[+a.slice(3) - 1];
      if (b) { b.click(); return true; }
    }
    return false;
  }

  // Hold Command for a moment with no other key: the iPadOS gesture for "what can I press here".
  var holdT = 0, byHold = false;
  function cancelHold() { if (holdT) { clearTimeout(holdT); holdT = 0; } }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Meta") { cancelHold(); if (!e.repeat) holdT = setTimeout(function () { holdT = 0; if (!helpOpen()) { byHold = true; showHelp(true); } }, 900); return; }
    cancelHold();
    if (e.defaultPrevented) return;
    var a = keyAction(e, { typing: typing(e.target), sheetOpen: sheetOpen(), helpOpen: helpOpen() });
    if (a && run(a)) e.preventDefault();
  });
  document.addEventListener("keyup", function (e) {
    if (e.key === "Meta") { cancelHold(); if (byHold) { byHold = false; showHelp(false); } }
  });
  window.addEventListener("blur", cancelHold);

  window.SMD_IPAD = { showShortcuts: function () { showHelp(true); }, keyAction: keyAction };
})();
