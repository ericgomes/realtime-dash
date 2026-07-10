const { getServiceClient } = require('../lib/supabase');
const { resolveTenantByViewToken } = require('../lib/tenants');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'method_not_allowed' }); return; }

  const q = req.query || {};
  const token = q.token;
  const period = String(q.period || '60m');

  if (!token) {
    res.status(200).json({ ok: false, message: 'No summary available' });
    return;
  }

  const supabase = getServiceClient();
  const tenant = await resolveTenantByViewToken(supabase, token);
  if (!tenant) {
    res.status(200).json({ ok: false, message: 'No summary available' });
    return;
  }

  const { data, error } = await supabase
    .from('load_summary_snapshots')
    .select('payload,generated_at')
    .eq('tenant_id', tenant.id)
    .eq('period_key', period)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    res.status(200).json({ ok: false, message: 'No summary available' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, summary: data.payload });
};
