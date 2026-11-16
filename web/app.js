"use strict";
// StockRadar 웹앱 (아이폰용) — 안드로이드 앱과 같은 데이터·기준을 씀

// ───────────── 작은 도구들 ─────────────
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isKr = sym => /\.(KS|KQ)$/.test(sym);
const fmt = (v, d = 2) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v, sym) => v == null || isNaN(v) ? "—" : isKr(sym) ? "₩" + Math.round(v).toLocaleString("ko-KR") : "$" + fmt(v, v >= 1000 ? 0 : 2);
const pct = (v, d = 2) => v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const cls = v => v == null || isNaN(v) ? "muted" : v >= 0 ? "g" : "r";
const big = (v, sym) => {
  if (v == null || isNaN(v) || v <= 0) return "—";
  if (isKr(sym)) { return v >= 1e12 ? (v / 1e12).toFixed(1) + "조" : v >= 1e8 ? Math.round(v / 1e8).toLocaleString() + "억" : Math.round(v).toLocaleString(); }
  return v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M";
};
const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + "분 전" : m < 1440 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전"; };
const dstr = (ms, withDay) => { const d = new Date(ms); const s = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; return withDay ? s + ` (${"일월화수목금토"[d.getDay()]})` : s; };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2200); }

// ───────────── 데이터 가져오기 ─────────────
// 1순위: GitHub이 20분마다 미리 받아둔 data/ 파일 (같은 사이트라 아이폰에서도 막히지 않음)
// 2순위: 목록에 없던 종목·검색은 무료 공용 중계 서버로 직접 시도
const fname = sym => sym.replace(/\^/g, "_").replace(/=/g, "-");
const _dc = new Map();
async function data(p, ttl = 120_000) {
  const c = _dc.get(p); if (c && Date.now() - c.at < ttl) return c.v;
  try {
    const r = await fetch("data/" + p + "?v=" + Math.floor(Date.now() / ttl), { cache: "no-cache" });
    const v = r.ok ? await r.json() : null; _dc.set(p, { at: Date.now(), v }); return v;
  } catch (e) { return null; }
}
const PROXIES = [
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
];
async function get(url, type = "json") {
  let err;
  for (const p of PROXIES) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(p(url), { signal: ctl.signal }); clearTimeout(tm);
      if (!r.ok) { err = new Error("HTTP " + r.status); continue; }
      return type === "json" ? await r.json() : await r.text();
    } catch (e) { err = e; }
  }
  throw err || new Error("fail");
}
function fromStatic(sym, j, iv) {
  if (!j || !j.c?.length) return null;
  const m = j.m || {}, closes = j.c, times = j.t.map(x => x * 1000);
  const price = m.price ?? closes[closes.length - 1];
  const prev = (iv === "1d" || iv === "1wk") && closes.length >= 2 ? closes[closes.length - 2] : m.prev;
  return { sym, name: m.name || sym, price, prev, base: m.prev ?? prev, closes, times, high52: m.h52, low52: m.l52, dayHigh: m.hi, dayLow: m.lo, vol: m.vol };
}
function sliceFrom(d, fromMs) {
  if (!d) return d; const i = d.times.findIndex(t => t >= fromMs); if (i <= 0) return d;
  return { ...d, closes: d.closes.slice(i), times: d.times.slice(i), base: d.closes[i - 1] };
}
const DAY = 86400000;

