/* Settings presentation only. Existing builders retain control ownership and gates.
 * Set smd_settings_redesign=0 to restore the previous layout. */
(function () {
  'use strict';
  function enabled() { try { return localStorage.getItem('smd_settings_redesign') !== '0'; } catch (e) { return true; } }
  var lastView = { category: 'All', query: '' };
  function enhance(root) {
    if (!root || !enabled() || root.getAttribute('data-settings-ui')) return;
    root.setAttribute('data-settings-ui', '1');
    var body = root.querySelector('.sbr-set-body');
    if (!body) return;
    var experimental = root.id === 'sbrExperimental';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', experimental ? 'Experimental features' : 'Settings');
    var intro = document.createElement('p'); intro.className = 'settings-intro';
    intro.textContent = experimental ? 'Explore optional tools. Review access requirements and draft-content notices before enabling a feature.' : 'Make StewardMD work for you.';
    body.insertBefore(intro, body.firstChild);
    var back = root.querySelector('.sbr-set-back');
    if (back) back.focus({ preventScroll: true });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !(e.target.type === 'search' && e.target.value)) { e.preventDefault(); if (back) back.click(); }
      if (e.key === 'Tab') {
        var focusable = Array.prototype.filter.call(root.querySelectorAll('button,input,select,summary,a[href],[tabindex="0"]'), function (n) { return !n.disabled && n.getClientRects().length; });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    if (experimental) return;
    var groups = [], current;
    Array.prototype.slice.call(body.children).forEach(function (node) {
      if (node === intro) return;
      if (node.classList.contains('sbr-sec')) {
        current = document.createElement('section'); current.className = 'settings-group';
        current.setAttribute('data-title', node.textContent);
        body.insertBefore(current, node); groups.push(current);
      }
      if (current) current.appendChild(node);
    });
    var advanced = groups.filter(function (g) { return g.getAttribute('data-title') === 'Advanced'; })[0];
    if (advanced) {
      Array.prototype.slice.call(advanced.querySelectorAll('.smd-nav-row')).forEach(function (node) {
        var title = node.querySelector('.sbr-tg-t');
        if (!title) return;
        var detail = document.createElement('details'); detail.className = 'settings-detail';
        var summary = document.createElement('summary'); summary.textContent = title.textContent;
        node.parentNode.insertBefore(detail, node); detail.appendChild(summary); detail.appendChild(node); title.remove();
      });
    }
    if (advanced && advanced.querySelector('.settings-detail')) {
      var models = document.createElement('section'); models.className = 'settings-group'; models.setAttribute('data-title', 'AI & voice');
      models.innerHTML = '<div class="sbr-sec">AI &amp; voice</div><p class="sbr-note">Choose how images, dictation and MaiK answers are processed.</p>';
      advanced.insertAdjacentElement('afterend', models);
      Array.prototype.forEach.call(advanced.querySelectorAll('.settings-detail'), function (d) { models.appendChild(d); });
      groups.splice(groups.indexOf(advanced) + 1, 0, models);
    }
    var exp = groups.filter(function (g) { return g.getAttribute('data-title') === 'Experimental'; })[0];
    if (exp) { var duplicate = exp.querySelector('.sbr-card'); if (duplicate) duplicate.remove();
      if (window.SMD_SETTINGS_INDEX) exp.setAttribute('data-search', SMD_SETTINGS_INDEX().filter(function (t) { return t.group === 'exp'; }).map(function (t) { return t.title + ' ' + t.sub; }).join(' ').toLowerCase());
    }
    var descriptions = {
      profile: 'Your profile, StewardMD ID and clinician verification',
      notifications: 'App notices and medical updates',
      appearance: 'Text size, fonts, density, accessibility and themes',
      applewatch: 'Manage your paired Apple Watch', wearos: 'Connect with your Wear OS companion',
      experimental: 'All optional tools, research features and beta access',
      offlinedb: 'Manage drug information available offline',
      mail: 'Manage the support mailbox', hospadmin: 'Review hospital access requests'
    };
    Array.prototype.forEach.call(body.querySelectorAll('[data-sbr-act]'), function (button) {
      var key = button.getAttribute('data-sbr-act'), label = button.querySelector('.sbr-lbl');
      if (label && descriptions[key]) {
        if (key === 'appearance') button.setAttribute('data-search', 'haptics vibration heading script aurora colors blend speed auto fit presets');
        var sub = document.createElement('span'); sub.className = 'settings-description'; sub.textContent = descriptions[key]; var copy = document.createElement('span'); copy.className = 'settings-row-copy'; label.parentNode.insertBefore(copy, label); copy.appendChild(label); copy.appendChild(sub);
      }
      if (!button.querySelector('.sbr-chev')) { var arrow = document.createElement('span'); arrow.className = 'sbr-chev'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '›'; button.appendChild(arrow); }
    });
    var controls = document.createElement('div'); controls.className = 'settings-tools';
    controls.innerHTML = '<label class="settings-search"><span>Find a setting</span><input type="search" placeholder="Search settings…" autocomplete="off" spellcheck="false"></label><nav class="settings-nav" aria-label="Settings categories"></nav><p class="settings-results" role="status" aria-live="polite" hidden></p>';
    intro.insertAdjacentElement('afterend', controls);
    var nav = controls.querySelector('nav'), input = controls.querySelector('input'), status = controls.querySelector('[role=status]'), active = lastView.category; input.value = lastView.query;
    if (active !== 'All' && !groups.some(function (g) { return g.getAttribute('data-title') === active; })) active = 'All';
    ['All'].concat(groups.map(function (g) { return g.getAttribute('data-title'); })).forEach(function (name) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.setAttribute('aria-pressed', String(name === active));
      b.addEventListener('click', function () { active = name; input.value = ''; apply(); }); nav.appendChild(b);
    });
    function apply() {
      var q = input.value.trim().toLowerCase(), count = 0;
      lastView = { category: active, query: input.value };
      groups.forEach(function (g) {
        var match = (!q && (active === 'All' || active === g.getAttribute('data-title'))) || (q && (g.textContent.toLowerCase() + ' ' + (g.getAttribute('data-search') || '') + ' ' + Array.prototype.map.call(g.querySelectorAll('[data-search]'), function (n) { return n.getAttribute('data-search'); }).join(' ')).indexOf(q) !== -1);
        g.hidden = !match;
        if (match) count++;
        Array.prototype.forEach.call(g.querySelectorAll('details'), function (d) { if (q) { if (!d.hasAttribute('data-search-open')) d.setAttribute('data-search-open', String(d.open)); d.open = match; } else if (d.hasAttribute('data-search-open')) { d.open = d.getAttribute('data-search-open') === 'true'; d.removeAttribute('data-search-open'); } });
      });
      Array.prototype.forEach.call(nav.children, function (b) { b.setAttribute('aria-pressed', String(!q && b.textContent === active)); });
      status.hidden = !q; status.textContent = count ? count + ' matching section' + (count === 1 ? '' : 's') : 'No matching settings. Try “theme”, “voice” or “clinical”.';
    }
    Array.prototype.forEach.call(body.querySelectorAll('.sbr-sec'), function (heading) { heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '3'); });
    apply();
    input.addEventListener('input', apply);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target === input && input.value) { input.value = ''; apply(); e.stopPropagation(); }
    });
  }
  window.SMD_SETTINGS_UI = { enhance: enhance, enabled: enabled };
}());
