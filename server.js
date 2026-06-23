const path = require("path");
const express = require("express");
const Parser = require("rss-parser");
const { CATEGORIES, FEEDS } = require("./feeds");

const parser = new Parser({
  timeout: 10000,
  headers: { "User-Agent": "newsfeed/1.0 (+rss aggregator)" },
});

const TTL = 5 * 60 * 1000; // 5 min cache per category
const cache = new Map(); // slug -> { at, items }

// article-extractor is ESM-only; lazy dynamic import keeps this file CommonJS.
let _extract;
async function getExtractor() {
  if (!_extract) ({ extract: _extract } = await import("@extractus/article-extractor"));
  return _extract;
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

function normalize(item, slug) {
  const body = item["content:encoded"] || item.content || item.contentSnippet || item.summary || "";
  const text = String(item.contentSnippet || item.content || item.summary || "").replace(/<[^>]*>/g, "").trim();
  let source = slug;
  try { source = item.link ? new URL(item.link).hostname.replace(/^www\./, "") : slug; } catch {}
  return {
    title: (item.title || "(untitled)").trim(),
    link: item.link || null,
    source,
    category: slug,
    publishedAt: item.isoDate || item.pubDate || null,
    readingMinutes: readingMinutes(body),
    snippet: text.slice(0, 240),
    image: pickImage(item),
  };
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

async function fetchCategory(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const urls = FEEDS[slug] || [];
  const results = await Promise.allSettled(urls.map((u) => parser.parseURL(u)));
  const items = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue; // dead feed → skip, don't break the page
    for (const it of r.value.items || []) items.push(normalize(it, slug));
  }
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

module.exports = { app, readingMinutes, filterSort, normalize };
