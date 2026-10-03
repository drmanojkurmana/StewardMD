// privacy-mode.js (plan B2): the pure masks, the render wrapper, and the session / kill-switch state.
// Every name and number here is invented for the test; none is a real patient.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../privacy-mode.js", import.meta.url), "utf8");
const DOTS = "••••";

function store(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
// No document: the module still exposes its pure API and state, it just paints nothing.
function load({ local, session } = {}) {
  const window = { localStorage: store(local), sessionStorage: store(session) };
  vm.runInNewContext(SRC, { window });
  return window.SMD_PRIVACY_MODE;
}
const P = load();

test("names become initials: first and last word only, titles dropped", () => {
  assert.equal(P.maskName("Testa Patientkumar"), "T. P.");
  assert.equal(P.maskName("testa"), "T.");
  assert.equal(P.maskName("Alpha Beta Gamma Delta Epsilon"), "A. E.", "a long name never spells itself out");
  assert.equal(P.maskName("Mr. Testa Patientkumar"), "T. P.");
  assert.equal(P.maskName("Smt Dummy Devi"), "D. D.");
  assert.equal(P.maskName("B/O Dummymother"), "D.", "baby-of prefix is not the name");
  assert.equal(P.maskName("Baby of Dummymother"), "O. D.");
  assert.equal(P.maskName("Dr"), "D.", "a name that is only a title still masks, never echoes");
  assert.equal(P.maskName("O'Testa Fakename"), "O. F.");
  assert.equal(P.maskName("Annex-Mariex Fakefox"), "A. F.");
  assert.equal(P.maskName("  FAKE   NAME  "), "F. N.");
});

test("names: empty, non-Latin scripts and junk", () => {
  assert.equal(P.maskName(""), "");
  assert.equal(P.maskName(null), "");
  assert.equal(P.maskName(undefined), "");
  assert.equal(P.maskName("   "), "");
  assert.equal(P.maskName("रवि कुमार"), "र. क.", "Devanagari");
  assert.equal(P.maskName("రవి కుమార్"), "ర. క.", "Telugu");
  assert.equal(P.maskName("王小明"), "王.", "CJK without spaces");
  assert.equal(P.maskName("محمد علي"), "م. ع.", "Arabic");
  assert.equal(P.maskName("𠜎一 二"), "𠜎. 二.", "an astral character is never split in half");
  assert.equal(P.maskName("---"), DOTS, "no letters: dots, never the input");
  assert.equal(P.maskName("12345"), DOTS, "a number in a name field is not echoed");
  assert.equal(P.maskName("<img src=x>"), "I. S.", "markup in a name is masked like any word");
});

test("hospital IDs keep at most the last 4, fewer as they get shorter, none when very short", () => {
  assert.equal(P.maskId("UHID20269990001"), DOTS + " 0001");
  assert.equal(P.maskId("MR99990001"), DOTS + " 0001");
  assert.equal(P.maskId("99-9999-9999-0001"), DOTS + " 0001", "ABHA-shaped, separators ignored");
  assert.equal(P.maskId("FAKE0001"), DOTS + " 01");
  assert.equal(P.maskId("FAK0001"), DOTS + " 01");
  assert.equal(P.maskId("999901"), DOTS);
  assert.equal(P.maskId("42"), DOTS);
  assert.equal(P.maskId("7"), DOTS);
  assert.equal(P.maskId(""), "");
  assert.equal(P.maskId(null), "");
  assert.equal(P.maskId("१२३४५६७८९०"), DOTS, "non-ASCII digits are never sliced");
});

test("an ID mask never reveals the whole ID, or more than 4 of its characters, at any length", () => {
  const all = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  for (let n = 1; n <= 24; n++) {
    const id = all.slice(0, n);
    const m = P.maskId(id);
    assert.ok(m.startsWith(DOTS), "starts with dots: " + m);
    const shown = m.slice(DOTS.length).trim();
    assert.ok(shown.length <= 4, "at most 4 shown for length " + n);
    assert.ok(shown.length < n || n === 0, "never the whole ID for length " + n);
    assert.ok(n >= 10 || shown.length <= 2, "short IDs show at most 2 for length " + n);
  }
});

test("phones: digits only, last 4 of a mobile", () => {
  assert.equal(P.maskPhone("+91 90000 00001"), DOTS + " 0001");
  assert.equal(P.maskPhone("90000-00001"), DOTS + " 0001");
  assert.equal(P.maskPhone("(000) 555-0101"), DOTS + " 0101");
  assert.equal(P.maskPhone("12345"), DOTS);
  assert.equal(P.maskPhone("not given"), DOTS, "words in a phone field are not echoed");
  assert.equal(P.maskPhone(""), "");
  assert.equal(P.maskPhone(null), "");
});

test("addresses and other free identifiers keep nothing", () => {
  assert.equal(P.maskAll("12 Fake Street, Testville"), DOTS);
  assert.equal(P.mask("address", "12 Fake Street"), DOTS);
  assert.equal(P.mask("other", "anything"), DOTS);
  assert.equal(P.mask("unknown-kind", "anything"), DOTS, "an unknown kind masks everything");
  assert.equal(P.maskAll("  "), "");
});

test("wrap: the real value stays in the markup, the mask rides in data-phi, both escaped", () => {
  assert.equal(P.wrap("name", "Testa Patientkumar"), '<span data-phi="T. P."><span>Testa Patientkumar</span></span>');
  assert.equal(P.wrap("id", "MR99990001", "<b>MR 99990001</b>"), '<span data-phi="•••• 0001"><span><b>MR 99990001</b></span></span>',
    "the caller's own formatted markup is kept as the inner content");
  assert.equal(P.wrap("name", 'A"<x>'), '<span data-phi="A."><span>A&quot;&lt;x&gt;</span></span>');
  assert.equal(P.wrap("name", "", "Unnamed"), "Unnamed", "nothing to mask: the placeholder is returned as is");
  assert.equal(P.wrap("name", null, "Patient"), "Patient");
  assert.equal(P.wrap("name", null), "");
});

test("wrapIn wraps exactly the identifier inside a built sentence", () => {
  const t = "Bed 4 · Testa Patientkumar — Critical";
  assert.equal(P.wrapIn("name", t, "Testa Patientkumar"),
    'Bed 4 · <span data-phi="T. P."><span>Testa Patientkumar</span></span> — Critical');
  assert.equal(P.wrapIn("name", "Bed B · B", "B", 8), 'Bed B · <span data-phi="B."><span>B</span></span>', "from skips an earlier match");
  assert.equal(P.wrapIn("name", "No name <here>", "Absent"), "No name &lt;here&gt;");
  assert.equal(P.wrapIn("name", "x", ""), "x");
});

test("attr: an accessible name carries the real text, data-phi-<attr> the same text built round the mask", () => {
  const card = (n) => "Open Bed 7, " + (n || "Patient") + ", Critical";
  assert.equal(P.attr("aria-label", "name", "Testa Patientkumar", card),
    ' aria-label="Open Bed 7, Testa Patientkumar, Critical" data-phi-aria-label="Open Bed 7, T. P., Critical"');
  assert.equal(P.attr("title", "id", "UHID20269990001", (n) => "UHID " + n),
    ' title="UHID UHID20269990001" data-phi-title="UHID ' + DOTS + ' 0001"', "IDs use the ID mask");
  assert.equal(P.attr("alt", "name", "A\"<x> Fake", (n) => "Photo of " + n),
    ' alt="Photo of A&quot;&lt;x&gt; Fake" data-phi-alt="Photo of A. F."', "both values escaped");
  assert.equal(P.attr("aria-label", "name", "", card), ' aria-label="Open Bed 7, Patient, Critical"', "nothing to mask: no marker");
  assert.equal(P.attr("aria-label", "name", null, card), ' aria-label="Open Bed 7, Patient, Critical"');
  const masked = P.attr("aria-label", "name", "Testa Patientkumar", card).split("data-phi-aria-label=")[1];
  assert.ok(!/Testa|Patientkumar/.test(masked), "the masked label never holds the name");
});

test("state: default off, session-scoped, kill switch hides and forces off", () => {
  const a = load();
  assert.equal(a.enabled(), true);
  assert.equal(a.isOn(), false, "default off");
  assert.equal(a.screenText("name", "Testa Patientkumar"), "Testa Patientkumar", "screen text is the value while off");
  assert.equal(a.set(true), true);
  assert.equal(a.isOn(), true);
  assert.equal(a.screenText("name", "Testa Patientkumar"), "T. P.");
  assert.equal(a.screenText("id", "MR99990001"), DOTS + " 0001");
  assert.equal(a.screenText("name", ""), "");
  assert.equal(a.set(false), false);
  assert.equal(a.isOn(), false);

  const resumed = load({ session: { smd_privacy_mode: "1" } });
  assert.equal(resumed.isOn(), true, "the session's choice survives a reload");

  const killed = load({ local: { smd_privacy_mode_enabled: "0" }, session: { smd_privacy_mode: "1" } });
  assert.equal(killed.enabled(), false);
  assert.equal(killed.isOn(), false, "kill switch wins over a session that had it on");
  assert.equal(killed.set(true), false, "and it cannot be turned on");
  assert.equal(killed.mountToggle({}, null, ""), null, "no toggle is mounted");
});

test("the attribute helpers mark inputs and photos", () => {
  assert.equal(P.inputAttr(), " data-phi-input");
  assert.equal(P.imgAttr(), " data-phi-img");
});
