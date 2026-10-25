const { test } = require("node:test");
const assert = require("node:assert");
const {
  readingMinutes,
  filterSort,
  normalize,
  relaxXml,
  pickSource,
  resolveFallbackDate,
  resolveAuth,
  normalizeSources,
} = require("./server");
const { getAdapter } = require("./adapters");

test("readingMinutes: ~200 wpm, floor of 1", () => {
  assert.equal(readingMinutes(""), 1);
  assert.equal(readingMinutes("one two three"), 1);
  assert.equal(readingMinutes(Array(400).fill("w").join(" ")), 2);
  assert.equal(readingMinutes("<p>" + Array(200).fill("w").join(" ") + "</p>"), 1); // tags stripped
});

test("filterSort: newest first by default", () => {
  const items = [
    { title: "old", snippet: "", category: "a", publishedAt: "2020-01-01", readingMinutes: 1 },
    { title: "new", snippet: "", category: "a", publishedAt: "2030-01-01", readingMinutes: 1 },
  ];
  assert.equal(filterSort(items)[0].title, "new");
});

test("filterSort: sort=category groups alphabetically", () => {
  const items = [
    { title: "z", snippet: "", category: "zoo", publishedAt: "2030-01-01", readingMinutes: 1 },
    { title: "a", snippet: "", category: "art", publishedAt: "2020-01-01", readingMinutes: 1 },
  ];
  assert.equal(filterSort(items, { sort: "category" })[0].category, "art");
});

test("filterSort: timeframe drops anything older than the window", () => {
  const recent = new Date(Date.now() - 3600 * 1000).toISOString(); // 1h ago
  const items = [
    { title: "fresh", snippet: "", category: "a", publishedAt: recent, readingMinutes: 1 },
    { title: "stale", snippet: "", category: "a", publishedAt: "2000-01-01", readingMinutes: 1 },
  ];
  const out = filterSort(items, { sinceHours: 24 });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "fresh");
});

test("filterSort: query matches title and snippet", () => {
  const items = [
    { title: "Bitcoin surges", snippet: "", category: "a", publishedAt: "2030-01-01", readingMinutes: 1 },
    { title: "Soccer recap", snippet: "ronaldo scores", category: "a", publishedAt: "2030-01-01", readingMinutes: 1 },
  ];
  assert.equal(filterSort(items, { q: "ronaldo" }).length, 1);
  assert.equal(filterSort(items, { q: "bitcoin" })[0].title, "Bitcoin surges");
});

test("normalize: strips html, derives source host, computes reading time", () => {
  const n = normalize(
    { title: " Hi ", link: "https://www.example.com/a", content: "<p>hello world</p>", isoDate: "2030-01-01" },
    "ai"
  );
  assert.equal(n.title, "Hi");
  assert.equal(n.source, "example.com");
  assert.equal(n.category, "ai");
  assert.equal(n.snippet, "hello world");
});

test("normalize: falls back to the supplied date when the feed has no timestamp", () => {
  const n = normalize(
    { title: "Undated", link: "https://github.com/foo/bar", content: "" },
    "oss-github",
    "2026-10-25T12:00:00.000Z"
  );
  assert.equal(n.publishedAt, "2026-10-25T12:00:00.000Z");
});

test("normalize: prefers the Google News publisher over the news.google.com host", () => {
  const n = normalize(
    { title: "Story", link: "https://news.google.com/rss/articles/abc", source: "Reuters", content: "" },
    "markets",
    "2026-10-25T12:00:00.000Z"
  );
  assert.equal(n.source, "Reuters");
});

test("pickSource: falls back to the slug when the link is unusable", () => {
  assert.equal(pickSource({ link: "not a url" }, "gaming"), "gaming");
});

test("relaxXml: escapes bare ampersands but leaves valid entities alone", () => {
  assert.equal(relaxXml("a &amp; b"), "a &amp; b");
  assert.equal(relaxXml("a &lt; b"), "a &lt; b");
  assert.equal(relaxXml("a & b"), "a &amp; b");
  assert.equal(relaxXml("&#39; &#x27;"), "&#39; &#x27;");
});

