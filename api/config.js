const { getServiceClient } = require('../lib/supabase');
const { resolveTenantByToken } = require('../lib/tenants');

// Config publica do cliente, lida pelo lsm.js. Devolve so a taxa de amostragem
// em %, para o browser amostrar sozinho (controle central, sem tocar na tag).
function samplePercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || !(n > 0)) return 100;
  const pct = n > 1 ? n : n * 100;
  return Math.min(100, Math.round(pct));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  // Cache na borda por token (a URL inclui ?token=) e no browser.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }

  const token = (req.query && req.query.token) || '';
  if (!token) { res.status(200).json({ ok: false, sample: 100 }); return; }

  const supabase = getServiceClient();
  const tenant = await resolveTenantByToken(supabase, token);
  if (!tenant || !tenant.is_active) { res.status(200).json({ ok: false, sample: 100 }); return; }

  res.status(200).json({ ok: true, sample: samplePercent(tenant.sample_rate) });
};
