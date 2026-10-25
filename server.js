const path = require("path");
const express = require("express");
const Parser = require("rss-parser");
const { CATEGORIES, FEEDS } = require("./feeds");

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "newsfeed/1.0 (+rss aggregator)" },
  // Google News wraps every item in <source url="...">Publisher</source>; keep it so
  // we can show the real publisher instead of "news.google.com".
  customFields: { item: ["source"] },
});

const TTL = 5 * 60 * 1000; // 5 min cache per category
const cache = new Map(); // slug -> { at, items }
const feedHealth = new Map(); // url -> { ok, at, items, error }

const FETCH_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_FEEDS = 12; // ~195 feeds total; keeps us under rate limits (429s)
const MAX_CONCURRENT_PER_HOST = 3; // one publisher must not get hammered
const MAX_ATTEMPTS = 2; // one retry — transient resets and 429s clear fast
const RETRY_BACKOFF_MS = 400;

// article-extractor is ESM-only; lazy dynamic import keeps this file CommonJS.
let _extract;
async function getExtractor() {
  if (!_extract) ({ extract: _extract } = await import("@extractus/article-extractor"));
  return _extract;
}

// --- concurrency limiter ---
//
// A global ceiling plus a per-host ceiling. Both matter: with ~195 feeds a
// cold start hammers the same publishers (six hnrss.org queries, eleven Google
// News searches), and the excess connections get reset. Per-host capping keeps
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

function normalize(item, slug, fallbackDate) {
  const body = item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
  const text = String(item.contentSnippet || item.content || item.summary || "").replace(/<[^>]*>/g, "").trim();
  return {
    title: (item.title || "(untitled)").trim(),
    link: item.link || null,
    source: pickSource(item, slug),
    category: slug,
    publishedAt: item.isoDate || item.pubDate || fallbackDate || null,
    readingMinutes: readingMinutes(body),
    snippet: text.slice(0, 240),
    image: pickImage(item),
  };
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
function filterSort(items, { sinceHours = 0, q = "", sort = "newest" } = {}) {
  let out = items;
  if (sinceHours > 0) {
    const cut = Date.now() - sinceHours * 3600 * 1000;
    out = out.filter((i) => i.publishedAt && new Date(i.publishedAt).getTime() >= cut);
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

// --- fetch (network) ---

// We fetch by hand rather than using parser.parseURL() for two reasons:
//   1. some hosts (deepmind.google) gzip their response and rss-parser cannot inflate it;
//   2. we need the raw XML to run it through relaxXml() first.
async function fetchFeedOnce(url) {
  const host = hostOf(url);
  await acquire(host);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "newsfeed/1.0 (+rss aggregator)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return await parser.parseString(relaxXml(xml));
  } finally {
    release(host);
  }
}

// One retry with jittered backoff. Connection resets and 429s are transient;
// a dead feed stays dead and is reported by /api/health.
async function fetchFeed(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchFeedOnce(url);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS * attempt + Math.random() * 300);
      }
    }
  }
  throw lastError;
}

async function fetchCategory(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const urls = FEEDS[slug] || [];
  const results = await Promise.allSettled(urls.map((u) => fetchFeed(u)));
  const items = [];
  results.forEach((r, i) => {
    const url = urls[i];
    if (r.status !== "fulfilled") {
      // dead feed → skip, don't break the page, but make it visible in the log
      const error = String((r.reason && r.reason.message) || r.reason);
      feedHealth.set(url, { ok: false, at: Date.now(), items: 0, error });
      console.warn(`[feed] ${slug}: ${url} failed — ${error}`);
      return;
    }
    const parsed = r.value.items || [];
    const fallbackDate = resolveFallbackDate(parsed, Date.now());
    for (const it of parsed) items.push(normalize(it, slug, fallbackDate));
    feedHealth.set(url, { ok: true, at: Date.now(), items: parsed.length, error: null });
  });
  cache.set(slug, { at: Date.now(), items });
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
  // Per-feed status for every configured source — this is how you see a dead feed
  // instead of guessing why a category looks thin.
  try {
    const slugs = req.query.category
      ? String(req.query.category).split(",").map((s) => s.trim()).filter((s) => FEEDS[s])
      : Object.keys(FEEDS);
    const report = await Promise.all(
      slugs.map(async (slug) => {
        const items = await fetchCategory(slug);
        return {
          slug,
          label: (CATEGORIES.find((c) => c.slug === slug) || {}).label || slug,
          totalItems: items.length,
          feeds: (FEEDS[slug] || []).map((url) => {
            const h = feedHealth.get(url);
            return { url, ok: h ? h.ok : null, items: h ? h.items : null, error: h ? h.error : "not fetched yet" };
          }),
        };
      })
    );
    const dead = report.flatMap((r) => r.feeds.filter((f) => f.ok === false).map((f) => ({ slug: r.slug, url: f.url, error: f.error })));
    res.json({ categories: report.length, deadFeeds: dead, report });
  } catch (err) {
    res.status(502).json({ error: "health check failed", detail: String(err.message || err) });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const slugs = req.query.category
      ? String(req.query.category).split(",").map((s) => s.trim()).filter((s) => FEEDS[s])
      : Object.keys(FEEDS);
    const items = (await Promise.all(slugs.map(fetchCategory))).flat();
    const filtered = filterSort(items, {
      sinceHours: Number(req.query.since) || 0,
      q: req.query.q || "",
      sort: req.query.sort === "category" ? "category" : "newest",
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
  resolveFallbackDate,
};
