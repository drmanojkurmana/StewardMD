/* Shared pamphlet parts: line icons ([data-ico]) and the contact footer ([data-part="foot"]). */
(function () {
  var I = {
    log: '<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/><path d="M3 7v12"/>',
    stetho: '<path d="M6 3v6a5 5 0 0 0 10 0V3"/><path d="M11 14v2a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="12" r="2"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M4 12h4l2-3 3 6 2-3h5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3"/><path d="M20 4v14h-7"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    scalpel: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M11 7l6 6"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    pill: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M9.5 8.5l5 7"/>',
    microbe: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M16 11v4"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    icu: '<path d="M3 12h4l2-5 4 10 2-5h6"/><rect x="2" y="3" width="20" height="18" rx="3"/>',
    baby: '<circle cx="12" cy="8" r="4"/><path d="M6 21a6 6 0 0 1 12 0"/><path d="M10.5 8h.01M13.5 8h.01"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    onco: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'
  };
  var nodes = document.querySelectorAll("[data-ico]");
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].innerHTML = '<svg viewBox="0 0 24 24">' + (I[nodes[i].getAttribute("data-ico")] || "") + "</svg>";
  }
  var apple = '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z"/></svg>';
  var play = '<svg viewBox="0 0 24 24"><path d="M4 2.8v18.4c0 .5.5.8 1 .6l10.6-9.2L5 3.2c-.4-.3-1 0-1 .6z" opacity=".95"/><path d="M15.6 12.6l3.2 2.8 1.6-.9c.8-.5.8-1.6 0-2.1l-1.6-.9z" opacity=".75"/></svg>';
  var foot = document.querySelectorAll('[data-part="foot"]');
  for (var j = 0; j < foot.length; j++) {
    foot[j].innerHTML =
      '<div class="qr"><img src="img/qr.svg" alt="QR code to download StewardMD"></div>' +
      '<div class="cta"><b>Scan to get StewardMD on your phone</b>' +
      '<span>Free to start. Pro unlocks every module. iPhone and Android.</span>' +
      '<div class="stores"><div class="store">' + apple + '<div><small>Download on the</small><strong>App Store</strong></div></div>' +
      '<div class="store">' + play + '<div><small>GET IT ON</small><strong>Google Play</strong></div></div></div></div>' +
      '<div class="by"><small>Developed by</small><img class="mk" src="img/maiknowledge.png" alt="MaiKnowledge">stewardmd.in &middot; hello@maiknowledge.com' +
      '<div class="safe">Decision support for registered clinicians. It supports, and never replaces, clinical judgement.</div></div>';
  }
})();
