function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, Math.min(s.length - 1, idx))];
}

function round(v) {
  return v == null ? null : Math.round(v);
}

function pct(n, total) {
  return total ? (n / total) * 100 : 0;
}

function classify(load, tenant) {
  if (load == null) return null;
  if (load >= tenant.very_slow_threshold_ms) return 'verySlow';
  if (load >= tenant.slow_threshold_ms) return 'slow';
  if (load < 1000) return 'veryFast';
  if (load < 3000) return 'fast';
  return 'ok';
}

function buildGroup(key, list, tenant) {
  const withLoad = list.filter(e => e.load_time_ms != null);
  const loads = withLoad.map(e => e.load_time_ms);
  const base = withLoad.length;

  let veryFastCount = 0, fastCount = 0, okCount = 0, slowCount = 0, verySlowCount = 0;
  for (const e of withLoad) {
    const c = classify(e.load_time_ms, tenant);
    if (c === 'veryFast') veryFastCount++;
    else if (c === 'fast') fastCount++;
    else if (c === 'ok') okCount++;
    else if (c === 'slow') slowCount++;
    else if (c === 'verySlow') verySlowCount++;
  }

  const slowOrVerySlowPercent = pct(slowCount + verySlowCount, base);
  const verySlowPercent = pct(verySlowCount, base);

  return {
    key,
    total: list.length,
    veryFastCount, fastCount, okCount, slowCount, verySlowCount,
    veryFastPercent: pct(veryFastCount, base),
    fastPercent: pct(fastCount, base),
    okPercent: pct(okCount, base),
    slowPercent: pct(slowCount, base),
    verySlowPercent,
    slowOrVerySlowPercent,
    avgLoadMs: round(mean(loads)),
    avgTtfbMs: round(mean(withLoad.map(e => e.ttfb_ms).filter(v => v != null))),
    avgDomReadyMs: round(mean(withLoad.map(e => e.dom_ready_ms).filter(v => v != null))),
    p75LoadMs: round(percentile(loads, 75)),
    p90LoadMs: round(percentile(loads, 90)),
    p95LoadMs: round(percentile(loads, 95)),
    score: slowOrVerySlowPercent + verySlowPercent * 2
  };
}

function groupRanking(events, keyFn, tenant) {
  const map = new Map();
  for (const e of events) {
    const k = keyFn(e);
    if (k == null || k === '') continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const groups = [];
  map.forEach((list, k) => groups.push(buildGroup(k, list, tenant)));
  groups.sort((a, b) => (b.total - a.total) || (b.score - a.score));
  return groups.slice(0, 5000);
}

module.exports = { mean, percentile, round, pct, classify, buildGroup, groupRanking };
