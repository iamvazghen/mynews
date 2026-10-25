const path = require("path");
const express = require("express");
const Parser = require("rss-parser");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { CATEGORIES, FEEDS, PERIODIC } = require("./feeds");
const { getAdapter } = require("./adapters");
const { buildServer } = require("./mcp");

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "newsfeed/1.0 (+rss aggregator)" },
  // Google News wraps every item in <source url="...">Publisher</source>; keep it so
  // we can show the real publisher instead of "news.google.com".
  customFields: { item: ["source"] },
});

// Caching is per SOURCE, not per category, so each source can refresh on its
// own schedule. That matters because the keyed providers have tiny free-tier
// quotas (GNews: 100 requests/day) and a flat 5-minute category cache would
// blow them instantly — a category is re-fetched every time its cache expires.
const DEFAULT_TTL_MS = 5 * 60 * 1000; // keyless RSS
const AUTH_TTL_MS = 60 * 60 * 1000; // keyed sources: their quota is per day
const sourceCache = new Map(); // source url -> { at, items }
const feedHealth = new Map(); // source key -> { ok, at, items, error, skipped }

const FETCH_TIMEOUT_MS = 10000;
// A cold start fetches ~285 sources. Going higher looks faster on paper but
// is not: publishers treat a burst from one IP as abuse. Measured cold start
// (285 sources, all keys live):
//   concurrency 24 -> 93s, 14 dead feeds
//   concurrency 20 -> 33s,  4 dead feeds
//   concurrency 16 -> 30s,  3 dead feeds
// 16 it is. The per-host spacing below matters more than the global cap.
const MAX_CONCURRENT_FEEDS = 16;
const MAX_CONCURRENT_PER_HOST = 3; // one publisher must not get hammered
const MAX_ATTEMPTS = 2; // one retry — transient resets and 429s clear fast
const RETRY_BACKOFF_MS = 400;

// A slow host is a dead host. Timing out twice costs two full timeouts and
// holds a concurrency slot for the whole of each, which is what turns a
// cold start into a timeout for the request. One attempt, then move on.

const USER_AGENT = "newsfeed/1.0 (+rss aggregator; https://github.com/iamvazghen/mynews)";

// article-extractor is ESM-only; lazy dynamic import keeps this file CommonJS.
let _extract;
async function getExtractor() {
  if (!_extract) ({ extract: _extract } = await import("@extractus/article-extractor"));
  return _extract;
}

// --- concurrency limiter ---
//
// A global ceiling plus a per-host ceiling. Both matter: with ~230 sources a
// cold start hammers the same publishers (several Google News searches, six
// hnrss queries), and the excess connections get reset. Per-host capping keeps
// us polite and stops a burst from taking down a whole category.

let active = 0;
const hostActive = new Map();
const waiters = [];

function tryAcquire(host) {
  const h = hostActive.get(host) || 0;
  if (active < MAX_CONCURRENT_FEEDS && h < MAX_CONCURRENT_PER_HOST) {
    active++;
    hostActive.set(host, h + 1);
    return true;
  }
  return false;
}

function acquire(host) {
  if (tryAcquire(host)) return Promise.resolve();
  return new Promise((resolve) => waiters.push({ host, resolve }));
}

