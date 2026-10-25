# MyNews — Vazghen's news feed

A multi-topic news aggregator that doubles as an **API your AI agents can read**.
One small Express server pulls RSS for 30 topics, serves a designed browser feed,
and exposes the same data as a REST + MCP API — including full readable article
text, not just headlines. **No API keys required.**

**Live:** https://mynews-nine.vercel.app · **Repo:** https://github.com/iamvazghen/mynews

```
/                 landing page
/dashboard.html   the live feed — filter, sort by newest/category, timeframe, search
/api/*            the agent API (REST), also exposed over MCP via mcp.js
```

### Why I built it (portfolio note)

A focused full-stack project that solves a real problem I have: I read across ~29
unrelated topics, and I want my own agents to read them too. It demonstrates:

- **Full-stack JS** — Express API, RSS aggregation, in-memory caching, HTML→text article extraction.
- **Design** — a hand-built Cobalt design system (OKLCH tokens, Space Grotesk / Inter / JetBrains Mono), responsive, reduced-motion-safe; no UI framework.
- **Agent integration** — the same API is consumed by a browser **and** by LLM agents over **MCP**, so a scheduled agent can fetch headlines and then read full articles to summarize.
- **Shipping** — deployed to Vercel (serverless) from GitHub with CI on push, and to a private VPS as a systemd service.

It's deliberately small: ~1 backend file, 1 feed-config file, a static frontend, and an MCP shim.

## Run it locally

```bash
npm install
npm start          # → http://localhost:3000
npm test           # unit checks for reading-time + filter/sort + XML/date helpers
```

The feed is live immediately — every card shows when it dropped and how long it
takes to read; sort by newest or category, pick a timeframe, search.

## The live feed — what's wired and how to change it

Everything goes through **`feeds.js`** — the only file you edit. Each category is
`{ slug, label, feeds: [rss urls] }`. A dead/blocked URL is skipped so the page
never breaks; it is also logged to stderr and visible at `GET /api/health`.

- **Add a source:** drop another RSS URL into a category's `feeds` array, or a typed entry like `{ type: "json", adapter: "hn", url: "..." }` (see the source layer below).
- **Add a category:** append a new `{ slug, label, feeds }` object. Frontend, API and chips pick it up automatically.
- **Check what is alive:** `GET /api/health` returns every configured source with its status, item count and last error — and lists the ones that are skipped because a key isn't configured yet.

### Two URL patterns worth knowing

Some topics have no first-party RSS. Two query-based feeds cover **any** subject
without a publisher relationship:

```
hnrss.org/newest?q=<terms>&points=<n>&count=30    # Hacker News search
news.google.com/rss/search?q=<terms>+when:7d       # Google News search
```

The `count=30` on `hnrss.org` is not optional — without it those endpoints
intermittently return HTTP 502. Google News items carry the real publisher in
`<source>`, and the server surfaces that as the card's source instead of
`news.google.com`.

## The 30 categories

| Group | Categories |
| --- | --- |
| **AI** | AI · Industry & Business · AI · Research & Practice · AI Agents |
| **Tech** | Coding & Tech · Open-Source / GitHub · Cybersecurity |
| **Money** | Startups · Business · Investments · **Stock Markets & Equities** · **Rates, Treasuries & Bonds** · **Economics & Inflation** · **FX Reference Rates (ECB)** · **Global Currencies & FX** · Crypto & Blockchain |
| **Science** | Space & Science · Climate & Energy · Health & Biotech |
| **Culture** | Gaming · Film & TV · Marvel & DC · Manga & Anime · Reading Recs · Sneakerhead · Watches |
| **Sports** | Basketball · Football (Soccer) · Sports · F1, Tennis, NFL |
| **World** | Germany · Ukraine · Armenia · Local |

Bold = new.

### Money & markets in detail

The financial categories are split so you can read one without the rest:

- **Stock Markets & Equities** — indices, earnings, market moves (CNBC, FT, Nikkei Asia, SCMP, Google News).
- **Rates, Treasuries & Bonds** — policy decisions and sovereign debt: Fed monetary policy, Fed press releases, ECB press + tender operations, ECB Market Information Dissemination, Bank of England, Bank of Japan, Google News on Treasury yields.
- **Economics & Inflation** — CPI and payrolls (BLS), euro-area statistics (ECB), macro desks (CNBC Economy, The Economist Finance & Economics), Google News on inflation / rate decisions / GDP.
- **FX Reference Rates (ECB)** — the *numbers*: one authoritative daily feed per currency for USD, JPY, CNY, NOK, SGD, CHF, GBP, SEK, DKK, AUD, CAD, NZD, INR, KRW, MXN, BRL, ZAR, TRY, THB and PLN (`1 EUR = N units`, published ~16:00 CET on TARGET days), plus the RBA's daily rates for AUD. These sit in their own category on purpose — a feed publishing one rate per day gets buried under a hundred breaking-news items once everything is sorted by date. Because rates are published on TARGET days, this category is marked `periodic`: the `since` window always keeps its newest day, so `?since=24` on a Sunday still returns Friday's rates instead of an empty list.
- **Global Currencies & FX** — the *why*: FXStreet, ForexLive, and per-currency Google News for USD, JPY, CNY, NOK, SGD, CHF, EUR and GBP, so you see the policy or risk event behind a move.

### The source layer — RSS plus JSON APIs

RSS alone left **8 of 30 categories under 10 items in a 24-hour window**: thin
for a daily digest, and with no depth material at all. Every category now draws
on two kinds of source.

**1. RSS / Atom** — the base layer. Free, keyless, no signup. 233 endpoints.

**2. JSON APIs** — normalised to the same item shape by `adapters.js`. 45
endpoints, all keyless:

| Adapter | Gives you |
| --- | --- |
| `arxiv` | preprints — the actual paper, not a headline about it |
| `openalex` | scholarly works, abstracts reconstructed from the inverted index |
| `devto` | working engineers writing about what they built |
| `stackexchange` | the questions themselves, with vote counts and answer counts |
| `hn` | Hacker News via the public Algolia index (newest-first, any topic) || `openlibrary` | books by subject, with covers and first-publish years |
| `frankfurter` | ECB FX reference rates for 30 currencies in one keyless call |
| `coingecko` | crypto market snapshot — price, 24h move, volume |
| `gnews` | 80,000+ sources in 41 languages, with the real publisher (keyed) |
| Google News queries | one search feed per category, so no niche is ever empty |

A feed entry is a plain URL string (RSS) or a typed object (JSON):

```js
"https://example.com/rss.xml"                    // RSS
api("hn", "https://hn.algolia.com/api/v1/...")    // JSON adapter
api("guardian", "https://...api-key={{auth}}",
    { auth: { env: "GUARDIAN_KEY" } })             // needs a key
```

### Optional API keys (none required)

**Nothing is needed to run or deploy** — all 30 topics work from keyless
sources alone. 23 further sources are wired up but dormant until you supply
credentials; a source whose key is missing is **skipped, never failed**, so
you can commit the full source list and switch integrations on one env var at
a time. `GET /api/health` reports them under `skippedSources` with the reason.