test("relaxXml: does not touch ampersands inside CDATA", () => {
  const xml = "<![CDATA[Tom & Jerry]]>";
  assert.equal(relaxXml(xml), xml);
});

test("resolveFallbackDate: uses the feed's own newest date for undated items", () => {
  const items = [{ isoDate: "2026-10-20T00:00:00.000Z" }, { pubDate: "2026-10-23T00:00:00.000Z" }];
  const fallback = resolveFallbackDate(items, Date.parse("2026-10-25T00:00:00.000Z"));
  assert.equal(fallback, "2026-10-23T00:00:00.000Z");
});

test("resolveFallbackDate: falls back to fetch time when the feed has no dates at all", () => {
  const now = Date.parse("2026-10-25T09:30:00.000Z");
  assert.equal(resolveFallbackDate([], now), "2026-10-25T09:30:00.000Z");
});

test("filterSort: a scheduled category keeps its newest batch outside the window", () => {
  // Friday's FX rates, viewed with a 24h window on a Sunday — nothing published
  // since Friday, so a plain window would report "no rates".
  const items = [
    { title: "rate friday USD", category: "fx-rates", publishedAt: "2026-10-23T13:15:00.000Z" },
    { title: "rate friday JPY", category: "fx-rates", publishedAt: "2026-10-23T05:45:00.000Z" },
    { title: "rate thursday", category: "fx-rates", publishedAt: "2026-10-22T13:15:00.000Z" },
    { title: "old news", category: "currencies", publishedAt: "2026-10-01T00:00:00.000Z" },
  ];
  const sticky = new Set(["fx-rates"]);
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-10-25T20:00:00.000Z");
  try {
    const titles = filterSort(items, { sinceHours: 24, sticky }).map((i) => i.title);
    assert.ok(titles.includes("rate friday USD"), "keeps the newest day's rate");
    assert.ok(titles.includes("rate friday JPY"), "keeps the morning fix of the same day");
    assert.ok(!titles.includes("rate thursday"), "drops the previous day");
    assert.ok(!titles.includes("old news"), "still drops stale items from normal categories");
  } finally {
    Date.now = realNow;
  }
});

test("filterSort: without the sticky flag a scheduled category is filtered normally", () => {
  const items = [
    { title: "rate friday", category: "fx-rates", publishedAt: "2026-10-23T13:15:00.000Z" },
  ];
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-10-25T20:00:00.000Z");
  try {
    assert.equal(filterSort(items, { sinceHours: 24 }).length, 0);
  } finally {
    Date.now = realNow;
  }
});

test("resolveAuth: a source with no credentials is usable as-is", () => {
  const r = resolveAuth({ url: "https://example.com/rss" });
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://example.com/rss");
});

