const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function toTime(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (n > 120000) return null;
  return n;
}

function toInt(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return n;
}

function toNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizePath(v) {
  if (typeof v !== 'string' || !v) return null;
  return v.startsWith('/') ? v : '/' + v;
}

function validTimestamp(v) {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function detectBrowser(ua) {
  ua = ua || '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/i.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Other';
}

function detectOS(ua) {
  ua = ua || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function deviceLabel(browser, isMobile, isIphone, isAndroid) {
  let device;
  if (isIphone) device = 'iPhone';
  else if (isAndroid) device = 'Android';
  else if (isMobile) device = 'Mobile';
  else device = 'Desktop';
  return device + ' / ' + browser;
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-ingest-secret');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const secret = req.headers['x-ingest-secret'];
  if (!secret || secret !== process.env.INGEST_SECRET) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: 'invalid_json' });
    return;
  }

  if (body.site !== process.env.ALLOWED_SITE) {
    res.status(403).json({ ok: false, error: 'forbidden_site' });
    return;
  }

  const ua = typeof body.user_agent === 'string' ? body.user_agent : '';
  const width = toInt(body.width);
  const height = toInt(body.height);
  const loadTime = toTime(body.load_time_ms);

  const isIphone = /iPhone/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = /Mobi|Android|iPhone|iPod|iPad/i.test(ua) || (width !== null && width < 768);
  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  const row = {
    event_timestamp: validTimestamp(body.timestamp) || new Date().toISOString(),
    site: body.site,
    page_location: typeof body.page_location === 'string' ? body.page_location : null,
    page_path: normalizePath(body.page_path),
    load_time_ms: loadTime,
    dom_ready_ms: toTime(body.dom_ready_ms),
    ttfb_ms: toTime(body.ttfb_ms),
    user_agent: ua || null,
    width: width,
    height: height,
    effective_type: typeof body.effective_type === 'string' ? body.effective_type : null,
    downlink: toNumber(body.downlink),
    is_mobile: isMobile,
    is_iphone: isIphone,
    is_android: isAndroid,
    browser: browser,
    os: os,
    device_label: deviceLabel(browser, isMobile, isIphone, isAndroid),
    is_slow: loadTime !== null && loadTime >= 5000,
    is_very_slow: loadTime !== null && loadTime >= 10000,
    raw: body
  };

  const { error } = await supabase.from('load_events').insert(row);
  if (error) {
    res.status(500).json({ ok: false, error: 'insert_failed' });
    return;
  }

  res.status(200).json({ ok: true });
};
