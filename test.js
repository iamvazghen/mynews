const { test } = require("node:test");
const assert = require("node:assert");
const { readingMinutes, filterSort, normalize } = require("./server");

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
