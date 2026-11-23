// Builds data.json (what the site shows) and candidates.json (dubs for you to review).
//
// A title is "confirmed" only when one of these is true:
//   1. TMDB/JustWatch lists it as streaming on that platform in India right now, or
//   2. you added a `proof` link to the platform's own page plus a `checked` date in manual.json.
// Everything else stays "reported" and is hidden on the site by default.
//
// Run: TMDB_TOKEN=xxxx node scripts/update.mjs        (re-checks the last 45 days)
//      FULL=1 TMDB_TOKEN=xxxx node scripts/update.mjs  (whole current year)
import fs from "node:fs";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error("Set TMDB_TOKEN to your TMDB API Read Access Token.");
  process.exit(1);
}
const FULL = process.env.FULL === "1";
const API = "https://api.themoviedb.org/3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { Authorization: "Bearer " + TOKEN, accept: "application/json" } });
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(r.status + " " + u.pathname);
    return r.json();
  }
  throw new Error("Rate limited: " + path);
}

const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const TODAY = iso(now);
const from = FULL ? `${now.getUTCFullYear()}-01-01` : iso(new Date(now.getTime() - 45 * 864e5));
const to = iso(new Date(now.getTime() + 7 * 864e5));

const PLATFORM_NAMES = {
  "Netflix": "Netflix", "Amazon Prime Video": "Prime Video", "Amazon Video": "Prime Video",
  "Disney Plus Hotstar": "JioHotstar", "JioHotstar": "JioHotstar", "Hotstar": "JioHotstar",
  "Zee5": "ZEE5", "ZEE5": "ZEE5", "Sony Liv": "SonyLIV", "SonyLIV": "SonyLIV",
  "Aha": "Aha", "aha": "Aha", "Sun Nxt": "Sun NXT", "Sun NXT": "Sun NXT",
  "ETV Win": "ETV Win", "Etv Win": "ETV Win", "Apple TV Plus": "Apple TV+", "Lionsgate Play": "Lionsgate Play",
};
const PLATFORM_HOSTS = ["netflix.com", "primevideo.com", "amazon.in", "amazon.com", "hotstar.com", "jiohotstar.com",
  "zee5.com", "sonyliv.com", "aha.video", "sunnxt.com", "etvwin.com"];

function providers(block) {
  const IN = block && block.results && block.results.IN;
  if (!IN || !IN.flatrate || !IN.flatrate.length) return [];   // subscription streaming only
  return [...new Set(IN.flatrate.map((p) => PLATFORM_NAMES[p.provider_name] || p.provider_name))];
}
function proofOk(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return new URL(u).protocol === "https:" && PLATFORM_HOSTS.some((k) => h === k || h.endsWith("." + k));
  } catch { return false; }
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const monthOf = (x) => x.m || (x.d || "").slice(0, 7);

async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

/* ---------- Telugu originals straight from TMDB (confirmed by availability) ---------- */
async function fetchMovies() {
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const r = await get("/discover/movie", {
      with_original_language: "te", region: "IN", with_release_type: 4,
      "release_date.gte": from, "release_date.lte": to, sort_by: "primary_release_date.asc", page,
    });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  const rows = await inBatches(ids, 8, async (id) => {
    const m = await get("/movie/" + id, { append_to_response: "release_dates,watch/providers" });
    const india = (m.release_dates && m.release_dates.results || []).find((x) => x.iso_3166_1 === "IN");
    const dates = ((india && india.release_dates) || []).filter((x) => x.type === 4).map((x) => x.release_date.slice(0, 10)).sort();
    const d = dates.find((x) => x >= from && x <= to) || dates[0];
    const p = providers(m["watch/providers"]);
    if (!d || !p.length) return null;
    return { n: m.title || m.original_title, t: "Movie", p, d, src: "tmdb", status: "confirmed", how: "justwatch",
      verified: TODAY, link: "https://www.themoviedb.org/movie/" + id };
  });
  return rows.filter(Boolean);
}
async function fetchSeries() {
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const r = await get("/discover/tv", {
      with_original_language: "te", watch_region: "IN",
      "first_air_date.gte": from, "first_air_date.lte": to, sort_by: "first_air_date.asc", page,
    });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  const rows = await inBatches(ids, 8, async (id) => {
    const m = await get("/tv/" + id, { append_to_response: "watch/providers" });
    const p = providers(m["watch/providers"]);
    if (!m.first_air_date || !p.length) return null;
    return { n: m.name || m.original_name, t: "Series", p, d: m.first_air_date, src: "tmdb", status: "confirmed",
      how: "justwatch", verified: TODAY, link: "https://www.themoviedb.org/tv/" + id };
  });
  return rows.filter(Boolean);
}

