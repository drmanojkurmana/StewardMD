// connect-agent/phone/snapshot.mjs — the phone-side accessibility-style snapshot walker.
// See connect-agent/phone/CONTRACT.md "Snapshot line format". Written as a real function (parsed and
// syntax-checked by Node) and serialized with String() for evaluation in the page realm, exactly the
// pattern discovery.mjs uses for SMD_CONNECT_OBSERVER. Must not close over anything from this module.
//
// Never sends element VALUES off-device: only role, a truncated/redacted name, and a synthetic ref.
function SMD_CONNECT_SNAPSHOT() {
  var MAX_LINES = 400;
  var MAX_NAME = 80;

  var ROLE_BY_TAG = {
    a: 'link', button: 'button', input: 'textbox', textarea: 'textbox', select: 'combobox',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    td: 'cell', th: 'cell', tr: 'row',
  };
  var ROLE_BY_ARIA = {
    link: 'link', button: 'button', menuitem: 'menuitem', tab: 'tab', option: 'option',
    textbox: 'textbox', checkbox: 'checkbox', radio: 'radio', combobox: 'combobox',
    heading: 'heading', cell: 'cell', row: 'row',
  };
  var ROLE_BY_INPUT_TYPE = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button' };

  var roleOf = function (el) {
    var aria = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    if (aria && ROLE_BY_ARIA[aria]) return ROLE_BY_ARIA[aria];
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (ROLE_BY_INPUT_TYPE[type]) return ROLE_BY_INPUT_TYPE[type];
      return 'textbox';
    }
    return ROLE_BY_TAG[tag] || null;
  };

  var redact = function (s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/\d{4,}/g, '#');
  };

  var nameOf = function (el) {
    var raw = el.getAttribute && (el.getAttribute('aria-label') || '');
    if (!raw && el.tagName === 'INPUT') raw = el.value || el.getAttribute('placeholder') || '';
    if (!raw && el.tagName === 'IMG') raw = el.getAttribute('alt') || '';
    if (!raw) raw = el.getAttribute && el.getAttribute('title') || '';
    if (!raw) raw = el.textContent || '';
    var n = redact(raw);
    return n.length > MAX_NAME ? n.slice(0, MAX_NAME) : n;
  };

  var isVisible = function (el) {
    try { return el.getClientRects().length > 0; } catch (e) { return false; }
  };

  var out = [];
  var refs = {};
  var refN = 0;

  var walk = function (root, depth) {
    if (out.length >= MAX_LINES) return;
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (out.length >= MAX_LINES) return;
      var el = kids[i];
      if (!el || el.nodeType !== 1) continue;
      var tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;

      if (!isVisible(el)) { walk(el, depth); continue; }

      var role = roleOf(el);
      if (role) {
        var name = nameOf(el);
        var indent = new Array(depth + 1).join('  ');
        var clickable = role === 'link' || role === 'button' || role === 'menuitem' || role === 'tab' || role === 'option';
        if (clickable || role === 'textbox' || role === 'checkbox' || role === 'radio' || role === 'combobox') {
          refN++;
          var ref = 'e' + refN;
          refs[ref] = el;
          out.push(indent + '- ' + role + ' "' + name + '" [ref=' + ref + ']');
        } else {
          out.push(indent + '- ' + role + (name ? ' "' + name + '"' : ''));
        }
      } else if (el.childElementCount === 0 && el.textContent && el.textContent.trim()) {
        var txt = redact(el.textContent);
        if (txt) {
          var textIndent = new Array(depth + 1).join('  ');
          out.push(textIndent + '- text "' + (txt.length > MAX_NAME ? txt.slice(0, MAX_NAME) : txt) + '"');
        }
      }

      // Same-origin iframes: walk their document too (CONTRACT: "include same-origin iframes'
      // documents"). Cross-origin throws on contentDocument access; caught and skipped.
      if (tag === 'iframe') {
        try {
          var idoc = el.contentDocument;
          if (idoc && idoc.body) walk(idoc.body, depth + 1);
        } catch (e) { /* cross-origin: skip */ }
        continue;
      }

      walk(el, role ? depth + 1 : depth);
    }
  };

  walk(document.body || document.documentElement, 0);
  window.__smd_refs = refs;
  return out.slice(0, MAX_LINES).join('\n');
}

export const SNAPSHOT_SOURCE = String(SMD_CONNECT_SNAPSHOT);

/** Expression that evaluates the snapshot walker in the page realm and returns the line-text string. */
export function snapshotExpression() {
  return `(${SNAPSHOT_SOURCE})()`;
}

/** Expression that clicks a previously-snapshotted ref. Mirrors plugin-client.mjs's click(). */
export function clickExpression(ref) {
  return `(function(){var el=window.__smd_refs&&window.__smd_refs[${JSON.stringify(String(ref))}];if(!el)return 'no-ref';el.click();return 'ok';})()`;
}
