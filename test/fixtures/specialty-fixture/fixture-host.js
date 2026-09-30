/* Fixture host for the specialty engine UI test: every feature on, a two-case clinic plugin, the fixture models.
   Not clinical content. */
(function (G) {
  "use strict";
  var SP = G.SPECIALTY;
  var host = SP.createHost({
    id: "fixture", global: "FIXTURE", base: "/test/fixtures/specialty-fixture/", rootId: "smdFixture", rootClass: "fx-root",
    storeKey: "smd_fixture_v1", prefKey: "smd_fixture_prefs", flag: "smd_fixture",
    title: { en: "Fixture", hi: "फ़िक्स्चर" }, subtitle: { en: "Engine test specialty", hi: "इंजन परीक्षण विषय" },
    levels: { free: ["mbbs"] }, proFeature: "fixture", models: "FIXTURE_MODELS", draft: true
  });
  SP.features.learn(host); SP.features.bank(host); SP.features.explore(host); SP.features.tools(host); SP.features.drills(host); SP.features.notes(host);
  host.registerClinic({
    id: "cases", title: { en: "Fixture clinic", hi: "फ़िक्स्चर क्लिनिक" }, sub: { en: "Two kinds of case", hi: "दो तरह के केस" }, icon: "pulse", deck: "decks/cases.json",
    render: function (h, item, done) {
      var I = h._internal;
      h._st.again = function () { h.registerClinic; I.paint(I.top("Back", I.tx(item.c.label), "", I.langBtn()) + '<div class="sp-scroll sp-pad"><p class="fx-case">' + I.tx(item.c.label) + '</p><button type="button" class="sp-btn pri sp-wide" data-act="fxdone">Done</button></div>'); };
      I.ACTIONS.fxdone = function () { I.save(); done(); };
      h._st.again();
    }
  });
  host.registerExplorer({ id: "fx-explore", title: { en: "Fixture explorer", hi: "फ़िक्स्चर एक्सप्लोरर" }, line: { en: "Tap the box", hi: "बॉक्स छुएँ" }, lesson: "fx-one", test: { mcqTopic: "fx-a" },
    open: function (h, x) { h._exploreUI.frame(x.id, '<button type="button" class="sp-btn sec" data-act="fxtap" id="fxTap">Tap</button>'); h._internal.ACTIONS.fxtap = function () { h._exploreUI.mark(x.id); }; } });
})(window);