/* ---------- Hand-added titles: confirm each one or leave it "reported" ---------- */
async function findTitle(x) {
  const kinds = x.t === "Series" || x.t === "Show" ? ["tv"] : x.t === "Movie" ? ["movie"] : ["movie", "tv"];
  const year = (x.d || x.m || "").slice(0, 4);
  for (const kind of kinds) {
    const r = await get("/search/" + kind, { query: x.n, include_adult: "false" });
    const hit = (r.results || []).find((c) => {
      const names = [c.title, c.original_title, c.name, c.original_name].filter(Boolean).map(norm);
      if (!names.includes(norm(x.n))) return false;
      if (c.original_language !== "te") return false;
      const y = (c.release_date || c.first_air_date || "").slice(0, 4);
      return !y || !year || Math.abs(+y - +year) <= 1;
    });
    if (hit) {
      const full = await get("/" + kind + "/" + hit.id, { append_to_response: "watch/providers" });
      return { providers: providers(full["watch/providers"]), link: `https://www.themoviedb.org/${kind}/${hit.id}` };
    }
  }
  return null;
}
async function verify(x) {
  const base = { ...x, src: "manual", status: "reported" };
  // 1. You checked the platform's own page (needed for Telugu dubs, because only the platform lists audio tracks).
  if (x.proof && x.checked && proofOk(x.proof)) {
    return { ...base, status: "confirmed", how: "platform", verified: x.checked, link: x.proof };
  }
  // 2. Telugu dubs cannot be confirmed automatically.
  if (x.dub) return base;
  // 3. Not out yet, so it cannot be streaming.
  if (x.d && x.d > TODAY) return base;
  // 4. Is it listed as streaming on the reported platform in India?
  const hit = await findTitle(x);
  if (!hit) return base;
  const ok = (x.p || []).filter((p) => hit.providers.includes(p));
  if (!ok.length) return base;
  return { ...base, status: "confirmed", how: "justwatch", verified: TODAY, p: ok,
    pending: (x.p || []).filter((p) => !ok.includes(p)), link: hit.link };
}

/* ---------- Review list: new non-Telugu films on streaming, for you to check for a Telugu audio track ---------- */
async function fetchCandidates(skip) {
  const since = iso(new Date(now.getTime() - 14 * 864e5));
  const rows = [];
  for (const lang of ["ta", "ml", "kn", "hi"]) {
    const ids = [];
    for (let page = 1; page <= 3; page++) {
      const r = await get("/discover/movie", {
        with_original_language: lang, region: "IN", with_release_type: 4,
        "release_date.gte": since, "release_date.lte": TODAY, sort_by: "popularity.desc", page,
      });
      ids.push(...r.results.map((m) => m.id));
      if (page >= r.total_pages) break;
    }
    const got = await inBatches(ids, 8, async (id) => {
      const m = await get("/movie/" + id, { append_to_response: "watch/providers" });
      const p = providers(m["watch/providers"]);
      const name = m.title || m.original_title;
      if (!p.length || skip.has(norm(name))) return null;
      return { n: name, from: lang, p, link: "https://www.themoviedb.org/movie/" + id };
    });
    rows.push(...got.filter(Boolean));
  }
  return rows;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

const manualRaw = readJson("manual.json", { items: [] }).items || [];
const previous = (readJson("data.json", { items: [] }).items || []).filter((x) => x.src === "tmdb" && (FULL ? false : x.d < from));

console.log(`Checking Telugu releases from ${from} to ${to}${FULL ? " (full year)" : ""}`);
const [movies, series, manual] = await Promise.all([fetchMovies(), fetchSeries(), inBatches(manualRaw, 6, verify)]);
console.log(`TMDB: ${movies.length} movies, ${series.length} series. Hand-added: ${manual.filter((x) => x.status === "confirmed").length}/${manual.length} confirmed`);

// If the same title appears twice, keep the better-confirmed copy.
const rank = (x) => (x.status === "confirmed" ? (x.how === "platform" ? 3 : 2) : 1);
const best = new Map();
for (const x of [...manual, ...previous, ...movies, ...series]) {
  const key = norm(x.n) + "|" + monthOf(x);
  const cur = best.get(key);
  if (!cur || rank(x) > rank(cur)) best.set(key, x);
}
const items = [...best.values()].sort((a, b) => (b.d || b.m + "-00").localeCompare(a.d || a.m + "-00"));
fs.writeFileSync("data.json", JSON.stringify({ updated: now.toISOString(), items }, null, 1) + "\n");
console.log(`Wrote data.json: ${items.filter((x) => x.status === "confirmed").length} confirmed, ${items.filter((x) => x.status !== "confirmed").length} reported`);

const skip = new Set(manualRaw.map((x) => norm(x.n)));
const candidates = await fetchCandidates(skip);
fs.writeFileSync("candidates.json", JSON.stringify({ updated: now.toISOString(), items: candidates }, null, 1) + "\n");
console.log(`Wrote candidates.json with ${candidates.length} titles to review`);
