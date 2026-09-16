/* test/ward-ask-autoanswer.js - for the ward harnesses written when ward.js asked with window.prompt / window.confirm.
 *
 * Retest 2026-09-16: ward.js asks on the ward itself (askFor, st.ask) instead of a browser dialog. The harnesses kept
 * their prompt and confirm stubs as the "person" answering; this answers the IN-APP question with them, through the
 * dialog's own controls, the way a person would: every field is typed from window.prompt(<its label>) in order (a
 * select takes the matching option, "y"/"n" meaning Yes/No), a question with no fields asks window.confirm(<title>),
 * then the dialog's own OK or Cancel is clicked. A prompt answering null cancels. Nothing in ward.js is bypassed: an
 * empty required field is refused by the dialog, and the write is the one its OK button sends.
 */
(function () {
  function answer() {
    var W = window.WARD, a = W && W._st && W._st.ask;
    // A runner that answers the dialog itself (run-ward-clinical-forms-ui.mjs) turns this off.
    if (!a || a.__autoAnswered || window.__noAutoAnswer) return;
    var box = document.querySelector("#smdWard .w-ask");
    if (!box) return;
    a.__autoAnswered = true;
    var btn = function (act) { var b = box.querySelector('[data-w-act="' + act + '"]'); if (b) b.click(); };
    var fields = box.querySelectorAll("[data-w-ask]");
    if (!fields.length) { btn(window.confirm(box.querySelector("h3").textContent) ? "askok" : "askcancel"); return; }
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], label = f.closest("label") ? f.closest("label").querySelector("span").textContent : "";
      var v = window.prompt(label);
      if (v === null || v === undefined) { btn("askcancel"); return; }
      v = String(v);
      if (f.tagName === "SELECT") {
        var has = Array.prototype.some.call(f.options, function (o) { return o.value === v; });
        if (!has) v = /^y/i.test(v) ? "yes" : /^n/i.test(v) ? "no" : v.trim().toLowerCase();
      }
      f.value = v;
      f.dispatchEvent(new Event("input", { bubbles: true }));
      f.dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn("askok");
  }
  new MutationObserver(function () { setTimeout(answer, 0); }).observe(document.documentElement, { childList: true, subtree: true });
})();
