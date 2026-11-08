// Home tabs (owner 2026-11-07): For you / Learn / Bedside / Practice / <branch>, discovery and problem search.
//   node --test test/home-tabs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SRC = read('tool-groups.js'), HOME = read('home.js'), SEARCH = read('search.js'), INDEX = read('index.html');

function load(store = {}, search = '') {
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const window = { localStorage, location: { search } };
  window.window = window;
  vm.runInNewContext(SRC, { window, globalThis: window });
  return { TG: window.SMD_TOOL_GROUPS, store };
}
const block = HOME.slice(HOME.indexOf('var HOME_TOOLS = ['), HOME.indexOf('function homeToolByAct('));
const ACTS = [...block.matchAll(/\{ act: "([a-z0-9]+)"/g)].map((m) => m[1]);
const SUBS = Object.fromEntries([...block.matchAll(/\{ act: "([a-z0-9]+)"[^\n]*?sub: "([^"]*)"/g)].map((m) => [m[1], m[2]]));

test('every Home tool not already above the grid sits in exactly one task tab', () => {
  const { TG } = load();
  for (const a of ACTS) {
    if (TG.ON_HOME_ALREADY.includes(a)) continue;
    const n = TG.TASKS.filter((t) => t.acts.includes(a)).length;
    assert.equal(n, 1, `${a} is in ${n} task tabs`);
  }
  for (const t of TG.TASKS) for (const a of t.acts) {
    assert.ok(ACTS.includes(a), `${t.id} names ${a}, not a Home tool`);
    assert.ok(!TG.ON_HOME_ALREADY.includes(a), `${a} is already above the grid`);
  }
  assert.deepEqual([...TG.TAB_IDS], ['foryou', 'learn', 'bedside', 'practice', 'branch']);
});

test('branches name real tools, and every kit the profile can map to has a branch', () => {
  const { TG } = load();
  const ids = new Set();
  for (const b of TG.BRANCHES) {
    assert.ok(!ids.has(b.id), 'duplicate branch ' + b.id); ids.add(b.id);
    for (const a of b.acts) assert.ok(ACTS.includes(a), `${b.id} names ${a}`);
  }
  const kits = new Set(Object.values(eval('(' + read('specialty-kits.js').match(/var SPEC_TO_KIT = (\{[\s\S]*?\});/)[1] + ')')));
  kits.add('dental');
  for (const k of kits) assert.ok(TG.branchForKit(k), 'no branch for kit ' + k);
  assert.equal(TG.branchForKit('cancer-screening').id, 'oncology');
});

test('branch: the picked one wins, else the kit, else none', () => {
  assert.equal(load({}).TG.branch(), null);
  assert.equal(load({ smd_my_specialty: 'cancer-screening' }).TG.branch().id, 'oncology');
  const { TG, store } = load({ smd_my_specialty: 'cancer-screening' });
  TG.setBranch('cardiology'); assert.equal(store.smd_home_branch, 'cardiology'); assert.equal(TG.branch().id, 'cardiology');
  TG.setBranch('nonsense'); assert.equal(TG.branch().id, 'cardiology');
});

test('tab: remembered, For you by default for every role', () => {
  assert.equal(load({}).TG.tab(), 'foryou');
  assert.equal(load({ smd_role: 'doctor' }).TG.tab(), 'foryou');
  assert.equal(load({ smd_role: 'student' }).TG.tab(), 'foryou', 'a hidden For you grid would leave a hidden duplicate of every tile');
  const { TG } = load({ smd_role: 'student' }); TG.setTab('practice'); assert.equal(TG.tab(), 'practice');
  TG.setTab('bogus'); assert.equal(TG.tab(), 'practice');
});

test('flag: on by default, off with smd_home_tabs=0 or ?hometabs=0', () => {
  assert.equal(load({}).TG.tabsOn(), true);
  assert.equal(load({ smd_home_tabs: '0' }).TG.tabsOn(), false);
  assert.equal(load({}, '?hometabs=0').TG.tabsOn(), false);
  assert.equal(load({ smd_home_tabs: '0' }, '?hometabs=1').TG.tabsOn(), true);
});

test('discovery: seeding marks Home tools known, opening marks seen, one tool a week, Not now hides it for the week', () => {
  const { TG, store } = load({ smd_tools_recent: '["prep"]' });
  assert.equal(TG.isNew('kardia'), false, 'nothing is new before the first seed');
  TG.seedSeen(['kardia', 'clinix']);
  assert.equal(TG.isNew('kardia'), false); assert.equal(TG.isNew('prep'), false, 'recently used counts as known');
  assert.equal(TG.isNew('tokos'), true);
  TG.seedSeen(['tokos']); assert.equal(TG.isNew('tokos'), true, 'seeding happens once');
  TG.markSeen('tokos'); assert.equal(TG.isNew('tokos'), false);
  const week = Date.UTC(2026, 10, 9), pool = ['kardia', 'narke', 'neo', 'tokos', 'startcase'];
  const a = TG.tryNext(pool, week);
  assert.ok(['narke', 'neo'].includes(a), 'an unseen tool not above the grid: ' + a);
  assert.equal(TG.tryNext(pool, week + 864e5), a, 'same tool all week');
  assert.notEqual(TG.tryNext(pool, week + 7 * 864e5), a, 'another next week');
  TG.hideTry(week); assert.equal(TG.tryNext(pool, week), ''); assert.ok(TG.tryNext(pool, week + 7 * 864e5));
  TG.markSeen('narke'); TG.markSeen('neo'); assert.equal(TG.tryNext(pool, week + 14 * 864e5), '');
  assert.ok(!/patient|name/i.test(store.smd_tools_seen), 'tool ids only');
});

test('problem search: what a doctor types finds the tool', () => {
  const { TG } = load();
  const top = (q) => (TG.suggest(q)[0] || {}).act;
  assert.equal(top('paracetamol dose for a child'), 'dosecalc');
  assert.equal(top('sodium 122'), 'electrolytes');
  assert.equal(top('hyperkalemia'), 'electrolytes');
  assert.equal(top('cardiac arrest'), 'codeblue');
  assert.equal(top('dka insulin'), 'insulin');
  assert.equal(top('medical certificate'), 'docs');
  assert.equal(top('neet pg mcq'), 'prep');
  assert.equal(top('ctg'), 'tokos');
  assert.equal(top('newborn jaundice'), 'neo');
  assert.ok(TG.suggest('stage breast cancer').some((x) => x.act === 'staging'));
  assert.equal(top('enteral feeding'), undefined, '"ent" matches only as a whole word');
  assert.equal(top('history'), undefined, '"his" matches only as a whole word');
  assert.equal(TG.suggest('ab').length, 0);
  for (const a of Object.keys(TG.PROBLEMS)) assert.ok(ACTS.includes(a), 'problem words for unknown tool ' + a);
});

test('subtitles: plain words, short, no dashes; Anaesthetica is the anaesthesia title', () => {
  for (const [a, s] of Object.entries(SUBS)) {
    assert.ok(s.length <= 30, `${a} subtitle too long: ${s}`);
    assert.ok(!/[–—]| - /.test(s), 'dash in ' + s);
  }
  assert.ok(/act: "narke"[^\n]*tt: "Anaesthetica"/.test(block));
  assert.equal(SUBS.followcare === SUBS.maitri, false, 'FollowCare and MAiTRI read differently');
  assert.ok(!/Anesthetica/.test(HOME + read('narke.js') + read('review-desk.js')), 'old spelling gone');
});

test('home.js and search.js wire it in; tokens bumped', () => {
  assert.ok(/homeToolsSectionMarkup\(\) \+/.test(HOME), 'Home renders the tools section through the tabs');
  assert.ok(/wireHomeTabs\(root\)/.test(HOME));
  assert.ok(/role="tablist"/.test(HOME) && /role="tab"/.test(HOME) && /role="tabpanel"/.test(HOME));
  assert.ok(/T\.markSeen\(/.test(HOME), 'opening a tool marks it seen');
  assert.ok(/out\.tools = problemTools\(q,/.test(SEARCH));
  assert.ok(/tool-groups\.js\?v=tg3/.test(INDEX));
  assert.ok(!/(^|[^.\w])(let|const) |=>|`/.test(SRC.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'tool-groups.js is ES5');
});
