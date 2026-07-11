/* Live Site Monitor - loader RUM.
   Uso: <script async src=".../lsm.js?v=N" data-token="ing_..."></script>
   A taxa de amostragem vem do backend (/api/config), cacheada por sessao, e a
   amostragem acontece no browser -> controle central + poucas requisicoes.
   Opcional: data-sample="N" (em %) sobrepoe a config e pula a busca.
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
  if (!TOKEN) return;
  var ORIGIN = new URL(me.src).origin;
  var API = ORIGIN + '/api/ingest';
  var SAMPLE_PERCENT = 100;

  // Resolve a taxa: atributo explicito > cache da sessao > /api/config.
  var attr = me.getAttribute('data-sample');
  if (attr !== null && attr !== '') {
    start(parseFloat(attr));
  } else {
    var key = 'lsm_s_' + TOKEN, cached = null;
    try { cached = sessionStorage.getItem(key); } catch (e) {}
    if (cached !== null) {
      start(parseFloat(cached));
    } else {
      fetch(ORIGIN + '/api/config?token=' + encodeURIComponent(TOKEN))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var pct = (j && j.sample > 0) ? j.sample : 100;
          try { sessionStorage.setItem(key, pct); } catch (e) {}
          start(pct);
        })
        .catch(function () { start(100); });
    }
  }

  function start(pct) {
    if (!(pct > 0)) pct = 100;
    if (Math.random() * 100 >= pct) return;
    SAMPLE_PERCENT = pct;

    // Carregamento real: envia os tempos (espera o load se ainda nao ocorreu).
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
  }

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
})();
