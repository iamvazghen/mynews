// The only file you edit to change the feed.
// Each category = a slug, a display label, and a list of RSS/Atom URLs.
// Feeds that 404 or time out are silently skipped (see server.js), so a dead
// URL never breaks the page — swap it when convenient.
//
// ponytail: RSS is the whole live-data layer — free, keyless, no signup.
// A few topics have no first-party RSS, so we use Hacker News query feeds
// (hnrss.org) or a community GitHub-trending mirror. Swap any of these for a
// paid API later if you want deeper coverage (see README "Going deeper").

const CATEGORIES = [
  { slug: "marvel-dc", label: "Marvel & DC", feeds: [
    "https://screenrant.com/feed/",
    "https://www.cbr.com/feed/",
  ]},
  { slug: "manga-anime", label: "Manga & Anime", feeds: [
    "https://www.animenewsnetwork.com/all/rss.xml",
    "https://otakukart.com/feed/",
  ]},
  { slug: "ai", label: "AI", feeds: [
    "https://venturebeat.com/category/ai/feed/",
    "https://www.technologyreview.com/feed/",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
  ]},
  { slug: "basketball", label: "Basketball", feeds: [
    "https://www.espn.com/espn/rss/nba/news",
    "https://www.cbssports.com/rss/headlines/nba/",
  ]},
  { slug: "football", label: "Football (Soccer)", feeds: [
    "https://www.espn.com/espn/rss/soccer/news",
    "https://feeds.bbci.co.uk/sport/football/rss.xml",
  ]},
  { slug: "investments", label: "Investments", feeds: [
    "https://www.cnbc.com/id/15839069/device/rss/rss.html",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
  ]},
  { slug: "startups", label: "Startups", feeds: [
    "https://techcrunch.com/category/startups/feed/",
    "https://hnrss.org/newest?q=startup&points=50",
  ]},
  { slug: "crypto", label: "Crypto & Blockchain", feeds: [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
  ]},
  { slug: "coding-tech", label: "Coding & Tech", feeds: [
    "https://hnrss.org/frontpage",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/index",
  ]},
  { slug: "agents", label: "AI Agents", feeds: [
    "https://hnrss.org/newest?q=AI+agents",
    "https://hnrss.org/newest?q=LLM+agent",
  ]},
  { slug: "business", label: "Business & Entrepreneurship", feeds: [
    "https://www.entrepreneur.com/latest.rss",
    "https://feeds.feedburner.com/inc/headlines",
    "https://www.fastcompany.com/latest/rss",
  ]},
  { slug: "sneakers", label: "Sneakerhead", feeds: [
    "https://sneakernews.com/feed/",
    "https://www.nicekicks.com/feed/",
  ]},
  { slug: "watches", label: "Watches", feeds: [
    "https://www.ablogtowatch.com/feed/",
    "https://www.fratellowatches.com/feed/",
  ]},
  { slug: "reading", label: "Reading Recs", feeds: [
    "https://lithub.com/feed/",
    "https://www.themarginalian.org/feed/",
  ]},
  { slug: "politics", label: "Germany · Ukraine · Armenia", feeds: [
    "https://rss.dw.com/rdf/rss-en-ger",
    "https://www.pravda.com.ua/eng/rss/",
    "https://www.evnreport.com/feed/",
  ]},
  { slug: "oss-github", label: "Open-Source / GitHub", feeds: [
    "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml",
    "https://hnrss.org/show",
  ]},
];

// slug -> [urls], built once for fast lookup in the server.
const FEEDS = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.feeds]));

module.exports = { CATEGORIES, FEEDS };
