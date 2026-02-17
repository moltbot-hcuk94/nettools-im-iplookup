# nettools-im-iplookup

Dockerized IP lookup API for **nettools.im**.

## Features

- **GET /lookup?ip=** → combines:
  - **RDAP** lookup (via IANA bootstrap → query the correct registry RDAP service directly)
  - **MaxMind GeoLite2** ASN + City (if `.mmdb` present)
- **SQLite** caching for RDAP responses
- **Per-client rate limiting**: **24 requests / day** (by `req.ip`)
- **CORS allowlist**: defaults to `nettools.im` + `www.nettools.im`
- Optional **MaxMind DB updater** container (downloads GeoLite2 archives)

## Endpoints

### `GET /health`

Returns `{ ok: true }`.

### `GET /lookup?ip=1.1.1.1`

Response:

```json
{
  "ip": "1.1.1.1",
  "rdap": { "...": "..." },
  "rdapSource": "cache",
  "rdapFetchedAt": 1730000000000,
  "geo": {
    "asn": { "autonomous_system_number": 13335, "autonomous_system_organization": "..." },
    "city": { "country": "...", "location": { "latitude": 0, "longitude": 0 } }
  },
  "maxmind": {
    "cityDbPath": "/data/geoip/GeoLite2-City.mmdb",
    "asnDbPath": "/data/geoip/GeoLite2-ASN.mmdb",
    "cityLoaded": true,
    "asnLoaded": true
  }
}
```

## Configuration (env vars)

| Name | Default | Notes |
|---|---:|---|
| `PORT` | `3000` | API listen port |
| `HOST` | `0.0.0.0` | API listen host |
| `TRUST_PROXY` | `true` | Set to true behind reverse proxy so `req.ip` uses `X-Forwarded-For` |
| `CORS_ALLOWLIST` | `https://nettools.im,https://www.nettools.im` | Comma-separated origins |
| `SQLITE_PATH` | `/data/app.sqlite` | SQLite file (RDAP cache + rate limits) |
| `RDAP_CACHE_TTL_SECONDS` | `86400` | RDAP cache TTL |
| `RDAP_BASE_URL` | *(empty)* | Optional RDAP base URL override. Leave empty to use IANA bootstrap (recommended). |
| `RATE_LIMIT_DAILY` | `24` | Requests per client per UTC day |
| `GEOIP_DB_DIR` | `/data/geoip` | Directory for `.mmdb` files |
| `GEOIP_CITY_MMDB` | `GeoLite2-City.mmdb` | Filename in `GEOIP_DB_DIR` |
| `GEOIP_ASN_MMDB` | `GeoLite2-ASN.mmdb` | Filename in `GEOIP_DB_DIR` |

### MaxMind updater env vars

Used by `geoip-updater` service or `npm run geoip:update`:

| Name | Default | Notes |
|---|---:|---|
| `MAXMIND_LICENSE_KEY` | *(required)* | Your MaxMind license key |
| `MAXMIND_EDITION_IDS` | `GeoLite2-City,GeoLite2-ASN` | Comma-separated edition ids |
| `MAXMIND_UPDATE_INTERVAL_SECONDS` | `86400` | Only when running updater loop |

## Run with Docker Compose

1. Create a `data/` folder:

```bash
mkdir -p data/geoip
```

2. Provide your MaxMind key (for updater):

```bash
export MAXMIND_LICENSE_KEY=xxxx
```

3. Start:

```bash
docker compose up -d --build
```

- API: `http://localhost:3000/health`
- Lookup: `http://localhost:3000/lookup?ip=1.1.1.1`

## Local dev

```bash
npm install
npm run dev
```