test("resolveAuth: a missing key skips the source instead of failing it", () => {
  const prev = process.env.TEST_NEWS_KEY;
  delete process.env.TEST_NEWS_KEY;
  const r = resolveAuth({ url: "https://example.com/x?k={{auth}}", auth: { env: "TEST_NEWS_KEY" } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /TEST_NEWS_KEY/);
  if (prev !== undefined) process.env.TEST_NEWS_KEY = prev;
});

test("resolveAuth: a present key is substituted into the url", () => {
  process.env.TEST_NEWS_KEY = "secret123";
  const r = resolveAuth({ url: "https://example.com/x?k={{auth}}", auth: { env: "TEST_NEWS_KEY" } });
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://example.com/x?k=secret123");
  delete process.env.TEST_NEWS_KEY;
});

test("resolveAuth: a header key is passed through as a header", () => {
  process.env.TEST_NEWS_KEY = "tok";
  const r = resolveAuth({ url: "https://example.com/x", auth: { env: "TEST_NEWS_KEY", header: "X-Auth-Token" } });
  assert.equal(r.headers["X-Auth-Token"], "tok");
  delete process.env.TEST_NEWS_KEY;
});

test("normalizeSources: plain strings become rss sources, objects pass through", () => {
  const out = normalizeSources(["https://a/rss.xml", { type: "json", adapter: "hn", url: "https://b" }]);
  assert.equal(out[0].type, "rss");
  assert.equal(out[0].url, "https://a/rss.xml");
  assert.equal(out[1].type, "json");
  assert.equal(out[1].adapter, "hn");
});

test("adapter gdelt: converts the seendate stamp into an ISO date", () => {
  const out = getAdapter("gdelt")({
    articles: [{ title: "Story", url: "https://x.com/a", seendate: "20261025T191500Z", socialimage: "https://i/x.jpg" }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].isoDate, "2026-10-25T19:15:00.000Z");
  assert.equal(out[0].link, "https://x.com/a");
});

test("adapter hn: falls back to the HN permalink when a story has no url", () => {
  const out = getAdapter("hn")({
    hits: [{ title: "T", objectID: "12345", created_at: "2026-10-25T10:00:00Z", url: null }],
  });
  assert.equal(out[0].link, "https://news.ycombinator.com/item?id=12345");
  assert.equal(out[0].isoDate, "2026-10-25T10:00:00.000Z");
});

test("adapter frankfurter: one item per currency", () => {
  const out = getAdapter("frankfurter")({ base: "EUR", date: "2026-10-23", rates: { USD: 1.1193, JPY: 175.51 } });
  assert.equal(out.length, 2);
  assert.match(out[0].title, /1 EUR = [\d.]+ (USD|JPY) 2026-10-23/);
});

test("adapter openalex: rebuilds the abstract from the inverted index", () => {
  const out = getAdapter("openalex")({
    results: [{ display_name: "Paper", doi: "https://doi.org/x", publication_date: "2026-01-02", abstract_inverted_index: { Hello: [0], world: [1] } }],
  });
  assert.equal(out[0].title, "Paper");
  assert.equal(out[0].isoDate, "2026-01-02T00:00:00.000Z");
  assert.match(out[0].content, /Hello world/);
});

test("adapter coingecko: formats a 24h price move into a headline", () => {
  const out = getAdapter("coingecko")([
    { id: "bitcoin", name: "Bitcoin", symbol: "btc", current_price: 80465, price_change_percentage_24h: -3.07, market_cap: 1, total_volume: 2, image: "i", last_updated: "2026-10-25T10:00:00Z" },
  ]);
  assert.match(out[0].title, /Bitcoin \(BTC\) \$80465 -3\.07%/);
});

test("every configured adapter exists and every source is well formed", () => {
  const { ALL_SOURCES, CATEGORIES } = require("./feeds");
  const { normalizeSources } = require("./server");
  for (const slug of Object.keys(require("./feeds").FEEDS)) {
    for (const src of normalizeSources(require("./feeds").FEEDS[slug])) {
      assert.ok(src.url, `source in ${slug} has no url`);
      if (src.type === "json") {
        assert.doesNotThrow(() => getAdapter(src.adapter), `unknown adapter "${src.adapter}" in ${slug}`);
      }
      if (src.auth) {
        assert.ok(src.auth.env, `source in ${slug} declares auth without an env var`);
      }
    }
  }
  assert.ok(CATEGORIES.length >= 30);
  assert.ok(ALL_SOURCES.length > 200);
});

test("/api/mcp: tools over HTTP, live categories, upstream 400 is isError", async () => {
  const { app } = require("./server");
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.NEWS_API = base;
  const rpc = (id, method, params = {}) =>
    fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }).then((r) => r.json());
  try {
    const tools = (await rpc(1, "tools/list")).result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(tools, ["check_feeds", "get_article", "get_news", "list_categories"]);
    const cats = await rpc(2, "tools/call", { name: "list_categories", arguments: {} });
    const { CATEGORIES } = require("./feeds");
    assert.strictEqual(JSON.parse(cats.result.content[0].text).length, CATEGORIES.length);
    const bad = await rpc(3, "tools/call", { name: "get_article", arguments: { url: "not-a-url" } });
    assert.strictEqual(bad.result.isError, true);
  } finally {
    delete process.env.NEWS_API;
    srv.close();
  }
});
