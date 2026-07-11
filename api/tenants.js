const crypto = require('crypto');
const { getServiceClient } = require('../lib/supabase');

function authorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const h = req.headers || {};
  if (h['x-admin-secret'] === secret) return true;
  if (h['authorization'] === 'Bearer ' + secret) return true;
  const q = req.query || {};
  if (q.secret === secret) return true;
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

function newToken(prefix) {
  return prefix + crypto.randomBytes(20).toString('hex');
}

function deriveSlug(site) {
  const s = String(site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return s.split('.')[0] || 'tenant';
}

function toDomains(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function toNum(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-admin-secret');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!authorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }

  const supabase = getServiceClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: true });
    if (error) { res.status(500).json({ ok: false, error: 'query_failed' }); return; }
    res.status(200).json({ ok: true, tenants: data });
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') { res.status(400).json({ ok: false, error: 'invalid_json' }); return; }

    const fields = {
      name: body.name,
      site: body.site,
      allowed_domains: toDomains(body.allowed_domains),
      is_active: body.is_active !== false,
      retention_hours: toNum(body.retention_hours, 3),
      aggregation_freshness_minutes: toInt(body.aggregation_freshness_minutes, 1),
      default_period_key: body.default_period_key || '60m',
      min_group_size: toInt(body.min_group_size, 5),
      slow_threshold_ms: toInt(body.slow_threshold_ms, 5000),
      very_slow_threshold_ms: toInt(body.very_slow_threshold_ms, 10000),
      sample_rate: toNum(body.sample_rate, 0.10),
      timezone: body.timezone || 'America/Sao_Paulo',
      updated_at: new Date().toISOString()
    };

    if (typeof body.tag_host === 'string' && body.tag_host) fields.tag_host = body.tag_host;

    if (body.id) {
      if (body.regenerate_token) fields.ingest_token = newToken('ing_');
      if (body.regenerate_view_token) fields.view_token = newToken('view_');
      const { data, error } = await supabase.from('tenants').update(fields).eq('id', body.id).select().maybeSingle();
      if (error) { res.status(500).json({ ok: false, error: 'update_failed', detail: error.message }); return; }
      res.status(200).json({ ok: true, tenant: data });
      return;
    }

    if (!fields.name || !fields.site) {
      res.status(400).json({ ok: false, error: 'missing_fields' });
      return;
    }
    const rawSlug = String(body.slug || '').trim().toLowerCase();
    fields.slug = rawSlug || deriveSlug(fields.site);
    fields.ingest_token = newToken('ing_');
    fields.view_token = newToken('view_');
    const { data, error } = await supabase.from('tenants').insert(fields).select().maybeSingle();
    if (error) { res.status(500).json({ ok: false, error: 'insert_failed', detail: error.message }); return; }
    res.status(200).json({ ok: true, tenant: data });
    return;
  }

  res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