const Y = {
  async chart(sym, range, interval) {
    const f = fname(sym);
    // 미리 받아둔 파일에서 꺼내기
    if (interval.endsWith("m")) {
      const d = fromStatic(sym, await data(`c/${f}.i.json`, 60_000), interval);
      if (d) {
        if (range === "1d") { const last = new Date(d.times[d.times.length - 1]); const k = last.toDateString(); const i = d.times.findIndex(t => new Date(t).toDateString() === k); return { ...d, closes: d.closes.slice(i), times: d.times.slice(i), base: i > 0 ? d.closes[i - 1] : d.base }; }
        return d;
      }
    } else if (interval === "1d" && range === "max") {
      const d = fromStatic(sym, await data(`h/${f}.json`, 3600_000), "1d"); if (d) return d;
    } else if (interval === "1d") {
      const d = fromStatic(sym, await data(`c/${f}.d.json`, 600_000), "1d");
      const back = { "5d": 7, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731 }[range];
      if (d && back) return sliceFrom(d, Date.now() - back * DAY);
    } else {
      const d = fromStatic(sym, await data(`c/${f}.w.json`, 3600_000), "1wk");
      if (d) return range === "max" ? d : sliceFrom(d, Date.now() - ({ "5y": 5, "10y": 10, "2y": 2, "1y": 1 }[range] || 5) * 365.25 * DAY);
    }
    // 목록에 없던 종목 → 공용 중계 서버로 직접
    try {
      const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`);
      const r = j.chart.result[0], ts = r.timestamp || [], cl = r.indicators?.quote?.[0]?.close || [];
      const t = [], c = []; ts.forEach((x, i) => { if (cl[i] != null) { t.push(x); c.push(cl[i]); } });
      return fromStatic(sym, { t, c, m: { price: r.meta.regularMarketPrice, prev: r.meta.chartPreviousClose, name: r.meta.longName || r.meta.shortName, h52: r.meta.fiftyTwoWeekHigh, l52: r.meta.fiftyTwoWeekLow } }, interval);
    } catch (e) { return null; }
  },
  async quotes(syms) {
    const j = await data("quotes.json", 60_000);
    const out = {};
    if (j?.q) { Q._at = j.at; for (const s of syms) if (j.q[s]) out[s] = { ...j.q[s], name: j.q[s].name || j.q[s].sname }; }
    const miss = syms.filter(s => !out[s]);
    await Promise.all(miss.slice(0, 20).map(async s => {
      const c = await Y.chart(s, "5d", "1d");
      if (c) out[s] = { price: c.price, prev: c.prev, chg: c.price - c.prev, pct: (c.price / c.prev - 1) * 100, name: c.name, high52: c.high52, low52: c.low52 };
    }));
    return out;
  },
  async search(q) {
    try {
      const j = await get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&lang=ko-KR&region=KR`);
      return (j.quotes || []).filter(x => x.symbol && ["EQUITY", "ETF", "INDEX"].includes(x.quoteType))
        .map(x => ({ sym: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType, exch: x.exchDisp || x.exchange, etf: x.quoteType === "ETF" }));
    } catch (e) { return []; }
  },
  async summary(sym) {
    const s = await data(`s/${fname(sym)}.json`, 3600_000); if (s) return s;
    try {
      const j = await get(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,topHoldings,fundProfile`);
      return j.quoteSummary.result[0];
    } catch (e) { return null; }
  }
};

async function newsSearch(q, en = false) {
  try {
    const url = en ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
    const xml = new DOMParser().parseFromString(await get(url, "text"), "text/xml");
    return [...xml.querySelectorAll("item")].slice(0, 20).map(it => {
      const t = it.querySelector("title")?.textContent || "";
      const src = it.querySelector("source")?.textContent || "";
      return { title: t.replace(new RegExp(" - " + src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), ""), link: it.querySelector("link")?.textContent, src, time: Date.parse(it.querySelector("pubDate")?.textContent || "") };
    });
  } catch (e) { return []; }
}

// ───────────── 저장소 ─────────────
const LS = {
  get(k, d) { try { const v = localStorage.getItem("sr_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sr_" + k, JSON.stringify(v)); } catch { } }
};
const S = {
  sectors: [], favs: new Set(LS.get("favs", [])), memos: LS.get("memos", {}), deleted: new Set(LS.get("deleted", [])),
  sort: LS.get("sort", "cap"),
  save() { LS.set("sectors", this.sectors); LS.set("favs", [...this.favs]); LS.set("memos", this.memos); LS.set("deleted", [...this.deleted]); LS.set("sort", this.sort); }
};
let CATALOG = [];
async function loadCatalog() {
  CATALOG = await (await fetch("catalog.json", { cache: "no-cache" })).json();
  const saved = LS.get("sectors", null);
  if (!saved) { S.sectors = JSON.parse(JSON.stringify(CATALOG)); S.save(); return; }
  S.sectors = saved;
  // 앱이 업데이트돼 새로 생긴 기본 종목·섹터는 추가 (사용자가 지운 건 제외)
  for (const cs of CATALOG) {
    let us = S.sectors.find(s => s.name === cs.name);
    if (!us) { if (!S.deleted.has("sector:" + cs.name)) S.sectors.push(JSON.parse(JSON.stringify(cs))); continue; }
    for (const st of cs.stocks) if (!us.stocks.some(x => x.t === st.t) && !S.deleted.has(cs.name + ":" + st.t)) us.stocks.push(st);
  }
  S.save();
}
const allStocks = () => { const m = new Map(); for (const s of [...S.sectors, ...CATALOG]) for (const st of s.stocks) if (!m.has(st.t)) m.set(st.t, st); return m; };
const findStock = sym => allStocks().get(sym) || { t: sym, ko: sym, desc: "", pts: [], etf: false };

// ───────────── 시세 캐시 ─────────────
const Q = {}; let quotesAt = 0, quotesLoading = false;
async function refreshQuotes(force) {
  if (quotesLoading || (!force && Date.now() - quotesAt < 60_000)) return;
  quotesLoading = true;
  const syms = [...new Set(S.sectors.flatMap(s => s.stocks.map(x => x.t)))];
  try { Object.assign(Q, await Y.quotes(syms)); quotesAt = Date.now(); } finally { quotesLoading = false; }
  if (route().name === "home") renderHome(true);
}

// ───────────── 화면 이동 ─────────────
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { name: "home" };
  const [a, ...rest] = h.split("/");
  if (a === "s") return { name: "detail", sym: decodeURIComponent(rest.join("/")) };
  return { name: a };
}
function go(path) { location.hash = "#/" + path; }
window.addEventListener("hashchange", render);

function setHeader(title, back) {
  $("#title").textContent = title;
  $("#menuBtn").classList.toggle("hidden", back);
  $("#backBtn").classList.toggle("hidden", !back);
}
$("#backBtn").onclick = () => history.length > 1 ? history.back() : go("");
$("#refreshBtn").onclick = () => { quotesAt = 0; render(true); toast("새로고침"); };

function drawer(open) {
  $("#drawer").classList.toggle("hidden", !open); $("#drawerBg").classList.toggle("hidden", !open);
  if (!open) return;
  const secs = S.sectors.map((s, i) => `<a class="item" data-sec="${i}">${esc(s.emoji)} ${esc(s.name)}</a>`).join("");
  $("#drawer").innerHTML = `
    <div class="grp">보기</div><a class="item" href="#/">🏠 홈 (전체 섹터)</a>${secs}
    <div class="grp">공부하기</div>
    <a class="item" href="#/signals">🚦 매수 타이밍 신호 (공포지수·VIX·RSI)</a>
    <div class="grp">관리</div>
    <a class="item" data-add="1">➕ 종목 추가 (섹터 자동 분류)</a>
    <a class="item" href="#/settings">⚙️ 설정</a>`;
  $("#drawer").querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    drawer(false);
    if (a.dataset.sec != null) { if (route().name !== "home") { go(""); setTimeout(() => scrollToSec(+a.dataset.sec), 300); } else scrollToSec(+a.dataset.sec); }
    if (a.dataset.add) addStockSheet(-1);
  }));
}
$("#menuBtn").onclick = () => drawer(true);
$("#drawerBg").onclick = () => drawer(false);

function sheet(html, onMount) {
  $("#sheet").innerHTML = html; $("#sheet").classList.remove("hidden"); $("#sheetBg").classList.remove("hidden");
  onMount && onMount($("#sheet"));
}
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheetBg").classList.add("hidden"); }
$("#sheetBg").onclick = closeSheet;

async function render(force) {
  const r = route();
  LS.set("lastHash", location.hash);
  window.scrollTo(0, 0);
  if (r.name === "home") return renderHome(false, force);
  if (r.name === "detail") return renderDetail(r.sym, force);
  if (r.name === "signals") return renderSignals(force);
  if (r.name === "settings") return renderSettings();
  go("");
}

// ───────────── 홈 ─────────────
function scrollToSec(i) {
  const el = document.getElementById("sec" + i);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
}
function sortList(list) {
  const k = S.sort;
  return [...list].sort((a, b) => {
    const qa = Q[a.t] || {}, qb = Q[b.t] || {};
    if (k === "cap") return (qb.cap || 0) - (qa.cap || 0);
    if (k === "up") return (qb.pct ?? -999) - (qa.pct ?? -999);
    if (k === "down") return (qa.pct ?? 999) - (qb.pct ?? 999);
    if (k === "vol") return ((qb.vol || 0) * (qb.price || 0)) - ((qa.vol || 0) * (qa.price || 0));
    return 0;
  });
}
function stockRow(st) {
  const q = Q[st.t];
  const fav = S.favs.has(st.t) ? "★ " : "";
  let ext = "";
  if (q && !isKr(st.t)) {
    if (q.state && q.state.startsWith("PRE") && q.pre) ext = `<div class="tk">프리 ${money(q.pre, st.t)} <span class="${cls(q.prePct)}">${pct(q.prePct)}</span></div>`;
    else if (q.state && (q.state.startsWith("POST") || q.state === "CLOSED") && q.post) ext = `<div class="tk">애프터 ${money(q.post, st.t)} <span class="${cls(q.postPct)}">${pct(q.postPct)}</span></div>`;
  }
  return `<div class="stock" data-sym="${esc(st.t)}">
    <div class="grow" style="min-width:0"><div class="nm">${fav}${esc(st.ko)}</div><div class="tk">${esc(st.t)}${q?.cap ? " · " + big(q.cap, st.t) : ""}${st.etf ? " · ETF" : ""}</div></div>
    <div><div class="px">${q ? money(q.price, st.t) : "…"}</div><div class="pc ${cls(q?.pct)}">${q ? pct(q.pct) : ""}</div>${ext}</div>
  </div>`;
}
function renderHome(quotesOnly, force) {
  setHeader("StockRadar", false);
  const sortNames = { cap: "시총순", up: "상승률", down: "하락률", vol: "거래대금", none: "기본" };
  const favs = S.sectors.flatMap(s => s.stocks).filter((x, i, a) => S.favs.has(x.t) && a.findIndex(y => y.t === x.t) === i);
  let html = `<div class="chips" id="secChips">${S.sectors.map((s, i) => `<button class="chip" data-sec="${i}">${esc(s.emoji)} ${esc(s.name)}</button>`).join("")}</div>
    <div class="chips" style="margin:6px 0 4px">${Object.entries(sortNames).map(([k, v]) => `<button class="chip sm ${S.sort === k ? "on" : ""}" data-sort="${k}">${v}</button>`).join("")}</div>`;
  if (favs.length) html += `<div class="sec">★ 관심 종목</div><div class="card">${sortList(favs).map(stockRow).join("")}</div>`;
  S.sectors.forEach((s, i) => {
    const us = sortList(s.stocks.filter(x => !isKr(x.t))), kr = sortList(s.stocks.filter(x => isKr(x.t)));
    html += `<div class="between" id="sec${i}"><div class="sec">${esc(s.emoji)} ${esc(s.name)} <span class="muted small">${s.stocks.length}</span></div>
      <button class="chip sm" data-add="${i}">＋ 추가</button></div><div class="card">`;
    if (us.length && kr.length) html += `<div class="flag">🇺🇸 미국</div>`;
    html += us.map(stockRow).join("");
    if (kr.length) html += (us.length ? `<div class="flag">🇰🇷 한국</div>` : "") + kr.map(stockRow).join("");
    html += `</div>`;
  });
  html += `<div class="sub" style="text-align:center;margin-top:10px">${Q._at ? "시세 기준: " + ago(Q._at) + " (약 20분마다 갱신)" : "시세 불러오는 중…"}</div>`;
  const y = window.scrollY;
  $("#app").innerHTML = html;
  if (quotesOnly) window.scrollTo(0, y);
  $("#app").querySelectorAll("[data-sym]").forEach(el => el.onclick = () => go("s/" + encodeURIComponent(el.dataset.sym)));
  $("#app").querySelectorAll("[data-sec]").forEach(el => el.onclick = () => scrollToSec(+el.dataset.sec));
  $("#app").querySelectorAll("[data-sort]").forEach(el => el.onclick = () => { S.sort = el.dataset.sort; S.save(); renderHome(true); });
  $("#app").querySelectorAll("[data-add]").forEach(el => el.onclick = () => addStockSheet(+el.dataset.add));
  if (!quotesOnly) refreshQuotes(force);
}
setInterval(() => { if (route().name === "home" && !document.hidden) refreshQuotes(false); }, 60_000);

// ───────────── 종목 추가 (여러 개 선택) ─────────────
const SECTOR_HINTS = [
  ["양자컴퓨팅", /quantum/i], ["사이버보안", /security|cyber|software—infrastructure/i], ["생명과학", /biotech|drug|pharma|medical|health|diagnos/i],
  ["AI·반도체", /semiconductor/i], ["우주항공", /aerospace|space/i], ["원자력·전력", /utilit|uranium|nuclear|electric/i],
  ["로봇·자율주행", /robot|automation|machinery/i], ["핀테크·디지털자산", /credit|capital markets|financial|payment|bank/i],
  ["화장품·뷰티", /household|personal products|cosmetic/i], ["클린에너지·ESS", /solar|renewable|battery/i], ["AI 소프트웨어", /software/i]
];
function guessSector(hit, summ) {
  if (hit.etf) return S.sectors.findIndex(s => s.name === "대표 ETF");
  const text = [summ?.assetProfile?.industry, summ?.assetProfile?.sector, hit.name].join(" ");
  for (const [name, re] of SECTOR_HINTS) if (re.test(text)) { const i = S.sectors.findIndex(s => s.name === name); if (i >= 0) return i; }
  return -1;
}
function addStockSheet(secIdx) {
  const auto = secIdx < 0;
  const sel = new Map();
  sheet(`<div class="b" style="font-size:17px;margin-bottom:8px">${auto ? "종목 추가 · 섹터 자동 분류" : esc(S.sectors[secIdx].name) + "에 종목 추가"}</div>
    <input id="q" placeholder="이름·티커 (예: 삼성전자, NVDA, 로봇) · 콤마로 여러 개" autocomplete="off">
    <div class="sub" style="margin:6px 2px">여러 개를 탭해서 고른 뒤 아래 버튼으로 한 번에 추가해요. 창이 안 닫혀서 계속 검색할 수 있어요.</div>
    <div id="hits"></div>
    <button class="btn" id="addBtn" disabled style="margin-top:8px">추가할 종목을 고르세요</button>
    <button class="btn ghost" id="closeBtn" style="margin-top:6px">닫기</button>`, el => {
    const exists = sym => auto ? S.sectors.some(s => s.stocks.some(x => x.t === sym)) : S.sectors[secIdx].stocks.some(x => x.t === sym);
    let timer;
    const upd = () => { const b = $("#addBtn", el); b.disabled = !sel.size; b.textContent = sel.size ? `선택한 ${sel.size}개 추가` : "추가할 종목을 고르세요"; };
    async function search() {
      const raw = $("#q", el).value.trim(); if (!raw) { $("#hits", el).innerHTML = ""; return; }
      $("#hits", el).innerHTML = `<div class="spin">검색 중…</div>`;
      const terms = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const cat = [...allStocks().values()];
      const res = [];
      for (const t of terms) {
        const local = cat.filter(x => x.ko.toLowerCase().includes(t.toLowerCase()) || x.t.toLowerCase() === t.toLowerCase())
          .map(x => ({ sym: x.t, name: x.ko, etf: x.etf, exch: isKr(x.t) ? "KRX" : "", ko: x.ko }));
        const remote = await Y.search(t);
        const merged = [...local, ...remote.filter(r => !local.some(l => l.sym === r.sym))].slice(0, terms.length > 1 ? 3 : 15);
        res.push(...merged);
      }
      const uniq = res.filter((x, i) => res.findIndex(y => y.sym === x.sym) === i);
      if (!uniq.length) { $("#hits", el).innerHTML = `<div class="spin">결과가 없어요. 영어 이름이나 티커로도 찾아보세요.</div>`; return; }
      $("#hits", el).innerHTML = uniq.map(h => {
        const have = exists(h.sym), on = sel.has(h.sym);
        return `<div class="hit" data-h="${esc(h.sym)}" style="${have ? "opacity:.5" : ""}"><div class="grow"><div class="b">${esc(h.ko || h.name)}</div><div class="sub">${esc(h.sym)} ${esc(h.exch || "")}${h.etf ? " · ETF" : ""}</div></div>
          <div>${have ? '<span class="g small b">추가됨</span>' : on ? "✅" : "⬜"}</div></div>`;
      }).join("");
      $("#hits", el).querySelectorAll("[data-h]").forEach(d => d.onclick = () => {
        const h = uniq.find(x => x.sym === d.dataset.h); if (exists(h.sym)) return;
        sel.has(h.sym) ? sel.delete(h.sym) : sel.set(h.sym, h); upd(); search();
      });
    }
    $("#q", el).oninput = () => { clearTimeout(timer); timer = setTimeout(search, 350); };
    $("#closeBtn", el).onclick = closeSheet;
    $("#addBtn", el).onclick = async () => {
      const list = [...sel.values()]; sel.clear(); upd();
      const msgs = [];
      for (const h of list) {
        let idx = secIdx;
        if (auto) {
          idx = guessSector(h, await Y.summary(h.sym));
          if (idx < 0) { idx = S.sectors.findIndex(s => s.name === "내 종목"); if (idx < 0) { S.sectors.push({ name: "내 종목", emoji: "📁", stocks: [] }); idx = S.sectors.length - 1; } }
        }
        const known = allStocks().get(h.sym);
        S.sectors[idx].stocks.push(known || { t: h.sym, ko: h.ko || h.name, desc: "", pts: [], etf: !!h.etf });
        S.deleted.delete(S.sectors[idx].name + ":" + h.sym);
        msgs.push(auto ? `${h.sym}→${S.sectors[idx].name}` : h.sym);
      }
      S.save(); toast("추가: " + msgs.join(", ")); quotesAt = 0; search();
      if (route().name === "home") renderHome(false);
    };
    setTimeout(() => $("#q", el).focus(), 100);
  });
}

// ───────────── 차트 (손가락으로 훑기) ─────────────
function setupCanvas(cv, hCss) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
  cv.width = w * dpr; cv.height = hCss * dpr; cv.style.height = hCss + "px";
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h: hCss };
}
function scrub(cv, onPick) {
  const pick = e => { const r = cv.getBoundingClientRect(); onPick((e.clientX - r.left) / r.width); };
  cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); pick(e); });
  cv.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") pick(e); });
}
function priceChart(cv, data, sym, infoEl) {
  let sel = -1;
  const draw = () => {
    const { c, w, h } = setupCanvas(cv, 200);
    const cl = data.closes; if (cl.length < 2) return;
    const lo = Math.min(...cl), hi = Math.max(...cl), pad = 6, R = 44;
    const x = i => pad + i / (cl.length - 1) * (w - pad - R), y = v => 8 + (1 - (v - lo) / (hi - lo || 1)) * (h - 24);
    const up = cl[cl.length - 1] >= (data.base || cl[0]);
    c.strokeStyle = "#2C2E3A"; c.fillStyle = "#8B8FA3"; c.font = "10px -apple-system";
    [lo, (lo + hi) / 2, hi].forEach(v => { c.beginPath(); c.moveTo(pad, y(v)); c.lineTo(w - R, y(v)); c.stroke(); c.fillText(fmt(v, v >= 100 ? 0 : 2), w - R + 4, y(v) + 3); });
    c.strokeStyle = up ? "#22C55E" : "#EF4444"; c.lineWidth = 1.8; c.beginPath();
    cl.forEach((v, i) => i ? c.lineTo(x(i), y(v)) : c.moveTo(x(i), y(v))); c.stroke();
    if (sel >= 0) { c.strokeStyle = "#fff"; c.lineWidth = 1; c.beginPath(); c.moveTo(x(sel), 0); c.lineTo(x(sel), h - 14); c.stroke(); c.fillStyle = "#fff"; c.beginPath(); c.arc(x(sel), y(cl[sel]), 4, 0, 7); c.fill(); }
  };
  scrub(cv, f => {
    sel = Math.max(0, Math.min(data.closes.length - 1, Math.round(f * (data.closes.length - 1) * (cv.clientWidth / (cv.clientWidth - 50)))));
    const t = data.times[sel]; const d = new Date(t);
    const first = data.closes[0];
    infoEl.innerHTML = `${dstr(t, true)} ${data.intraday ? d.toTimeString().slice(0, 5) : ""} · <b>${money(data.closes[sel], sym)}</b> <span class="${cls(data.closes[sel] - first)}">기간 시작 대비 ${pct((data.closes[sel] / first - 1) * 100)}</span>`;
    draw();
  });
  draw();
}

// ───────────── 매수 타이밍 신호 계산 ─────────────
const Sig = {
  rsi(c, n = 14) {
    if (c.length <= n + 1) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  },
  ma(c, n) { return c.length >= n ? c.slice(-n).reduce((a, b) => a + b, 0) / n : null; },
  fgView(v) { return v < 10 ? "극단적 공포 — 추가 매수 적극" : v < 25 ? "극단적 공포 — 적극 매수 고려" : v < 45 ? "공포 — 분할 매수" : v < 55 ? "중립 — 관망" : v < 75 ? "탐욕 — 관망·분할 매도 검토" : "극단적 탐욕 — 분할 매도"; },
  fgState(v) { return v < 25 ? 2 : v < 45 ? 1 : v >= 75 ? -1 : 0; },
  fgKo(r) { return ({ "extreme fear": "극단적 공포", fear: "공포", neutral: "중립", greed: "탐욕", "extreme greed": "극단적 탐욕" })[String(r).toLowerCase()] || r; },
  avgMdd(sym) { return ["^IXIC", "^NDX", "QQQ", "QQQM"].includes(sym) ? -20 : -14; },
  PARTS: [
    ["market_momentum_sp500", "1. 주가 모멘텀 (S&P500 위치)", "S&P500이 125일 평균보다 얼마나 위/아래인지"],
    ["market_volatility_vix", "2. 시장 변동성 (VIX)", "VIX가 50일 평균보다 높으면 공포"],
    ["put_call_options", "3. 옵션 시장 (풋/콜 비율)", "하락에 거는 풋옵션이 많을수록 공포"],
    ["safe_haven_demand", "4. 안전자산 수요 (채권 vs 주식)", "최근 20일 국채가 주식보다 잘 나가면 공포"],
    ["stock_price_breadth", "5. 시장 폭 (상승·하락 종목 수)", "오르는 종목 거래량이 더 많으면 탐욕"],
    ["stock_price_strength", "6. 주식 수요 (52주 신고가 vs 신저가)", "신고가 종목이 더 많으면 탐욕"],
    ["junk_bond_demand", "7. 정크본드 수요", "위험한 회사채 금리 차이가 좁으면 탐욕"]
  ],
  async fearGreed() {
    try {
      const j = await data("fg.json", 300_000) || await get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata");
      return { score: j.fear_and_greed.score, rating: j.fear_and_greed.rating, parts: Sig.PARTS.map(([k, n, d]) => ({ name: n, desc: d, score: j[k]?.score, rating: j[k]?.rating || "" })) };
    } catch (e) { return null; }
  },
  /** 일봉(1년)+주봉(5년)으로 RSI·낙폭·200일/200주선 */
  price(d, w, isIndex, sym) {
    const out = []; const px = d?.price ?? w?.price; if (px == null) return out;
    const r = d && Sig.rsi(d.closes);
    if (r != null) out.push({ name: "RSI 일봉 (14일)", value: r.toFixed(0), state: r <= 30 ? 2 : r <= 40 ? 1 : r >= 70 ? -1 : 0, rule: "30 이하 과매도 → 매수 고려 · 70 이상 과매수 → 매도 고려", note: "단기 신호. 가격이 빠르게 많이 떨어져 반등 가능성이 통계적으로 높은 구간이에요." });
    const rw = w && Sig.rsi(w.closes);
    if (rw != null) out.push({ name: "RSI 주봉 (14주)", value: rw.toFixed(0), state: rw <= 35 ? 2 : rw <= 45 ? 1 : rw >= 70 ? -1 : 0, rule: "35 이하 = 중기 저점 구간", note: "일봉의 노이즈를 걷어낸 중기 흐름. 35 아래면 단순 조정이 아니라 중기 저점에 들어왔다는 신호예요." });
    const hi = Math.max(...(w?.closes || []), ...(d?.closes || []));
    if (hi > 0 && isFinite(hi)) {
      const dd = (px / hi - 1) * 100;
      if (isIndex) {
        const avg = Sig.avgMdd(sym);
        out.push({ name: "MDD (고점 대비 낙폭)", value: dd.toFixed(1) + "%", state: dd <= avg ? 2 : dd <= avg / 2 ? 1 : 0,
          rule: `평균 ${avg}% 아래면 매수 시작 · -30% 비중 확대 · -47% 이상 극단(-50%까지 분할 설계)`,
          note: (dd <= -47 ? "2008년급 극단적 하락. 남은 현금을 -50%까지 나눠서 투입하는 구간. " : dd <= -30 ? "비중을 확대하는 구간이에요. " : dd <= avg ? "매년 평균적으로 오는 하락 폭을 넘었어요. 분할 매수 시작 구간. " : "") + "한 번에 다 사지 말고 단계별로." });
      } else out.push({ name: "MDD (고점 대비 낙폭)", value: dd.toFixed(1) + "%", state: dd <= -30 ? 2 : dd <= -20 ? 1 : 0, rule: "개별 종목은 -30% 이상이면 관심 · 이유(실적 악화?) 먼저 확인", note: "최근 5년 최고 종가 대비 하락률. 개별 종목은 이유가 있어서 빠지는 경우가 많아 기준을 넓게 잡았어요." });
    }
    const m200 = d && Sig.ma(d.closes, 200);
    if (m200) { const gap = (px / m200 - 1) * 100; out.push({ name: "200일 이동평균선 (약 1년)", value: (gap > 0 ? "+" : "") + gap.toFixed(1) + "% 이격", state: gap <= -5 ? 2 : gap < 0 ? 1 : gap > 25 ? -1 : 0, rule: "5% 이상 아래로 이탈 시 기회", note: gap <= -5 ? "1년 평균보다 훨씬 싼 저평가 구간이에요." : gap < 0 ? "200일선 바로 아래. 장기 상승 추세가 흔들리는 중." : "200일선 위 = 장기 상승 추세 유지 중." + (gap > 25 ? " 선에서 너무 멀어져 단기 과열." : "") }); }
    const w200 = w && Sig.ma(w.closes, 200);
    if (w200) { const gap = (px / w200 - 1) * 100; out.push({ name: "200주 이동평균선 (약 4년)", value: (gap > 0 ? "+" : "") + gap.toFixed(1) + "% 이격", state: gap <= 3 ? 2 : gap <= 10 ? 1 : 0, rule: "근접하거나 이탈 = 역사적 바닥권", note: "2008·2020·2022 하락장에서 S&P500이 바닥을 만든 기준선이에요." }); }
    return out;
  }
};
const sigColor = s => s === 2 ? "var(--green)" : s === 1 ? "var(--amber)" : s === -1 ? "var(--red)" : "var(--sub)";
const sigLabel = s => s === 2 ? "🟢 매수 구간" : s === 1 ? "🟡 관심 구간" : s === -1 ? "🔴 과열" : "⚪ 해당 없음";
function sigSummary(list) {
  const buy = list.filter(x => x.state === 2).length, watch = list.filter(x => x.state === 1).length, hot = list.filter(x => x.state === -1).length;
  const [t, c] = buy >= 3 ? ["🟢 3개 이상 동시 신호 — 비중을 크게 싣는 구간", "g"] : buy === 2 ? ["🟢 2개가 겹침 — 매수 준비", "g"] : buy === 1 ? ["🟡 1개가 신호 — 주목하며 지켜보기", "a"]
    : watch >= 2 ? ["🟡 여러 지표가 관심 구간 — 조금씩 담아볼 만함", "a"] : hot ? ["🔴 과열 신호 있음 — 추격 매수는 조심", "r"] : ["⚪ 특별한 신호 없음 — 평소처럼 적립식", "muted"];
  return `<div class="sub b">${list.length}개 중 매수 구간 ${buy}개 · 관심 ${watch}개${hot ? " · 과열 " + hot + "개" : ""}</div><div class="b ${c}" style="margin:3px 0 4px;font-size:15px">${t}</div>`;
}
const sigRow = g => `<div style="padding:10px 0;border-top:1px solid var(--line)">
  <div class="between"><span class="b">${esc(g.name)}</span><span class="b" style="color:${sigColor(g.state)};font-size:16px">${esc(g.value)}</span></div>
  <div class="between" style="margin-top:4px"><span class="sub">기준: ${esc(g.rule)}</span><span class="badge" style="background:${sigColor(g.state)};flex:none">${sigLabel(g.state)}</span></div>
  <div class="small" style="margin-top:4px;line-height:1.45">${esc(g.note)}</div></div>`;

// ───────────── AI 뉴스 요약 (Gemini) ─────────────
// 키는 이 아이폰에만 저장 (공개 사이트라 코드에 절대 넣지 않음)
// 무료 키 우선 → 무료 한도 소진 시 유료 키가 있으면 예상 금액을 보여주고 확인 후에만 사용
const AI = {
  MODELS: ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"],
  price(m) { return m.includes("lite") ? [0.10, 0.40] : m.includes("pro") ? [1.25, 10] : [0.30, 2.50]; },
  resetText() {
    // 구글 무료 한도는 미국 서부 자정에 초기화 → 한국 시간으로
    const now = new Date(), la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const next = new Date(la); next.setHours(24, 0, 0, 0);
    const kr = new Date(now.getTime() + (next - la));
    return `${kr.getMonth() + 1}/${kr.getDate()} ${kr.getHours() < 12 ? "오전" : "오후"} ${kr.getHours() % 12 || 12}시`;
  },
  prompt(st, sym, news) {
    const lines = news.map(n => `- [${n.time ? new Date(n.time).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "?"}] (${n.src || "출처 미상"}) ${n.title}`).join("\n");
    return `너는 주식 뉴스를 한국 개인 투자자에게 정리해주는 애널리스트다.
아래는 ${sym} (${st.ko}) 관련 최근 뉴스 목록이다 (날짜, 출처, 제목).
규칙:
- 목록에 있는 내용에만 근거하고, 없는 사실을 지어내지 마라.
- 같은 사건을 다룬 기사는 하나로 합쳐라. 이 종목과 무관한 기사는 무시해라.
- 모두 자연스러운 한국어로, 각 항목은 한 문장으로 짧게.
- 매수·매도 권유 표현은 쓰지 마라.
출력(JSON): oneLine(최근 뉴스 흐름 한 문장), mood(긍정/중립/부정), points(핵심 3~5개, 최신순), good(호재 0~3개), bad(악재·리스크 0~3개), watch(앞으로 주목할 일정·이벤트 0~3개)

뉴스 목록:
${lines}`;
  },
  estimateKrw(promptLen) {
    const [pin, pout] = AI.price(AI.MODELS[0]);
    const usd = (promptLen / 2.5 * pin + 1500 * pout) / 1e6;   // 출력·생각 토큰 넉넉히 1500개로
    return Math.max(1, Math.ceil(usd * 1450));
  },
  async call(key, prompt) {
    const schema = { type: "OBJECT", properties: { oneLine: { type: "STRING" }, mood: { type: "STRING" }, points: { type: "ARRAY", items: { type: "STRING" } },
      good: { type: "ARRAY", items: { type: "STRING" } }, bad: { type: "ARRAY", items: { type: "STRING" } }, watch: { type: "ARRAY", items: { type: "STRING" } } }, required: ["oneLine", "mood", "points"] };
    let last;
    for (const m of AI.MODELS) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: schema } }) });
      } catch (e) { last = { code: 599, msg: "네트워크 오류" }; continue; }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
        const um = j.usageMetadata || {}, [pin, pout] = AI.price(m);
        const usd = ((um.promptTokenCount || 0) * pin + ((um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)) * pout) / 1e6;
        return { ...JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), model: m, usd };
      }
      last = { code: r.status, msg: j.error?.message || "" };
      if (!(r.status === 429 || r.status >= 500 || r.status === 404)) break;
    }
    throw last || { code: 0, msg: "요약 실패" };
  },
  async digest(st, sym, news, force) {
    const cacheKey = "dg_" + sym, c = LS.get(cacheKey, null);
    if (!force && c && Date.now() - c.at < 6 * 3600_000) return c;
    const free = LS.get("gemFree", ""), paid = LS.get("gemPaid", "");
    if (!free && !paid) throw { code: -1, msg: "설정에서 Gemini API 키를 넣으면 뉴스를 AI가 요약해줘요 (무료)" };
    if (!news.length) throw { code: 0, msg: "요약할 뉴스가 없어요" };
    const prompt = AI.prompt(st, sym, news.slice(0, 25));
    let out, usedPaid = false;
    try {
      if (!free) throw { code: 429 };
      out = await AI.call(free, prompt);
    } catch (e) {
      if (e.code !== 429) throw { code: e.code, msg: e.code === 400 || e.code === 401 || e.code === 403 ? "Gemini API 키가 올바르지 않아요" : e.code >= 500 ? "Gemini 서버가 혼잡해요. 잠시 후 다시 눌러주세요" : "요약 실패: " + (e.msg || e.code) };
      if (!paid) throw { code: 429, msg: `오늘 Gemini 무료 사용량을 다 썼어요. ${AI.resetText()} 이후 다시 무료로 요약돼요` };
      const krw = AI.estimateKrw(prompt.length), spent = LS.get("gemSpent", 0);
      if (!confirm(`무료 사용량을 다 썼어요.\n\n유료 키로 요약할까요?\n예상 비용: 약 ${krw}원 (이번 1회)\n지금까지 유료 사용: 약 ${Math.round(spent)}원\n\n취소하면 ${AI.resetText()} 이후 무료로 다시 요약돼요.`))
        throw { code: 429, msg: `유료 요약을 취소했어요. ${AI.resetText()} 이후 무료로 다시 요약돼요` };
      out = await AI.call(paid, prompt); usedPaid = true;
      LS.set("gemSpent", spent + out.usd * 1450);
    }
    const d = { ...out, at: Date.now(), n: news.length, paid: usedPaid };
    LS.set(cacheKey, d);
    return d;
  }
};
function digestHtml(d) {
  const mc = d.mood?.includes("긍정") ? "g" : d.mood?.includes("부정") ? "r" : "a";
  const list = (t, a, c) => a?.length ? `<div class="b small ${c || ""}" style="margin-top:10px">${t}</div>` + a.map(x => `<div class="small" style="margin-top:3px;line-height:1.45">• ${esc(x)}</div>`).join("") : "";
  return `<div class="between"><span class="badge" style="background:var(--${mc === "g" ? "green" : mc === "r" ? "red" : "amber"})">${esc(d.mood || "중립")}</span><span class="sub">${ago(d.at)} · 기사 ${d.n}개${d.paid ? ` · 유료 약 ${Math.max(1, Math.round(d.usd * 1450))}원` : " · 무료"}</span></div>
    <div class="b" style="margin-top:8px;line-height:1.45">${esc(d.oneLine)}</div>${list("📌 핵심", d.points)}${list("👍 호재", d.good, "g")}${list("⚠️ 악재·리스크", d.bad, "r")}${list("📅 주목할 일정", d.watch, "ac")}`;
}

// ───────────── 종목 상세 ─────────────
const RANGES = [["1일", "1d", "5m"], ["5일", "5d", "30m"], ["1개월", "1mo", "1d"], ["6개월", "6mo", "1d"], ["1년", "1y", "1d"], ["5년", "5y", "1wk"], ["전체", "max", "1mo"]];
async function renderDetail(sym) {
  const st = findStock(sym);
  setHeader(st.ko || sym, true);
  const fav = S.favs.has(sym);
  $("#app").innerHTML = `
    <div class="between"><div><div class="muted small">${esc(sym)}${st.etf ? " · ETF" : ""}</div><div class="big" id="dPrice">…</div><div id="dChg" class="b"></div><div id="dExt" class="small"></div></div>
      <button class="chip" id="favBtn">${fav ? "★ 관심" : "☆ 관심"}</button></div>
    <div class="card" style="margin-top:10px"><div id="cInfo" class="sub" style="min-height:18px">차트를 손가락으로 밀면 그날 가격이 나와요</div><canvas class="chart" id="cv"></canvas>
      <div class="ranges">${RANGES.map((r, i) => `<button data-r="${i}" class="${i === LS.get("range", 4) ? "on" : ""}">${r[0]}</button>`).join("")}</div></div>
    <div class="card" id="dToday"></div>
    ${st.desc || st.pts?.length ? `<div class="sec">📌 핵심 포인트</div><div class="card">${st.desc ? `<div class="b" style="margin-bottom:6px">${esc(st.desc)}</div>` : ""}${(st.pts || []).map(p => `<div class="small" style="margin-top:3px">• ${esc(p)}</div>`).join("")}</div>` : ""}
    <div class="sec">📂 담긴 섹터</div><div class="card" id="dSecs"></div>
    <div class="sec">📝 메모</div><div class="card"><textarea id="memo" placeholder="이 종목에 대한 내 생각, 매수 이유, 목표가…">${esc(S.memos[sym] || "")}</textarea></div>
    <div class="sec">🚦 매수 타이밍 신호</div><div class="card" id="dSig"><div class="spin">계산 중…</div></div>
    <div class="sec">📊 주요 지표</div><div class="card" id="dMetrics"><div class="spin">불러오는 중…</div></div>
    <div id="dHold"></div>
    <div class="between"><div class="sec">🤖 AI 뉴스 요약</div><button class="chip sm" id="aiRe">다시 요약</button></div><div class="card" id="dAI"><div class="spin">뉴스 모으는 중…</div></div>
    <div class="sec">📰 뉴스</div><div class="chips" id="newsTabs"></div><div class="card" id="dNews"><div class="spin">불러오는 중…</div></div>
    <div class="sec">🔗 링크</div><div class="card">
      <a class="link" target="_blank" href="https://finance.yahoo.com/quote/${encodeURIComponent(sym)}">Yahoo Finance ›</a><br>
      ${isKr(sym) ? `<a class="link" target="_blank" href="https://m.stock.naver.com/domestic/stock/${sym.split(".")[0]}/total">네이버 증권 ›</a>` : `<a class="link" target="_blank" href="https://www.tradingview.com/symbols/${sym}/">TradingView ›</a>`}</div>`;
  $("#favBtn").onclick = () => { S.favs.has(sym) ? S.favs.delete(sym) : S.favs.add(sym); S.save(); $("#favBtn").textContent = S.favs.has(sym) ? "★ 관심" : "☆ 관심"; };
  $("#memo").oninput = e => { S.memos[sym] = e.target.value; S.save(); };
  const drawSecs = () => {
    const ins = S.sectors.map((s, i) => [s, i]).filter(([s]) => s.stocks.some(x => x.t === sym));
    $("#dSecs").innerHTML = (ins.length ? ins.map(([s, i]) => `<div class="between" style="padding:6px 0"><span>${esc(s.emoji)} ${esc(s.name)}</span><button class="chip sm" data-rm="${i}">빼기 ✕</button></div>`).join("")
      : `<div class="sub">아직 어떤 섹터에도 없어요.</div>`) + `<div class="chips" style="margin-top:8px">${S.sectors.map((s, i) => ins.some(([, j]) => j === i) ? "" : `<button class="chip sm" data-addto="${i}">＋ ${esc(s.name)}</button>`).join("")}</div>`;
    $("#dSecs").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const s = S.sectors[+b.dataset.rm]; s.stocks = s.stocks.filter(x => x.t !== sym); S.deleted.add(s.name + ":" + sym); S.save(); toast(s.name + "에서 뺐어요"); drawSecs(); });
    $("#dSecs").querySelectorAll("[data-addto]").forEach(b => b.onclick = () => { const s = S.sectors[+b.dataset.addto]; s.stocks.push({ ...st, t: sym, ko: st.ko || Q[sym]?.name || sym }); S.deleted.delete(s.name + ":" + sym); S.save(); toast(s.name + "에 담았어요"); drawSecs(); });
  };
  drawSecs();

  // 시세
  const q = (await Y.quotes([sym]))[sym]; if (q) Q[sym] = q;
  const qq = Q[sym];
  if (qq) {
    $("#dPrice").textContent = money(qq.price, sym);
    $("#dChg").innerHTML = `<span class="${cls(qq.pct)}">${qq.chg != null ? (qq.chg > 0 ? "+" : qq.chg < 0 ? "-" : "") + money(Math.abs(qq.chg), sym) : ""} (${pct(qq.pct)})</span>`;
    if (!isKr(sym)) {
      if (qq.pre && qq.state?.startsWith("PRE")) $("#dExt").innerHTML = `프리마켓 ${money(qq.pre, sym)} <span class="${cls(qq.prePct)}">${pct(qq.prePct)}</span>`;
      else if (qq.post) $("#dExt").innerHTML = `애프터마켓 ${money(qq.post, sym)} <span class="${cls(qq.postPct)}">${pct(qq.postPct)}</span>`;
    }
    $("#dToday").innerHTML = `<div class="kv"><span class="k">시가총액</span><span class="v">${big(qq.cap, sym)}</span></div>
      <div class="kv"><span class="k">52주 최저 / 최고</span><span class="v">${money(qq.low52, sym)} / ${money(qq.high52, sym)}</span></div>
      ${qq.high52 ? `<div class="kv"><span class="k">52주 최고가 대비</span><span class="v ${cls(qq.price / qq.high52 - 1)}">${pct((qq.price / qq.high52 - 1) * 100)}</span></div>` : ""}`;
  } else $("#dToday").innerHTML = `<div class="sub">시세를 불러오지 못했어요.</div>`;

  // 차트
  const loadRange = async i => {
    LS.set("range", i);
    $("#app").querySelectorAll("[data-r]").forEach(b => b.classList.toggle("on", +b.dataset.r === i));
    const [, range, iv] = RANGES[i];
    const d = await Y.chart(sym, range, iv);
    if (!d) { $("#cInfo").textContent = "차트를 불러오지 못했어요"; return; }
    d.intraday = iv.endsWith("m");
    const chg = (d.closes[d.closes.length - 1] / (i === 0 ? d.base : d.closes[0]) - 1) * 100;
    $("#cInfo").innerHTML = `${RANGES[i][0]} 수익률 <b class="${cls(chg)}">${pct(chg)}</b> · 손가락으로 밀어보세요`;
    priceChart($("#cv"), d, sym, $("#cInfo"));
  };
  $("#app").querySelectorAll("[data-r]").forEach(b => b.onclick = () => loadRange(+b.dataset.r));
  loadRange(LS.get("range", 4));

  // 신호
  Promise.all([Y.chart(sym, "1y", "1d"), Y.chart(sym, "5y", "1wk")]).then(([d, w]) => {
    const list = Sig.price(d, w, st.etf || sym.startsWith("^"), sym);
    $("#dSig").innerHTML = list.length ? sigSummary(list) + list.map(sigRow).join("") + `<a class="link" href="#/signals">시장 전체 신호(공포지수·VIX) 보기 ›</a>` : `<div class="sub">차트 데이터가 부족해 계산할 수 없어요.</div>`;
  });

  // 지표
  Y.summary(sym).then(sm => renderMetrics(sym, st, sm));

  // 뉴스
  const pre = await data(`n/${fname(sym)}.json`, 600_000);
  const tabs = [["국내", async () => pre?.ko?.length ? pre.ko : newsSearch((st.ko && st.ko !== sym ? st.ko.replace(/\(.*\)/, "").trim() : sym) + " 주가")],
    ...(isKr(sym) ? [] : [["해외", async () => pre?.en?.length ? pre.en : newsSearch((qq?.name || sym) + " stock", true)]]),
    ["🔍 기업분석", async () => pre?.an?.length ? pre.an : newsSearch((st.ko || sym).replace(/\(.*\)/, "").trim() + " 기업분석")]];
  const runAI = async force => {
    $("#dAI").innerHTML = `<div class="spin">AI가 최근 뉴스를 읽는 중… (10초쯤)</div>`;
    try {
      const all = [...(await tabs[0][1]()), ...(tabs.length > 2 ? await tabs[1][1]() : [])];
      const d = await AI.digest(st, sym, all, force);
      $("#dAI").innerHTML = digestHtml(d) + `<div class="sub" style="margin-top:10px">AI가 기사 제목을 정리한 거라 틀릴 수 있어요. 중요한 건 원문을 확인하세요.</div>`;
    } catch (e) {
      $("#dAI").innerHTML = `<div class="small">${esc(e.msg || "요약 실패")}</div>` + (e.code === -1 ? `<a class="link" href="#/settings">Gemini 키 넣으러 가기 ›</a>` : "");
    }
  };
  $("#aiRe").onclick = () => runAI(true);
  runAI(false);
  let nt = 0;
  const loadNews = async () => {
    $("#newsTabs").innerHTML = tabs.map((t, i) => `<button class="chip ${i === nt ? "on" : ""}" data-n="${i}">${t[0]}</button>`).join("");
    $("#newsTabs").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { nt = +b.dataset.n; loadNews(); });
    $("#dNews").innerHTML = `<div class="spin">불러오는 중…</div>`;
    const list = await tabs[nt][1]();
    $("#dNews").innerHTML = list.length ? list.slice(0, 12).map(n => `<a class="news" target="_blank" href="${esc(n.link)}"><div class="t">${esc(n.title)}</div><div class="m">${esc(n.src)} · ${n.time ? ago(n.time) : ""}</div></a>`).join("") : `<div class="sub">뉴스가 없어요.</div>`;
  };
  loadNews();
}

function raw(o) { return o?.raw ?? (typeof o === "number" ? o : null); }
function renderMetrics(sym, st, sm) {
  if (!sm) { $("#dMetrics").innerHTML = `<div class="sub">지표를 불러오지 못했어요.</div>`; return; }
  const sd = sm.summaryDetail || {}, ks = sm.defaultKeyStatistics || {}, fd = sm.financialData || {}, pr = sm.price || {};
  const P = v => v == null ? "—" : (v * 100).toFixed(1) + "%";
  const N = (v, d = 1) => v == null ? "—" : v.toFixed(d);
  let rows;
  if (st.etf || pr.quoteType === "ETF") {
    rows = [["총보수", P(raw(ks.annualReportExpenseRatio) ?? raw(sm.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio))],
      ["배당수익률", P(raw(sd.yield) ?? raw(sd.trailingAnnualDividendYield))], ["운용 규모", big(raw(sd.totalAssets), sym)],
      ["올해 수익률", P(raw(ks.ytdReturn))], ["3년 평균 수익률", P(raw(ks.threeYearAverageReturn))], ["5년 평균 수익률", P(raw(ks.fiveYearAverageReturn))], ["베타(3년)", N(raw(ks.beta3Year), 2)]];
  } else {
    const pe = raw(sd.trailingPE), fpe = raw(sd.forwardPE) ?? raw(ks.forwardPE);
    rows = [["PER (주가÷1년 이익)", pe == null ? (raw(ks.trailingEps) < 0 ? "적자" : "—") : N(pe)], ["선행 PER (내년 예상 이익 기준)", N(fpe)],
      ["PBR (주가÷순자산)", N(raw(ks.priceToBook), 2)], ["PSR (시총÷매출)", N(raw(sd.priceToSalesTrailing12Months), 2)],
      ["EV/EBITDA", N(raw(ks.enterpriseToEbitda))], ["PEG (PER÷성장률)", N(raw(ks.pegRatio), 2)],
      ["매출 성장률 (전년비)", P(raw(fd.revenueGrowth))], ["영업이익률", P(raw(fd.operatingMargins))], ["순이익률", P(raw(fd.profitMargins))],
      ["ROE (자본 대비 이익)", P(raw(fd.returnOnEquity))], ["부채비율 (부채÷자본)", raw(fd.debtToEquity) == null ? "—" : raw(fd.debtToEquity).toFixed(0) + "%"],
      ["배당수익률", P(raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield))], ["베타 (시장 대비 변동)", N(raw(sd.beta), 2)],
      ["목표주가 (애널리스트 평균)", raw(fd.targetMeanPrice) ? money(raw(fd.targetMeanPrice), sym) + ` (${fd.recommendationKey || ""})` : "—"]];
  }
  $("#dMetrics").innerHTML = rows.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("") +
    (sm.assetProfile?.industry ? `<div class="sub" style="margin-top:8px">업종: ${esc(sm.assetProfile.sector || "")} · ${esc(sm.assetProfile.industry)}</div>` : "");
  const hs = sm.topHoldings?.holdings || [];
  if (hs.length) {
    const mx = Math.max(...hs.map(h => raw(h.holdingPercent) || 0)) || 1;
    const sum = hs.reduce((a, h) => a + (raw(h.holdingPercent) || 0), 0);
    $("#dHold").innerHTML = `<div class="sec">📦 상위 보유 종목 · 비중</div><div class="card">` + hs.map(h => {
      const p = raw(h.holdingPercent) || 0;
      return `<div style="padding:5px 0" data-hs="${esc(h.symbol)}"><div class="between"><span class="b small">${esc(allStocks().get(h.symbol)?.ko || h.holdingName)}</span><span class="small"><span class="muted">${esc(h.symbol || "")}</span> <b class="ac">${(p * 100).toFixed(1)}%</b></span></div><div class="bar"><div style="width:${p / mx * 100}%;background:var(--accent)"></div></div></div>`;
    }).join("") + `<div class="sub b" style="margin-top:6px">상위 ${hs.length}개 합계 ${(sum * 100).toFixed(1)}%${sum >= .6 ? " · 소수 종목에 집중된 편" : sum < .35 ? " · 넓게 분산된 편" : ""}</div></div>`;
    $("#dHold").querySelectorAll("[data-hs]").forEach(el => el.onclick = () => el.dataset.hs && go("s/" + encodeURIComponent(el.dataset.hs)));
  }
}

// ───────────── 지표 히스토리 + 백테스트 ─────────────
const dayKey = ms => Math.floor(ms / 86400000);
function alignTo(t, d) {
  const out = new Float64Array(t.length).fill(NaN); if (!d) return out;
  const m = new Map(); d.closes.forEach((v, i) => m.set(dayKey(d.times[i]), v));
  for (let i = 0; i < t.length; i++) { const v = m.get(dayKey(t[i])); out[i] = v ?? (i ? out[i - 1] : NaN); }
  return out;
}
const ret = (a, i, d) => i >= d && a[i - d] > 0 && !isNaN(a[i]) && !isNaN(a[i - d]) ? a[i] / a[i - d] - 1 : NaN;
function pctRank(raw, invert) {
  const out = new Float64Array(raw.length).fill(NaN);
  for (let i = 120; i < raw.length; i++) {
    if (isNaN(raw[i])) continue; let below = 0, cnt = 0;
    for (let j = Math.max(0, i - 251); j <= i; j++) if (!isNaN(raw[j])) { cnt++; if (raw[j] < raw[i]) below++; }
    if (cnt < 60) continue; const p = below * 100 / Math.max(1, cnt - 1); out[i] = invert ? 100 - p : p;
  }
  return out;
}
/** CNN 공포·탐욕 방식을 공개 데이터로 근사 (6개 요소를 1년 백분위로 점수화해 평균) */
function estimateFg(t, spx, vix, tlt, hyg, ief, rsp, spy) {
  const n = t.length, mom = new Float64Array(n).fill(NaN), str = new Float64Array(n).fill(NaN), vx = new Float64Array(n).fill(NaN);
  let s125 = 0, vs = 0;
  for (let i = 0; i < n; i++) {
    s125 += spx[i]; if (i >= 125) s125 -= spx[i - 125]; if (i >= 124) mom[i] = spx[i] / (s125 / 125) - 1;
    if (i >= 251) { let lo = Infinity, hi = 0; for (let j = i - 251; j <= i; j++) { lo = Math.min(lo, spx[j]); hi = Math.max(hi, spx[j]); } if (hi > lo) str[i] = (spx[i] - lo) / (hi - lo); }
    if (!isNaN(vix[i])) { vs += vix[i]; if (i >= 50 && !isNaN(vix[i - 50])) vs -= vix[i - 50]; if (i >= 49) vx[i] = vix[i] / (vs / 50) - 1; }
  }
  const mk = f => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; };
  const parts = [pctRank(mom), pctRank(str), pctRank(vx, true), pctRank(mk(i => ret(spx, i, 20) - ret(tlt, i, 20))), pctRank(mk(i => ret(hyg, i, 20) - ret(ief, i, 20))), pctRank(mk(i => ret(rsp, i, 20) - ret(spy, i, 20)))];
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { const v = parts.map(p => p[i]).filter(x => !isNaN(x)); if (v.length >= 3) out[i] = v.reduce((a, b) => a + b, 0) / v.length; }
  return out;
}
const HIST = {};
async function loadHistory(sym) {
  if (HIST[sym]) return HIST[sym];
  const [d, v, spx0, tlt, hyg, ief, rsp, spy] = await Promise.all([Y.chart(sym, "max", "1d"), Y.chart("^VIX", "max", "1d"),
    sym === "^GSPC" ? null : Y.chart("^GSPC", "max", "1d"), Y.chart("TLT", "max", "1d"), Y.chart("HYG", "max", "1d"), Y.chart("IEF", "max", "1d"), Y.chart("RSP", "max", "1d"), Y.chart("SPY", "max", "1d")]);
  if (!d || d.closes.length < 260) return null;
  const t = d.times, px = Float64Array.from(d.closes), n = t.length;
  const vix = alignTo(t, v);
  // CNN 실제 과거 값 (막히면 비어 있음)
  const fgCnn = new Float64Array(n).fill(NaN);
  try {
    const arr = await data("fgh.json", 3600_000) || [];
    const m = new Map(); arr.forEach(([x, y]) => m.set(dayKey(x), y));
    if (m.size) { const last = Math.max(...m.keys()); for (let i = 0; i < n; i++) { const k = dayKey(t[i]); fgCnn[i] = m.get(k) ?? (i && !isNaN(fgCnn[i - 1]) && k <= last ? fgCnn[i - 1] : NaN); } }
  } catch (e) { }
  const spx = sym === "^GSPC" ? px : alignTo(t, spx0);
  const fgEst = estimateFg(t, spx, vix, alignTo(t, tlt), alignTo(t, hyg), alignTo(t, ief), alignTo(t, rsp), alignTo(t, spy));
  const fg = new Float64Array(n); for (let i = 0; i < n; i++) fg[i] = isNaN(fgCnn[i]) ? fgEst[i] : fgCnn[i];
  const rsi = new Float64Array(n).fill(NaN); { let g = 0, l = 0; const p = 14;
    for (let i = 1; i < n; i++) { const dd = px[i] - px[i - 1];
      if (i <= p) { dd > 0 ? g += dd : l -= dd; if (i === p) { g /= p; l /= p; rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (p - 1) + Math.max(dd, 0)) / p; l = (l * (p - 1) + Math.max(-dd, 0)) / p; rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } }
  const mdd = new Float64Array(n); { let hi = 0; for (let i = 0; i < n; i++) { hi = Math.max(hi, px[i]); mdd[i] = (px[i] / hi - 1) * 100; } }
  const ma200 = new Float64Array(n).fill(NaN); { let s = 0; for (let i = 0; i < n; i++) { s += px[i]; if (i >= 200) s -= px[i - 200]; if (i >= 199) ma200[i] = (px[i] / (s / 200) - 1) * 100; } }
  const H = { sym, t, px, n, vix, fg, fgCnn, fgEst, rsi, mdd, ma200, fwd: (i, d) => i + d < n ? (px[i + d] / px[i] - 1) * 100 : null };
  HIST[sym] = H; return H;
}
const DEFS = [
  { key: "fg", group: "공포·탐욕", rule: "20 미만", th: 20, v: (h, i) => h.fg[i], s: x => x < 20, desc: "투자자 심리 점수 0~100. 낮을수록 다들 겁먹은 상태 → 역사적으로 싸게 살 기회였어요." },
  { key: "fg10", group: "공포·탐욕", rule: "10 미만", th: 10, v: (h, i) => h.fg[i], s: x => x < 10, desc: "투자자 심리 점수 0~100. 낮을수록 다들 겁먹은 상태 → 역사적으로 싸게 살 기회였어요." },
  { key: "vix", group: "VIX", rule: "30 이상", th: 30, v: (h, i) => h.vix[i], s: x => x >= 30, desc: "앞으로 30일 동안 시장이 얼마나 출렁일지에 대한 공포. 평소 12~20, 30 넘으면 패닉." },
  { key: "rsi", group: "RSI", rule: "30 이하", th: 30, v: (h, i) => h.rsi[i], s: x => x <= 30, desc: "최근 14일 동안 오른 힘 vs 내린 힘. 30 아래면 너무 많이 팔린 과매도 상태." },
  { key: "mdd", group: "고점 대비 낙폭", rule: "-14% 이하", th: -14, unit: "%", v: (h, i) => h.mdd[i], s: x => x <= -14, desc: "역대 최고점에서 지금까지 몇 % 떨어졌는지." },
  { key: "mdd20", group: "고점 대비 낙폭", rule: "-20% 이하", th: -20, unit: "%", v: (h, i) => h.mdd[i], s: x => x <= -20, desc: "역대 최고점에서 지금까지 몇 % 떨어졌는지." },
  { key: "mdd30", group: "고점 대비 낙폭", rule: "-30% 이하", th: -30, unit: "%", v: (h, i) => h.mdd[i], s: x => x <= -30, desc: "역대 최고점에서 지금까지 몇 % 떨어졌는지." },
  { key: "ma", group: "200일선", rule: "5% 이상 아래", th: -5, unit: "%", v: (h, i) => h.ma200[i], s: x => x <= -5, desc: "최근 200거래일(약 1년) 평균 가격보다 몇 % 위/아래에 있는지." }
];
function backtest(h) {
  const stat = (label, rule, key, on) => {
    let days = 0, eps = 0, prev = false, last = -1; const f3 = [], f6 = [], f12 = [];
    for (let i = 0; i < h.n; i++) { const s = on(i); if (s) { days++; if (!prev) eps++; last = i; const a = h.fwd(i, 63), b = h.fwd(i, 126), c = h.fwd(i, 252); a != null && f3.push(a); b != null && f6.push(b); c != null && f12.push(c); } prev = s; }
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return { label, rule, key, days, eps, last, r3: avg(f3), r6: avg(f6), r12: avg(f12), win: f12.length ? f12.filter(x => x > 0).length * 100 / f12.length : null };
  };
  const out = [stat("아무 날이나 샀을 때", "기준선 (비교용)", "", () => true)];
  DEFS.forEach(d => out.push(stat(`${d.group} ${d.rule}`, d.rule, d.key, i => { const v = d.v(h, i); return !isNaN(v) && d.s(v); })));
  const core = ["fg", "vix", "rsi", "mdd", "ma"].map(k => DEFS.find(d => d.key === k));
  const hits = i => core.filter(d => { const v = d.v(h, i); return !isNaN(v) && d.s(v); }).length;
  out.push(stat("2개 겹침 (매수 준비)", "공포탐욕·VIX·RSI·낙폭·200일선 중 2개+", "", i => hits(i) >= 2));
  out.push(stat("3개 이상 (비중 크게)", "위 5개 중 3개+", "", i => hits(i) >= 3));
  return out;
}
let histDef = 0, histRange = 6;
function historyChart(cv, h, def, from, onSel) {
  let sel = -1;
  const draw = () => {
    const { c, w, h: H } = setupCanvas(cv, 300);
    const count = h.n - from; if (count < 2) return;
    const L = 4, R = 42, W = w - L - R, top = [6, H * 0.58], bot = [H * 0.64, H - 16];
    const x = i => L + (i - from) / (count - 1) * W;
    const step = Math.max(1, Math.floor(count / W));
    c.fillStyle = "rgba(34,197,94,0.22)";
    for (let i = from; i < h.n; i += step) { let on = false; for (let k = i; k < Math.min(h.n, i + step); k++) { const v = def.v(h, k); if (!isNaN(v) && def.s(v)) { on = true; break; } } if (on) c.fillRect(x(i) - Math.max(.8, W / count * step / 2), top[0], Math.max(1.6, W / count * step), bot[1] - top[0]); }
    let lo = Infinity, hi = -Infinity; for (let i = from; i < h.n; i++) { lo = Math.min(lo, h.px[i]); hi = Math.max(hi, h.px[i]); }
    const llo = Math.log(lo), lhi = Math.log(hi) || llo + 1;
    const yp = v => top[1] - (Math.log(v) - llo) / (lhi - llo || 1) * (top[1] - top[0]);
    c.font = "10px -apple-system"; c.fillStyle = "#8B8FA3"; c.strokeStyle = "#2C2E3A"; c.lineWidth = 1;
    [0, .5, 1].forEach(f => { const v = Math.exp(llo + (lhi - llo) * f); c.beginPath(); c.moveTo(L, yp(v)); c.lineTo(L + W, yp(v)); c.stroke(); c.fillText(fmt(v, v >= 100 ? 0 : 1), L + W + 4, yp(v) + 3); });
    c.strokeStyle = "#6C7BFF"; c.lineWidth = 1.6; c.beginPath();
    for (let i = from; i < h.n; i += step) i === from ? c.moveTo(x(i), yp(h.px[i])) : c.lineTo(x(i), yp(h.px[i]));
    c.lineTo(x(h.n - 1), yp(h.px[h.n - 1])); c.stroke();
    let a = Infinity, b = -Infinity; for (let i = from; i < h.n; i++) { const v = def.v(h, i); if (!isNaN(v)) { a = Math.min(a, v); b = Math.max(b, v); } }
    if (a === Infinity) { c.fillText("이 기간엔 데이터가 없어요", L + 8, (bot[0] + bot[1]) / 2); }
    else {
      a = Math.min(a, def.th); b = Math.max(b, def.th); if (a === b) b = a + 1;
      const yi = v => bot[1] - (v - a) / (b - a) * (bot[1] - bot[0]);
      c.strokeStyle = "#2C2E3A"; [bot[0], bot[1]].forEach(yy => { c.beginPath(); c.moveTo(L, yy); c.lineTo(L + W, yy); c.stroke(); });
      c.fillText(fmt(b, 0), L + W + 4, bot[0] + 8); c.fillText(fmt(a, 0), L + W + 4, bot[1]);
      c.strokeStyle = "#22C55E"; c.setLineDash([6, 4]); c.beginPath(); c.moveTo(L, yi(def.th)); c.lineTo(L + W, yi(def.th)); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#22C55E"; c.fillText(String(def.th), L + W + 4, yi(def.th) + 3);
      c.strokeStyle = "#F5B83D"; c.lineWidth = 1.3; c.beginPath(); let started = false;
      for (let i = from; i < h.n; i += step) { const v = def.v(h, i); if (isNaN(v)) { started = false; continue; } started ? c.lineTo(x(i), yi(v)) : (c.moveTo(x(i), yi(v)), started = true); }
      c.stroke();
      if (sel >= from) { const v = def.v(h, sel); if (!isNaN(v)) { c.fillStyle = "#fff"; c.beginPath(); c.arc(x(sel), yi(v), 3.5, 0, 7); c.fill(); } }
    }
    const spanY = (h.t[h.n - 1] - h.t[from]) / 3.15576e10, every = spanY > 60 ? 20 : spanY > 30 ? 10 : spanY > 12 ? 5 : spanY > 5 ? 2 : 1;
    c.fillStyle = "#8B8FA3"; let lastY = -1;
    for (let i = from; i < h.n; i++) { const y = new Date(h.t[i]).getFullYear(); if (y !== lastY) { if (lastY !== -1 && y % every === 0) c.fillText(every >= 5 ? String(y) : "'" + String(y).slice(2), x(i) - 8, H - 3); lastY = y; } }
    if (sel >= from) { c.strokeStyle = "#fff"; c.lineWidth = 1; c.beginPath(); c.moveTo(x(sel), top[0]); c.lineTo(x(sel), bot[1]); c.stroke(); c.fillStyle = "#fff"; c.beginPath(); c.arc(x(sel), yp(h.px[sel]), 3.5, 0, 7); c.fill(); }
  };
  scrub(cv, f => { const W = cv.clientWidth - 46; const count = h.n - from; sel = from + Math.max(0, Math.min(count - 1, Math.round((f * cv.clientWidth - 4) / W * (count - 1)))); onSel(sel); draw(); });
  return { draw, select(i) { sel = i; draw(); } };
}

async function renderHistory(box, sym, label) {
  const etfName = { "^GSPC": "VOO·SPY 같은 S&P500 ETF", "^IXIC": "QQQ 같은 나스닥 ETF", "^KS11": "KODEX 200 같은 코스피 ETF" }[sym] || "지수 ETF";
  box.innerHTML = `<div class="sec">📈 지표 히스토리 · 백테스트</div><div class="card"><div class="spin">상장 이후 전체 데이터 불러오는 중… (S&P500은 1927년부터라 10초쯤 걸려요)</div></div>`;
  const h = await loadHistory(sym);
  if (!h) { box.innerHTML = `<div class="sec">📈 지표 히스토리 · 백테스트</div><div class="card sub">히스토리 데이터를 불러오지 못했어요.</div>`; return; }
  const years = [1, 3, 5, 10, 20, 30, 0], spanYears = Math.floor((h.t[h.n - 1] - h.t[0]) / 3.15576e10);
  let cur = h.n - 1, chart;
  box.innerHTML = `<div class="sec">📈 지표 히스토리 · 백테스트</div><div class="card" id="hc">
    <div class="sub b">① 지표 고르기</div><div class="chips" id="hg" style="margin:4px 0 8px"></div>
    <div class="sub b">② 매수 기준</div><div class="chips" id="hl" style="margin:4px 0 4px"></div><div class="sub" id="hdesc" style="margin-bottom:8px"></div>
    <div class="sub b">③ 기간</div><div class="chips" id="hr" style="margin:4px 0 8px"></div>
    <div class="sub" style="margin-bottom:6px">👆 아래 차트를 손가락으로 좌우로 밀어서 날짜를 고르세요. 그날 지수 ETF를 샀다면 그 뒤 얼마가 됐는지 바로 계산돼요. 초록 줄 = 고른 신호가 켜졌던 날.</div>
    <div class="card2" id="hinfo"></div><canvas class="chart" id="hcv" style="margin-top:6px"></canvas><div class="sub" id="hnote" style="margin-top:6px"></div></div>
    <div class="card" id="bt"></div>`;
  const dv = (v, d = 1) => isNaN(v) ? "—" : v.toFixed(d);
  const after = (i, d) => dstr(i + d < h.n ? h.t[i + d] : h.t[i] + d * 365 / 252 * 86400000);
  const showInfo = i => {
    cur = i; const def = DEFS[histDef], v = def.v(h, i), on = !isNaN(v) && def.s(v);
    $("#hinfo").innerHTML = `<div class="b">📅 ${dstr(h.t[i], true)}</div><div class="small">그날 ${label} 지수: ${fmt(h.px[i])}</div>
      <div class="small b" style="margin-top:4px;color:${on ? "var(--green)" : "var(--sub)"}">${isNaN(v) ? `⚪ '${def.group}' 그날은 데이터 없음` : on ? `🟢 '${def.group} ${def.rule}' 신호가 켜진 날 — 값 ${dv(v)}${def.unit || ""}` : `⚪ '${def.group} ${def.rule}' 신호는 꺼져 있던 날 — 값 ${dv(v)}${def.unit || ""}`}</div>
      <div class="sub" style="margin-top:3px">그날 지표: 공포탐욕${isNaN(h.fgCnn[i]) && !isNaN(h.fgEst[i]) ? "(추정)" : ""} ${dv(h.fg[i], 0)} · VIX ${dv(h.vix[i])} · RSI ${dv(h.rsi[i], 0)} · 고점 대비 ${dv(h.mdd[i])}% · 200일선 ${isNaN(h.ma200[i]) ? "—" : (h.ma200[i] > 0 ? "+" : "") + h.ma200[i].toFixed(1) + "%"}</div>
      <div class="small b" style="margin:8px 0 2px">💰 이날 ${etfName} 100만원어치를 사서 그대로 들고 있었다면</div>` +
      [[63, "3개월 뒤"], [126, "6개월 뒤"], [252, "1년 뒤"]].map(([d, nm]) => { const r = h.fwd(i, d);
        return `<div class="between small" style="padding:2px 0"><span class="muted">${nm} (${after(i, d)})</span><b class="${r == null ? "muted" : cls(r)}">${r == null ? "아직 그날이 안 왔어요" : Math.round(100 * (1 + r / 100)).toLocaleString() + "만원 (" + pct(r, 1) + ")"}</b></div>`; }).join("");
  };
  const refresh = () => {
    const def = DEFS[histDef], groups = [...new Set(DEFS.map(d => d.group))], lv = DEFS.map((d, i) => [d, i]).filter(([d]) => d.group === def.group);
    $("#hg").innerHTML = groups.map(g => `<button class="chip sm ${g === def.group ? "on" : ""}" data-g="${esc(g)}">${esc(g)}</button>`).join("");
    $("#hl").innerHTML = lv.map(([d, i]) => `<button class="chip sm ${i === histDef ? "on" : ""}" data-l="${i}">${esc(d.rule)}</button>`).join("");
    $("#hdesc").textContent = `${def.group}: ${def.desc} · 초록 줄 = ${def.rule}였던 날`;
    $("#hr").innerHTML = years.map((y, i) => `<button class="chip sm ${i === histRange ? "on" : ""}" data-y="${i}">${y ? y + "년" : "전체 (" + spanYears + "년)"}</button>`).join("");
    $("#hg").querySelectorAll("[data-g]").forEach(b => b.onclick = () => { histDef = DEFS.findIndex(d => d.group === b.dataset.g); refresh(); });
    $("#hl").querySelectorAll("[data-l]").forEach(b => b.onclick = () => { histDef = +b.dataset.l; refresh(); });
    $("#hr").querySelectorAll("[data-y]").forEach(b => b.onclick = () => { histRange = +b.dataset.y; refresh(); });
    const y = years[histRange], cut = y ? Date.now() - y * 3.15576e10 : 0;
    const from = Math.max(0, h.t.findIndex(t => t >= cut));
    chart = historyChart($("#hcv"), h, def, from, showInfo); chart.select(cur); showInfo(cur);
  };
  const hasCnn = [...h.fgCnn].some(x => !isNaN(x));
  const firstCnn = [...h.fgCnn].findIndex(x => !isNaN(x));
  $("#hnote").textContent = (hasCnn ? `※ 공포·탐욕: ${dstr(h.t[firstCnn]).slice(0, 7)}부터는 CNN 실제 값, 그 이전은 자체 추정치예요. ` : "※ 공포·탐욕: CNN 값을 못 받아 전체를 자체 추정치로 보여줘요. ") +
    "자체 추정치 = CNN과 같은 방식으로 6가지(S&P500 125일선 대비 모멘텀, 52주 위치, VIX vs 50일 평균, 주식 vs 국채, 정크본드 vs 국채, 동일가중 vs 시총가중)를 최근 1년 안에서 점수화해 평균낸 값이라 CNN과 몇 점 차이 날 수 있어요.";
  refresh();
  window.addEventListener("resize", () => chart && chart.draw(), { passive: true });

  // 백테스트 표
  const st = backtest(h), base = st[0], yf = ms => new Date(ms).getFullYear();
  const cell = (v, b, isPct = true, isBase) => `<td class="${v == null ? "muted" : isBase ? "" : b != null && v > b ? "g" : "r"}">${v == null ? "—" : isPct ? pct(v, 1) : Math.round(v) + "%"}</td>`;
  $("#bt").innerHTML = `<div class="b ac" style="font-size:15px">🧪 백테스트: 신호 뜬 날 샀다면? (${label}, ${yf(h.t[0])}~${yf(h.t[h.n - 1])}, ${spanYears}년)</div>
    <div class="card2" style="margin:8px 0"><div class="b small">📖 표 읽는 법</div>${[
      `한 줄 = '이 신호가 켜진 날마다 ${etfName}를 샀다면' 평균 몇 % 벌었는지`, "3개월·6개월·1년 = 산 날로부터 그만큼 들고 있다가 팔았을 때 수익률",
      "1년 승률 = 1년 뒤에 돈을 번(플러스였던) 경우의 비율", "맨 위 '아무 날이나' = 신호 없이 아무 날에나 샀을 때 (비교 기준)",
      "N번 (N일) = 신호가 켜진 시기가 N번, 날짜로는 총 N일", "줄을 누르면 위 차트가 그 신호로 바뀌고 가장 최근 신호 날짜로 이동해요",
      "지표마다 시작 연도가 달라요: VIX 1990년~, 공포·탐욕 추정 1990년대~, RSI·낙폭·200일선은 전체 기간"].map(t => `<div class="sub" style="margin-top:3px">• ${t}</div>`).join("")}</div>
    <table class="bt"><tr><th>신호 (횟수)</th><th>3개월</th><th>6개월</th><th>1년</th><th>1년 승률</th></tr>` +
    st.map(s => { const isBase = s === base;
      const line = !isBase && s.r12 != null && base.r12 != null ? `<tr><td colspan="5" style="border-top:0;padding-top:0;font-weight:400" class="small ${s.r12 >= base.r12 ? "g" : "r"}">→ 100만원이 1년 뒤 평균 ${Math.round(100 * (1 + s.r12 / 100))}만원. 그냥 샀을 때(${Math.round(100 * (1 + base.r12 / 100))}만원)보다 ${Math.abs(s.r12 - base.r12).toFixed(1)}%p ${s.r12 >= base.r12 ? "더" : "덜"} 벌었어요${s.last >= 0 ? " · 가장 최근: " + dstr(h.t[s.last]) : ""}</td></tr>`
        : !isBase && !s.days ? `<tr><td colspan="5" style="border-top:0;padding-top:0;font-weight:400" class="small muted">→ 이 기간엔 한 번도 안 켜졌어요</td></tr>` : "";
      return `<tr data-k="${s.key}" data-last="${s.last}"><td><div>${esc(s.label)}</div><div class="sub" style="font-weight:400">${isBase ? s.rule : s.eps + "번 (" + s.days + "일)"}</div></td>${cell(s.r3, base.r3, true, isBase)}${cell(s.r6, base.r6, true, isBase)}${cell(s.r12, base.r12, true, isBase)}${cell(s.win, base.win, false, isBase)}</tr>${line}`; }).join("") +
    `</table><div class="sub" style="margin-top:8px">초록 = 아무 날이나 산 것보다 좋았음 · 빨강 = 나빴음. 과거 결과가 미래를 보장하진 않아요.</div>`;
  $("#bt").querySelectorAll("tr[data-k]").forEach(tr => tr.onclick = () => {
    const i = DEFS.findIndex(d => d.key === tr.dataset.k); if (i < 0) return;
    histDef = i; histRange = years.length - 1; cur = +tr.dataset.last >= 0 ? +tr.dataset.last : cur; refresh();
    $("#hc").scrollIntoView({ behavior: "smooth" });
  });
}

// ───────────── 매수 타이밍 신호 화면 ─────────────
let sigMarket = 0;
const MARKETS = [["^GSPC", "🇺🇸 S&P 500", "S&P 500", true], ["^IXIC", "🇺🇸 나스닥", "나스닥", true], ["^KS11", "🇰🇷 코스피", "코스피", false]];
async function renderSignals() {
  setHeader("🚦 매수 타이밍 신호", true);
  const [sym, , label, us] = MARKETS[sigMarket];
  $("#app").innerHTML = `<div class="chips">${MARKETS.map((m, i) => `<button class="chip ${i === sigMarket ? "on" : ""}" data-m="${i}">${m[1]}</button>`).join("")}</div>
    <div id="sigMain" style="margin-top:8px"><div class="spin">지표 불러오는 중…</div></div><div id="sigHist"></div>`;
  $("#app").querySelectorAll("[data-m]").forEach(b => b.onclick = () => { sigMarket = +b.dataset.m; renderSignals(); });
  const [d, w, vix, fg] = await Promise.all([Y.chart(sym, "1y", "1d"), Y.chart(sym, "5y", "1wk"), Y.chart("^VIX", "5d", "1d"), Sig.fearGreed()]);
  const drawMain = () => {
    const list = [];
    const est = HIST[sym] ? [...HIST[sym].fgEst].reverse().find(x => !isNaN(x)) : null;
    const fgv = fg?.score ?? est;
    if (fgv != null) list.push({ name: fg ? "공포·탐욕 지수 (CNN)" : "공포·탐욕 지수 (자체 추정)", value: Math.round(fgv) + " · " + Sig.fgView(fgv).split(" —")[0], state: Sig.fgState(fgv),
      rule: "→ " + Sig.fgView(fgv) + " · 20 아래 비중 확대, 10 미만 추가 매수",
      note: (fg ? "주가 모멘텀·변동성·옵션·안전자산·정크본드 등 7개로 만든 미국 투자심리 점수(0~100)." : "CNN 값을 못 받아 같은 방식으로 직접 계산한 추정치예요.") + (us ? "" : " (미국 시장 기준)") });
    else list.push({ name: "공포·탐욕 지수", value: "계산 중…", state: 0, rule: "20 미만 극단적 공포 구간", note: "CNN 값을 못 받아 자체 추정치를 계산하고 있어요 (아래 히스토리 로딩 후 표시)." });
    if (vix) list.push({ name: "VIX (변동성 지수)", value: vix.price.toFixed(1), state: vix.price >= 30 ? 2 : vix.price >= 20 ? 1 : 0, rule: "30 이상 시장 패닉 상태", note: "S&P500 옵션으로 계산한 앞으로 30일 공포 정도. 평소 12~20, 30 넘으면 패닉, 40 넘으면 코로나·금융위기급." });
    list.push(...Sig.price(d, w, true, sym));
    const bands = [["0~25", "극단적 공포 · 적극 매수 고려", 2], ["25~45", "공포 · 분할 매수", 1], ["45~55", "중립 · 관망", 0], ["55~75", "탐욕 · 관망·분할 매도 검토", -1], ["75~100", "극단적 탐욕 · 분할 매도", -1]];
    const bi = fgv == null ? -1 : fgv < 25 ? 0 : fgv < 45 ? 1 : fgv < 55 ? 2 : fgv < 75 ? 3 : 4;
    $("#sigMain").innerHTML = `<div class="card"><div class="b" style="font-size:16px;margin-bottom:4px">${label} ${d ? fmt(d.price) : ""}</div>${sigSummary(list)}${list.map(sigRow).join("")}</div>` +
      (fg?.parts?.some(p => p.score != null) ? `<div class="card"><div class="b ac">😱 공포·탐욕 지수는 이 7가지로 만들어져요</div><div class="sub">각 0(극단적 공포) ~ 100(극단적 탐욕) · 7개 평균이 위 점수</div>` +
        fg.parts.map(p => { const s = p.score == null ? 0 : p.score < 25 ? 2 : p.score < 45 ? 1 : p.score >= 75 ? -1 : 0;
          return `<div style="padding:8px 0"><div class="between"><span class="b small">${p.name}</span><span class="b small" style="color:${sigColor(s)}">${p.score == null ? "—" : Math.round(p.score)} ${Sig.fgKo(p.rating)}</span></div><div class="bar"><div style="width:${p.score ?? 50}%;background:${s ? sigColor(s) : "var(--accent)"}"></div></div><div class="sub" style="margin-top:3px">${p.desc}</div></div>`; }).join("") + `<div class="between sub"><span>공포</span><span>탐욕</span></div></div>` : "") +
      `<div class="card"><div class="b ac">📘 공포·탐욕 지수 구간별 투자 관점</div>` + bands.map(([k, v, s], i) => `<div class="row" style="padding:6px 8px;border-radius:8px;${i === bi ? "background:var(--card2)" : ""}"><b style="width:64px;color:${sigColor(s)}">${k}</b><span class="${i === bi ? "b" : "muted"}">${v}${i === bi ? "  ◀ 지금" : ""}</span></div>`).join("") +
      `<div class="b ac" style="margin-top:12px">📉 하락 단계별 대응 (지수)</div>${["평균 낙폭: S&P500 -14.1% (1993~2026) · 나스닥(QQQ) -20.2% (1999~2026)", "-14% 이상 → 주식 매수 시작 (금·채권 같은 안전자산 일부 팔아서)", "-30% 이상 → 비중 확대", "-47% 이상 → 2008년급 극단 하락. -50%까지 염두에 두고 분할 매수 설계"].map(t => `<div class="small" style="margin-top:4px">• ${t}</div>`).join("")}</div>
      <div class="card"><div class="b ac">💡 이렇게 쓰세요</div>${["하나만 보지 말고 겹치는 순간을 기다리세요: 1개면 주목, 2개면 매수 준비, 3개 이상이면 비중을 크게.", "공포가 극에 달했을 때 준비된 사람이 움직여요 — 뉴스는 온통 부정적이고 주변은 다 팔라고 할 때가 보통 그 순간이에요.", "레버리지 ETF는 바닥 신호에서도 더 크게 빠질 수 있어요. 신호는 '본주·지수 ETF 분할 매수' 기준이에요."].map(t => `<div class="small" style="margin-top:4px">• ${t}</div>`).join("")}
      <a class="link" target="_blank" href="https://edition.cnn.com/markets/fear-and-greed">CNN 공포·탐욕 지수 원본 보기 ›</a></div>`;
  };
  drawMain();
  renderHistory($("#sigHist"), sym, label).then(() => { if (!fg) drawMain(); });
}

// ───────────── 설정 ─────────────
function renderSettings() {
  setHeader("⚙️ 설정", true);
  $("#app").innerHTML = `<div class="card"><div class="b">🤖 AI 뉴스 요약 (Gemini)</div>
      <div class="sub" style="margin:6px 0">무료 키를 넣으면 종목마다 최근 뉴스를 AI가 한국어로 요약해줘요. 키는 이 아이폰에만 저장되고 다른 곳으로 보내지 않아요.<br>
      키 발급(무료): <a target="_blank" href="https://aistudio.google.com/apikey">https://aistudio.google.com/apikey</a> → Create API key → 복사</div>
      <div class="sub b" style="margin-top:8px">무료 키</div><input id="kFree" placeholder="AIza… 로 시작하는 키" value="${esc(LS.get("gemFree", ""))}">
      <div class="sub b" style="margin-top:10px">유료 키 (선택)</div><input id="kPaid" placeholder="없으면 비워두세요" value="${esc(LS.get("gemPaid", ""))}">
      <div class="sub" style="margin-top:6px">무료 사용량을 다 쓰면, 유료 키가 있을 때만 <b>예상 금액을 먼저 보여주고 확인을 받은 뒤</b> 써요. 지금까지 유료 사용: 약 ${Math.round(LS.get("gemSpent", 0))}원</div>
      <button class="btn" id="kSave" style="margin-top:10px">저장</button></div>
    <div class="card"><div class="b">아이폰 홈 화면에 추가하기</div><div class="sub" style="margin-top:6px">사파리 아래쪽 공유 버튼(□↑) → "홈 화면에 추가" → 추가. 이후엔 앱처럼 전체 화면으로 열려요.</div></div>
    <div class="card"><div class="b">데이터</div><div class="sub" style="margin-top:6px">섹터·관심·메모는 이 아이폰(사파리)에만 저장돼요. 사파리 방문 기록을 지우면 같이 지워질 수 있어요.</div>
      <button class="btn ghost" id="resetBtn" style="margin-top:10px">섹터를 기본값으로 초기화</button></div>
    <div class="card sub">StockRadar 웹 · 안드로이드 앱과 같은 기준 · 데이터는 약 20분마다 갱신 (실시간 아님) · 시세 Yahoo Finance, 뉴스 Google News, 공포·탐욕 CNN</div>`;
  $("#kSave").onclick = () => { LS.set("gemFree", $("#kFree").value.trim()); LS.set("gemPaid", $("#kPaid").value.trim()); toast("저장했어요"); };
  $("#resetBtn").onclick = () => { if (confirm("섹터와 종목 목록을 기본값으로 되돌릴까요? (관심·메모는 유지)")) { S.sectors = JSON.parse(JSON.stringify(CATALOG)); S.deleted.clear(); S.save(); toast("초기화했어요"); go(""); } };
}

// ───────────── 시작 ─────────────
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
  await loadCatalog();
  if (!location.hash) { const last = LS.get("lastHash", ""); if (last && last !== "#/") { location.hash = last; return; } }
  render();
})();
document.addEventListener("visibilitychange", () => { if (!document.hidden && route().name === "home") refreshQuotes(false); });
