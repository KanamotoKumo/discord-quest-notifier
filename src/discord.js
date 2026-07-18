// src/discord.js
import { DISCORD_TOKEN } from './config.js';
import { warn, error, log } from './logging.js';
import fs from 'fs/promises';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';

const DEFAULT_RETRIES = 3;
const RETRY_BASE_MS = 800;

/**
 * Simple sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Discord's rate limit on /quests/@me appears to be keyed to the account
 * token, not the source IP — a 429 from one proxy tends to arrive alongside
 * 429s from other, unrelated proxy IPs in the same time window. So instead
 * of each connection attempt (direct + every proxy) independently retrying
 * into the same wall, a 429 anywhere records a shared cooldown that every
 * other attempt checks before it even makes a request.
 */
let rateLimitedUntil = 0;

async function waitForSharedCooldown() {
  const waitMs = rateLimitedUntil - Date.now();
  if (waitMs > 0) {
    warn(`Waiting ${Math.ceil(waitMs / 1000)}s for a shared Discord rate limit to clear...`);
    await sleep(waitMs);
  }
}

function recordRateLimit(waitMs) {
  const until = Date.now() + waitMs;
  if (until > rateLimitedUntil) rateLimitedUntil = until;
}

/**
 * Fetch wrapper with retries for transient errors (429, 5xx)
 * options may include `agent` for proxy support
 */
async function fetchWithRetries(url, options = {}, retries = DEFAULT_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
    await waitForSharedCooldown();

    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      // network-level error: retry if attempts remain
      if (attempt <= retries) {
        const waitMs = RETRY_BASE_MS * attempt;
        warn(`Network error fetching ${url} — retrying ${attempt}/${retries} after ${waitMs}ms: ${err.message}`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }

    if (res.ok) return res;

    // Retry on rate limit or server errors
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt <= retries) {
      let retryAfter = res.headers.get('retry-after');
      if (!retryAfter && res.status === 429) {
        // Discord also includes retry_after in the JSON body; the header
        // should normally be present, but fall back to the body just in case.
        try {
          const bodyClone = await res.clone().json();
          if (bodyClone?.retry_after) retryAfter = bodyClone.retry_after;
        } catch (e) {
          // not JSON or already consumed — ignore
        }
      }
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : RETRY_BASE_MS * attempt;
      if (res.status === 429) recordRateLimit(waitMs);
      warn(`Discord API ${res.status} — retrying attempt ${attempt}/${retries} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

/**
 * Normalizes a proxy connection string into a URL HttpsProxyAgent can
 * actually use. Handles two shapes:
 *  - a proper URL already (scheme://user:pass@host:port) — returned as-is
 *  - "scheme://host:port:username:password", the format this repo's
 *    proxy.json originally used, exported directly from a proxy panel —
 *    this is NOT a valid URL (extra colons after the port) and would throw
 *    when passed straight to `new URL()`/HttpsProxyAgent, silently dropping
 *    every proxy since the failure was swallowed by a try/catch.
 */
function parseProxyString(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Already has credentials embedded properly (user:pass@host) — use as-is
  if (/\/\/[^/@]+@/.test(trimmed)) return trimmed;

  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  const scheme = schemeMatch ? schemeMatch[1] : 'http';
  const rest = schemeMatch ? schemeMatch[2] : trimmed;

  const parts = rest.split(':');
  if (parts.length < 2) return null;

  const [host, port, username, password] = parts;
  if (!host || !port) return null;

  if (username && password) {
    return `${scheme}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  if (username) {
    return `${scheme}://${encodeURIComponent(username)}@${host}:${port}`;
  }
  return `${scheme}://${host}:${port}`;
}

/**
 * Parses a PROXY_LIST env var value — accepts either a JSON array
 * (`["https://...", ...]`), a JSON object (`{"proxies": [...]}`), or a
 * plain newline/comma-separated list of proxy strings.
 */
function parseProxyListValue(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.proxies)) return parsed.proxies;
  } catch (e) {
    // not JSON — fall through to plain-list parsing
  }
  return trimmed.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
}

/**
 * Fetch a remote proxy list (e.g. a GitHub Gist raw URL) — used when the
 * list is too large to fit in a GitHub Actions secret (secrets have a size
 * limit; PROXY_LIST hit it). Accepts the same shapes as parseProxyListValue.
 */
async function fetchRemoteProxyList(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      warn(`PROXY_LIST_URL fetch failed: ${res.status}`);
      return [];
    }
    const text = await res.text();
    return parseProxyListValue(text);
  } catch (err) {
    warn(`PROXY_LIST_URL fetch error: ${err.message}`);
    return [];
  }
}

/** Collapses proxies pointing at the same host (ignoring port) down to one
 * — a single physical server exposed on many ports (seen in some free
 * proxy lists) would otherwise be tried dozens of times for no benefit. */
