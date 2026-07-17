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
 * Fetch wrapper with retries for transient errors (429, 5xx)
 * options may include `agent` for proxy support
 */
async function fetchWithRetries(url, options = {}, retries = DEFAULT_RETRIES) {
  let attempt = 0;
  while (true) {
    attempt++;
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
      const retryAfter = res.headers.get('retry-after');
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : RETRY_BASE_MS * attempt;
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

/**
 * Load the proxy list. Checked in order, first one that yields anything wins:
 *   1. PROXY_LIST_URL — a raw URL (e.g. a Gist) to fetch the list from at
 *      runtime. Use this when the list is too big for a GitHub secret.
 *   2. PROXY_LIST — the list inline, as a secret/env var (fine for shorter
 *      lists).
 *   3. proxy.json — local file, for local development only. Meant to stay
 *      empty/placeholder in the repo (see its own comment) and is in
 *      .gitignore so a locally-filled-in copy won't get committed by accident.
 */
async function loadProxyList() {
  if (process.env.PROXY_LIST_URL) {
    const fromUrl = (await fetchRemoteProxyList(process.env.PROXY_LIST_URL))
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(parseProxyString)
      .filter(Boolean);
    if (fromUrl.length) return fromUrl;
    warn('PROXY_LIST_URL is set but returned no usable proxy strings — falling back.');
  }

  if (process.env.PROXY_LIST) {
    const fromEnv = parseProxyListValue(process.env.PROXY_LIST)
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(parseProxyString)
      .filter(Boolean);
    if (fromEnv.length) return fromEnv;
    warn('PROXY_LIST is set but contained no usable proxy strings.');
  }

  try {
    const p = path.resolve(process.cwd(), 'proxy.json');
    const raw = await fs.readFile(p, 'utf8').catch(() => null);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.proxies)) return [];
    return parsed.proxies
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(parseProxyString)
      .filter(Boolean);
  } catch (err) {
    warn(`Failed to load proxy.json: ${err.message}`);
    return [];
  }
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

/**
 * Fetch quests for the authorized account
 * Tries direct request first; if no useful data and proxies are configured
 * (via PROXY_LIST env var or local proxy.json), will try proxies in sequence.
 * Returns an array (possibly empty) of quests.
 */
export async function fetchQuests() {
  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is not set');
  }

  // Try direct first
  try {
    const direct = await callQuestsApi();
    // If direct returned something (non-empty array) return it immediately
    if (Array.isArray(direct) && direct.length > 0) {
      log(`Fetched ${direct.length} quests via direct connection.`);
      return direct;
    }
    // If direct returned empty, we may still want to try proxies (to discover region-locked quests)
    warn('Direct fetch returned no quests; will attempt proxies if available.');
  } catch (err) {
    // Log and continue to proxy attempts
    warn(`Direct fetch failed: ${err.message}. Will attempt proxies if available.`);
  }

  // Load proxies (optional)
  const proxies = await loadProxyList();
  if (!proxies || proxies.length === 0) {
    warn('No proxies configured (set PROXY_LIST or fill in proxy.json locally). Returning direct result (empty).');
    return [];
  }

  // Try proxies in order (you can randomize if preferred)
  for (const proxyUrl of proxies) {
    if (!proxyUrl) continue;
    try {
      // Create agent for proxy
      let agent;
      try {
        agent = new HttpsProxyAgent(proxyUrl);
      } catch (err) {
        warn(`Invalid proxy URL ${proxyUrl}: ${err.message}`);
        continue;
      }

      // Call API via proxy agent
      const quests = await callQuestsApi({ agent });
      if (Array.isArray(quests) && quests.length > 0) {
        log(`Fetched ${quests.length} quests via proxy ${proxyUrl}`);
        return quests;
      } else {
        warn(`Proxy ${proxyUrl} returned no quests.`);
      }
    } catch (err) {
      warn(`Proxy ${proxyUrl} failed: ${err.message}`);
      // try next proxy
    }
  }

  // If we reach here, no proxy returned quests
  warn('All proxies tried and no quests found. Returning empty list.');
  return [];
}
