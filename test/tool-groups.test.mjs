// tool-groups.js: role sections for the All tools sheet, the Home starter set, Recently used, descriptions.
//   node --test test/tool-groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SRC = read('tool-groups.js'), HOME = read('home.js'), INDEX = read('index.html');

function load(store = {}, search = '') {
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const window = { localStorage, location: { search } };
  window.window = window;
  vm.runInNewContext(read('role-features.js'), { window, localStorage, document: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: function () {}, location: window.location, setTimeout() {}, setInterval() { return 0; }, clearInterval() {} });
  vm.runInNewContext(SRC, { window, globalThis: window });
  return { TG: window.SMD_TOOL_GROUPS, ROLE: window.SMD_ROLE, store };
}
// The registry acts, read from the HOME_TOOLS block of home.js.
const block = HOME.slice(HOME.indexOf('var HOME_TOOLS = ['), HOME.indexOf('function homeToolByAct('));
const ACTS = [...block.matchAll(/\{ act: "([a-z0-9]+)"/g)].map((m) => m[1]);
const ROLES = ['student', 'intern', 'resident', 'doctor'];
const LOCKED = load().ROLE.LOCKED;

test('the registry was read', () => { assert.ok(ACTS.length >= 40, 'HOME_TOOLS has ' + ACTS.length + ' acts'); });

test('every Home tool sits in exactly one role section and has a description', () => {
  const { TG } = load();
  for (const a of ACTS) {
    const n = TG.GROUPS.filter((g) => g.acts.includes(a)).length;
    assert.equal(n, 1, `${a} is in ${n} sections`);
    assert.ok(TG.desc(a).length > 10, `${a} has a description`);
  }
  for (const g of TG.GROUPS) for (const a of g.acts) assert.ok(ACTS.includes(a), `section ${g.role} names ${a}, which is not a Home tool`);
  for (const a of Object.keys(TG.DESC)) assert.ok(ACTS.includes(a), `description for unknown tool ${a}`);
});

test('a role section never holds a tool that role is locked out of', () => {
  const { TG } = load();
  for (const g of TG.GROUPS) for (const a of g.acts) assert.ok(!LOCKED[g.role].includes(a), `${a} is in the ${g.role} section but locked for ${g.role}`);
});

test('descriptions and section text: plain, no dashes, no ES6 in the file', () => {
  const { TG } = load();
  const texts = Object.values(TG.DESC).concat(TG.GROUPS.flatMap((g) => [g.tt, g.sub]));
  for (const t of texts) { assert.ok(!/[–—]| - /.test(t), 'dash in: ' + t); assert.ok(t.length <= 70, 'too long: ' + t); }
  assert.ok(!/(^|[^.\w])(let|const) |=>|`/.test(SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'tool-groups.js is ES5');
});

test('starter: 6 to 8 tools for every role and specialty, never one Home already offers, never a locked one', () => {
  const { TG } = load();
  for (const r of ROLES.concat([''])) {
    for (const kit of [''].concat(Object.keys(TG.PACKS))) {
      const usable = (a) => !r || !LOCKED[r].includes(a);
      const s = TG.starter(r, kit, usable);
      assert.ok(s.length >= 6 && s.length <= 8, `${r || 'none'}/${kit || 'no kit'}: ${s.length} tools`);
      assert.equal(new Set(s).size, s.length, 'no duplicates');
      for (const a of s) {
        assert.ok(ACTS.includes(a), `${a} is a Home tool`);
        assert.ok(!TG.ON_HOME_ALREADY.includes(a), `${a} is already above the grid`);
        assert.ok(usable(a), `${a} is locked for ${r}`);
      }
      for (const a of TG.PACKS[kit] || []) if (usable(a) && !TG.ON_HOME_ALREADY.includes(a)) assert.ok(s.includes(a), `${kit} pack puts ${a} on Home`);
    }
  }
});

test('starter reads the role and the specialty the app stored', () => {
  const { TG } = load({ smd_role: 'student', smd_my_specialty: 'obgyn' });
  assert.equal(TG.role(), 'student');
  const s = TG.starter();
  assert.equal(s[0], 'tokos', 'the specialty pack comes first');
  assert.ok(s.includes('clinix') && s.includes('prep'), 'then the student tools');
});

test('sections: own role first and marked; every tool once; unknown tools in More tools', () => {
  const { TG } = load();
  // Arrays from the vm context have another realm's prototype: compare copies.
  const tools = ACTS.map((act) => ({ act })).concat([{ act: 'newtool' }]);
  const secs = [...TG.sections(tools, 'resident')];
  assert.equal(secs[0].role, 'resident'); assert.ok(secs[0].mine);
  assert.ok(secs.slice(1).every((s) => !s.mine));
  assert.deepEqual([...secs.slice(1, 4).map((s) => s.role)], ['student', 'intern', 'doctor'], 'the rest in ladder order');
  const all = secs.flatMap((s) => s.tools.map((t) => t.act));
  assert.equal(all.length, tools.length); assert.equal(new Set(all).size, tools.length);
  assert.equal(secs.at(-1).tt, 'More tools'); assert.deepEqual([...secs.at(-1).tools.map((t) => t.act)], ['newtool']);
  assert.deepEqual([...TG.sections(tools, '').slice(0, 4).map((s) => s.role)], ROLES, 'no role: ladder order');
});

test('Recently used: newest first, 4 at most, no duplicates, ids only', () => {
  const { TG, store } = load();
  ['clinix', 'prep', 'neo', 'clinix', 'narke', 'tokos'].forEach(TG.pushRecent);
  assert.deepEqual([...TG.recent()], ['tokos', 'narke', 'clinix', 'neo']);
  TG.pushRecent('<img src=x>');
  assert.deepEqual([...TG.recent()], ['tokos', 'narke', 'clinix', 'neo'], 'a bad id is ignored');
  store.smd_tools_recent = '["ok","<b>",3]';
  assert.deepEqual([...TG.recent()], ['ok'], 'stored junk is dropped');
});

test('flag: on by default, smd_tool_groups=0 or ?toolgroups=0 turns it off', () => {
  assert.equal(load().TG.on(), true);
  assert.equal(load({ smd_tool_groups: '0' }).TG.on(), false);
  assert.equal(load({}, '?toolgroups=0').TG.on(), false);
});

test('wiring: index.html loads tool-groups.js before home.js; home.js seeds prefs before every write', () => {
  const tg = INDEX.indexOf('/tool-groups.js?v='), hm = INDEX.indexOf('/home.js?v=');
  assert.ok(tg > 0 && tg < hm, 'tool-groups.js loads first');
  assert.ok(!/p = homeToolPrefs\(\); p\[t\.act\] = now/.test(HOME), 'every pin/hide goes through homeToolPrefsForWrite');
  assert.equal((HOME.match(/homeToolPrefsForWrite\(\); p\[t\.act\] = now/g) || []).length, 2);
  assert.match(HOME, /noteToolOpened\(a\); ACT\[a\]\(\)/, 'Home taps are recorded');
});