function release(host) {
  active--;
  hostActive.set(host, Math.max(0, (hostActive.get(host) || 1) - 1));
  // wake the first waiter whose host has room again
  for (let i = 0; i < waiters.length; i++) {
    if (tryAcquire(waiters[i].host)) {
      const [w] = waiters.splice(i, 1);
      w.resolve();
      break;
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hosts with hard request limits, and the minimum gap we leave between calls
// to the same host. Tuned by measurement, not guesswork:
//
//   content.guardianapis.com — 60 requests/MINUTE, no per-second cap. A burst
//     of 9 returned 200 with the minute budget untouched, so 150ms is plenty.
//   gnews.io — documented as 1 request/second; 8 concurrent gave six 429s.
//     This is the one chain that genuinely serialises the cold start.
//   hnrss.org — no longer used; Hacker News comes from the Algolia index.
//   api.twelvedata.com — 8 API credits/minute; a 5-symbol batch costs 5.
const HOST_MIN_INTERVAL_MS = {
  "content.guardianapis.com": 150,
  "gnews.io": 1100,
  "hnrss.org": 700, // kept for any future hnrss source; unused today
  "newsapi.org": 300,
  "api.twelvedata.com": 1200,
  "www.reddit.com": 600,
  "api.themoviedb.org": 300,
};
const hostLastRequest = new Map();

// Reserve this host's next slot and wait for it. Reserving (rather than
// just sleeping) keeps two concurrent callers from grabbing the same gap.
async function reserveHostSlot(host) {
  const gap = HOST_MIN_INTERVAL_MS[host];
  if (!gap) return;
  const last = hostLastRequest.get(host) || 0;
  const startAt = Math.max(Date.now(), last + gap);
  hostLastRequest.set(host, startAt);
  const wait = startAt - Date.now();
  if (wait > 0) await sleep(wait);
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

// --- XML hardening ---

// Some publishers ship unescaped "&" inside image srcset attributes
// (restofworld.org is the canonical case). xml2js aborts the whole feed on that,
// so escape bare ampersands before parsing — but leave CDATA sections alone.
function relaxXml(xml) {
  return String(xml)
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g)
    .map((part) =>
      part.startsWith("<![CDATA[")
        ? part
        : part.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
    )
    .join("");
}

// --- pure helpers (exported so test.js can hit them without a server) ---

function readingMinutes(html) {
  const words = String(html || "").replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200)); // ponytail: 200 wpm is the accepted average
}

function pickImage(item) {
  if (item.image) return item.image;
  if (item.enclosure && /^image\//.test(item.enclosure.type || "") && item.enclosure.url) {
    return item.enclosure.url;
  }
  const body = item["content:encoded"] || item.content || "";
  const m = body.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

// The publisher shown on a card. Usually the article's own hostname, but Google
// News links route through news.google.com — there we use the <source> publisher.
function pickSource(item, slug) {
  const gnews = typeof item.source === "string" ? item.source.trim() : "";
  let host = null;
  try { host = item.link ? new URL(item.link).hostname.replace(/^www\./, "") : null; } catch {}
  if (gnews && (!host || host === "news.google.com")) return gnews;
  return host || slug;
}

function normalize(item, slug, fallbackDate, feedUrl) {
  const body = item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
  const text = String(item.contentSnippet || item.content || item.summary || "").replace(/<[^>]*>/g, "").trim();
  const out = {
    title: (item.title || "(untitled)").trim(),
    link: item.link || null,
    source: pickSource(item, slug),
    category: slug,
    publishedAt: item.isoDate || item.pubDate || fallbackDate || null,
    readingMinutes: readingMinutes(body),
    snippet: text.slice(0, 240),
    image: pickImage(item),
  };
  // Which feed this came from. Non-enumerable, so it never reaches the API
  // response, but filterSort() needs it to reason per-feed about staleness.
  if (feedUrl) Object.defineProperty(out, "feed", { value: feedUrl, enumerable: false });
  return out;
}

// Feeds that ship no timestamps at all (GitHub Trending, Nikkei Asia) would be
// dropped by the `since` window, so give them a bounded fallback date: the
// feed's own newest dated item, or the fetch time when the feed has none.
function resolveFallbackDate(items, fetchedAt) {
  const dates = items.map((i) => i.isoDate || i.pubDate).filter(Boolean).sort();
  const newest = dates.length ? new Date(dates[dates.length - 1]) : null;
  const now = new Date(fetchedAt);
  if (!newest || Number.isNaN(newest.getTime())) return now.toISOString();
  // never claim an undated item is newer than the feed's own newest entry
  return (newest < now ? newest : now).toISOString();
}

// Filter + sort a flat item list. Pure → unit-tested.
// `sticky` holds category slugs that publish on a schedule (see PERIODIC in
// feeds.js). For those, the newest batch is always kept even when it falls
// outside the `since` window — otherwise a rolling 24h window on a Sunday
// would hide Friday's FX reference rates and an agent would wrongly report
// that no rates exist.
function filterSort(items, { sinceHours = 0, q = "", sort = "newest", sticky = new Set() } = {}) {
  let out = items;
  if (sinceHours > 0) {
    const cut = Date.now() - sinceHours * 3600 * 1000;
    // Newest item per FEED, not per category. A daily-rate feed and a live
    // quote feed live in the same category but publish on different
    // schedules — keeping only the category's newest day would throw away
    // the rates in favour of the quote.
    const newestByFeed = new Map();
    for (const i of out) {
      const group = i.feed || i.category;
      const t = i.publishedAt ? new Date(i.publishedAt).getTime() : 0;
      if (!newestByFeed.has(group) || t > newestByFeed.get(group)) newestByFeed.set(group, t);
    }
    out = out.filter((i) => {
      const t = i.publishedAt ? new Date(i.publishedAt).getTime() : 0;
      if (t >= cut) return true;
      if (!sticky.has(i.category)) return false;
      // Same UTC day as that feed's own newest item — a day's rates can be
      // published in two batches (ECB morning + afternoon fix, plus RBA).
      const day = (ms) => new Date(ms).toISOString().slice(0, 10);
      return day(t) === day(newestByFeed.get(i.feed || i.category));
    });
  }
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((i) => (i.title + " " + i.snippet).toLowerCase().includes(needle));
  }
  return [...out].sort((a, b) => {
    if (sort === "category" && a.category !== b.category) return a.category.localeCompare(b.category);
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });
}

// --- sources ---
//
// A source is either a plain RSS URL (kept as a string in feeds.js) or a typed
// object. Plain strings are normalised once here so the fetch path only ever
// deals with objects.

function normalizeSources(list) {
  return list.map((e) => (typeof e === "string" ? { type: "rss", url: e } : e));
}

const SOURCES = Object.fromEntries(
  Object.entries(FEEDS).map(([slug, list]) => [slug, normalizeSources(list)])
);

// Reddit's OAuth2 client-credentials flow, token fetched per request (they
// last an hour, but a per-request token costs one call and never goes stale).
async function redditAccessToken(id, secret) {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`reddit token: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error(`reddit token: ${body.error || "no access_token"}`);
  return body.access_token;
}

// Resolve credentials. A source whose credentials are absent is SKIPPED, not
// failed — so the feed list can name every integration and still work with
// only some of them configured.
function resolveAuth(src) {
  const a = src.auth;
  if (!a) return { ok: true, url: src.url, headers: {} };

  if (a.type === "reddit-oauth") {
    const id = (process.env[a.env] || "").trim();
    const secret = (process.env[a.secretEnv] || "").trim();
    if (!id || !secret) return { ok: false, reason: `needs ${a.env} + ${a.secretEnv}` };
    return { ok: true, url: src.url, headers: {}, oauth: { id, secret } };
  }

  const token = process.env[a.env];
  // Trim: a stray newline or space in an env var makes several providers
  // answer "you did not provide an API key" rather than "invalid key", which
  // is a confusing way to fail. (GNews does exactly this.)
  if (!token || !token.trim()) return { ok: false, reason: `needs ${a.env}` };
  const clean = token.trim();
  const headers = {};
  if (a.header) headers[a.header] = clean;
  return {
    ok: true,
    url: src.url.replace(/\{\{auth\}\}/g, encodeURIComponent(clean)),
    headers,
  };
}

async function fetchSourceOnce(src) {
  const auth = resolveAuth(src);
  if (!auth.ok) return { skipped: auth.reason };

  const headers = {
    "User-Agent": src.ua || USER_AGENT,
    accept: src.type === "json" ? "application/json, */*" : "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    ...auth.headers,
  };

  if (auth.oauth) {
    headers.authorization = `Bearer ${await redditAccessToken(auth.oauth.id, auth.oauth.secret)}`;
  }

  const host = hostOf(auth.url);
  await reserveHostSlot(host);
  await acquire(host);
  try {
    const res = await fetch(auth.url, {
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(src.timeout || FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A quota rejection is not a broken feed, and it says so in the body.
      // Keep it: the difference between "this provider is down" and "we have
      // used up today's allowance" matters when reading the health report.
      if (res.status === 403 || res.status === 429) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
      }
      throw new Error(`HTTP ${res.status}`);
    }

    if (src.type === "json") {
      const payload = await res.json();
      const adapter = getAdapter(src.adapter);
      return { items: adapter(payload, src) || [] };
    }

    // rss / atom — inflate before parsing, then relax malformed XML
    const xml = await res.text();
    const parsed = await parser.parseString(relaxXml(xml));
    return { items: parsed.items || [] };
  } finally {
    release(host);
  }
}

// One retry with jittered backoff. Connection resets and 429s are transient;
// a dead feed stays dead and is reported by /api/health. A rate-limited
// response gets a longer wait, because the limiter needs a second or two to
// clear rather than a few hundred milliseconds. A timeout is NOT retried —
// the host is slow or gone, and a second attempt would hold a concurrency
// slot for another full timeout.
async function fetchSource(src) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchSourceOnce(src);
    } catch (err) {
      lastError = err;
      const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
      if (timedOut || attempt >= MAX_ATTEMPTS) break;
      const rateLimited = /HTTP 429|HTTP 502|HTTP 503/.test(String((err && err.message) || err));
      const backoff = rateLimited ? 2000 : RETRY_BACKOFF_MS;
      await sleep(backoff * attempt + Math.random() * 300);
    }
  }
  throw lastError;
}

const sourceKey = (src) => src.url;

// Some providers answer 403/429 with "you have reached your request limit for
// today" once a daily allowance is used up. That is not a broken feed — it is
// a budget, and hammering it again wastes requests and buries the real
// failures. Once a host says that, stop calling it until the next UTC day.
const quotaUntil = new Map(); // host -> epoch ms

const isQuotaError = (msg) =>
  /request limit|quota|too many requests|rate limit exceeded/i.test(String(msg || ""));

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

// How long a source's items stay fresh. A source may declare `ttlMinutes` to
// override; keyed sources default to an hour, because their free tier is
// measured in requests per DAY and a headline does not go stale in five
// minutes.
function ttlFor(src) {
  if (src.ttlMinutes) return src.ttlMinutes * 60 * 1000;
  if (src.auth) return AUTH_TTL_MS;
  return DEFAULT_TTL_MS;
}

// Fetch a source unless its cached copy is still fresh. Returns raw items —
// normalisation happens at assembly time so cached and fresh items are
// treated identically.
async function fetchSourceCached(src) {
  const ttl = ttlFor(src);
  const hit = sourceCache.get(src.url);
  if (hit && Date.now() - hit.at < ttl) return { items: hit.items, cached: true };

  // This provider's daily allowance is spent — do not call it again until the
  // day rolls over. Retrying it would waste requests and hide real failures.
  const until = quotaUntil.get(hostOf(src.url));
  if (until && Date.now() < until) {
    return { items: [], quota: true, until };
  }

  const res = await fetchSource(src);
  if (res.skipped) return { items: [], skipped: res.skipped };
  sourceCache.set(src.url, { at: Date.now(), items: res.items });
  return { items: res.items, cached: false };
}

async function fetchCategory(slug) {
  const sources = SOURCES[slug] || [];
  const results = await Promise.allSettled(sources.map((s) => fetchSourceCached(s)));
  const items = [];
  results.forEach((r, i) => {
    const src = sources[i];
    const key = sourceKey(src);
    if (r.status !== "fulfilled") {
      const error = String((r.reason && r.reason.message) || r.reason);
      if (isQuotaError(error)) {
        quotaUntil.set(hostOf(src.url), nextUtcMidnight());
        feedHealth.set(key, { ok: false, at: Date.now(), items: 0, error, skipped: false, quota: true });
        console.warn(`[feed] ${slug}: ${src.url} — daily request limit reached, pausing until 00:00 UTC`);
      } else {
        feedHealth.set(key, { ok: false, at: Date.now(), items: 0, error, skipped: false, quota: false });
        console.warn(`[feed] ${slug}: ${src.url} failed — ${error}`);
      }
      return;
    }
    if (r.value && r.value.quota) {
      feedHealth.set(key, { ok: false, at: Date.now(), items: 0, error: "daily request limit reached", skipped: false, quota: true });
      return;
    }
    if (r.value && r.value.skipped) {
      // Missing credentials — not an error, just not configured.
      feedHealth.set(key, { ok: null, at: Date.now(), items: 0, error: null, skipped: true, reason: r.value.skipped });
      return;
    }
    const parsed = r.value.items || [];
    const fallbackDate = resolveFallbackDate(parsed, Date.now());
    for (const it of parsed) items.push(normalize(it, slug, fallbackDate, src.url));
    feedHealth.set(key, { ok: true, at: Date.now(), items: parsed.length, error: null, skipped: false, cached: !!r.value.cached });
  });
  return items;
}

// --- app ---

const app = express();

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*"); // browser app + agents on other hosts
  next();
});

app.get("/api/categories", (req, res) => {
  res.json(CATEGORIES.map(({ slug, label }) => ({ slug, label })));
});

app.get("/api/health", async (req, res) => {
  // Per-source status for every configured source — this is how you see a dead
  // feed, or an integration you have not supplied a key for yet.
  try {
    const slugs = req.query.category
      ? String(req.query.category).split(",").map((s) => s.trim()).filter((s) => SOURCES[s])
      : Object.keys(SOURCES);
    const report = await Promise.all(
      slugs.map(async (slug) => {
        const items = await fetchCategory(slug);
        return {
          slug,
          label: (CATEGORIES.find((c) => c.slug === slug) || {}).label || slug,
          totalItems: items.length,
          feeds: (SOURCES[slug] || []).map((src) => {
            const h = feedHealth.get(sourceKey(src));
            return {
              url: src.url,
              adapter: src.adapter || "rss",
              ok: h ? h.ok : null,
              items: h ? h.items : null,
              error: h ? h.error : "not fetched yet",
              skipped: h ? !!h.skipped : false,
              quota: h ? !!h.quota : false,
              reason: h ? h.reason || null : null,
            };
          }),
        };
      })
    );
    const dead = report.flatMap((r) =>
      r.feeds.filter((f) => f.ok === false).map((f) => ({ slug: r.slug, url: f.url, error: f.error, quota: !!f.quota }))
    );
    const skipped = report.flatMap((r) =>
      r.feeds.filter((f) => f.skipped).map((f) => ({ slug: r.slug, url: f.url, reason: f.reason }))
    );
    res.json({ categories: report.length, deadFeeds: dead, skippedSources: skipped, report });
  } catch (err) {
    res.status(502).json({ error: "health check failed", detail: String(err.message || err) });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const slugs = req.query.category
      ? String(req.query.category).split(",").map((s) => s.trim()).filter((s) => SOURCES[s])
      : Object.keys(SOURCES);
    const items = (await Promise.all(slugs.map(fetchCategory))).flat();
    const filtered = filterSort(items, {
      sinceHours: Number(req.query.since) || 0,
      q: req.query.q || "",
      sort: req.query.sort === "category" ? "category" : "newest",
      sticky: PERIODIC,
    });
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json({
      count: filtered.length,
      totalReadingMinutes: filtered.reduce((n, i) => n + i.readingMinutes, 0),
      items: filtered.slice(0, limit),
    });
  } catch (err) {
    res.status(502).json({ error: "fetch failed", detail: String(err.message || err) });
  }
});

// Full readable text of one article — what agents call to read/summarize a story.
app.get("/api/article", async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "valid url required" });
  try {
    const extract = await getExtractor();
    const a = await extract(url);
    if (!a || !a.content) return res.status(422).json({ error: "could not extract content", url });
    const text = String(a.content).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    res.json({
      url,
      title: a.title || null,
      author: a.author || null,
      published: a.published || null,
      source: a.source || null,
      wordCount: text.split(" ").filter(Boolean).length,
      readingMinutes: readingMinutes(a.content),
      content: text,
    });
  } catch (err) {
    res.status(502).json({ error: "fetch failed", detail: String(err.message || err) });
  }
});

// The base URL this app should call for its own REST API. NEWS_API lets a
// deployment (or a test) point the MCP tools at a specific instance; otherwise
// we derive it from the incoming request so it works behind a proxy.
function selfBase(req) {
  if (process.env.NEWS_API) return String(process.env.NEWS_API).replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  return `${proto}://${req.get("host")}`;
}

// MCP over Streamable HTTP — the same tools as the stdio shim, so an agent
// pointed at the deployed endpoint sees new categories the moment they ship.
// Stateless (no session id) and JSON responses rather than an SSE stream:
// simple request/response for agents that just want to call a tool.
app.all("/api/mcp", express.json({ limit: "1mb" }), async (req, res) => {
  let transport;
  try {
    const server = buildServer(selfBase(req));
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: String((err && err.message) || err) },
        id: null,
      });
    }
  }
});

app.use(express.static(path.join(__dirname, "public")));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`News feed → http://localhost:${PORT}`));
}

module.exports = {
  app,
  readingMinutes,
  filterSort,
  normalize,
  relaxXml,
  pickSource,
  pickImage,
  resolveFallbackDate,
  resolveAuth,
  normalizeSources,
  isQuotaError,
};
