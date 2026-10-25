// The only file you edit to change the feed.
//
// Each category is { slug, label, feeds: [...] } and each feed entry is one of:
//
//   "https://example.com/rss.xml"                      → RSS/Atom (the common case)
//   { type: "json", adapter: "hn", url: "..." }         → a JSON API, normalised by adapters.js
//   { type: "json", adapter: "guardian", url: "...{{auth}}",
//     auth: { env: "GUARDIAN_KEY" } }                   → needs an API key in the environment
//   { type: "json", adapter: "reddit", url: "...",
//     auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID",
//              secretEnv: "REDDIT_CLIENT_SECRET" } }    → needs OAuth2 credentials
//
// A source whose credentials are missing is SKIPPED, never failed — see
// server.js. That way you can commit the full source list and enable
// integrations by adding an env var, without the feed ever breaking.
//
// ponytail: RSS is the base layer — free, keyless, no signup. The JSON
// adapters exist because RSS alone leaves several topics thin: a daily rate
// sheet, a preprint, a Stack Overflow answer or a scholarly paper is exactly
// the "go in depth" material a headline feed can't provide.
//
// Two URL patterns worth knowing:
//   news.google.com/rss/search?q=<terms>+when:2d    — Google News search
//   hnrss.org/newest?q=<terms>&points=<n>&count=30   — Hacker News search
// The `count=30` on hnrss matters: without it those endpoints intermittently
// return HTTP 502.

// Google News search feed — the reliable way to keep any topic populated.
// Google ranks by relevance and stamps every item with a real publish time.
const gn = (q, window = "2d") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${window}`).replace(/%20/g, "+")}&hl=en-US&gl=US&ceid=US:en`;

// Hacker News via the public Algolia index. Keyless, and returns the newest
// matches first — good depth for technical topics.
const hn = (query, hits = 25) =>
  `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${hits}`;