function dedupeByHost(proxyUrls) {
  const seen = new Set();
  const result = [];
  for (const p of proxyUrls) {
    let host;
    try {
      host = new URL(p).hostname;
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    result.push(p);
  }
  return result;
}

/**
 * Load the proxy list. Checked in order, first one that yields anything wins:
 *   1. PROXY_LIST_URL — a raw URL (e.g. a Gist) to fetch the list from at
 *      runtime. Use this when the list is too big for a GitHub secret.
 *   2. PROXY_LIST — the list inline, as a secret/env var (fine for shorter
 *      lists).
 *   3. proxy.json — local file, for local development only. Meant to stay
 *      empty/placeholder in the repo (see its own comment) and is in
 *      .gitignore so a locally-filled-in copy won't get committed by accident.
 * Result is deduplicated by host regardless of source.
 */
async function loadProxyList() {
  let list = [];

  if (process.env.PROXY_LIST_URL) {
    const fromUrl = (await fetchRemoteProxyList(process.env.PROXY_LIST_URL))
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(parseProxyString)
      .filter(Boolean);
    if (fromUrl.length) list = fromUrl;
    else warn('PROXY_LIST_URL is set but returned no usable proxy strings — falling back.');
  }

  if (!list.length && process.env.PROXY_LIST) {
    const fromEnv = parseProxyListValue(process.env.PROXY_LIST)
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(parseProxyString)
      .filter(Boolean);
    if (fromEnv.length) list = fromEnv;
    else warn('PROXY_LIST is set but contained no usable proxy strings.');
  }

  if (!list.length) {
    try {
      const p = path.resolve(process.cwd(), 'proxy.json');
      const raw = await fs.readFile(p, 'utf8').catch(() => null);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.proxies)) {
          list = parsed.proxies
            .map(s => String(s).trim())
            .filter(Boolean)
            .map(parseProxyString)
            .filter(Boolean);
        }
      }
    } catch (err) {
      warn(`Failed to load proxy.json: ${err.message}`);
    }
  }

  const deduped = dedupeByHost(list);
  if (list.length && deduped.length < list.length) {
    log(`Deduplicated proxy list: ${list.length} entries -> ${deduped.length} unique host(s).`);
  }
  return deduped;
}

/**
 * Internal helper to perform the actual API call and parse JSON.
 * Accepts optional fetch options (headers, agent, etc).
 */
async function callQuestsApi(options = {}) {
  const url = 'https://discord.com/api/v9/quests/@me';
  const headers = {
    Authorization: DISCORD_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'X-Super-Properties': Buffer.from(JSON.stringify({
      os: 'Windows',
      browser: 'Chrome',
      device: '',
    })).toString('base64'),
  };

  const fetchOptions = { headers, ...options };

  const res = await fetchWithRetries(url, fetchOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}: ${body}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Failed to parse Discord response JSON: ${err.message}`);
  }

  // Normalize response shape
  if (Array.isArray(data.quests)) return data.quests;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data?.quests)) return data.quests;
  return [];
}

/** Never log full proxy URLs — they contain credentials. Host:port only. */
function maskProxy(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return '(invalid proxy url)';
  }
}

/**
 * Fetch quests for the authorized account.
 *
 * Calls direct AND every configured proxy (not just "try direct, fall back
 * to proxies only if direct fails/is empty") — different regions can see
 * different (locked) quests, so checking only one source misses quests that
 * only show up from other countries. Results are merged and deduplicated
 * by quest id.
 *
 * Proxies run with limited concurrency (PROXY_CONCURRENCY, default 5) so a
 * long proxy list doesn't run entirely sequentially, but also doesn't fire
 * everything at once.
 *
 * Throws only if EVERY source (direct + all proxies) failed — if at least
 * one source returned data, that data is returned even if others failed.
 */
export async function fetchQuests() {
  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is not set');
  }

  const questsById = new Map();
  let successCount = 0;
  const mergeIn = (quests) => {
    let newCount = 0;
    for (const q of quests) {
      if (!q?.id) continue;
      if (!questsById.has(q.id)) newCount++;
      questsById.set(q.id, q);
    }
    return newCount;
  };

  // Direct connection (the account's own real IP/region)
  try {
    const direct = await callQuestsApi();
    if (Array.isArray(direct)) {
      const newCount = mergeIn(direct);
      log(`Direct connection: ${direct.length} quest(s) (${newCount} new).`);
      successCount++;
    }
  } catch (err) {
    warn(`Direct fetch failed: ${err.message}`);
  }

  // Every proxy — each simulates a different region, which can reveal
  // quests that are locked/hidden from the direct connection's own region.
  const proxies = await loadProxyList();
  if (!proxies.length) {
    warn('No proxies configured (set PROXY_LIST_URL, PROXY_LIST, or fill in proxy.json locally). Direct-only this run.');
  } else {
    log(`Checking ${proxies.length} proxy/proxies for region-locked quests...`);
    const concurrency = Math.max(1, Number(process.env.PROXY_CONCURRENCY) || 2);

    for (let i = 0; i < proxies.length; i += concurrency) {
      const batch = proxies.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async proxyUrl => {
          if (!proxyUrl) return;
          const label = maskProxy(proxyUrl);
          try {
            let agent;
            try {
              agent = new HttpsProxyAgent(proxyUrl);
            } catch (err) {
              warn(`Invalid proxy ${label}: ${err.message}`);
              return;
            }

            const quests = await callQuestsApi({ agent });
            if (Array.isArray(quests)) {
              const newCount = mergeIn(quests);
              log(`Proxy ${label}: ${quests.length} quest(s) (${newCount} new).`);
              successCount++;
            }
          } catch (err) {
            warn(`Proxy ${label} failed: ${err.message}`);
          }
        })
      );
    }
  }

  if (successCount === 0) {
    throw new Error('All connection attempts failed (direct and every proxy) — could not reach Discord.');
  }

  const merged = Array.from(questsById.values());
  log(`Merged total: ${merged.length} unique quest(s) from ${successCount} successful source(s).`);
  return merged;
}
