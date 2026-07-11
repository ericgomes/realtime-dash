/* Live Site Monitor - loader RUM.
   Uso: <script async src=".../lsm.js" data-token="ing_..." data-sample="10"></script>
   Envia o carregamento real com tempos e detecta troca de rota SPA sozinho. */
(function () {
  var me = document.currentScript;
  if (!me) {
    var all = document.querySelectorAll('script[data-token]');
    me = all[all.length - 1];
  }
  if (!me || window.__lsm) return;
  window.__lsm = 1;

  var TOKEN = me.getAttribute('data-token');
  var SAMPLE_PERCENT = parseFloat(me.getAttribute('data-sample'));
  if (!(SAMPLE_PERCENT > 0)) SAMPLE_PERCENT = 100;
  var API = new URL(me.src).origin + '/api/ingest';

  if (!TOKEN || Math.random() * 100 >= SAMPLE_PERCENT) return;

  function payload(navType) {
    var c = navigator.connection || {};
    return {
      page_location: location.href,
      page_path: location.pathname,
      sample_rate: SAMPLE_PERCENT,
      nav_type: navType,
      user_agent: navigator.userAgent,
      width: innerWidth,
      height: innerHeight,
      timestamp: new Date().toISOString(),
      effective_type: c.effectiveType || null,
      downlink: c.downlink || null
    };
  }

  function send(p) {
    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
      body: JSON.stringify(p),
      keepalive: true
    }).catch(function () {});
  }

  // Carregamento real: envia os tempos (espera o load se ainda nao ocorreu).
  function sendLoad() {
    var n = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (!n || !n.loadEventEnd) return;
    var act = n.activationStart || 0;
    var p = payload('load');
    p.prerendered = act > 0;
    p.load_time_ms = Math.max(0, Math.round(n.loadEventEnd - act));
    p.dom_ready_ms = Math.max(0, Math.round(n.domContentLoadedEventEnd - act));
    p.ttfb_ms = Math.round(n.responseStart - n.requestStart);
    send(p);
  }
  if (document.readyState === 'complete') setTimeout(sendLoad, 0);
  else addEventListener('load', function () { setTimeout(sendLoad, 0); });

  // SPA: troca de rota sem reload -> pageview sem tempos.
  var last = location.pathname;
  function onRoute() {
    setTimeout(function () {
      if (location.pathname === last) return;
      last = location.pathname;
      send(payload('spa'));
    }, 0);
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (orig) history[m] = function () { var r = orig.apply(this, arguments); onRoute(); return r; };
  });
  addEventListener('popstate', onRoute);
})();
