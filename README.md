# MyNews — Vazghen's news feed

A multi-topic news aggregator that doubles as an **API your AI agents can read**.
One small Express server pulls RSS for 16 topics, serves a designed browser feed,
and exposes the same data as a REST + MCP API — including full readable article
text, not just headlines. **No API keys required.**

**Live:** https://mynews-nine.vercel.app · **Repo:** https://github.com/iamvazghen/mynews

```
/                 landing page
/dashboard.html   the live feed — filter, sort by newest/category, timeframe, search
/api/*            the agent API (REST), also exposed over MCP via mcp.js
```

### Why I built it (portfolio note)

A focused full-stack project that solves a real problem I have: I read across ~16
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
npm test           # unit checks for reading-time + filter/sort
```

The feed is live immediately — every card shows when it dropped and how long it
takes to read; sort by newest or category, pick a timeframe, search.

## The live feed — what's wired and how to change it

Everything goes through **`feeds.js`** — the only file you edit. Each category is
`{ slug, label, feeds: [rss urls] }`. A dead/blocked URL is silently skipped, so
the page never breaks; swap it when convenient.

- **Add a source:** drop another RSS URL into a category's `feeds` array.
- **Add a category:** append a new `{ slug, label, feeds }` object. Frontend, API and chips pick it up automatically.
- **Find a feed:** most sites expose `/feed/`, `/rss`, or `/feed.xml`. Topics without first-party RSS use Hacker News query feeds (`hnrss.org/newest?q=...`).

### Optional API keys (none required)

RSS covers all 16 topics today, so **nothing is needed to run or deploy**. Add a
key only if you want more than a source's feed exposes — each is a small change:

| Want | Source | Key |
| --- | --- | --- |
| Broad multi-source headlines | [NewsAPI](https://newsapi.org) / [GNews](https://gnews.io) | free tier |
| Trending repos (richer than the RSS mirror) | GitHub `GET /search/repositories?sort=stars` | a PAT |
| Reddit topic feeds | `reddit.com/r/<sub>/.rss` | none (already RSS) |
| Crypto prices alongside news | CoinGecko | none |

Store keys as env vars (add `dotenv`) — never hardcode them.

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
```

```bash
curl "https://mynews-nine.vercel.app/api/news?category=agents,ai&since=24&limit=10"
curl "https://mynews-nine.vercel.app/api/article?url=https://www.theverge.com/some-story"
```

## Connect your AI agent — step by step

The API is public and keyless, so wiring any agent takes three steps.

1. **Point at the API.** Base URL `https://mynews-nine.vercel.app/api`.
2. **Get headlines.** `GET /api/news?category=ai,crypto&since=24` → titles, sources, timestamps, read-time.
3. **Read the full story.** `GET /api/article?url=<link from step 2>` → clean body text to summarize.

That's enough for any framework (LangChain, a custom tool, a cron + curl). For
**MCP-native** agents, use the bundled server instead of raw HTTP:

```bash
npm i @modelcontextprotocol/sdk zod
NEWS_API=https://mynews-nine.vercel.app node mcp.js   # speaks MCP over stdio
```

It exposes three tools: `get_news`, `get_article`, `list_categories`.

### OpenClaw (the simplest path)

Add one block to `~/.openclaw/openclaw.json` under `mcp.servers`, then restart the
gateway — every agent gains the three tools:

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

- `server.js` — API + cache + reading-time + article extraction
- `feeds.js` — the 16 categories → RSS URLs (edit this)
- `public/` — Cobalt-themed landing + feed (`index.html`, `dashboard.html`, `app.js`, `styles.css`, `landing.css`, `tokens.css`)
- `api/index.js` + `vercel.json` — Vercel serverless wiring
- `mcp.js` — MCP server (get_news / get_article / list_categories)
- `test.js` — unit checks
