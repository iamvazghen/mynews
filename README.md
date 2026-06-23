# MyNews

A multi-topic news aggregator. One Express server fetches RSS for 16 topics,
caches for 5 min, and serves a browser feed plus a JSON + MCP API your OpenClaw
agents can read. **No API keys required** — RSS is the whole live-data layer.

- `/` — MyNews landing page
- `/dashboard.html` — the live feed (filter, sort, timeframe, search)
- `/api/*` — the agent API (REST), also exposed over MCP via `mcp.js`

## Run it

```bash
npm install
npm start          # → http://localhost:3000
npm test           # unit checks for reading-time + filter/sort
```

Open `http://localhost:3000`. The feed is live immediately — filter by category,
sort by newest or category, pick a timeframe, search, see per-story and total
read-time and relative timestamps.

## The live feed — what's wired and how to change it

Everything goes through **`feeds.js`** — the only file you edit. Each category is
`{ slug, label, feeds: [rss urls] }`. A dead/blocked URL is silently skipped, so
the page never breaks; swap it when convenient.

- **Add a source:** drop another RSS URL into a category's `feeds` array.
- **Add a category:** append a new `{ slug, label, feeds }` object. Frontend +
  API + chips pick it up automatically.
- **Find a feed:** most sites expose `/feed/`, `/rss`, or `/feed.xml`. Topics
  without first-party RSS use Hacker News query feeds (`hnrss.org/newest?q=...`).

### Going deeper (optional API keys)

RSS covers all 16 topics today. Add a key only if you want more than a site's
RSS exposes. Each is a 2-line change: add the key to a feed-fetch helper or a new
handler.

| Want | Source | Key |
| --- | --- | --- |
| Broad multi-source headlines | [NewsAPI](https://newsapi.org) / [GNews](https://gnews.io) | free tier |
| Trending repos (richer than the RSS mirror) | GitHub `GET /search/repositories?sort=stars` | PAT (you already have one) |
| Reddit topic feeds | `reddit.com/r/<sub>/.rss` | none (already RSS) |
| Crypto prices alongside news | CoinGecko | none |

Store keys in a `.env` (add `dotenv`) — don't hardcode them.

## The agent API (this is your integration layer)

The same JSON the browser uses. CORS is open, so agents on any host can call it.

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
```

```
GET /api/article?url=<article-url>
  → { url, title, author, published, source, wordCount, readingMinutes, content }
    full readable body text (boilerplate stripped) — what agents read to summarize a story
```

```bash
curl "http://localhost:3000/api/news?category=agents,ai&since=24&limit=10"
curl "http://localhost:3000/api/article?url=https://example.com/some-story"
```

## Connecting OpenClaw agents

**Option A — REST (simplest).** Your agents have `network=bridge`; point them at
`http://<host>:3000/api/news`. Document it in their `EXTERNAL_APIS.md` like the
other no-key APIs. Run the server on the VPS and they hit it directly.

**Option B — MCP (`mcp.js`).** A wrapper exposing `get_news`, `get_article`, and
`list_categories` as MCP tools. Registered in `~/.openclaw/openclaw.json` under
`mcp.servers.mynews`:

```json
"mynews": {
  "command": "/usr/bin/node",
  "args": ["/home/openclaw/newsfeed/mcp.js"],
  "env": { "NEWS_API": "http://localhost:3000" }
}
```

All agents then have the three tools. A morning-news cron can fetch headlines with
`get_news`, then `get_article` for the full text of each story it wants to summarize.

## Deployed on the VPS

Runs as a systemd `--user` unit (`newsfeed.service`, `Restart=always`) on
`100.107.141.83:3000`. Manage with:

```bash
systemctl --user restart newsfeed     # after editing feeds.js
systemctl --user status newsfeed
journalctl --user -u newsfeed -f
```

To redeploy after local changes: re-tar (without `node_modules`), scp, extract to
`~/newsfeed`, `npm install --omit=dev`, `systemctl --user restart newsfeed`.

## Deploy (VPS)

```bash
PORT=3000 node server.js          # or pm2 / a systemd --user unit, like your other services
```

Put it behind your existing reverse proxy if you want it on a domain. The 5-min
cache keeps it gentle on upstream RSS.

## Files

- `server.js` — API + static host + cache + reading-time
- `feeds.js` — the 16 categories → RSS URLs (edit this)
- `public/` — the Cobalt-themed feed UI (`index.html`, `app.js`, `styles.css`, `tokens.css`)
- `mcp.js` — optional MCP wrapper
- `test.js` — unit checks
