async function resolveTenant(supabase, slug) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function domainAllowed(tenant, site, pageLocation) {
  const allowed = tenant.allowed_domains || [];
  if (!allowed.length) return true;
  if (site && allowed.includes(site)) return true;
  const host = hostnameOf(pageLocation);
  if (host && allowed.includes(host)) return true;
  return false;
}

module.exports = { resolveTenant, hostnameOf, domainAllowed };
