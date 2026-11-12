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
      mail: 'Manage the support mailbox', hospadmin: 'Review hospital access requests',
      aictl: 'AI usage, limits and model switches'
    };
    Array.prototype.forEach.call(body.querySelectorAll('[data-sbr-act]'), function (button) {
      var key = button.getAttribute('data-sbr-act'), label = button.querySelector('.sbr-lbl');
      if (label && descriptions[key]) {
        if (key === 'appearance') button.setAttribute('data-search', 'haptics vibration heading script aurora colors blend speed auto fit presets');
        var sub = document.createElement('span'); sub.className = 'settings-description'; sub.textContent = descriptions[key]; var copy = document.createElement('span'); copy.className = 'settings-row-copy'; label.parentNode.insertBefore(copy, label); copy.appendChild(label); copy.appendChild(sub);
      }
      if (!button.querySelector('.sbr-chev')) { var arrow = document.createElement('span'); arrow.className = 'sbr-chev'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '›'; button.appendChild(arrow); }
    });
    // iOS grouped list: each section's rows sit in one inset card, with the heading above it.
    groups.forEach(function (g) {
      var card = document.createElement('div'); card.className = 'settings-card';
      Array.prototype.slice.call(g.children).forEach(function (n) { if (!n.classList.contains('sbr-sec')) card.appendChild(n); });
      g.appendChild(card);
    });
    // The account row leads the page with the doctor's own name, like the Apple Account card.
    var prof = body.querySelector('[data-sbr-act="profile"]'), acctName = '';
    try { acctName = String((JSON.parse(localStorage.getItem('stewardmd_account') || '{}') || {}).name || '').trim(); } catch (e) {}
    if (prof && acctName && acctName.indexOf('@') < 0) {
      var lbl = prof.querySelector('.sbr-lbl'), avatar = document.createElement('span');
      avatar.className = 'settings-avatar'; avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = acctName.replace(/^\s*(dr|prof|mr|mrs|ms)\.?\s+/i, '').charAt(0).toUpperCase();
      prof.classList.add('settings-profile'); prof.insertBefore(avatar, prof.firstChild); lbl.textContent = acctName;
      var psub = prof.querySelector('.settings-description'); if (psub) psub.textContent = 'Profile, ID & verification';
    }
    // iOS navigation: the large title scrolls away and the small centred title fades in. No layout shift.
    var large = document.createElement('div'); large.className = 'settings-largetitle'; large.setAttribute('aria-hidden', 'true'); large.textContent = 'Settings';
    body.insertBefore(large, body.firstChild);
    var bar = root.querySelector('.sbr-set-head');
    root.addEventListener('scroll', function () { bar.classList.toggle('is-scrolled', root.scrollTop > 44); }, { passive: true });
    var controls = document.createElement('div'); controls.className = 'settings-tools';
    controls.innerHTML = '<label class="settings-search"><span>Find a setting</span><input type="search" placeholder="Search" autocomplete="off" spellcheck="false"></label><p class="settings-results" role="status" aria-live="polite" hidden></p>';
    intro.insertAdjacentElement('afterend', controls);
    var input = controls.querySelector('input'), status = controls.querySelector('[role=status]'), active = 'All'; input.value = lastView.query;
    // iPad: a sidebar of sections beside one detail pane, as in iPadOS Settings. Narrow windows keep the single list.
    var split = document.documentElement.classList.contains('smd-tablet') ? window.matchMedia('(min-width: 768px)') : null;
    function splitOn() { return !!split && split.matches; }
    var acct = groups.filter(function (g) { return g.getAttribute('data-title') === 'Account'; })[0];
    var sections = groups.filter(function (g) { return g !== acct; }), sideNav = null, detailHead = null;
    var SECTION = {
      'Preferences': ['#8e8e93', '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>', 'Notifications, appearance and your connected devices.'],
      'Software Update': ['#34c759', '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>', 'Keep StewardMD up to date on this device.'],
      'Advanced': ['#636366', '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>', 'Clinical engine settings for this device.'],
      'AI & voice': ['#5856d6', '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', 'Choose how images, dictation and MaiK answers are processed.'],
      'Admin': ['#1c1c1e', '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>', 'Owner tools: mail, hospital requests and AI controls.'],
      'Experimental': ['#ff9500', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>', 'Optional tools, research features and beta access.']
    };
    function tileHtml(name) { var c = SECTION[name] || SECTION.Advanced; return '<span class="settings-tile" style="background:' + c[0] + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + c[1] + '</svg></span>'; }
    if (split) {
      if (!sections.some(function (g) { return g.getAttribute('data-title') === lastView.category; })) lastView.category = sections.length ? sections[0].getAttribute('data-title') : 'All';
      active = lastView.category;
      var aside = document.createElement('aside'); aside.className = 'settings-sidebar';
      sideNav = document.createElement('nav'); sideNav.className = 'settings-sidenav'; sideNav.setAttribute('aria-label', 'Settings sections');
      sections.forEach(function (g) {
        var name = g.getAttribute('data-title'), b = document.createElement('button'), t = document.createElement('span');
        b.type = 'button'; b.setAttribute('data-section', name); b.innerHTML = tileHtml(name); t.textContent = name; b.appendChild(t);
        b.addEventListener('click', function () { active = name; input.value = ''; apply(); root.scrollTop = 0; });
        sideNav.appendChild(b);
      });
      aside.appendChild(large); aside.appendChild(controls);
      if (acct) aside.appendChild(acct);
      aside.appendChild(sideNav);
      body.insertBefore(aside, body.firstChild);
      detailHead = document.createElement('div'); detailHead.className = 'settings-detail-head';
      aside.insertAdjacentElement('afterend', detailHead);
      if (split.addEventListener) split.addEventListener('change', apply);
    }
    function paintSplit(q) {
      if (!split) return;
      root.toggleAttribute('data-searching', !!q);
      Array.prototype.forEach.call(sideNav.children, function (b) { if (!q && b.getAttribute('data-section') === active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      detailHead.hidden = !!q || !splitOn();
      if (detailHead.hidden) return;
      var c = SECTION[active] || SECTION.Advanced, h = document.createElement('h3'), p = document.createElement('p');
      h.textContent = active; p.textContent = c[2]; detailHead.innerHTML = tileHtml(active); detailHead.appendChild(h); detailHead.appendChild(p);
    }
    function apply() {
      var q = input.value.trim().toLowerCase(), count = 0;
      lastView = { category: active, query: input.value };
      groups.forEach(function (g) {
        if (g === acct && splitOn()) { g.hidden = false; return; }
        var match = (!q && (!splitOn() || active === g.getAttribute('data-title'))) || (q && (g.textContent.toLowerCase() + ' ' + (g.getAttribute('data-search') || '') + ' ' + Array.prototype.map.call(g.querySelectorAll('[data-search]'), function (n) { return n.getAttribute('data-search'); }).join(' ')).indexOf(q) !== -1);
        g.hidden = !match;
        if (match) count++;
        Array.prototype.forEach.call(g.querySelectorAll('details'), function (d) { if (q) { if (!d.hasAttribute('data-search-open')) d.setAttribute('data-search-open', String(d.open)); d.open = match; } else if (d.hasAttribute('data-search-open')) { d.open = d.getAttribute('data-search-open') === 'true'; d.removeAttribute('data-search-open'); } });
      });
      status.hidden = !q; status.textContent = count ? count + ' matching section' + (count === 1 ? '' : 's') : 'No matching settings. Try “theme”, “voice” or “clinical”.';
      paintSplit(q);
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
