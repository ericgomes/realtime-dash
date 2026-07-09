const { getServiceClient } = require('../lib/supabase');
const { buildGroup, groupRanking, pct, classify } = require('../lib/metrics');

const PERIODS = [
  { key: '15m', minutes: 15 },
  { key: '30m', minutes: 30 },
  { key: '60m', minutes: 60 },
  { key: '3h', minutes: 180 },
  { key: '6h', minutes: 360 },
  { key: '24h', minutes: 1440 }
];

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers || {};
  if (h['authorization'] === 'Bearer ' + secret) return true;
  if (h['x-cron-secret'] === secret) return true;
  const q = req.query || {};
  if (q.secret === secret) return true;
  return false;
}

async function fetchEvents(supabase, tenantId, startISO, endISO) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase
      .from('load_events')
      .select('load_time_ms,ttfb_ms,dom_ready_ms,page_path,device_label,browser,os,effective_type,is_iphone')
      .eq('tenant_id', tenantId)
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > 200000) break;
  }
  return all;
}

function overallStats(events, tenant) {
  const g = buildGroup('overall', events, tenant);
  const withLoad = events.filter(e => e.load_time_ms != null);
  const iph = withLoad.filter(e => e.is_iphone);
  let iphSlow = 0;
  for (const e of iph) {
    const c = classify(e.load_time_ms, tenant);
    if (c === 'slow' || c === 'verySlow') iphSlow++;
  }
  return {
    total: g.total,
    veryFastPercent: g.veryFastPercent,
    fastPercent: g.fastPercent,
    okPercent: g.okPercent,
    slowPercent: g.slowPercent,
    verySlowPercent: g.verySlowPercent,
    slowOrVerySlowPercent: g.slowOrVerySlowPercent,
    avgLoadMs: g.avgLoadMs,
    p75LoadMs: g.p75LoadMs,
    p90LoadMs: g.p90LoadMs,
    p95LoadMs: g.p95LoadMs,
    avgTtfbMs: g.avgTtfbMs,
    avgDomReadyMs: g.avgDomReadyMs,
    iphoneSlowPercent: pct(iphSlow, iph.length)
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const supabase = getServiceClient();
  const { data: tenants, error } = await supabase.from('tenants').select('*').eq('is_active', true);
  if (error) {
    res.status(500).json({ ok: false, error: 'tenants_query_failed' });
    return;
  }

  const now = Date.now();
  let generated = 0;
  let skipped = 0;
  const results = [];

  for (const tenant of (tenants || [])) {
    for (const p of PERIODS) {
      const { data: last } = await supabase
        .from('load_summary_snapshots')
        .select('generated_at')
        .eq('tenant_id', tenant.id)
        .eq('period_key', p.key)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (last) {
        const ageMin = (now - new Date(last.generated_at).getTime()) / 60000;
        if (ageMin < tenant.aggregation_freshness_minutes) { skipped++; continue; }
      }

      const windowEnd = new Date(now);
      const windowStart = new Date(now - p.minutes * 60000);
      const events = await fetchEvents(supabase, tenant.id, windowStart.toISOString(), windowEnd.toISOString());
      const overall = overallStats(events, tenant);

      const payload = {
        generatedAt: new Date(now).toISOString(),
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          site: tenant.site,
          timezone: tenant.timezone,
          minGroupSize: tenant.min_group_size,
          slowThresholdMs: tenant.slow_threshold_ms,
          verySlowThresholdMs: tenant.very_slow_threshold_ms,
          sampleRate: tenant.sample_rate,
          defaultPeriodKey: tenant.default_period_key
        },
        periodKey: p.key,
        periodMinutes: p.minutes,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        overall,
        byPage: groupRanking(events, e => e.page_path, tenant),
        byDevice: groupRanking(events, e => e.device_label, tenant),
        byBrowser: groupRanking(events, e => e.browser, tenant),
        byOs: groupRanking(events, e => e.os, tenant),
        byConnection: groupRanking(events, e => e.effective_type || 'unknown', tenant)
      };

      const row = {
        tenant_id: tenant.id,
        site: tenant.site,
        period_key: p.key,
        period_minutes: p.minutes,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        total_events: overall.total,
        slow_percent: overall.slowOrVerySlowPercent,
        very_slow_percent: overall.verySlowPercent,
        avg_load_ms: overall.avgLoadMs,
        p75_load_ms: overall.p75LoadMs,
        p90_load_ms: overall.p90LoadMs,
        p95_load_ms: overall.p95LoadMs,
        avg_ttfb_ms: overall.avgTtfbMs,
        avg_dom_ready_ms: overall.avgDomReadyMs,
        iphone_slow_percent: overall.iphoneSlowPercent,
        payload
      };

      const { error: insErr } = await supabase.from('load_summary_snapshots').insert(row);
      if (!insErr) {
        generated++;
        results.push({ tenant: tenant.slug, period: p.key, total: overall.total });
      }
    }

    const cutoff = new Date(now - tenant.retention_days * 86400000).toISOString();
    await supabase.from('load_events').delete().eq('tenant_id', tenant.id).lt('created_at', cutoff);
  }

  const snapCutoff = new Date(now - 7 * 86400000).toISOString();
  await supabase.from('load_summary_snapshots').delete().lt('generated_at', snapCutoff);

  res.status(200).json({ ok: true, generated, skipped, results });
};
