/* lazy-load.js — on-demand script loader for heavy feature modules */
(function () {
  var loaded = {};
  window.smdLazy = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return loaded[src];
  };
})();
