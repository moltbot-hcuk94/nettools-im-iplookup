import { ProxyAgent } from 'undici';

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

export async function fetchRdap({ ip, baseUrl, signal }) {
  // RDAP endpoints expect the IP literal in the path.
  // Using encodeURIComponent() breaks some RDAP servers for IPv6 because it encodes ':' as '%3A'.
  // Encode conservatively but keep ':' intact.
  const ipPath = encodeURIComponent(ip).replaceAll('%3A', ':');
  const url = new URL(ipPath, baseUrl).toString();
  const proxy = proxyForUrl(url);
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/rdap+json, application/json;q=0.9, */*;q=0.1'
    },
    signal,
    ...(dispatcher ? { dispatcher } : {})
  });
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
    return { source: 'cache', rdap: cached.rdap, fetchedAt: cached.fetchedAt };
  }

  const rdap = await fetchRdap({ ip, baseUrl });
  const fetchedAt = nowMs;
  await db.run(
    'INSERT INTO rdap_cache(ip, response_json, fetched_at) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET response_json=excluded.response_json, fetched_at=excluded.fetched_at',
    ip,
    JSON.stringify(rdap),
    fetchedAt
  );
  return { source: 'live', rdap, fetchedAt };
}