| Integration | Register at | Free tier | Used for |
| --- | --- | --- | --- |
| Guardian Open Platform | [bonobo.capi.gutools.co.uk/register/developer](https://bonobo.capi.gutools.co.uk/register/developer) | 500/day, 60/min, non-commercial | deep sectioned coverage for 9 categories |
| NewsAPI | [newsapi.org/register](https://newsapi.org/register) | 100 req/day, attribution required | broad multi-publisher headlines |
| GNews | [gnews.io/register](https://gnews.io/register) | 100 req/day, 1 req/sec, 12h delay | 8 categories, 80k+ sources |
| TMDB | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) | generous | film, TV and anime discovery |
| Twelve Data | [twelvedata.com/register](https://twelvedata.com/register) | 800 credits/day, 8/min | live FX quotes |
| Reddit OAuth2 | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) | standard | subreddit depth (6 subreddits) |

Copy `.env.example` to `.env` and fill in what you want — it lists every URL
above with the exact steps for each. Reddit needs an app id + secret (choose a
"script" app; the redirect URI can be anything), the rest are single API keys.
Store them as env vars — never hardcode them. `.env` is gitignored.

Locally, `npm start` loads `.env` automatically (Node's `--env-file`). On Vercel,
set them under **Project → Settings → Environment Variables** — or with the
CLI, using `--value` so no trailing newline gets stored:

```bash
vercel env add GUARDIAN_KEY production --value "<key>" --sensitive
```

That last detail matters: a key with a trailing newline makes GNews answer
`400 "You did not provide an API key"` rather than "invalid key", and the
server now trims credentials on the way in so it cannot happen again.

The Guardian key is the highest-value one: it is the only source here with
genuinely deep per-topic coverage. Its free tier is **non-commercial** — if
MyNews ever earns money, request a commercial key at
`https://bonobo.capi.gutools.co.uk/register/commercial` instead.

### How caching works

Caching is **per source**, not per category, and each source refreshes on its
own schedule. That is what makes the free-tier quotas survivable:

| Source kind | Refresh | Why |
| --- | --- | --- |
| keyless RSS | 5 min | cheap, wants to be fresh |
| Guardian | 120 min | 500 requests/day, 9 sources → ~108/day |
| NewsAPI | 120 min | 100 requests/day, 3 sources → ~36/day |
| GNews | 240 min | 100 requests/day, 8 sources → ~48/day |
| TMDB, Twelve Data, Reddit | 60 min | no daily cap; Twelve Data is 8 credits/min |

A source can override this with `ttlMinutes`.

Hosts with hard request limits also get a **minimum gap between requests**, and
the gaps are measured rather than guessed:

| Host | Gap | Measured behaviour |
| --- | --- | --- |
| `content.guardianapis.com` | 150 ms | 60 req/**minute**, no per-second cap — 9 at once left the budget untouched |
| `gnews.io` | 1100 ms | genuinely 1 req/second — 8 concurrent gave six 429s |
| `api.twelvedata.com` | 1200 ms | 8 API credits/minute; a 5-symbol batch costs 5 |

The per-feed timeout is 10 s and a timeout is **not** retried — a slow host is a
dead host, and a second attempt would hold a concurrency slot for another full
timeout. A cold start over ~285 sources takes about 30 s on Vercel and is
instant on the VPS, where the process never goes cold.

### When a provider runs out of daily quota

Some providers answer `403` with *"you have reached your request limit for
today"* once a daily allowance is spent — GNews does this. The server
recognises that response, pauses the whole host until 00:00 UTC, and reports
it separately from a broken feed:

```json
{ "url": "https://gnews.io/...", "ok": false, "quota": true,
  "error": "daily request limit reached" }
```

So a spent budget never turns into a wall of red in the health report, and the
feed is not hammered with requests that cannot succeed. Check the quota usage
before adding another provider on the same key — GNews's 100 requests/day is
easy to consume with eight sources refreshing four times a day.

**The result:** categories under 10 items in 24h went **8 → 0**, daily items
**962 → 1,822**, and `ai` alone went from 2 items / 1 source to **70 items /
30 sources**.

## The API

CORS is open, so any agent or page can call it.

```
GET /api/categories
  → [{ slug, label }, ...]

GET /api/news?category=ai,crypto&since=24&sort=newest&q=bitcoin&limit=50
  category  comma-separated slugs (omit = all)
  since     only items from the past N hours (0 = all time)
  sort      newest | category
  q         keyword filter on title + snippet
  limit     max items (default 200, cap 500)
  → { count, totalReadingMinutes, items: [{ title, link, source,
       category, publishedAt, readingMinutes, snippet, image }] }

GET /api/article?url=<article-url>
  → { url, title, author, published, source, wordCount, readingMinutes, content }
    full readable body text, boilerplate stripped — what an agent reads to summarize a story

GET /api/health
  → { categories, deadFeeds: [{ slug, url, error }],
       skippedSources: [{ slug, url, reason }],
       report: [{ slug, label, totalItems,
         feeds: [{ url, adapter, ok, items, error, skipped, reason }] }] }
    per-source status for every configured source — so a thin category is
    explainable instead of mysterious. `skipped` marks a source whose
    credentials are not configured yet (not a failure).
```

```bash
curl "https://mynews-nine.vercel.app/api/news?category=agents,ai&since=24&limit=10"
curl "https://mynews-nine.vercel.app/api/article?url=https://www.theverge.com/some-story"
curl "https://mynews-nine.vercel.app/api/health?category=currencies"
```

## Connect your AI agent — step by step

The API is public and keyless, so wiring any agent takes three steps.

1. **Point at the API.** Base URL `https://mynews-nine.vercel.app/api`.
2. **Get headlines.** `GET /api/news?category=agents,ai&since=24` → titles, sources, timestamps, read-time.
3. **Read the full story.** `GET /api/article?url=<link from step 2>` → clean body text to summarize.

That's enough for any framework (LangChain, a custom tool, a cron + curl). For
**MCP-native** agents, use the bundled server instead of raw HTTP:

```bash
npm i @modelcontextprotocol/sdk zod
NEWS_API=https://mynews-nine.vercel.app node mcp.js   # speaks MCP over stdio
```

It exposes four tools: `get_news`, `get_article`, `list_categories`, `check_feeds`.

### OpenClaw (the simplest path)

Add one block to `~/.openclaw/openclaw.json` under `mcp.servers`, then restart the
gateway — every agent gains the tools:

```json
"mynews": {
  "command": "/usr/bin/node",
  "args": ["/home/openclaw/newsfeed/mcp.js"],
  "env": { "NEWS_API": "https://mynews-nine.vercel.app" }
}
```

A morning-news cron then calls `get_news` for the day's headlines and `get_article`
for the full text of each story it wants to summarize — no scraping glue.

## Deployments

- **Vercel (public, online):** Express runs as a serverless function (`api/index.js` + `vercel.json`); `public/` is the static site. Auto-deploys on push to `main`.
- **VPS (private):** a systemd `--user` unit (`newsfeed.service`, `Restart=always`) on port 3000. Manage with `systemctl --user restart|status newsfeed` and `journalctl --user -u newsfeed -f`.

## Files

- `server.js` — API + cache + reading-time + article extraction + feed health + MCP over HTTP
- `feeds.js` — the 30 categories → sources (RSS URLs and JSON adapters; edit this)
- `adapters.js` — normalisers that turn JSON API responses into feed items
- `.env.example` — the optional API keys, documented
- `public/` — Cobalt-themed landing + feed (`index.html`, `dashboard.html`, `app.js`, `styles.css`, `landing.css`, `tokens.css`)
- `api/index.js` + `vercel.json` — Vercel serverless wiring
- `mcp.js` — MCP server (get_news / get_article / list_categories / check_feeds)
- `test.js` — unit checks

## Notes on the feed layer

Three things `server.js` handles that a naive `rss-parser` setup gets wrong:

1. **Gzip.** Some hosts (deepmind.google) gzip their response; the client inflates it before parsing.
2. **Malformed XML.** Some publishers ship unescaped `&` inside image `srcset` attributes (restofworld.org). Bare ampersands are escaped before parsing; CDATA sections are left alone.
3. **Undated feeds.** GitHub Trending and Nikkei Asia ship no timestamps, so the `since` window used to drop them entirely and the category rendered "no stories". Undated items now inherit a bounded fallback date — the feed's own newest entry, or the fetch time when the feed has none — so they survive the 24-hour window instead of vanishing.
