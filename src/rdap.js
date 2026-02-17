import { ProxyAgent } from 'undici';
import { resolveRdapBaseUrlForIp } from './rdap_bootstrap.js';

function parseNoProxy() {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function hostMatchesNoProxy(host, noProxyList) {
  if (!host) return false;
  return noProxyList.some(entry => {
    if (entry === '*') return true;
    if (entry.startsWith('.')) return host.endsWith(entry);
    return host === entry;
  });
}

function proxyForUrl(urlStr) {
  const u = new URL(urlStr);
  const noProxy = parseNoProxy();
  if (hostMatchesNoProxy(u.hostname, noProxy)) return null;

  if (u.protocol === 'https:') {
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  if (u.protocol === 'http:') {
    return process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  return null;
}

function normalizeRdapBaseUrlForIpQuery(baseUrl) {
  // IANA bootstrap returns service base URLs like:
  //   https://rdap.apnic.net/
  // ARIN returns:
  //   https://rdap.arin.net/registry/
  // For IP queries, servers generally expect /ip/<addr> under that base.
  const u = new URL(baseUrl);
  // Ensure trailing slash
  if (!u.pathname.endsWith('/')) u.pathname += '/';

  const p = u.pathname;
  if (p.endsWith('/ip/') || p.endsWith('/ip')) return u.toString();

  // Append ip/
  u.pathname = p + 'ip/';
  return u.toString();
}

export async function fetchRdap({ ip, baseUrl, signal }) {
  const effectiveBaseUrl = normalizeRdapBaseUrlForIpQuery(baseUrl);

  // RDAP endpoints expect the IP literal in the path.
  // Using encodeURIComponent() breaks some RDAP servers for IPv6 because it encodes ':' as '%3A'.
  // Encode conservatively but keep ':' intact.
  const ipPath = encodeURIComponent(ip).replaceAll('%3A', ':');
  const url = new URL(ipPath, effectiveBaseUrl).toString();
  const proxy = proxyForUrl(url);
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/rdap+json, application/json;q=0.9, */*;q=0.1'
      },
      signal,
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (e) {
    // Network/TLS/DNS failures throw (TypeError: fetch failed). Surface as 502.
    const err = new Error('RDAP fetch failed');
    err.status = 502;
    err.body = {
      code: 'rdap_fetch_failed',
      url,
      cause: String(e?.cause?.message || e?.message || e)
    };
    throw err;
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`RDAP request failed (${res.status})`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function getRdapCacheOnly({ db, ip, ttlSeconds, nowMs = Date.now() }) {
  const row = await db.get('SELECT response_json, fetched_at FROM rdap_cache WHERE ip = ?', ip);
  if (!row) return { hit: false };

  const ageSeconds = (nowMs - row.fetched_at) / 1000;
  if (ageSeconds > ttlSeconds) return { hit: false };

  return { hit: true, rdap: JSON.parse(row.response_json), fetchedAt: row.fetched_at };
}

export async function getRdapCached({ db, ip, ttlSeconds, baseUrl, nowMs = Date.now() }) {
  const cached = await getRdapCacheOnly({ db, ip, ttlSeconds, nowMs });
  if (cached.hit) {
    return { source: 'cache', rdap: cached.rdap, fetchedAt: cached.fetchedAt, resolved: null };
  }

  // Resolve the correct RDAP registry endpoint via IANA bootstrap.
  // This avoids depending on third-party aggregators like rdap.org.
  let resolvedBaseUrl = baseUrl;
  if (!resolvedBaseUrl || resolvedBaseUrl === 'bootstrap') {
    resolvedBaseUrl = await resolveRdapBaseUrlForIp(ip);
  }
  if (!resolvedBaseUrl) {
    const err = new Error('RDAP bootstrap could not resolve an endpoint for this IP');
    err.status = 502;
    err.body = { code: 'rdap_bootstrap_failed' };
    throw err;
  }

  const rdap = await fetchRdap({ ip, baseUrl: resolvedBaseUrl });

  const fetchedAt = nowMs;
  const resolved = { baseUrl: resolvedBaseUrl };
  await db.run(
    'INSERT INTO rdap_cache(ip, response_json, fetched_at) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET response_json=excluded.response_json, fetched_at=excluded.fetched_at',
    ip,
    JSON.stringify(rdap),
    fetchedAt
  );
  return { source: 'live', rdap, fetchedAt, resolved };
}
