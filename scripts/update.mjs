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
const START = /^\d{4}-\d{2}-\d{2}$/.test(process.env.START || "") ? process.env.START : "";   // e.g. 2023-01-01 for a backfill
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
const from = START || (FULL ? `${now.getUTCFullYear()}-01-01` : iso(new Date(now.getTime() - 45 * 864e5)));
const to = iso(new Date(now.getTime() + 7 * 864e5));

// Split a long range into calendar months so each TMDB query stays small.
function monthChunks(a, b) {
  const out = [];
  let y = +a.slice(0, 4), m = +a.slice(5, 7);
  for (;;) {
    const s = `${y}-${String(m).padStart(2, "0")}-01`;
    const e = iso(new Date(Date.UTC(y, m, 0)));
    out.push([s < a ? a : s, e > b ? b : e]);
    if (e >= b) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
async function overChunks(fn) {
  const out = [];
  for (const [a, b] of monthChunks(from, to)) {
    const rows = await fn(a, b);
    if (START || FULL) console.log(`  ${a.slice(0, 7)}: ${rows.length}`);
    out.push(...rows);
  }
  return out;
}

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
async function fetchMovies(a, b) {
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const r = await get("/discover/movie", {
      with_original_language: "te", region: "IN", with_release_type: 4,
      "release_date.gte": a, "release_date.lte": b, sort_by: "primary_release_date.asc", page,
    });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  const rows = await inBatches(ids, 8, async (id) => {
    const m = await get("/movie/" + id, { append_to_response: "release_dates,watch/providers" });
    const india = (m.release_dates && m.release_dates.results || []).find((x) => x.iso_3166_1 === "IN");
    const dates = ((india && india.release_dates) || []).filter((x) => x.type === 4).map((x) => x.release_date.slice(0, 10)).sort();
    const d = dates.find((x) => x >= a && x <= b) || dates[0];
    const p = providers(m["watch/providers"]);
    if (!d || !p.length) return null;
    return { n: m.title || m.original_title, t: "Movie", p, d, poster: m.poster_path || null, src: "tmdb", status: "confirmed", how: "justwatch",
      verified: TODAY, link: "https://www.themoviedb.org/movie/" + id };
  });
  return rows.filter(Boolean);
}
async function fetchSeries(a, b) {
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const r = await get("/discover/tv", {
      with_original_language: "te", watch_region: "IN",
      "first_air_date.gte": a, "first_air_date.lte": b, sort_by: "first_air_date.asc", page,
    });
    ids.push(...r.results.map((m) => m.id));
    if (page >= r.total_pages) break;
  }
  const rows = await inBatches(ids, 8, async (id) => {
    const m = await get("/tv/" + id, { append_to_response: "watch/providers" });
    const p = providers(m["watch/providers"]);
    if (!m.first_air_date || !p.length) return null;
    return { n: m.name || m.original_name, t: "Series", p, d: m.first_air_date, poster: m.poster_path || null, src: "tmdb", status: "confirmed",
      how: "justwatch", verified: TODAY, link: "https://www.themoviedb.org/tv/" + id };
  });
  return rows.filter(Boolean);
}

/* ---------- Hand-added titles: confirm each one or leave it "reported" ---------- */
async function findTitle(x, lang = "te") {
  const kinds = x.t === "Series" || x.t === "Show" ? ["tv"] : x.t === "Movie" ? ["movie"] : ["movie", "tv"];
  const year = (x.d || x.m || "").slice(0, 4);
  for (const kind of kinds) {
    const r = await get("/search/" + kind, { query: x.n, include_adult: "false" });
    const hit = (r.results || []).find((c) => {
      const names = [c.title, c.original_title, c.name, c.original_name].filter(Boolean).map(norm);
      if (!names.includes(norm(x.n))) return false;
      if (c.original_language !== lang) return false;
      const y = (c.release_date || c.first_air_date || "").slice(0, 4);
      return !y || !year || Math.abs(+y - +year) <= 1;
    });
    if (hit) {
      const full = await get("/" + kind + "/" + hit.id, { append_to_response: "watch/providers" });
      return { providers: providers(full["watch/providers"]), poster: full.poster_path || null, link: `https://www.themoviedb.org/${kind}/${hit.id}` };
    }
  }
  return null;
}
async function verify(x) {
  const base = { ...x, src: "manual", status: "reported" };
  // Look the title up once. A Telugu dub gets its cover only from a film with the same name,
  // year and original language, so a wrong cover never appears.
  let hit = null;
  try {
    hit = await findTitle(x);
    const DUB = { Tamil: "ta", Malayalam: "ml", Kannada: "kn", Hindi: "hi", English: "en" };
    const any = hit || (x.dub && DUB[x.dub] ? await findTitle(x, DUB[x.dub]) : null);
    if (any && any.poster) base.poster = any.poster;
  } catch (e) { /* a failed lookup only means no cover and no automatic confirmation */ }
  // 1. You checked the platform's own page (needed for Telugu dubs, because only the platform lists audio tracks).
  if (x.proof && x.checked && proofOk(x.proof)) {
    return { ...base, status: "confirmed", how: "platform", verified: x.checked, link: x.proof };
  }
  // 2. Telugu dubs cannot be confirmed automatically.
  if (x.dub) return base;
  // 3. Not out yet, so it cannot be streaming.
  if (x.d && x.d > TODAY) return base;
  // 4. Is it listed as streaming on the reported platform in India?
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

// Platform logos for India, from TMDB. Kept from the last run if the lookup fails.
async function fetchLogos() {
  const logos = {};
  try {
    for (const kind of ["movie", "tv"]) {
      const r = await get("/watch/providers/" + kind, { watch_region: "IN" });
      for (const p of r.results || []) {
        const name = PLATFORM_NAMES[p.provider_name];
        if (name && p.logo_path && !logos[name]) logos[name] = p.logo_path;
      }
    }
  } catch (e) { console.log("Could not load platform logos:", e.message); }
  return logos;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

const manualRaw = readJson("manual.json", { items: [] }).items || [];
const previous = (readJson("data.json", { items: [] }).items || []).filter((x) => x.src === "tmdb" && (FULL ? false : x.d < from));

console.log(`Checking Telugu releases from ${from} to ${to}${FULL ? " (full year)" : ""}`);
console.log("Movies by month:");
const movies = await overChunks(fetchMovies);
console.log("Series by month:");
const series = await overChunks(fetchSeries);
const manual = await inBatches(manualRaw, 6, verify);
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
const logos = { ...(readJson("data.json", {}).logos || {}), ...(await fetchLogos()) };
fs.writeFileSync("data.json", JSON.stringify({ updated: now.toISOString(), logos, items }, null, 1) + "\n");
console.log(`Platform logos: ${Object.keys(logos).length}. Covers: ${items.filter((x) => x.poster).length}/${items.length}`);
console.log(`Wrote data.json: ${items.filter((x) => x.status === "confirmed").length} confirmed, ${items.filter((x) => x.status !== "confirmed").length} reported`);

const skip = new Set(manualRaw.map((x) => norm(x.n)));
const candidates = await fetchCandidates(skip);
fs.writeFileSync("candidates.json", JSON.stringify({ updated: now.toISOString(), items: candidates }, null, 1) + "\n");
console.log(`Wrote candidates.json with ${candidates.length} titles to review`);
