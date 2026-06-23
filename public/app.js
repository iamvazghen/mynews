const $ = (id) => document.getElementById(id);
const grid = $("grid"), note = $("note"), statusEl = $("status");

const state = { cats: new Set(), since: "24", sort: "newest", q: "" };
let labels = {}; // slug -> label

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

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
}, { rootMargin: "0px 0px -40px 0px" });

async function load() {
  note.hidden = true;
  statusEl.textContent = "loading…";
  const p = new URLSearchParams({ since: state.since, sort: state.sort });
  if (state.cats.size) p.set("category", [...state.cats].join(","));
  if (state.q) p.set("q", state.q);
  try {
    const res = await fetch(`/api/news?${p}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    grid.innerHTML = data.items.map(card).join("");
    grid.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    statusEl.innerHTML = data.count
      ? `<b>${data.count}</b> stories · <b>${humanMin(data.totalReadingMinutes)}</b> to read all`
      : "no stories";
    if (!data.count) { note.hidden = false; note.className = "note"; note.textContent = "Nothing in this window. Widen the timeframe or clear the search."; }
  } catch (err) {
    grid.innerHTML = "";
    statusEl.textContent = "error";
    note.hidden = false; note.className = "note note--err";
    note.textContent = `Could not load feed: ${err.message}. Is the server running?`;
  }
}

// --- controls ---
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function init() {
  const cats = await fetch("/api/categories").then((r) => r.json());
  const chips = $("chips");
  const all = document.createElement("button");
  all.className = "chip"; all.textContent = "All"; all.setAttribute("aria-pressed", "true");
  all.onclick = () => { state.cats.clear(); syncChips(); load(); };
  chips.appendChild(all);

  for (const c of cats) {
    labels[c.slug] = c.label;
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = c.label;
    b.dataset.slug = c.slug; b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      state.cats.has(c.slug) ? state.cats.delete(c.slug) : state.cats.add(c.slug);
      syncChips(); load();
    };
    chips.appendChild(b);
  }
  function syncChips() {
    all.setAttribute("aria-pressed", state.cats.size === 0);
    chips.querySelectorAll("[data-slug]").forEach((b) => b.setAttribute("aria-pressed", state.cats.has(b.dataset.slug)));
  }
  window.__syncChips = syncChips;

  $("timeframe").onchange = (e) => { state.since = e.target.value; load(); };
  $("sort").onchange = (e) => { state.sort = e.target.value; load(); };
  $("search").oninput = debounce((e) => { state.q = e.target.value.trim(); load(); }, 300);

  load();
}
const syncChips = () => window.__syncChips && window.__syncChips();
init();