// A JSON adapter source. `auth` is optional; when present the URL's
// "{{auth}}" placeholder is replaced with the env var's value.
// A source may also carry `ua` to override the User-Agent — some publishers
// answer 403 to anything that does not look like a browser.
const api = (adapter, url, opts = {}) => ({ type: "json", adapter, url, ...opts });

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
    // --- depth + daily volume ---
    gn("artificial intelligence model launch"),
    api("hn", hn("AI")),
    api("devto", "https://dev.to/api/articles?tag=ai&per_page=20"),
    api("openalex", "https://api.openalex.org/works?search=artificial%20intelligence&per-page=15&sort=publication_date:desc"),
    api("arxiv", "http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=15&sortBy=submittedDate&sortOrder=descending", { type: "atom" }),
    // --- authenticated (opt-in) ---
    api("guardian", "https://content.guardianapis.com/search?section=technology&q=artificial%20intelligence&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
    api("newsapi", "https://newsapi.org/v2/everything?q=artificial%20intelligence&sortBy=publishedAt&pageSize=20&language=en&apiKey={{auth}}", { auth: { env: "NEWSAPI_KEY" } }),
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
    // --- depth: preprints and papers ---
    api("arxiv", "http://export.arxiv.org/api/query?search_query=cat:cs.LG+OR+cat:cs.CL&max_results=20&sortBy=submittedDate&sortOrder=descending", { type: "atom" }),
    api("openalex", "https://api.openalex.org/works?search=large%20language%20model%20agent&per-page=15&sort=cited_by_count:desc"),
    api("devto", "https://dev.to/api/articles?tag=ai&per_page=20"),
    api("hn", hn("LLM")),
  ]},
  { slug: "agents", label: "AI Agents", feeds: [
    "https://hnrss.org/newest?q=AI+agents&count=30",
    "https://hnrss.org/newest?q=LLM+agent&count=30",
    "https://hnrss.org/newest?q=agentic&points=30",
    "https://blog.cloudflare.com/rss/",
    "https://github.blog/feed/",
    "https://news.google.com/rss/search?q=%22AI+agent%22+when:7d&hl=en-US&gl=US&ceid=US:en",
    // --- depth ---
    api("hn", hn("AI agent")),
    api("devto", "https://dev.to/api/articles?tag=ai-agents&per_page=20"),
    api("arxiv", "http://export.arxiv.org/api/query?search_query=cat:cs.MA+OR+cat:cs.HC&max_results=12&sortBy=submittedDate&sortOrder=descending", { type: "atom" }),
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
    // --- depth: real engineering writing and real Q&A ---
    api("devto", "https://dev.to/api/articles?tag=programming&per_page=20"),
    api("stackexchange", "https://api.stackexchange.com/2.3/questions?site=stackoverflow&pagesize=20&sort=creation&order=desc&filter=default"),
    api("hn", hn("engineering programming")),
    gn("software engineering developer tools"),
  ]},
  { slug: "oss-github", label: "Open-Source / GitHub", feeds: [
    // The trending feeds ship no timestamps — server.js gives them a bounded
    // fallback date so they survive the 24h window instead of vanishing.
    "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml",
    "https://mshibanami.github.io/GitHubTrendingRSS/weekly/all.xml",
    "https://hnrss.org/show?points=50",
    "https://go.dev/blog/feed.atom",
    "https://news.google.com/rss/search?q=open+source+github+when:7d&hl=en-US&gl=US&ceid=US:en",
    // --- depth ---
    api("hn", hn("open source")),
    api("stackexchange", "https://api.stackexchange.com/2.3/questions?site=serverfault&pagesize=15&sort=creation&order=desc&filter=default"),
  ]},

  // --- Business & money -------------------------------------------------
  { slug: "startups", label: "Startups", feeds: [
    "https://techcrunch.com/category/startups/feed/",
    "https://hnrss.org/newest?q=startup&points=50&count=30",
    "https://sifted.eu/feed",
    "https://tech.eu/feed/",
    "https://www.producthunt.com/feed",
    // --- depth + daily volume ---
    gn("startup funding round venture capital"),
    api("hn", hn("startup")),
  ]},
  { slug: "business", label: "Business & Entrepreneurship", feeds: [
    "https://www.inc.com/rss/",
    "https://www.entrepreneur.com/latest.rss",
    "https://www.fastcompany.com/latest/rss",
    "https://www.economist.com/business/rss.xml",
    "https://fortune.com/feed/fortune-feeds/?id=3230629",
    "https://news.google.com/rss/search?q=business+when:3d&hl=en-US&gl=US&ceid=US:en",
    // --- depth + daily volume ---
    gn("startup business strategy leadership"),
    api("guardian", "https://content.guardianapis.com/search?section=business&q=business&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
    api("newsapi", "https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=20&apiKey={{auth}}", { auth: { env: "NEWSAPI_KEY" } }),
  ]},
  { slug: "investments", label: "Investments", feeds: [
    "https://www.cnbc.com/id/15839069/device/rss/rss.html",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://www.investing.com/rss/news.rss",
    "https://seekingalpha.com/market_currents.xml",
    // --- depth + daily volume ---
    gn("stock market investing equities"),
    api("guardian", "https://content.guardianapis.com/search?section=business&q=markets&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
    api("twelvedata", "https://api.twelvedata.com/quote?symbol=EUR/USD,GBP/USD,USD/JPY&apikey={{auth}}", { auth: { env: "TWELVEDATA_KEY" } }),
  ]},
  { slug: "markets", label: "Stock Markets & Equities", feeds: [
    "https://www.cnbc.com/id/10001147/device/rss/rss.html",
    "https://www.ft.com/rss/home",
    "https://asia.nikkei.com/rss/feed/nar",
    "https://www.scmp.com/rss/4/feed",
    "https://news.google.com/rss/search?q=stock+market+when:3d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:3d+(S%26P+OR+Nasdaq+OR+%22Dow+Jones%22)&hl=en-US&gl=US&ceid=US:en",
    // --- depth + daily volume ---
    gn("equities shares earnings index"),
    api("guardian", "https://content.guardianapis.com/search?section=business&q=stock+market&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
    api("newsapi", "https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=20&apiKey={{auth}}", { auth: { env: "NEWSAPI_KEY" } }),
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
    // --- depth + daily volume ---
    gn("bond yields treasury interest rate decision"),
  ]},
  { slug: "macro", label: "Economics & Inflation", feeds: [
    // The BLS RSS feeds answer 403 to datacenter IPs (so they work from the
    // VPS but not from Vercel). The keyless BLS public API does not — so the
    // structured series below are what actually survives on serverless.
    api("bls", "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0", { label: "US CPI-U, all items", unit: "", archive: "cpi" }),
    api("bls", "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0L1E", { label: "US core CPI, all items less food and energy", unit: "", archive: "cpi" }),
    api("bls", "https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000", { label: "US unemployment rate", unit: "%", archive: "empsit" }),
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    "https://www.economist.com/finance-and-economics/rss.xml",
    "https://www.ecb.europa.eu/rss/statpress.html",
    "https://news.google.com/rss/search?q=when:3d+(inflation+OR+CPI+OR+%22interest+rate+decision%22+OR+GDP)&hl=en-US&gl=US&ceid=US:en",
    // --- depth + daily volume ---
    gn("inflation consumer prices central bank economy"),
    api("guardian", "https://content.guardianapis.com/search?section=business&q=economy&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
  ]},
  { slug: "fx-rates", label: "FX Reference Rates (ECB)", periodic: true, feeds: [
    // Daily reference rates, one authoritative feed per currency.
    // 1 EUR = N units, published ~16:00 CET each TARGET day.
    //
    // These live in their OWN category on purpose: a feed that publishes one
    // rate per day gets buried under a hundred breaking-news items once
    // everything is sorted by date. Keeping the rates separate means
    // "give me today's rates" is one cheap, precise query.
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
    "https://www.rba.gov.au/rss/rss-cb-exchange-rates.xml", // RBA daily rates (AUD)
    // --- keyless FX API: same ECB data, one call for 30 currencies ---
    api("frankfurter", "https://api.frankfurter.app/latest?from=EUR&to=USD,JPY,CNY,NOK,SGD,CHF,GBP,SEK,DKK,AUD,CAD,NZD,INR,KRW,MXN,BRL,ZAR,TRY,THB,PLN"),
    // --- authenticated live quotes ---
    api("twelvedata", "https://api.twelvedata.com/quote?symbol=EUR/USD,GBP/USD,USD/JPY,EUR/NOK,USD/CNH&apikey={{auth}}", { auth: { env: "TWELVEDATA_KEY" } }),
  ]},
  { slug: "currencies", label: "Global Currencies & FX", feeds: [
    // Market moves — *why* a pair moved: policy, carry, risk events.
    // The numbers themselves live in the "FX Reference Rates" category above.
    "https://www.fxstreet.com/rss/news",
    "https://www.forexlive.com/feed",
    "https://news.google.com/rss/search?q=when:7d+(USD+OR+%22US+dollar%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(JPY+OR+yen)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(CNY+OR+yuan)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(NOK+OR+%22Norwegian+krone%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(SGD+OR+%22Singapore+dollar%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(CHF+OR+%22Swiss+franc%22)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(EUR+OR+euro)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=when:7d+(GBP+OR+sterling)+currency+exchange+rate&hl=en-US&gl=US&ceid=US:en",
    // --- depth + daily volume ---
    gn("currency forex central bank exchange rate"),
  ]},
  { slug: "crypto", label: "Crypto & Blockchain", feeds: [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://blog.bitfinex.com/feed/",
    "https://decrypt.co/feed",
    "https://www.theblock.co/rss.xml",
    "https://bitcoinmagazine.com/feed",
    // --- depth + daily volume ---
    gn("bitcoin ethereum crypto blockchain"),
    api("coingecko", "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=15&page=1&sparkline=false"),
  ]},

  // --- Tech-adjacent beats ---------------------------------------------
  { slug: "cyber", label: "Cybersecurity", feeds: [
    "https://thehackernews.com/feeds/posts/default",
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
    // --- depth + daily volume ---
    gn("(cybersecurity OR hack OR ransomware OR vulnerability)"),
    api("hn", hn("security breach")),
    api("guardian", "https://content.guardianapis.com/search?section=technology&q=cybersecurity&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
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
    // --- depth + daily volume ---
    gn("video game release console review"),
    api("guardian", "https://content.guardianapis.com/search?section=technology&q=games&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
    api("reddit", "https://www.reddit.com/r/Gaming/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
  { slug: "film-tv", label: "Film & TV", feeds: [
    "https://www.theguardian.com/film/rss",
    "https://www.indiewire.com/feed/",
    "https://deadline.com/feed/",
    "https://variety.com/feed/",
    "https://www.hollywoodreporter.com/feed/",
    "https://www.rogerebert.com/feed",
    // --- depth + daily volume ---
    gn("film movie series streaming release"),
    api("tmdb", "https://api.themoviedb.org/3/trending/all/day?api_key={{auth}}", { auth: { env: "TMDB_KEY" } }),
    api("reddit", "https://www.reddit.com/r/MovieNews/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
  { slug: "space", label: "Space & Science", feeds: [
    // nature.com/nature.rss was here, but it now answers with a Cloudflare
    // bot challenge instead of the feed — replaced by these.
    "https://phys.org/rss-feed/breaking/",
    "https://phys.org/rss-feed/space-news/",
    "https://www.scientificamerican.com/platform/syndication/rss/",
    "https://arstechnica.com/science/feed/",
    "https://spacenews.com/feed/",
    "https://www.space.com/feeds/all",
    "https://www.universetoday.com/feed/",
    "https://www.quantamagazine.org/feed/",
    "https://www.newscientist.com/subject/space/feed/",
    "https://www.nasa.gov/feed/",
    "https://www.esa.int/rssfeed/Our_Activities/Space_News",
    // --- depth + daily volume ---
    gn("space launch nasa satellite telescope"),
    api("openalex", "https://api.openalex.org/works?search=astronomy%20astrophysics&per-page=12&sort=publication_date:desc"),
  ]},
  { slug: "climate", label: "Climate & Energy", feeds: [
    "https://www.canarymedia.com/rss",
    "https://cleantechnica.com/feed/",
    "https://www.carbonbrief.org/feed/",
    "https://www.utilitydive.com/feeds/news/",
    "https://www.latitudemedia.com/feed",
    // --- depth + daily volume ---
    gn("climate energy emissions renewable grid"),
    api("openalex", "https://api.openalex.org/works?search=climate%20change%20energy%20transition&per-page=12&sort=publication_date:desc"),
  ]},
  { slug: "health", label: "Health & Biotech", feeds: [
    "https://www.nejm.org/action/showFeed?jc=nejm&type=etoc&feed=rss",
    "https://www.statnews.com/feed/",
    "https://www.biopharmadive.com/feeds/news/",
    // --- depth + daily volume ---
    gn("pharma biotech clinical trial drug FDA"),
    api("openalex", "https://api.openalex.org/works?search=biotechnology%20clinical%20trial&per-page=12&sort=publication_date:desc"),
    api("guardian", "https://content.guardianapis.com/search?section=society&q=health&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
  ]},

  // --- Sports -----------------------------------------------------------
  { slug: "basketball", label: "Basketball", feeds: [
    "https://www.espn.com/espn/rss/nba/news",
    "https://www.cbssports.com/rss/headlines/nba/",
    // --- depth + daily volume ---
    gn("NBA basketball playoffs trade"),
  ]},
  { slug: "football", label: "Football (Soccer)", feeds: [
    "https://www.espn.com/espn/rss/soccer/news",
    "https://feeds.bbci.co.uk/sport/football/rss.xml",
    // --- depth + daily volume ---
    gn("football soccer transfer premier league"),
  ]},
  { slug: "sports", label: "Sports · F1, Tennis, NFL", feeds: [
    "https://feeds.bbci.co.uk/sport/formula1/rss.xml",
    "https://feeds.bbci.co.uk/sport/tennis/rss.xml",
    "https://www.espn.com/espn/rss/football/news",
    "https://www.skysports.com/rss/12040",
    // --- depth + daily volume ---
    gn("formula 1 tennis NFL result"),
  ]},

  // --- Culture & hobbies ------------------------------------------------
  { slug: "marvel-dc", label: "Marvel & DC", feeds: [
    "https://screenrant.com/feed/",
    "https://www.cbr.com/feed/",
    "https://comicbook.com/rss/",
    // --- depth + daily volume ---
    gn("Marvel DC comics MCU"),
    api("tmdb", "https://api.themoviedb.org/3/search/multi?query=marvel&api_key={{auth}}", { auth: { env: "TMDB_KEY" } }),
    api("reddit", "https://www.reddit.com/r/comicbooks/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
  { slug: "manga-anime", label: "Manga & Anime", feeds: [
    "https://www.animenewsnetwork.com/all/rss.xml",
    "https://otakukart.com/feed/",
    // --- depth + daily volume ---
    gn("anime manga studio season release"),
    api("tmdb", "https://api.themoviedb.org/3/discover/tv?with_genres=16&sort_by=popularity.desc&api_key={{auth}}", { auth: { env: "TMDB_KEY" } }),
  ]},
  { slug: "sneakers", label: "Sneakerhead", feeds: [
    "https://sneakernews.com/feed/",
    "https://www.nicekicks.com/feed/",
    "https://www.hypebeast.com/feed/",
    "https://www.highsnobiety.com/feed/",
    // --- depth + daily volume ---
    gn("sneaker release Jordan Nike collab"),
    api("reddit", "https://www.reddit.com/r/sneakers/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
  { slug: "watches", label: "Watches", feeds: [
    "https://www.ablogtowatch.com/feed/",
    "https://www.fratellowatches.com/feed/",
    "https://monochrome-watches.com/feed/",
    "https://wornandwound.com/feed/",
    // --- depth + daily volume ---
    gn("(watch OR timepiece OR horology)"),
    gn("(%22watch release%22 OR Rolex OR Omega OR Seiko)"),
    api("openlibrary", "https://openlibrary.org/subjects/watchmaking.json?limit=15"),
    api("reddit", "https://www.reddit.com/r/Watches/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
  { slug: "reading", label: "Reading Recs", feeds: [
    "https://lithub.com/feed/",
    "https://www.themarginalian.org/feed/",
    "https://clarkesworldmagazine.com/feed/",
    "https://reactormag.com/feed/",
    "https://www.tor.com/feed/",
    "https://www.theguardian.com/books/rss",
    // --- depth ---
    api("openlibrary", "https://openlibrary.org/search.json?q=subject:science_fiction&limit=15&sort=new"),
    gn("new book author novel prize"),
  ]},

  // --- World ------------------------------------------------------------
  { slug: "politics", label: "Germany · Ukraine", feeds: [
    "https://rss.dw.com/rdf/rss-en-ger",
    "https://www.pravda.com.ua/eng/rss/",
    "https://en.interfax.com.ua/news/last.rss",
    "https://www.spiegel.de/schlagzeilen/tops/index.rss",
    // --- depth + daily volume ---
    gn("Ukraine Germany politics government"),
    api("guardian", "https://content.guardianapis.com/search?section=world&q=Ukraine&order-by=newest&page-size=20&api-key={{auth}}", { auth: { env: "GUARDIAN_KEY" } }),
  ]},
  { slug: "armenia", label: "Armenia · Local", feeds: [
    "https://www.evnreport.com/feed/",
    "https://www.news.am/eng/rss/",
    "https://news.google.com/rss/search?q=Armenia+when:7d&hl=en-US&gl=US&ceid=US:en",
    // --- depth + daily volume ---
    gn("Armenia Yerevan government"),
    api("reddit", "https://www.reddit.com/r/Armenia/top.json?t=week&limit=25", { auth: { type: "reddit-oauth", env: "REDDIT_CLIENT_ID", secretEnv: "REDDIT_CLIENT_SECRET" } }),
  ]},
];

// slug -> [sources], built once for fast lookup in the server.
const FEEDS = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.feeds]));

// Categories that publish on a schedule rather than continuously. Their newest
// item can legitimately be older than the `since` window (FX reference rates are
// published on TARGET days, so on a Sunday the latest is Friday's), so the
// server always keeps their newest batch regardless of the window.
const PERIODIC = new Set(CATEGORIES.filter((c) => c.periodic).map((c) => c.slug));

// Every distinct source, for the health endpoint.
const ALL_SOURCES = Object.values(FEEDS).flat();

module.exports = { CATEGORIES, FEEDS, PERIODIC, ALL_SOURCES };
