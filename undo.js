/* StewardMD — Undo instead of "Are you sure?" (window.SMD_undo).
 *
 * For a destructive action on LOCAL, restorable data: do it now, then show a Dynamic Island card with
 * an Undo button for 6 seconds. Faster than a confirm dialog and kinder when it was a slip.
 *
 *   var shown = SMD_undo.run({ message: "Antibiogram removed", perform: fn, restore: fn });
 *   // true  -> performed, undo card shown
 *   // false -> not available (card disabled / not loaded): the caller must keep its confirm() dialog
 *
 * Only for data that can be put back exactly (a snapshot taken before perform). NEVER for server
 * records, patient data or anything audited: those keep their confirmation. Kill switch: it needs
 * the dynamic card, so localStorage smd_dyn_notify=0 or smd_undo=0 returns false. */
(function () {
  "use strict";
  var seam = { ok: function (o) { return !!(o && typeof o.perform === "function" && typeof o.restore === "function" && o.message); } };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  function off() { try { return localStorage.getItem("smd_undo") === "0"; } catch (e) { return false; } }
  window.SMD_undo = {
    available: function () { var D = window.SMD_dynNotify; return !!(D && D.enabled() && !off()); },
    run: function (o) {
      if (!seam.ok(o) || !window.SMD_undo.available()) return false;
      try { o.perform(); } catch (e) { return false; }
      var undone = false;
      window.SMD_dynNotify({
        title: o.message, message: o.detail || "", symbol: "info", accent: "#FF9F0A", haptic: true, duration: o.duration || 6000,
        action: { label: "Undo", onPress: function () {
          if (undone) return; undone = true;
          try { o.restore(); } catch (e) {}
          try { window.SMD_HAPTICS && SMD_HAPTICS.success(); } catch (e) {}
        } }
      });
      return true;
    }
  };
})();
