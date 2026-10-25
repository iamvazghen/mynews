// The only file you edit to change the feed.
// Each category = a slug, a display label, and a list of RSS/Atom URLs.
// Feeds that 404 or time out are skipped (see server.js), so a dead URL never
// breaks the page — but it is logged to stderr and visible at GET /api/health.
//
// ponytail: RSS is the whole live-data layer — free, keyless, no signup.
// A few topics have no first-party RSS, so we use Hacker News query feeds
// (hnrss.org) or Google News query feeds (news.google.com/rss/search?q=…).
// Both accept a `q=` query and a `when:` window, so any topic can be covered
// without a publisher relationship. Google News items carry the real publisher
// in <source>, which server.js surfaces as the card's source.
//
// Two URL patterns worth knowing:
//   hnrss.org/newest?q=<terms>&points=<n>&count=30   — Hacker News search
//   news.google.com/rss/search?q=<terms>+when:7d      — Google News search
// The `count=30` on hnrss matters: without it those endpoints intermittently
// return HTTP 502.

const CATEGORIES = [
  // --- AI ---------------------------------------------------------------
  { slug: "ai", label: "AI · Industry & Business", feeds: [
    "https://venturebeat.com/category/ai/feed/",
    "https://www.technologyreview.com/feed/",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://openai.com/news/rss.xml",
    "https://huggingface.co/blog/feed.xml",
    "https://news.mit.edu/rss/topic/artificial-intelligence2",
    "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",
    "https://blogs.nvidia.com/feed/",
    "https://aws.amazon.com/blogs/machine-learning/feed/",
    "https://blog.google/technology/ai/rss/",
  ]},
  { slug: "ai-research", label: "AI · Research & Practice", feeds: [
    "https://simonwillison.net/atom/everything/",
    "https://www.interconnects.ai/feed",
    "https://importai.substack.com/feed",
    "https://bensbites.com/feed",
    "https://www.oneusefulthing.org/feed",
    "https://www.latent.space/feed",
    "https://arstechnica.com/ai/feed/",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://www.marktechpost.com/feed/",
    "https://www.the-decoder.com/feed/",
    "https://machinelearning.apple.com/rss.xml",
    "https://deepmind.google/blog/rss.xml",
    "https://www.techmeme.com/feed.xml",
  ]},
  { slug: "agents", label: "AI Agents", feeds: [
    "https://hnrss.org/newest?q=AI+agents&count=30",
    "https://hnrss.org/newest?q=LLM+agent&count=30",
    "https://hnrss.org/newest?q=agentic&points=30",
    "https://blog.cloudflare.com/rss/",
    "https://github.blog/feed/",
    "https://news.google.com/rss/search?q=%22AI+agent%22+when:7d&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "coding-tech", label: "Coding & Tech", feeds: [
    "https://hnrss.org/frontpage?points=100",
    "https://lobste.rs/rss",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.phoronix.com/rss.php",
    "https://lwn.net/headlines/newrss",
    "https://stackoverflow.blog/feed/",
    "https://changelog.com/feed/",
    "https://thenewstack.io/feed/",
    "https://www.theregister.com/headlines.atom",
    "https://www.404media.co/rss/",
    "https://restofworld.org/feed/latest/",
    "https://heise.de/rss/heise-atom.xml",
    "https://www.golem.de/rss.php",
  ]},
  { slug: "oss-github", label: "Open-Source / GitHub", feeds: [
    // The trending feeds ship no timestamps — server.js gives them a bounded
    // fallback date so they survive the 24h window instead of vanishing.
    "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml",
    "https://mshibanami.github.io/GitHubTrendingRSS/weekly/all.xml",
    "https://hnrss.org/show?points=50",
    "https://go.dev/blog/feed.atom",
    "https://news.google.com/rss/search?q=open+source+github+when:7d&hl=en-US&gl=US&ceid=US:en",
  ]},

  // --- Business & money -------------------------------------------------
  { slug: "startups", label: "Startups", feeds: [
    "https://techcrunch.com/category/startups/feed/",
    "https://hnrss.org/newest?q=startup&points=50&count=30",
    "https://sifted.eu/feed",
    "https://tech.eu/feed/",
    "https://www.producthunt.com/feed",
  ]},
  { slug: "business", label: "Business & Entrepreneurship", feeds: [
    "https://www.inc.com/rss/",
    "https://www.entrepreneur.com/latest.rss",
    "https://www.fastcompany.com/latest/rss",
    "https://www.economist.com/business/rss.xml",
    "https://fortune.com/feed/fortune-feeds/?id=3230629",
    "https://news.google.com/rss/search?q=business+when:3d&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "investments", label: "Investments", feeds: [
    "https://www.cnbc.com/id/15839069/device/rss/rss.html",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://www.investing.com/rss/news.rss",
    "https://seekingalpha.com/market_currents.xml",
  ]},
  { slug: "markets", label: "Stock Markets & Equities", feeds: [
    "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    "https://www.ft.com/rss/home",
    "https://asia.nikkei.com/rss/feed/nar",
    "https://www.scmp.com/rss/4/feed",
    "https://news.google.com/rss/search?q=stock+market+when:3d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:3d+(S%26P+OR+Nasdaq+OR+%22Dow+Jones%22)&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "rates-bonds", label: "Rates, Treasuries & Bonds", feeds: [
    "https://www.federalreserve.gov/feeds/press_monetary.xml",
    "https://www.federalreserve.gov/feeds/press_all.xml",
    "https://www.ecb.europa.eu/rss/press.html",
    "https://www.ecb.europa.eu/rss/operations.html",
    "https://mid.ecb.europa.eu/rss/mid.xml",
    "https://www.bankofengland.co.uk/rss/news",
    "https://www.boj.or.jp/en/rss/whatsnew.xml",
    "https://news.google.com/rss/search?q=when:3d+(Treasury+yields+OR+bond+market+OR+%22interest+rates%22)&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "macro", label: "Economics & Inflation", feeds: [
    "https://www.bls.gov/feed/cpi.rss",
    "https://www.bls.gov/feed/empsit.rss",
    "https://www.bls.gov/feed/bls_latest.rss",
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    "https://www.economist.com/finance-and-economics/rss.xml",
    "https://www.ecb.europa.eu/rss/statpress.html",
    "https://news.google.com/rss/search?q=when:3d+(inflation+OR+CPI+OR+%22interest+rate+decision%22+OR+GDP)&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "currencies", label: "Global Currencies & FX", feeds: [
    // ECB euro reference rates — one authoritative daily feed per currency.
    // This is the rate feed: 1 EUR = N units, published ~16:00 CET each TARGET day.
    "https://www.ecb.europa.eu/rss/fxref-usd.html",  // US dollar
    "https://www.ecb.europa.eu/rss/fxref-jpy.html",  // Japanese yen
    "https://www.ecb.europa.eu/rss/fxref-cny.html",  // Chinese yuan
    "https://www.ecb.europa.eu/rss/fxref-nok.html",  // Norwegian krone
    "https://www.ecb.europa.eu/rss/fxref-sgd.html",  // Singapore dollar
    "https://www.ecb.europa.eu/rss/fxref-chf.html",  // Swiss franc
    "https://www.ecb.europa.eu/rss/fxref-gbp.html",  // Pound sterling
    "https://www.ecb.europa.eu/rss/fxref-sek.html",  // Swedish krona
    "https://www.ecb.europa.eu/rss/fxref-dkk.html",  // Danish krone
    "https://www.ecb.europa.eu/rss/fxref-aud.html",  // Australian dollar
    "https://www.ecb.europa.eu/rss/fxref-cad.html",  // Canadian dollar
    "https://www.ecb.europa.eu/rss/fxref-nzd.html",  // New Zealand dollar
    "https://www.ecb.europa.eu/rss/fxref-inr.html",  // Indian rupee
    "https://www.ecb.europa.eu/rss/fxref-krw.html",  // South Korean won
    "https://www.ecb.europa.eu/rss/fxref-mxn.html",  // Mexican peso
    "https://www.ecb.europa.eu/rss/fxref-brl.html",  // Brazilian real
    "https://www.ecb.europa.eu/rss/fxref-zar.html",  // South African rand
    "https://www.ecb.europa.eu/rss/fxref-try.html",  // Turkish lira
    "https://www.ecb.europa.eu/rss/fxref-thb.html",  // Thai baht
    "https://www.ecb.europa.eu/rss/fxref-pln.html",  // Polish zloty
    // Rate + market coverage
    "https://www.rba.gov.au/rss/rss-cb-exchange-rates.xml",
    "https://www.fxstreet.com/rss/news",
    "https://www.forexlive.com/feed",
    // News per currency — the reference rates tell you the number, these tell
    // you why it moved (policy, carry, risk events).
    "https://news.google.com/rss/search?q=when:7d+(USD+OR+%22US+dollar%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(JPY+OR+yen)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(CNY+OR+yuan)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(NOK+OR+%22Norwegian+krone%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(SGD+OR+%22Singapore+dollar%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(CHF+OR+%22Swiss+franc%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(EUR+OR+euro)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(GBP+OR+sterling)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
  ]},
  { slug: "crypto", label: "Crypto & Blockchain", feeds: [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://blog.bitfinex.com/feed/",
    "https://decrypt.co/feed",
    "https://www.theblock.co/rss.xml",
    "https://bitcoinmagazine.com/feed",
  ]},

  // --- Tech-adjacent beats ---------------------------------------------
  { slug: "cyber", label: "Cybersecurity", feeds: [
    "https://feeds.feedburner.com/TheHackersNews",
    "https://www.darkreading.com/rss.xml",
    "https://grahamcluley.com/feed/",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://aws.amazon.com/blogs/security/feed/",
    "https://www.helpnetsecurity.com/feed/",
    "https://www.securityweek.com/feed/",
    "https://www.schneier.com/feed/atom/",
    "https://krebsonsecurity.com/feed/",
    "https://therecord.media/feed",
  ]},
  { slug: "gaming", label: "Gaming", feeds: [
    "https://www.eurogamer.net/feed",
    "https://www.gamesindustry.biz/feed",
    "https://www.rockpapershotgun.com/feed",
    "https://www.pcgamesn.com/feed",
    "https://www.pcgamer.com/rss/",
    "https://www.destructoid.com/feed/",
    "https://www.polygon.com/rss/index.xml",
    "https://www.videogameschronicle.com/feed/",
    "https://blog.playstation.com/feed/",
    "https://news.xbox.com/en-us/feed/",
  ]},
  { slug: "film-tv", label: "Film & TV", feeds: [
    "https://www.theguardian.com/film/rss",
    "https://www.indiewire.com/feed/",
    "https://deadline.com/feed/",
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed/",
    "https://www.rogerebert.com/feed",
  ]},
  { slug: "space", label: "Space & Science", feeds: [
    "https://www.nature.com/nature.rss",
    "https://phys.org/rss-feed/breaking/",
    "https://www.scientificamerican.com/platform/syndication/rss/",
    "https://arstechnica.com/science/feed/",
    "https://spacenews.com/feed/",
    "https://www.nasa.gov/feed/",
    "https://www.esa.int/rssfeed/Our_Activities/Space_News",
  ]},
  { slug: "climate", label: "Climate & Energy", feeds: [
    "https://www.canarymedia.com/rss",
    "https://cleantechnica.com/feed/",
    "https://www.carbonbrief.org/feed/",
    "https://www.utilitydive.com/feeds/news/",
    "https://www.latitudemedia.com/feed",
  ]},
  { slug: "health", label: "Health & Biotech", feeds: [
    "https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss",
    "https://www.statnews.com/feed/",
    "https://www.biopharmadive.com/feeds/news/",
  ]},

  // --- Sports -----------------------------------------------------------
  { slug: "basketball", label: "Basketball", feeds: [
    "https://www.espn.com/espn/rss/nba/news",
    "https://www.cbssports.com/rss/headlines/nba/",
  ]},
  { slug: "football", label: "Football (Soccer)", feeds: [
    "https://www.espn.com/espn/rss/soccer/news",
    "https://feeds.bbci.co.uk/sport/football/rss.xml",
  ]},
  { slug: "sports", label: "Sports · F1, Tennis, NFL", feeds: [
    "https://feeds.bbci.co.uk/sport/formula1/rss.xml",
    "https://feeds.bbci.co.uk/sport/tennis/rss.xml",
    "https://www.espn.com/espn/rss/football/news",
    "https://www.skysports.com/rss/12040",
  ]},

  // --- Culture & hobbies ------------------------------------------------
  { slug: "marvel-dc", label: "Marvel & DC", feeds: [
    "https://screenrant.com/feed/",
    "https://www.cbr.com/feed/",
    "https://comicbook.com/rss/",
  ]},
  { slug: "manga-anime", label: "Manga & Anime", feeds: [
    "https://www.animenewsnetwork.com/all/rss.xml",
    "https://otakukart.com/feed/",
  ]},
  { slug: "sneakers", label: "Sneakerhead", feeds: [
    "https://sneakernews.com/feed/",
    "https://www.nicekicks.com/feed/",
    "https://www.hypebeast.com/feed/",
    "https://www.highsnobiety.com/feed/",
  ]},
  { slug: "watches", label: "Watches", feeds: [
    "https://www.ablogtowatch.com/feed/",
    "https://www.fratellowatches.com/feed/",
  ]},
  { slug: "reading", label: "Reading Recs", feeds: [
    "https://lithub.com/feed/",
    "https://www.themarginalian.org/feed/",
    "https://clarkesworldmagazine.com/feed/",
    "https://reactormag.com/feed/",
    "https://www.tor.com/feed/",
    "https://www.theguardian.com/books/rss",
  ]},

  // --- World ------------------------------------------------------------
  { slug: "politics", label: "Germany · Ukraine", feeds: [
    "https://rss.dw.com/rdf/rss-en-ger",
    "https://www.pravda.com.ua/eng/rss/",
    "https://en.interfax.com.ua/news/last.rss",
    "https://www.spiegel.de/schlagzeilen/tops/index.rss",
  ]},
  { slug: "armenia", label: "Armenia · Local", feeds: [
    "https://www.evnreport.com/feed/",
    "https://www.news.am/eng/rss/",
    "https://news.google.com/rss/search?q=Armenia+when:7d&hl=en-US&gl=US&ceid=US:en",
  ]},
];

// slug -> [urls], built once for fast lookup in the server.
const FEEDS = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.feeds]));

module.exports = { CATEGORIES, FEEDS };
