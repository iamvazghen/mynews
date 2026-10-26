const $ = (id) => document.getElementById(id);
const grid = $("grid"), note = $("note"), statusEl = $("status");

const state = {
  cats: new Set(),
  since: "24",
  sort: "newest",
  q: "",
  source: "",
  offset: 0,
  limit: 120,
  lastGroup: null, // last category heading rendered, so paging does not repeat it
};
let labels = {}; // slug -> label
let total = 0; // total matching stories
let loading = false;

// --- formatting ---
function ago(iso) {
  if (!iso) return "undated";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
function humanMin(n) {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// --- render ---
function card(item) {
  const img = item.image
    ? `<img class="card__img" src="${esc(item.image)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `
    <a class="card reveal" href="${esc(item.link)}" target="_blank" rel="noopener">
      ${img}
      <div class="card__body">
        <div class="card__meta mono">
          <span class="card__cat">${esc(labels[item.category] || item.category)}</span>
          <span class="dot">·</span><span>${esc(item.source)}</span>
        </div>
        <h2 class="card__title">${esc(item.title)}</h2>
        <p class="card__snippet">${esc(item.snippet)}</p>
        <div class="card__foot">
          <span class="mono">${ago(item.publishedAt)}</span>
          <span class="read">${item.readingMinutes} min read</span>
        </div>
      </div>
    </a>`;
}

// When sorting by category, each group gets a header so a 500-card wall is
// navigable rather than a single undifferentiated list.
function groupHeader(slug) {
  return `<h2 class="group mono">${esc(labels[slug] || slug)}</h2>`;
}

function renderGroups(items, fromGroup) {
  if (state.sort !== "category") return { html: items.map(card).join(""), lastGroup: null };
  let out = "";
  let current = fromGroup;
  for (const it of items) {
    if (it.category !== current) {
      current = it.category;
      out += groupHeader(current);
    }
    out += card(it);
  }
  return { html: out, lastGroup: current };
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
}, { rootMargin: "0px 0px -40px 0px" });

// --- url state, so a filtered feed can be shared or bookmarked ---
function pushUrl() {
  const p = new URLSearchParams();
  if (state.cats.size) p.set("category", [...state.cats].join(","));
  if (state.since !== "24") p.set("since", state.since);
  if (state.sort !== "newest") p.set("sort", state.sort);
  if (state.q) p.set("q", state.q);
  if (state.source) p.set("source", state.source);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  const cat = p.get("category");
  if (cat) cat.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => state.cats.add(s));
  if (p.get("since")) state.since = p.get("since");
  if (p.get("sort")) state.sort = p.get("sort");
  if (p.get("q")) state.q = p.get("q");
  if (p.get("source")) state.source = p.get("source");
}

// --- load ---
function buildParams() {
  const p = new URLSearchParams({
    since: state.since,
    sort: state.sort,
    limit: String(state.limit),
    offset: String(state.offset),
  });
  if (state.cats.size) p.set("category", [...state.cats].join(","));
  if (state.q) p.set("q", state.q);
  if (state.source) p.set("source", state.source);
  return p;
}

function updateStatus() {
  const shown = grid.querySelectorAll(".card").length;
  if (!total) {
    statusEl.textContent = "no stories";
    return;
  }
  statusEl.innerHTML =
    `<b>${shown}</b> of <b>${total.toLocaleString()}</b> stories · <b>${humanMin(totalReading)}</b> to read all`;
}

let totalReading = 0;

async function load(reset = true) {
  if (loading) return;
  loading = true;
  if (reset) {
    state.offset = 0;
    grid.innerHTML = "";
    note.hidden = true;
  }
  statusEl.textContent = reset ? "loading…" : "loading more…";

  try {
    const res = await fetch(`/api/news?${buildParams()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    total = data.count;
    totalReading = data.totalReadingMinutes;

    const html = renderGroups(data.items, reset ? null : state.lastGroup);
    if (reset) grid.innerHTML = html.html;
    else grid.insertAdjacentHTML("beforeend", html.html);
    state.lastGroup = html.lastGroup;
    grid.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    state.offset += data.items.length;
    $("more").hidden = !data.hasMore;
    $("more-count").textContent = data.hasMore ? `${state.offset.toLocaleString()} of ${total.toLocaleString()} loaded` : "";
    updateStatus();

    if (!total) {
      note.hidden = false;
      note.className = "note";
      note.textContent = state.q || state.source
        ? "Nothing matches that filter. Try a wider window or clear the search."
        : "Nothing in this window. Widen the timeframe or clear the search.";
    }
    pushUrl();
  } catch (err) {
    if (reset) grid.innerHTML = "";
    statusEl.textContent = "error";
    note.hidden = false;
    note.className = "note note--err";
    note.textContent = `Could not load feed: ${err.message}. Is the server running?`;
  } finally {
    loading = false;
  }
}

// --- source filter ---
async function loadSources() {
  const p = new URLSearchParams({ since: state.since });
  if (state.cats.size) p.set("category", [...state.cats].join(","));
  try {
    const data = await fetch(`/api/sources?${p}`).then((r) => r.json());
    const sel = $("source");
    const current = state.source;
    sel.innerHTML = `<option value="">All publishers (${data.count})</option>` +
      data.sources
        .map((s) => `<option value="${esc(s.source)}">${esc(s.source)} · ${s.items}</option>`)
        .join("");
    sel.value = current;
    if (current && ![...sel.options].some((o) => o.value === current)) {
      // the publisher vanished from this window — keep the filter, add it back
      sel.insertAdjacentHTML("beforeend", `<option value="${esc(current)}">${esc(current)}</option>`);
      sel.value = current;
    }
  } catch {
    /* the filter is a convenience — never block the feed on it */
  }
}

// --- source health ---
async function loadHealth() {
  const el = $("health");
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    const feeds = h.report.flatMap((r) => r.feeds);
    const alive = feeds.filter((f) => f.ok === true).length;
    const quota = feeds.filter((f) => f.quota).length;
    const dead = feeds.filter((f) => f.ok === false && !f.quota).length;
    const skipped = feeds.filter((f) => f.skipped).length;
    el.innerHTML = `${alive} alive${quota ? ` · ${quota} quota` : ""}${dead ? ` · ${dead} dead` : ""}${skipped ? ` · ${skipped} no key` : ""}`;
    el.classList.toggle("health--warn", quota + dead > 0);
    el.title = `${feeds.length} sources configured — ${alive} alive, ${quota} paused on a daily quota, ${dead} unreachable, ${skipped} awaiting an API key`;
  } catch {
    el.textContent = "sources ?";
    el.title = "Could not read source health";
  }
}

// --- controls ---
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function init() {
  readUrl();

  const cats = await fetch("/api/categories").then((r) => r.json());
  const chips = $("chips");
  const jump = $("jump");

  const all = document.createElement("button");
  all.className = "chip"; all.textContent = "All"; all.setAttribute("aria-pressed", "true");
  all.onclick = () => { state.cats.clear(); syncChips(); load(); loadSources(); };
  chips.appendChild(all);

  for (const c of cats) {
    labels[c.slug] = c.label;
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = c.label;
    b.dataset.slug = c.slug; b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      state.cats.has(c.slug) ? state.cats.delete(c.slug) : state.cats.add(c.slug);
      syncChips(); load(); loadSources();
    };
    chips.appendChild(b);

    jump.insertAdjacentHTML("beforeend", `<option value="${esc(c.slug)}">${esc(c.label)}</option>`);
  }

  function syncChips() {
    all.setAttribute("aria-pressed", state.cats.size === 0);
    chips.querySelectorAll("[data-slug]").forEach((b) => b.setAttribute("aria-pressed", state.cats.has(b.dataset.slug)));
  }
  window.__syncChips = syncChips;

  $("timeframe").value = state.since;
  $("sort").value = state.sort;
  $("search").value = state.q;

  $("timeframe").onchange = (e) => { state.since = e.target.value; load(); loadSources(); };
  $("sort").onchange = (e) => { state.sort = e.target.value; load(); };
  $("source").onchange = (e) => { state.source = e.target.value; load(); };
  $("search").oninput = debounce((e) => { state.q = e.target.value.trim(); load(); }, 300);
  $("more-btn").onclick = () => load(false);
  $("health").onclick = () => loadHealth();
  jump.onchange = (e) => {
    if (!e.target.value) return;
    state.cats.clear();
    state.cats.add(e.target.value);
    syncChips();
    const chip = chips.querySelector(`[data-slug="${CSS.escape(e.target.value)}"]`);
    if (chip) chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    load();
    loadSources();
  };

  syncChips();
  await load();
  loadSources();
  loadHealth();
}
const syncChips = () => window.__syncChips && window.__syncChips();
init();
