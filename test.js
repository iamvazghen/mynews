const { test } = require("node:test");
const assert = require("node:assert");
const { readingMinutes, filterSort, normalize, relaxXml, pickSource, resolveFallbackDate } = require("./server");

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
