// Normalisers for non-RSS sources.
//
// Every adapter returns the same shape the RSS path produces, so server.js can
// reuse one normaliser for both:
//
//   { title, link, content, isoDate }
//
// The publisher shown on a card is derived from the link's hostname, which is
// correct for all of these (arxiv.org, dev.to, openlibrary.org, the publisher's
// own domain for GDELT results, and so on).
//
// Adapters that need credentials are only wired up when their env var is
// present — see server.js. Nothing here reads process.env directly.

const asDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// "20261025T191500Z" -> "2026-10-25T19:15:00.000Z"
const gdeltDate = (s) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null;
};

const strip = (s, n = 400) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

// OpenAlex gives an inverted index; put the words back in order.
function rebuildAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(" ").slice(0, 600);
}

const adapters = {
  // --- GDELT: global news index search. Keyless, date-sorted. The single
  //     best lever for keeping a niche category populated every day.
  gdelt(payload) {
    return (payload.articles || []).map((a) => ({
      title: (a.title || "").trim(),
      link: a.url,
      isoDate: gdeltDate(a.seendate),
      content: a.title,
      image: a.socialimage || null,
    }));
  },

  // --- Hacker News via Algolia. Keyless, supports a numeric date filter,
  //     so it is the reliable way to get *recent* items for any topic.
  hn(payload) {
    return (payload.hits || []).map((h) => ({
      title: (h.title || h.story_title || "").trim(),
      link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      isoDate: asDate(h.created_at),
      content: strip(h.story_text || h.comment_text || h.title),
    }));
  },

  // --- DEV Community: practical engineering writing, per tag.
  devto(payload) {
    const list = Array.isArray(payload) ? payload : [];
    return list.map((a) => ({
      title: (a.title || "").trim(),
      link: a.url,
      isoDate: asDate(a.published_at || a.published_timestamp),
      content: strip(a.description),
      image: a.cover_image || a.social_image || null,
    }));
  },

  // --- arXiv: research preprints. Deep, not fast.
  arxiv(payload) {
    const list = payload.entries || payload.items || [];
    return list.map((e) => ({
      title: (e.title || "").replace(/\s+/g, " ").trim(),
      link: e.link || e.id,
      isoDate: asDate(e.published || e.updated || e.isoDate),
      content: strip(e.summary || e.content),
    }));
  },

  // --- OpenAlex: scholarly works. Citation-count sorted for "important".
  openalex(payload) {
    const list = payload.results || [];
    return list.map((w) => ({
      title: (w.display_name || w.title || "").trim(),
      link: w.doi || w.id,
      isoDate: asDate(w.publication_date),
      content: strip(rebuildAbstract(w.abstract_inverted_index) || w.keywords?.map((k) => k.display_name).join(", ")),
    }));
  },

  // --- Stack Exchange: the questions themselves are the articles.
  stackexchange(payload) {
    const list = payload.items || [];
    return list.map((q) => ({
      title: (q.title || "").trim(),
      link: q.link,
      isoDate: new Date((q.creation_date || 0) * 1000).toISOString(),
      content: strip(
        `${(q.tags || []).map((t) => t.replace(/</g, "&lt;")).join(", ")} — ${q.score || 0} votes, ${q.answer_count || 0} answers`
      ),
    }));
  },

  // --- Open Library: books by subject or search.
  openlibrary(payload) {
    const list = payload.docs || payload.works || [];
    return list.map((b) => {
      const key = b.key || (b.edition_key && b.edition_key[0]) || "";
      const authors = (b.authors || []).map((a) => a.name || a).filter(Boolean);
      return {
        title: (b.title || "").trim(),
        link: key.startsWith("http") ? key : `https://openlibrary.org${key}`,
        isoDate: b.first_publish_year ? `${b.first_publish_year}-01-01T00:00:00.000Z` : null,
        content: strip(
          `${authors.join(", ")}${b.first_publish_year ? ` · ${b.first_publish_year}` : ""}${
            (b.subject || []).slice(0, 4).join(", ")
          }`
        ),
        image: b.cover_id ? `https://covers.openlibrary.org/b/id/${b.cover_id}-M.jpg` : null,
      };
    });
  },

  // --- Frankfurter: keyless FX reference rates (ECB data, no key needed).
  frankfurter(payload) {
    const base = payload.base || "EUR";
    const date = payload.date;
    return Object.entries(payload.rates || {}).map(([ccy, rate]) => ({
      title: `1 ${base} = ${rate} ${ccy} ${date}`,
      link: `https://www.frankfurter.app/latest?from=${base}&to=${ccy}`,
      isoDate: date ? `${date}T00:00:00.000Z` : null,
      content: `ECB reference rate: 1 ${base} = ${rate} ${ccy} on ${date}.`,
    }));
  },

  // --- CoinGecko: crypto market snapshot.
  coingecko(payload) {
    const list = Array.isArray(payload) ? payload : [];
    return list.map((c) => {
      const pct = c.price_change_percentage_24h;
      const dir = pct == null ? "" : pct >= 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`;
      return {
        title: `${c.name} (${String(c.symbol || "").toUpperCase()}) $${c.current_price} ${dir} 24h`,
        link: `https://www.coingecko.com/en/coins/${c.id}`,
        isoDate: asDate(c.last_updated),
        content: strip(
          `Market cap $${(c.market_cap || 0).toLocaleString()}, 24h volume $${(c.total_volume || 0).toLocaleString()}.`
        ),
        image: c.image || null,
      };
    });
  },

  // --- BLS public API v1: US CPI and unemployment, keyless.
  //     The BLS *RSS* feeds answer 403 to datacenter IPs, but the public API
  //     does not — so this is what actually survives on a serverless host.
  //     Each figure is dated at its approximate release date (a month ends,
  //     then ~2 weeks later the number is published), not at the reference
  //     period, so it behaves like a news item rather than a stale datapoint.
  bls(payload, src) {
    const series = payload?.Results?.series?.[0];
    if (!series) return [];
    const label = src.label || series.seriesID;
    const unit = src.unit || "";
    const archive = src.archive || "cpi";
    return (series.data || []).map((d) => {
      const period = String(d.period || "");
      const month = Number(/^M(\d{2})$/.exec(period)?.[1] || 1);
      const year = Number(d.year);
      // last day of the reference month, plus ~2 weeks for the release lag
      const released = new Date(Date.UTC(year, month, 0) + 15 * 86400000);
      return {
        title: `${label}: ${d.value}${unit} — ${d.periodName} ${d.year} (BLS)`,
        link: `https://www.bls.gov/news.release/archives/${archive}_${period}${year}.htm`,
        isoDate: released.toISOString(),
        content: `${label} for ${d.periodName} ${d.year}: ${d.value}${unit}. Series ${series.seriesID}, published by the U.S. Bureau of Labor Statistics.`,
      };
    });
  },

  // --- The Guardian Open Platform. Needs a free API key.
  guardian(payload) {
    const list = payload?.response?.results || [];
    return list.map((r) => ({
      title: (r.webTitle || "").trim(),
      link: r.webUrl,
      isoDate: asDate(r.webPublicationDate),
      content: strip(r.fields?.trailText || r.fields?.bodyText || ""),
      image: null,
    }));
  },

  // --- NewsAPI. Needs a free developer key.
  newsapi(payload) {
    const list = payload.articles || [];
    return list.map((a) => ({
      title: (a.title || "").trim(),
      link: a.url,
      isoDate: asDate(a.publishedAt),
      content: strip(a.description),
      image: a.urlToImage || null,
    }));
  },

  // --- TMDB. Needs a free API key. Great for film, TV and anime.
  tmdb(payload) {
    const list = payload.results || [];
    return list.map((m) => ({
      title: (m.title || m.name || "").trim(),
      link: `https://www.themoviedb.org/${m.media_type || "movie"}/${m.id}`,
      isoDate: m.release_date || m.first_air_date ? `${m.release_date || m.first_air_date}T00:00:00.000Z` : null,
      content: strip(m.overview || ""),
      image: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    }));
  },

  // --- Reddit via OAuth2 client credentials. Needs an app id + secret.
  reddit(payload) {
    const list = payload?.data?.children || [];
    return list.map((c) => {
      const d = c.data || {};
      return {
        title: (d.title || "").trim(),
        link: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
        isoDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        content: strip(d.selftext || d.title),
        image: (d.preview?.images?.[0]?.source?.url || "").replace(/&amp;/g, "&"),
      };
    });
  },

  // --- Twelve Data: FX quotes. Needs a free key.
  twelvedata(payload) {
    const q = payload;
    if (!q || !q.symbol) return [];
    return [
      {
        title: `${q.symbol} ${q.close ?? q.price} (${q.percent_change ?? "?"}% today)`,
        link: `https://twelvedata.com/symbols/${q.symbol}`,
        isoDate: asDate(q.timestamp ? new Date(q.timestamp * 1000) : q.datetime),
        content: strip(`Open ${q.open} High ${q.high} Low ${q.low} Close ${q.close}`),
      },
    ];
  },
};

function getAdapter(name) {
  const fn = adapters[name];
  if (!fn) throw new Error(`unknown adapter: ${name}`);
  return fn;
}

module.exports = { adapters, getAdapter };
