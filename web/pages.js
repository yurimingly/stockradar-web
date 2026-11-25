"use strict";
// StockRadar 웹 — 안드로이드 앱과 같은 화면들 (홈 탭·대가별·상세 분석·비교·발굴·서학개미·뉴스·S&P 500·사전·대가·섹터 관리)

// ───────────── 공통 데이터 ─────────────
let STATIC = { glossary: [], gurus: [], stories: {}, rulesTable: {}, rules: {}, etfKnown: {}, crowd: {}, screens: [], expertFeeds: [] };
let MET = {};            // 종목별 원시 지표 (data/metrics.json)
let RATE = 1400;         // 원/달러
const SUMS = {};         // 상세 지표 캐시
async function loadStatic() {
  try { STATIC = await (await fetch("static.json", { cache: "no-cache" })).json(); } catch (e) { }
  MET = (await data("metrics.json", 600_000)) || {};
}
async function refreshMetrics() { const m = await data("metrics.json", 600_000); if (m) MET = { ...MET, ...m }; }

const f1 = v => fmt(v, 1), f2 = v => fmt(v, 2), f0 = v => fmt(v, 0);
const pct1 = v => v == null || isNaN(v) ? "—" : (v * 100).toFixed(1) + "%";
const pctStr = v => pct(v, 2);
const GOOD = "#22C55E", AMB = "#E0A526", ORG = "#F97316", NEU = "#6B7088", YEL = "#F5B83D";
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const usdOf = (sym, v) => isKr(sym) ? v / (RATE || 1400) : v;
const bigUsd = v => v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(1) + "M";
const krwBig = w => Math.abs(w) >= 1e12 ? (w / 1e12).toFixed(1) + "조원" : Math.abs(w) >= 1e8 ? Math.round(w / 1e8).toLocaleString() + "억원" : Math.round(w).toLocaleString() + "원";
const capUsd = sym => { const c = Q[sym]?.cap; return c > 0 ? usdOf(sym, c) : MET[sym]?.capUsd ?? null; };
const turnoverUsd = sym => { const q = Q[sym]; return q?.vol > 0 && q.price ? usdOf(sym, q.vol * q.price) : null; };
const monthPct = q => q?.sp?.length >= 2 && q.sp[0] > 0 ? (q.price / q.sp[0] - 1) * 100 : null;
const sectorOf = sym => S.sectors.find(s => s.stocks.some(x => x.t === sym))?.name || "";
const sectorIdx = sym => S.sectors.findIndex(s => s.stocks.some(x => x.t === sym));
const GLOSS = label => STATIC.glossary.find(t => t.label === label);
const innov = sec => /양자|AI|반도체|생명|바이오|우주|원자력|로봇|보안|혁신|핀테크|디지털자산|에너지|ESS/.test(sec);

// 탭하면 설명창 (어디서나 data-pop="번호")
const POP = [];
function popRef(title, text) { POP.push([title, text]); return POP.length - 1; }
function popup(title, text) {
  sheet(`<div class="b" style="font-size:17px">${esc(title)}</div><div class="small" style="white-space:pre-wrap;line-height:1.55;margin-top:10px">${esc(text)}</div>
    <button class="btn" style="margin-top:14px" id="popOk">확인</button>`, el => $("#popOk", el).onclick = closeSheet);
}
document.addEventListener("click", e => {
  const p = e.target.closest("[data-pop]"); if (p) { e.stopPropagation(); const [t, x] = POP[+p.dataset.pop] || []; if (t) popup(t, x); return; }
  const o = e.target.closest("[data-open]"); if (o) { e.stopPropagation(); openTicker(o.dataset.open, o.dataset.name); return; }
  const u = e.target.closest("[data-url]"); if (u) { e.stopPropagation(); window.open(u.dataset.url, "_blank"); }
}, true);
function openTicker(sym, name) {
  if (!allStocks().has(sym) && name) TMP_NAMES[sym] = name;
  go("s/" + encodeURIComponent(sym));
}
const TMP_NAMES = {};

function chipsHtml(items, sel, attr) {
  return `<div class="chips">${items.map(([id, label]) => `<button class="chip ${id === sel ? "on" : ""}" data-${attr}="${id}">${esc(label)}</button>`).join("")}</div>`;
}
function bindChips(root, attr, fn) { root.querySelectorAll(`[data-${attr}]`).forEach(b => b.onclick = () => fn(isNaN(+b.dataset[attr]) ? b.dataset[attr] : +b.dataset[attr])); }
const note = t => `<div class="sub" style="padding:4px 4px 8px">${t}</div>`;
const newsCard = (n, tag) => `<a class="news card" style="display:block;margin-bottom:6px" target="_blank" href="${esc(n.link)}">${tag ? `<div class="small b ac" style="margin-bottom:3px">${esc(tag)}</div>` : ""}<div class="t">${esc(n.title)}</div><div class="m">${[n.src, n.time ? ago(n.time) : ""].filter(Boolean).join(" · ")}</div></a>`;

// ───────────── 지표 값 ─────────────
function divYield(sym) {
  const q = Q[sym], r = MET[sym];
  if (q?.divRate > 0 && q.price > 0) return q.divRate / q.price;
  if (q?.divTrail > 0) return q.divTrail;
  const p = q?.price ?? r?.price;
  if (r?.drate > 0 && p > 0) return r.drate / p;
  return r?.dy ?? (q || r ? 0 : null);
}
function growthPct(r) {
  if (r.eps > 0 && r.feps > 0) return (r.feps / r.eps - 1) * 100;
  return r.eg != null ? r.eg * 100 : null;
}
function metricValue(sym, key) {
  if (key === "m1") { const m = monthPct(Q[sym]); return m == null ? null : m / 100; }
  if (key === "dy") return divYield(sym);
  const r = MET[sym]; if (!r) return null;
  if (key === "aum") return r.aum != null ? r.aum / 1e9 : null;
  if (key === "peg") {
    if (r.peg > 0) return r.peg;
    const g = growthPct(r); return r.pe > 0 && g > 0 ? r.pe / g : null;
  }
  return r[key] ?? null;
}
function peers(sym) {
  const sec = S.sectors.find(s => s.stocks.some(x => x.t === sym)); if (!sec) return [];
  const all = sec.stocks.filter(x => !x.etf), same = all.filter(x => isKr(x.t) === isKr(sym));
  return same.filter(x => MET[x.t]).length >= 3 ? same : all;
}
const peerValues = (sym, key, posOnly = true) => peers(sym).map(p => MET[p.t]?.[key]).filter(v => v != null && (!posOnly || v > 0) && (key !== "pe" || v < 1000));

// ───────────── 지표 해석 (안드로이드와 같은 문구) ─────────────
const LABEL_KEY = { "시가총액": "capUsd", "PER": "pe", "선행 PER": "fpe", "PEG": "peg", "PBR": "pb", "PSR": "psr", "EV/EBITDA": "evebitda", "EPS (주당순이익)": "eps",
  "이익수익률 (EPS ÷ 주가)": "ey", "매출 성장률 (전년 대비)": "rg", "이익 성장률 (전년 대비)": "eg", "매출총이익률": "gm", "영업이익률": "om", "순이익률": "pm",
  "ROE (자기자본이익률)": "roe", "ROA (총자산이익률)": "roa", "부채비율 (부채/자본)": "de", "유동비율": "cr", "당좌비율": "qr", "FCF 수익률": "fcfy",
  "배당수익률": "dy", "배당성향": "payout", "베타 (시장 대비 변동성)": "beta" };
function interpret(key, r, sym) {
  const kr = isKr(sym), mkt = kr ? 11 : 20, mktName = kr ? "한국" : "미국";
  const v = key === "peg" ? metricValue(sym, "peg") : key === "dy" ? divYield(sym) : r[key];
  if (v == null || isNaN(v)) return null;
  const sec = sectorOf(sym), x = d => f1(d) + "배";
  const vsSector = (k, fm) => { const ps = peerValues(sym, k, !["rg", "eg"].includes(k)); const m = ps.length >= 3 ? median(ps) : null; if (m == null) return ""; const d = (v / m - 1) * 100; return `\n· ${sec} 중앙값(${fm(m)})보다 ${f1(Math.abs(d))}% ${d >= 0 ? "높아요" : "낮아요"}.`; };
  const vsMarket = () => `\n· ${mktName} 시장 평균(약 ${mkt}배)의 ${f1(v / mkt)}배 수준이에요.`;
  const band = (b, last) => { for (const [lim, t, c] of b) if (v < lim) return [t, c]; return last; };
  const I = (tag, color, text) => ({ tag, color, text });
  switch (key) {
    case "pe": {
      const [t, c] = band([[10, "매우 낮음", GOOD], [15, "낮음", GOOD], [25, "보통", NEU], [40, "높음", AMB], [100, "매우 높음", ORG]], ["극단적", ORG]);
      const desc = v < 10 ? "이익에 비해 주가가 많이 싸요. 진짜 저평가일 수도 있고, 시장이 앞으로 이익이 줄 거라 보는 것일 수도 있어요." : v < 15 ? "이익 대비 싼 편이에요." : v < 25 ? "시장 평균 수준이에요."
        : v < 40 ? "앞으로 이익이 빠르게 늘 거라는 기대가 주가에 반영돼 있어요." : v < 100 ? "높은 성장 기대가 반영돼 있어요. 실적이 기대에 못 미치면 주가가 크게 흔들릴 수 있어요." : "지금 이익이 매우 작아서 PER이 튀는 상태예요. 이럴 땐 PER보다 선행 PER·PSR로 보는 게 맞아요.";
      const fp = r.fpe > 0 ? r.fpe : null;
      const fN = fp ? (fp < v ? `\n· 선행 PER(${x(fp)})이 더 낮아요 → 앞으로 1년 이익이 지금의 약 ${f1(v / fp)}배로 늘 것으로 예상돼요.` : `\n· 선행 PER(${x(fp)})이 더 높아요 → 앞으로 이익이 줄 것으로 예상돼요.`) : "";
      return I(t, c, `지금 이익이 그대로라면 시가총액만큼 벌기까지 약 ${f0(v)}년 걸리는 가격이에요.\n· ${desc}` + vsMarket() + vsSector("pe", x) + fN);
    }
    case "fpe": {
      const [t, c] = band([[10, "매우 낮음", GOOD], [15, "낮음", GOOD], [25, "보통", NEU], [40, "높음", AMB]], ["매우 높음", ORG]);
      const p = r.pe > 0 ? r.pe : null;
      const g = p ? ((p / v - 1) * 100 >= 0 ? `\n· 현재 PER ${x(p)} → 선행 ${x(v)}: 앞으로 1년 이익이 약 ${f0((p / v - 1) * 100)}% 늘어난다는 예상이 깔려 있어요.` : `\n· 현재 PER ${x(p)} → 선행 ${x(v)}: 앞으로 1년 이익이 약 ${f0(-(p / v - 1) * 100)}% 줄어든다는 예상이에요.`)
        : r.eps != null && r.eps <= 0 ? "\n· 지금은 적자인데 내년엔 흑자가 예상돼서 선행 PER만 계산돼요." : "";
      return I(t, c, `애널리스트들이 예상한 '앞으로 12개월 이익' 기준으로, 이익의 ${x(v)} 가격이에요.` + g + `\n· 피터 린치 기준으로는 이익이 연 ${f0(v)}% 정도씩 몇 년 늘어야 이 가격이 적정(PEG 1)해져요.` + vsMarket() + vsSector("fpe", x) + "\n· 예상치는 자주 바뀌어요. 실적이 예상보다 나쁘면 선행 PER이 다시 올라가요.");
    }
    case "peg": { const [t, c] = band([[1, "성장 대비 쌈", GOOD], [2, "적정", NEU]], ["성장 대비 비쌈", AMB]); return I(t, c, `PER이 이익 성장률의 ${f2(v)}배예요. 1 이하면 성장 속도에 비해 싸고, 2를 넘으면 비싸다고 봐요.`); }
    case "pb": {
      const [t, c] = band([[1, "장부가 이하", GOOD], [3, "보통", NEU], [10, "높음", AMB]], ["매우 높음", ORG]);
      const desc = v < 1 ? "회사를 청산하고 남는 순자산보다도 싸게 거래돼요. 자산 대비 저평가이거나, 수익성이 나빠 시장이 할인하는 상태예요." : v < 3 ? "자산 대비 보통 수준이에요." : "공장·현금 같은 장부 자산보다 기술·브랜드·플랫폼처럼 눈에 안 보이는 가치를 훨씬 높게 쳐주고 있어요.";
      let rn = ""; if (r.roe > 0) { const fair = r.roe / 0.10; rn = `\n· 돈을 잘 버는 회사일수록 PBR이 높아도 돼요. 대략 'PBR ≈ ROE ÷ 10%'로 보는데, ROE ${pct1(r.roe)} 기준 약 ${x(fair)}이 설명되는 수준이에요 → ` + (v > fair * 1.5 ? "지금은 그보다 꽤 비싸요." : v < fair * 0.7 ? "지금은 그보다 싸요." : "지금 PBR과 비슷해요."); }
      return I(t, c, `회사의 순자산(자산 − 부채)의 ${x(v)} 가격이에요.\n· ${desc}` + rn + vsSector("pb", x));
    }
    case "psr": {
      const [t, c] = band([[1, "매우 낮음", GOOD], [3, "보통", NEU], [10, "높음", AMB], [30, "매우 높음", ORG]], ["극단적", ORG]);
      return I(t, c, `1년 매출의 ${x(v)} 가격이에요. 이익이 적거나 적자인 성장주를 볼 때 유용해요.` + (r.pm > 0 ? `\n· 순이익률 ${pct1(r.pm)} 기준으로 PER로 바꾸면 약 ${x(v / r.pm)}이에요.` : "") + (v >= 10 ? "\n· 이 가격을 정당화하려면 매출이 앞으로 몇 년간 매우 빠르게 늘어야 해요." : "") + vsSector("psr", x));
    }
    case "evebitda": { const [t, c] = band([[8, "낮음", GOOD], [15, "보통", NEU], [25, "높음", AMB]], ["매우 높음", ORG]); return I(t, c, `빚까지 포함해 회사를 통째로 사면, 지금의 현금성 이익으로 약 ${f0(v)}년이 걸려 회수하는 가격이에요.` + vsSector("evebitda", x)); }
    case "eps": {
      const f = r.feps;
      const tail = v > 0 && f > 0 ? `\n· 앞으로 1년 예상 EPS ${money(f, sym)} (${pctStr((f / v - 1) * 100)})` : v <= 0 && f > 0 ? `\n· 앞으로 1년은 흑자 전환(EPS ${money(f, sym)})이 예상돼요.` : "";
      return v > 0 ? I("흑자", GOOD, `주식 1주가 최근 1년 동안 ${money(v, sym)}를 벌었어요. PER = 주가 ÷ 이 값이에요.${tail}`) : I("적자", ORG, `주식 1주당 최근 1년 동안 ${money(-v, sym)} 손실이 났어요. 그래서 PER은 계산되지 않아요.${tail}`);
    }
    case "ey": {
      const bond = kr ? 0.03 : 0.04, [t, c] = v <= 0 ? ["적자", ORG] : v >= 0.08 ? ["높음", GOOD] : v >= bond ? ["보통", NEU] : ["낮음", AMB];
      return I(t, c, `이 주식을 사면 이익 기준으로 연 ${pct1(v)}를 버는 셈이에요 (PER ${x(1 / v)}을 뒤집은 값).\n· ${kr ? "한국" : "미국"} 국채 금리(대략 ${pct1(bond)} 안팎)보다 ` + (v > bond ? "높아서 이익 대비로는 주식이 나쁘지 않은 편이에요." : "낮아서, 지금 이익만 보면 채권보다 매력이 적어요. 대신 이익 성장에 기대를 거는 가격이에요."));
    }
    case "rg": case "eg": {
      const what = key === "rg" ? "매출" : "순이익", [t, c] = v < 0 ? ["역성장", ORG] : v < 0.1 ? ["완만", NEU] : v < 0.25 ? ["양호", GOOD] : v < 0.5 ? ["고성장", GOOD] : ["초고성장", GOOD];
      return I(t, c, `최근 분기 ${what}이 1년 전 같은 분기보다 ${pctStr(v * 100)} 변했어요.` + (key === "eg" && v > 1 ? "\n· 작년 이익이 작았거나 일회성 요인이 있으면 이렇게 크게 튈 수 있어요." : "") + vsSector(key, pct1));
    }
    case "gm": { const [t, c] = v < 0.2 ? ["낮음", AMB] : v < 0.4 ? ["보통", NEU] : v < 0.6 ? ["높음", GOOD] : ["매우 높음", GOOD]; return I(t, c, `100원어치 팔면 원가를 빼고 ${f0(v * 100)}원이 남아요. 높을수록 가격 결정력(경쟁력)이 있다는 뜻이에요.`); }
    case "om": case "pm": {
      const what = key === "om" ? "본업(영업)으로" : "세금·이자까지 다 내고 최종적으로", [t, c] = v < 0 ? ["적자", ORG] : v < 0.05 ? ["낮음", AMB] : v < 0.15 ? ["보통", NEU] : v < 0.3 ? ["우수", GOOD] : ["매우 우수", GOOD];
      return I(t, c, `100원어치 팔아서 ${what} ${f1(v * 100)}원을 남겨요.` + (key === "om" ? vsSector("om", pct1) : ""));
    }
    case "roe": {
      const [t, c] = v < 0 ? ["적자", ORG] : v < 0.05 ? ["낮음", AMB] : v < 0.10 ? ["보통", NEU] : v < 0.15 ? ["양호", NEU] : v < 0.25 ? ["우수", GOOD] : ["매우 우수", GOOD];
      return I(t, c, `주주가 맡긴 돈 100원으로 1년에 ${f1(v * 100)}원을 벌었어요. 버핏은 15% 이상을 꾸준히 내는 회사를 좋아했어요.` + (r.de > 100 && v > 0.15 ? `\n· 다만 부채비율이 ${f0(r.de)}%라 빚 덕분에 ROE가 부풀려졌을 수 있어요.` : "") + vsSector("roe", pct1));
    }
    case "roa": { const [t, c] = v < 0 ? ["적자", ORG] : v < 0.02 ? ["낮음", AMB] : v < 0.05 ? ["보통", NEU] : v < 0.10 ? ["양호", GOOD] : ["우수", GOOD]; return I(t, c, `빚을 포함한 회사 전체 자산 100원으로 1년에 ${f1(v * 100)}원을 벌었어요.`); }
    case "de": { const [t, c] = v <= 50 ? ["탄탄", GOOD] : v <= 100 ? ["보통", NEU] : v <= 200 ? ["높음", AMB] : ["매우 높음", ORG]; return I(t, c, `자기자본 100원당 이자 내는 빚이 ${f0(v)}원 있어요. 금리가 높을 때나 실적이 나빠질 때 부담이 커져요.`); }
    case "cr": case "qr": {
      const [t, c] = key === "cr" ? (v < 1 ? ["빠듯", ORG] : v < 1.5 ? ["보통 이하", AMB] : v < 2 ? ["보통", NEU] : ["여유", GOOD]) : v < 1 ? ["빠듯", AMB] : ["여유", GOOD];
      return I(t, c, `1년 안에 갚아야 할 빚 100원당 ${key === "qr" ? "재고를 빼고 " : ""}바로 현금으로 바꿀 수 있는 자산이 ${f0(v * 100)}원 있어요.`);
    }
    case "fcfy": { const [t, c] = v < 0 ? ["현금 소진", ORG] : v < 0.02 ? ["낮음", AMB] : v < 0.05 ? ["보통", NEU] : ["높음", GOOD]; return I(t, c, `주가 100원당 회사가 1년에 ${f1(v * 100)}원의 '진짜 남는 현금'을 만들어요.` + (v < 0 ? " 지금은 버는 것보다 쓰는 현금이 많아요." : "")); }
    case "dy": {
      const [t, c] = v <= 0 ? ["배당 없음", NEU] : v < 0.02 ? ["낮음", NEU] : v < 0.04 ? ["보통", GOOD] : v < 0.08 ? ["높음", GOOD] : ["매우 높음(주의)", AMB];
      return I(t, c, v <= 0 ? "배당을 주지 않고 번 돈을 성장에 재투자하는 회사예요." : `1,000만원어치 사면 1년에 배당으로 약 ${f0(1e7 * v)}원(세전)을 받아요.` + (v >= 0.08 ? "\n· 주가가 크게 떨어져서 수익률이 높아 보이는 '배당 함정'일 수 있어요." : ""));
    }
    case "payout": { const [t, c] = v <= 0.6 ? ["안정", GOOD] : v <= 0.8 ? ["주의", AMB] : v <= 1 ? ["빠듯", ORG] : ["위험", ORG]; return I(t, c, `번 돈 100원 중 ${f0(v * 100)}원을 배당으로 나눠줘요.` + (v > 1 ? " 번 돈보다 많이 주고 있어서 배당이 줄어들 위험이 있어요." : "")); }
    case "beta": { const [t, c] = v < 0.8 ? ["덜 출렁임", GOOD] : v < 1.2 ? ["시장과 비슷", NEU] : v < 2 ? ["더 출렁임", AMB] : ["매우 큼", ORG]; return I(t, c, `시장(S&P500)이 10% 움직일 때 이 종목은 평균 약 ${f0(v * 10)}% 움직였어요.`); }
    case "capUsd": { const [t, c] = v >= 200e9 ? ["초대형주", NEU] : v >= 10e9 ? ["대형주", NEU] : v >= 2e9 ? ["중형주", NEU] : ["소형주", AMB]; return I(t, c, v < 2e9 ? "규모가 작아 성장 여지도 크지만, 주가 변동과 위험도 커요." : `규모 기준 ${t} 이에요.`); }
  }
  return null;
}
function statRow(label, value, sym, raw) {
  const g = GLOSS(label), key = LABEL_KEY[label], ip = key ? interpret(key, raw, sym) : null;
  const msg = `현재 값: ${value}\n` + (ip ? `\n📍 이 종목은 → ${ip.tag}\n${ip.text}\n` : "") + (g ? `\n📖 어떤 지표?\n${g.long}` : "");
  return `<div class="stat" ${g || ip ? `data-pop="${popRef(label, msg)}"` : ""}><div class="between"><span class="small">${esc(label)}${g ? " ⓘ" : ""}</span>
    <span style="text-align:right"><b>${esc(value)}</b>${ip ? `<br><span class="badge" style="background:${ip.color}">${esc(ip.tag)}</span>` : ""}</span></div>${g ? `<div class="sub">${esc(g.short)}</div>` : ""}</div>`;
}

// ───────────── 투자 대가 평가 ─────────────
function guruEval(g, r, sym, innovative) {
  const q = Q[sym];
  const { eps, pm, pe, pb, fpe, eg, rg, de, roe, om, gm, fcf, fcfy, cr, evebitda: eve } = r;
  const x1 = v => v.toFixed(1);
  const chk = (label, v, show, test) => [label, v == null ? "데이터 없음" : show(v), v == null ? null : test(v)];
  const profitable = eps != null ? eps > 0 : pm != null ? pm > 0 : null, loss = profitable === false;
  const profit = ["흑자 기업", profitable === true ? "흑자" : profitable === false ? "적자" : "데이터 없음", profitable];
  const peMax = l => loss ? [`PER ≤ ${l}`, "적자라 PER 없음", false] : chk(`PER ≤ ${l}`, pe, x1, v => v <= l);
  const fpeMax = l => fpe == null && loss ? [`선행 PER ≤ ${l}`, "적자 예상", false] : chk(`선행 PER ≤ ${l}`, fpe, x1, v => v >= 0 && v <= l);
  const deMax = l => chk(`부채비율 ≤ ${l}%`, de, v => x1(v) + "%", v => v <= l);
  const mn = (lab, v, p) => chk(`${lab} ≥ ${p}%`, v, pct1, x => x >= p / 100);
  const fcfPlus = chk("잉여현금흐름 플러스", fcf, v => v > 0 ? "플러스" : "마이너스", v => v > 0);
  const fromHigh = q?.high52 > 0 ? q.price / q.high52 - 1 : null;
  const month = monthPct(q); const up1m = chk("최근 1개월 상승", month == null ? null : month / 100, pct1, v => v > 0);
  let checks = [];
  switch (g.id) {
    case "buffett": checks = [profit, chk("순이익률 ≥ 15%", pm, pct1, v => v >= 0.15), mn("ROE", roe, 15), deMax(50), fcfPlus, peMax(25)]; break;
    case "munger": checks = [mn("ROE", roe, 20), mn("영업이익률", om, 20), mn("매출총이익률", gm, 40), deMax(50), profit, peMax(35)]; break;
    case "graham": checks = [peMax(15), chk("PBR ≤ 1.5", pb, x1, v => v <= 1.5),
      pe != null && pb != null ? chk("PER × PBR ≤ 22.5", pe * pb, x1, v => v <= 22.5) : ["PER × PBR ≤ 22.5", loss ? "적자" : "데이터 없음", loss ? false : null],
      chk("유동비율 ≥ 2", cr, x1, v => v >= 2), profit]; break;
    case "lynch": {
      const peg = r.peg > 0 ? r.peg : pe != null && eg > 0 ? pe / (eg * 100) : null;
      const pc = loss ? ["PEG ≤ 1", "적자라 계산 불가", false] : peg == null && eg != null && eg <= 0 ? ["PEG ≤ 1", "이익 감소", false] : chk("PEG ≤ 1", peg, x1, v => v <= 1);
      checks = [pc, chk("이익 성장률 15~50%", eg, pct1, v => v >= 0.15 && v <= 0.5), deMax(80), profit]; break;
    }
    case "pfisher": checks = [mn("매출 성장률", rg, 15), mn("영업이익률", om, 15), mn("매출총이익률", gm, 50), chk("이익 증가 중", eg, pct1, v => v > 0), chk("내부자 보유 ≥ 3%", r.insider, pct1, v => v >= 0.03)]; break;
    case "wood": checks = [["혁신 테마 (AI·유전체·우주·양자 등)", innovative ? "해당" : "해당 없음", innovative], mn("매출 성장률", rg, 25), mn("매출총이익률", gm, 50),
      chk("성장 여지 (시총 ≤ 2,000억 달러)", r.capUsd ?? r.cap, v => "$" + (v / 1e9).toFixed(1) + "B", v => v <= 200e9)]; break;
    case "oneil": checks = [mn("이익 성장률", eg, 25), mn("매출 성장률", rg, 25), chk("52주 최고가 대비 -15% 이내", fromHigh, pct1, v => v >= -0.15), up1m, mn("ROE", roe, 17)]; break;
    case "greenblatt": checks = [loss ? ["이익수익률 ≥ 6%", "적자", false] : chk("이익수익률 ≥ 6%", r.ey, pct1, v => v >= 0.06), mn("ROE", roe, 20), chk("EV/EBITDA ≤ 12", eve, x1, v => v >= 0 && v <= 12), profit]; break;
    case "templeton": checks = [chk("52주 최고가 대비 -30% 이상 하락", fromHigh, pct1, v => v <= -0.30), fpeMax(15), deMax(100), profit]; break;
    case "burry": checks = [chk("FCF 수익률 ≥ 8%", fcfy, pct1, v => v >= 0.08), chk("EV/EBITDA ≤ 8", eve, x1, v => v >= 0 && v <= 8), chk("PBR ≤ 1.5", pb, x1, v => v <= 1.5), deMax(100)]; break;
  }
  const pass = checks.filter(c => c[2] === true).length, total = checks.filter(c => c[2] != null).length, ratio = total ? pass / total : 0;
  return { g, checks, pass, total, ratio, verdict: total < 3 ? "데이터 부족" : ratio >= 0.75 ? "잘 맞음" : ratio >= 0.5 ? "일부 맞음" : "안 맞음" };
}
const verdictColor = r => r.verdict === "잘 맞음" ? GOOD : r.verdict === "일부 맞음" ? YEL : r.verdict === "안 맞음" ? "#9AA0B4" : "var(--sub)";
function consensus(sym, sec, raw) {
  const rs = STATIC.gurus.map(g => guruEval(g, raw, sym, innov(sec))).filter(r => r.total >= 3);
  return { sym, sec, fits: rs.filter(r => r.verdict === "잘 맞음").map(r => r.g.name), rated: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.ratio, 0) / rs.length : 0 };
}
function guruCardHtml(r) {
  return `<div class="card fold"><div class="between"><b style="font-size:15px">${esc(r.g.name)}</b><span class="badge" style="background:${verdictColor(r)}">${r.total < 3 ? r.verdict : `${r.pass}/${r.total} · ${r.verdict}`}</span></div>
    <div class="small b ac" style="margin-top:4px">${esc(r.g.style)}</div>
    <div class="more hidden"><div class="sub" style="margin:6px 0">${esc(r.g.idea)}</div>${r.checks.map(([l, v, ok]) => `<div class="between small" style="padding:4px 0"><span>${ok === true ? "✅" : ok === false ? "❌" : "➖"} ${esc(l)}</span><b class="${ok == null ? "muted" : ""}">${esc(v)}</b></div>`).join("")}</div>
    <div class="small ac tg" style="margin-top:4px">기준 자세히 보기 ▾</div></div>`;
}
function bindFolds(root) {
  root.querySelectorAll(".fold").forEach(c => c.onclick = e => { if (e.target.closest("a,button,[data-open]")) return; const m = $(".more", c); m.classList.toggle("hidden"); const t = $(".tg", c); if (t) t.textContent = m.classList.contains("hidden") ? (t.dataset.c || "기준 자세히 보기 ▾") : "접기 ▴"; });
}

// ───────────── 적정 PER ─────────────
function valuationRows(r, secPe, mPe, kr) {
  const eps = r.eps; if (!(eps > 0)) return [];
  const out = [], g = growthPct(r);
  if (secPe != null) out.push(["섹터 중앙값 PER 적용", secPe, eps * secPe, "같은 섹터 종목들의 PER 중간값을 이 회사 이익에 적용"]);
  out.push(["시장 평균 PER 적용", mPe, eps * mPe, kr ? `한국 시장 평균 수준(약 ${mPe}배)을 적용` : "미국 대형주 평균 수준(약 20배)을 적용"]);
  if (g > 0) {
    const lp = Math.min(50, Math.max(5, g)); out.push(["피터 린치 (PEG = 1)", lp, eps * lp, `적정 PER ≈ 이익 성장률. 예상 성장률 ${f1(g)}% 기준 (최대 50배로 제한)`]);
    const gg = Math.min(25, Math.max(0, g)), gp = 8.5 + 2 * gg; out.push(["그레이엄 공식", gp, eps * gp, "EPS × (8.5 + 2 × 성장률). 성장률은 최대 25%로 제한"]);
  }
  return out;
}
function valuationHtml(sym, r) {
  const price = Q[sym]?.price || r.price || 0, { pe, fpe, eps } = r, kr = isKr(sym);
  const pp = peerValues(sym, "pe"), secPe = pp.length >= 3 ? median(pp) : null, sec = sectorOf(sym);
  const line = (k, v, c = "") => `<div class="kv"><span class="k">${esc(k)}</span><span class="v ${c}">${v}</span></div>`;
  const loss = (eps != null && eps <= 0) || r.pm < 0;
  let h = "";
  if (loss || pe == null || eps == null) {
    h += `<div class="small">${loss ? "적자 기업이라 PER로는 평가할 수 없어요. 대신 매출 대비 가격(PSR)으로 비교해요." : "이익(EPS) 데이터를 받지 못해 PER을 계산할 수 없어요. 대신 매출 대비 가격(PSR)으로 비교해요."}</div>`;
    const ps = peerValues(sym, "psr"), sp = ps.length >= 3 ? median(ps) : null;
    h += line("이 종목 PSR", r.psr != null ? f1(r.psr) + "배" : "—");
    if (sec) h += line(sec + " PSR 중앙값", sp != null ? `${f1(sp)}배 (${ps.length}개)` : "데이터 부족");
    if (r.psr != null && sp) { const d = (r.psr / sp - 1) * 100; h += `<div class="b small ${d > 0 ? "r" : "g"}" style="margin-top:6px">섹터 중앙값보다 ${f1(Math.abs(d))}% ${d > 0 ? "비싸게" : "싸게"} 거래 중</div>`; }
    if (fpe > 0) h += line(loss ? "선행 PER (내년 흑자 예상 기준)" : "선행 PER", f1(fpe) + "배");
  } else {
    h += line("현재 PER", f1(pe) + "배"); if (fpe > 0) h += line("선행 PER", f1(fpe) + "배");
    if (sec) h += line(sec + " PER 중앙값", secPe != null ? `${f1(secPe)}배 (${pp.length}개)` : "데이터 부족");
    h += line(kr ? "한국 시장 평균 (참고)" : "미국 시장 평균 (참고)", kr ? "약 11배" : "약 20배");
    const g = growthPct(r); if (g != null) h += line("예상 이익 성장률", pctStr(g));
    if (secPe) { const d = (pe / secPe - 1) * 100; h += `<div class="b small ${d > 0 ? "r" : "g"}" style="margin-top:6px">같은 섹터보다 PER이 ${f1(Math.abs(d))}% ${d > 0 ? "높아요 (상대적으로 비쌈)" : "낮아요 (상대적으로 쌈)"}</div>`; }
    const rows = valuationRows(r, secPe, kr ? 11 : 20, kr);
    if (rows.length) h += `<div class="b ac small" style="margin:14px 0 2px">방법별 적정 주가 (EPS ${money(eps, sym)} 기준)</div>` + rows.map(([l, p, fp, n]) => { const up = price > 0 ? (fp / price - 1) * 100 : 0;
      return `<div style="padding:6px 0"><div class="between small"><span>${esc(l)} · ${f1(p)}배</span><b class="${cls(up)}">${money(fp, sym)} (${pctStr(up)})</b></div><div class="sub">${esc(n)}</div></div>`; }).join("");
  }
  const gl = GLOSS("적정 PER 가이드");
  h += `<div class="sub" style="margin-top:10px" ${gl ? `data-pop="${popRef(gl.label, gl.long)}"` : ""}>PER은 업종·성장률마다 적정 수준이 달라요. 위 값은 단순 공식 계산이라 참고만 하세요. (탭하면 가이드)</div>`;
  const si = sectorIdx(sym);
  if (si >= 0) h += `<a class="link" href="#/compare/${si}/${eps > 0 ? 0 : 4}">⚖️ ${esc(sec)} 종목들과 비교하기 →</a>`;
  return h;
}

// ───────────── 가치평가 지표 (섹터 비교 타일·상위 종목·과거 추이) ─────────────
function keyMetricHint(sym, r) {
  const st = findStock(sym), sec = sectorOf(sym) + " " + st.ko + " " + (st.desc || "");
  const loss = r.eps <= 0 || r.pm < 0;
  if (loss) return ["PSR · EV/매출을 먼저 보세요", "아직 적자라 PER·PEG는 의미가 없어요. 매출 대비 가격(PSR)과 매출 성장률, 그리고 보유 현금으로 몇 년 버틸 수 있는지가 핵심이에요."];
  if (/금융|은행|보험|지주|Bank|KB|신한/.test(sec)) return ["PBR + ROE를 먼저 보세요", "은행·보험은 자산(돈)이 곧 사업이라 PBR이 기본이에요. ROE가 높을수록 높은 PBR이 정당화돼요 (적정 PBR ≈ ROE ÷ 10%). EV/EBITDA·FCF는 금융사엔 잘 안 맞아요."];
  if (/반도체|메모리|에너지|석유|화학|철강|해운|자동차|원자력·전력/.test(sec)) return ["PBR과 '과거 평균 PER'을 함께 보세요", "경기를 타는 업종은 호황 정점에서 이익이 커서 PER이 오히려 낮아 보이고, 불황엔 PER이 높아 보여요. 그래서 PBR과 몇 년 평균 이익 기준 PER(아래 과거 추이)을 같이 봐야 해요." + (r.pe != null && r.fpe > r.pe * 1.3 ? " 지금은 선행 PER이 현재보다 높아 이익 감소가 예상되는 구간이에요." : "")];
  if (/리츠|REIT|부동산/.test(sec)) return ["배당수익률과 P/FFO를 보세요", "리츠는 감가상각이 커서 PER이 왜곡돼요. 배당수익률과 FFO(영업현금) 대비 가격이 기본이에요."];
  if ((r.rg ?? 0) >= 0.25) return ["PEG · PSR을 함께 보세요", "빠르게 크는 회사는 PER이 높게 나오는 게 정상이에요. 성장률 대비 PER(PEG)과 매출 대비 가격(PSR)으로 '성장에 비해 비싼지'를 보세요."];
  return ["PER · EV/EBITDA · FCF 수익률을 보세요", "꾸준히 돈을 버는 회사라 이익 대비 가격(PER)이 기본이에요. 빚까지 반영한 EV/EBITDA와 실제 현금 창출력(FCF 수익률)으로 확인하면 더 정확해요."];
}
const VALUE_GUIDE = "• PER, PBR, PSR은 주가가 회사의 이익·자산·매출에 비해 비싼지 싼지 보는 지표예요. 같은 업종끼리 비교할 때 가장 의미가 있어요.\n   - PER(주가수익비율) = 주가 ÷ EPS(주당순이익)\n   - PBR(주가순자산비율) = 주가 ÷ BPS(주당순자산)\n   - PSR(주가매출비율) = 주가 ÷ SPS(주당매출)\n\n• 아래 줄의 보완 지표도 함께 보세요:\n   - EV/EBITDA: 빚까지 포함한 몸값 ÷ 현금성 이익 (회사를 통째로 사는 가격)\n   - PEG: PER ÷ 이익 성장률 (성장 대비 비싼지)\n   - FCF 수익률: 잉여현금흐름 ÷ 시가총액 (실제로 남는 현금, 높을수록 좋음)\n• 업종마다 맞는 지표가 달라요. 은행·보험은 PBR+ROE, 적자 성장주는 PSR, 경기순환주는 PBR과 과거 평균 PER, 꾸준한 우량주는 PER·EV/EBITDA·FCF가 기본이에요 (🔑 표시 참고).\n\n• 이익·매출은 최근 4개 분기 합계(TTM) 기준이에요.\n\n• PER이 '적자'면 최근 1년 순이익이 마이너스라는 뜻이라, PER로는 싼지 판단할 수 없어요. 이럴 땐 PSR로 비교해요.\n\n• 섹터 중앙값은 이 앱의 같은 섹터 종목들(같은 나라 종목이 3개 이상이면 같은 나라끼리) 값의 중간값이에요. 평균보다 극단값에 덜 흔들려요.\n\n• 과거 추이는 각 연도 결산일 무렵의 주가와 그해 연간 실적으로 계산해요.\n\n• 시세는 약 20분마다, 재무 지표는 12시간마다 갱신돼요.\n\n• 출처: Yahoo Finance (시세·재무), 계산: StockRadar\n\n⚠️ 투자 유의: 이 정보는 판단을 돕는 참고용이며 투자 권유가 아니에요. 데이터의 정확성을 보장하지 않으며, 투자 결정과 책임은 본인에게 있어요.";
function valueMetricsHtml(sym, r) {
  const sec = sectorOf(sym), hasPeers = !!sec, ps = peers(sym);
  let h = `<div class="between"><span class="sub">${hasPeers ? `${esc(sec)} 섹터${ps.every(p => isKr(p.t) === isKr(sym)) ? (isKr(sym) ? "(한국)" : "(미국)") : ""} 중앙값과 비교` : "내 섹터에 없는 종목이라 섹터 비교는 없어요"}</span>
    <span class="small b ac" data-pop="${popRef("가치평가 지표 안내", VALUE_GUIDE)}">ⓘ 지표 안내</span></div>`;
  const hint = keyMetricHint(sym, r);
  if (hint) h += `<div class="card2" style="margin-top:8px"><div class="b small" style="color:${YEL}">🔑 ${esc(hint[0])}</div><div class="small" style="margin-top:3px;line-height:1.45">${esc(hint[1])}</div></div>`;
  const tiles = specs => `<div class="tiles">${specs.map(([name, key, lowerBetter]) => {
    const isPct = key === "fcfy", v = key === "peg" ? metricValue(sym, "peg") : r[key];
    const pv = !hasPeers ? [] : key === "peg" ? ps.map(p => metricValue(p.t, "peg")).filter(x => x > 0) : peerValues(sym, key, lowerBetter);
    const med = pv.length >= 3 ? median(pv) : null;
    const fv = x => isPct ? pct1(x) : key === "peg" ? f2(x) : f1(x) + "배";
    const ip = LABEL_KEY[name] ? interpret(LABEL_KEY[name], r, sym) : null;
    let cmp = "";
    if (v != null && med) {
      if (isPct) { const d = (v - med) * 100; cmp = `<div class="small b" style="color:${d >= 0 ? GOOD : ORG}">${d >= 0 ? "▲ " + f1(d) + "%p 좋음" : "▼ " + f1(-d) + "%p 낮음"}</div>`; }
      else { const d = (v / med - 1) * 100; cmp = `<div class="small b" style="color:${d >= 0 ? ORG : GOOD}">${d >= 0 ? "▲ " + f0(d) + "% 비쌈" : "▼ " + f0(-d) + "% 쌈"}</div>`; }
    }
    return `<div class="tile" ${ip ? `data-pop="${popRef(name, `현재 값: ${v != null ? fv(v) : "—"}\n\n📍 ${ip.tag}\n${ip.text}`)}"` : ""}><div class="sub b">${name}</div>
      <div class="b" style="font-size:17px;margin-top:2px">${v == null && key === "pe" && r.eps < 0 ? "적자" : v == null ? "—" : fv(v)}</div>${hasPeers ? `<div class="sub">섹터 ${med != null ? fv(med) : "—"}</div>` : ""}${cmp}</div>`;
  }).join("")}</div>`;
  h += tiles([["PER", "pe", true], ["PBR", "pb", true], ["PSR", "psr", true]]) + tiles([["EV/EBITDA", "evebitda", true], ["PEG", "peg", true], ["FCF 수익률", "fcfy", false]]);
  let top = [...ps].sort((a, b) => (capUsd(b.t) ?? -1) - (capUsd(a.t) ?? -1)).slice(0, 5);
  if (!top.some(p => p.t === sym)) top = [...top.slice(0, 4), findStock(sym)];
  if (top.length >= 2) {
    const fx = (m, k) => m?.[k] > 0 ? f1(m[k]) : k === "pe" && m?.eps < 0 ? "적자" : "—";
    const mm = k => { const v = median(peerValues(sym, k)); return v == null ? "—" : f1(v); };
    h += `<div class="b ac small" style="margin:14px 0 4px">섹터 시가총액 상위 종목</div><table class="mini"><tr><th>종목</th><th>시총</th><th>PER</th><th>PBR</th><th>PSR</th></tr>` +
      top.map(p => { const m = MET[p.t], me = p.t === sym, c = capUsd(p.t);
        return `<tr class="${me ? "me" : ""}" ${me ? "" : `data-open="${esc(p.t)}"`}><td>${esc(p.ko)}</td><td>${c ? bigUsd(c) : "—"}</td><td>${fx(m, "pe")}</td><td>${fx(m, "pb")}</td><td>${fx(m, "psr")}</td></tr>`; }).join("") +
      `<tr class="med"><td>섹터 중앙값</td><td></td><td>${mm("pe")}</td><td>${mm("pb")}</td><td>${mm("psr")}</td></tr></table>`;
  }
  h += `<div class="b ac small" style="margin:14px 0 4px">과거 추이 (연말 기준)</div><div id="vhBox" class="sub">불러오는 중…</div>`;
  return h;
}
async function fillHistoryVals(sym, r) {
  const box = $("#vhBox"); if (!box) return;
  const rows = await data(`vh/${fname(sym)}.json`, 3600_000);
  if (!rows?.length) { box.textContent = isKr(sym) || allStocks().has(sym) ? "과거 재무 데이터가 없어요" : "목록에 있는 종목만 과거 추이를 계산해요"; return; }
  const fv = v => v == null ? "—" : f1(v);
  let h = `<table class="mini"><tr><th>연도</th><th>PER</th><th>PBR</th><th>PSR</th></tr>` + rows.map(([y, pe, pb, ps]) => `<tr><td>${y}</td><td>${pe == null ? "적자" : f1(pe)}</td><td>${fv(pb)}</td><td>${fv(ps)}</td></tr>`).join("") +
    `<tr class="me"><td>지금</td><td>${fv(r.pe)}</td><td>${fv(r.pb)}</td><td>${fv(r.psr)}</td></tr></table>`;
  const pers = rows.map(x => x[1]).filter(v => v != null);
  if (pers.length >= 2 && r.pe != null) { const avg = pers.reduce((a, b) => a + b, 0) / pers.length;
    h += `<div class="small b" style="margin-top:6px;color:${r.pe >= avg ? ORG : GOOD}">과거 ${pers.length}년 평균 PER ${f1(avg)}배 → 지금은 평균보다 ${f0(Math.abs(r.pe / avg - 1) * 100)}% ${r.pe >= avg ? "높아요" : "낮아요"}</div>`; }
  box.className = ""; box.innerHTML = h;
}

// ───────────── 배당 분석 ─────────────
function dividendHtml(sym, r, st) {
  const q = Q[sym], price = q?.price ?? r.price ?? 0, dy = divYield(sym) ?? 0;
  const rate = r.drate ?? q?.divRate ?? (dy > 0 ? dy * price : null);
  const isDivSec = sectorOf(sym).includes("배당");
  if (dy <= 0 && !(rate > 0)) return isDivSec ? `<div class="sub">현재 배당을 주지 않거나 배당 데이터가 없어요.</div>` : "";
  const gp = g => { const t = GLOSS(g); return t ? `data-pop="${popRef(t.label, t.long)}"` : ""; };
  const line = (k, v, color, g) => `<div class="kv" ${g ? gp(g) : ""}><span class="k">${esc(k)}${g ? " ⓘ" : ""}</span><span class="v" style="${color ? "color:" + color : ""}">${esc(v)}</span></div>`;
  let h = `<div class="b" style="font-size:22px;color:${GOOD}">배당수익률 ${pct1(dy)}</div>`;
  if (rate > 0) h += line("연 배당금 (1주당)", money(rate, sym) + (!isKr(sym) ? ` (약 ${f0(rate * RATE)}원)` : ""));
  h += `<div class="sub" style="margin:2px 0 6px">1,000만원 투자 시 연 배당 약 ${f0(1e7 * dy)}원 (세전 · ${isKr(sym) ? "국내 배당소득세 15.4%" : "미국 주식은 보통 15% 원천징수"})</div>`;
  let score = 0, total = 0;
  if (r.dy5 > 0) { const d = (dy / r.dy5 - 1) * 100; h += line("5년 평균 배당수익률", pct1(r.dy5) + (d >= 0 ? ` (지금이 ${f1(d)}% 높음)` : ` (지금이 ${f1(-d)}% 낮음)`), null, "5년 평균 배당수익률"); }
  if (r.payout > 0) { total++; const p = r.payout; const [t, c] = p <= 0.6 ? (score++, ["안정", GOOD]) : p <= 0.8 ? ["주의", YEL] : p <= 1 ? ["빠듯", ORG] : ["위험 (번 돈보다 많이 줌)", "var(--red)"]; h += line("배당성향", `${pct1(p)} · ${t}`, c, "배당성향"); }
  if (!st.etf && r.fcf != null && r.cap > 0 && price > 0 && rate > 0) { total++; const cov = r.fcf / (rate * r.cap / price);
    const [t, c] = cov >= 1.5 ? (score++, ["여유", GOOD]) : cov >= 1 ? ["빠듯", YEL] : ["현금 부족", "var(--red)"]; h += line("FCF 배당 커버리지", `${f1(cov)}배 · ${t}`, c, "FCF 배당 커버리지"); }
  if (r.de != null) { total++; if (r.de <= 100) score++; h += line("부채비율", f1(r.de) + "%" + (r.de <= 100 ? " · 양호" : " · 높음"), r.de <= 100 ? null : YEL); }
  if (dy >= 0.08) h += `<div class="small" style="color:${YEL};margin-top:6px">⚠️ 배당수익률이 8% 이상이에요. 주가 급락으로 수익률이 높아 보이는 '배당 함정'일 수 있으니 배당성향·현금흐름을 꼭 같이 보세요.</div>`;
  const df = ms => { const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
  if (r.exdiv > 0) { const ms = r.exdiv * 1000, fu = ms > Date.now(); h += line(fu ? "다음 배당락일" : "최근 배당락일", df(ms) + (fu ? " (전날까지 매수)" : ""), null, "배당락일"); }
  if (r.divdate > 0) h += line("배당 지급일", df(r.divdate * 1000));
  if (total >= 2) { const [v, c] = score === total ? ["배당 안정성 높음", GOOD] : score * 2 >= total ? ["배당 안정성 보통", YEL] : ["배당 지속성 주의", ORG]; h += `<div class="b" style="color:${c};margin-top:8px">종합: ${v} (${score}/${total})</div>`; }
  return h + `<div class="sub" style="margin-top:6px">ADR(해외 기업)은 본국 원천징수 세율이 달라 실수령액이 달라질 수 있어요.</div>`;
}

// ───────────── ETF 보유 종목 ─────────────
function holdingsOf(sym, sm) {
  const list = (sm?.holdings || []).map(([s, n, p]) => ({ sym: s, name: n, pct: p, key: (s || n).split(".")[0] }));
  if (list.length) return { list, src: sm.holdSrc };
  const k = STATIC.etfKnown[sym]; if (!k) return { list: [] };
  return { list: k.items.map(([s, n, p]) => ({ sym: s, name: n, pct: p, key: s || n })), snap: k };
}
const holdingName = h => [...allStocks().values()].find(s => s.t.split(".")[0] === h.key && h.key)?.ko || h.name;
function holdingTarget(h) {
  const known = [...allStocks().values()].find(s => s.t.split(".")[0] === h.key && h.key);
  if (known) return known.t;
  if (h.sym.includes(".") || /^[A-Z]+$/.test(h.sym)) return h.sym;
  if (/^[0-9A-Z]{6}$/.test(h.sym)) return h.sym + ".KS";
  return "";
}
function holdingsHtml(sym, sm, max = 10) {
  const { list, snap, src } = holdingsOf(sym, sm);
  const link = isKr(sym) ? ["네이버 증권에서 전체 구성 종목 보기 ›", `https://finance.naver.com/item/main.naver?code=${sym.split(".")[0]}`] : ["Yahoo에서 전체 보유 종목 보기 ›", `https://finance.yahoo.com/quote/${sym}/holdings`];
  if (!list.length) return `<div class="sub">구성 종목을 가져오지 못했어요 (데이터 제공처에 정보가 없거나 연결 실패)</div><a class="link" target="_blank" href="${link[1]}">${link[0]}</a>`;
  const top = [...list].sort((a, b) => b.pct - a.pct).slice(0, max), mx = Math.max(...top.map(h => h.pct)) || 1, sum = top.reduce((a, h) => a + h.pct, 0);
  return top.map(h => { const tg = holdingTarget(h); return `<div style="padding:5px 0" ${tg ? `data-open="${esc(tg)}" data-name="${esc(holdingName(h))}"` : ""}><div class="between"><span class="b small">${esc(holdingName(h))}</span><span class="small">${h.sym && h.sym !== holdingName(h) ? `<span class="muted">${esc(h.sym.split(".")[0])}</span> ` : ""}<b class="ac">${(h.pct * 100).toFixed(1)}%</b></span></div><div class="bar"><div style="width:${Math.max(2, h.pct / mx * 100)}%;background:var(--accent)"></div></div></div>`; }).join("") +
    `<div class="sub b" style="margin-top:6px">상위 ${top.length}개 합계 ${(sum * 100).toFixed(1)}%${sum >= .6 ? " · 소수 종목에 집중된 편" : sum < .35 ? " · 넓게 분산된 편" : ""}</div>` +
    (snap ? `<div class="sub" style="margin-top:4px">기준 ${esc(snap.asOf)} · 출처 ${esc(snap.source)}${snap.note ? "<br>" + esc(snap.note) : ""}<br>※ 실시간 수집에 실패해 공개 자료로 보여주는 중이에요. 비중은 매일 바뀌어요.</div>` : src ? `<div class="sub" style="margin-top:4px">출처: ${esc(src)} (자동 수집)</div>` : "");
}

// ───────────── 지표 받아오기 (미리 받아둔 파일 → 없으면 직접) ─────────────
async function getSummary(sym) {
  if (SUMS[sym]) return SUMS[sym];
  let s = await data(`s/${fname(sym)}.json`, 3600_000);
  if (!s || !s.stats) s = await liveSummary(sym);
  if (s) { SUMS[sym] = s; if (s.raw && Object.keys(s.raw).length) MET[sym] = { ...(MET[sym] || {}), ...s.raw }; }
  return s;
}
async function liveSummary(sym) {
  const etf = findStock(sym).etf;
  try {
    const mods = etf ? "price,summaryDetail,defaultKeyStatistics,fundProfile,topHoldings,fundPerformance,assetProfile" : "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile";
    const j = await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}`);
    return parseSummary(j.quoteSummary.result[0], sym, etf || j.quoteSummary.result[0]?.price?.quoteType === "ETF");
  } catch (e) { return null; }
}
function parseSummary(res, sym, etf) {
  const R = (o, k) => { const v = o?.[k]; const x = v && typeof v === "object" ? v.raw : v; return typeof x === "number" && isFinite(x) ? x : null; };
  const F = (o, k) => o?.[k]?.fmt || null;
  const kr = isKr(sym), pr = res.price || {}, sd = res.summaryDetail || {}, ks = res.defaultKeyStatistics || {}, fd = res.financialData || {}, ap = res.assetProfile || {}, ce = res.calendarEvents || {};
  const stats = [], prof = [], raw = {}, holdings = []; let g = "";
  const add = (l, v) => { if (v != null && v !== "") stats.push([g, l, v]); };
  const put = (k, v) => { if (v != null && isFinite(v)) raw[k] = v; };
  const price = Q[sym]?.price || R(pr, "regularMarketPrice") || 0;
  const cash = v => kr ? Math.round(v).toLocaleString() + "원" : "$" + f2(v);
  const bigS = v => kr ? krwBig(v) : bigUsd(v) + ` (약 ${krwBig(v * RATE)})`;
  if (!etf) {
    const cap = R(pr, "marketCap"), eps = R(ks, "trailingEps"), pe = R(sd, "trailingPE") || (eps > 0 && price > 0 ? price / eps : null);
    let pb = R(ks, "priceToBook"); if (pb != null && (pb < 0.05 || pb > 300)) pb = null;
    const fcf = R(fd, "freeCashflow"), rev = R(fd, "totalRevenue");
    const ey = eps != null && price > 0 ? eps / price : pe ? 1 / pe : null, fcfy = fcf != null && cap ? fcf / cap : null;
    put("pe", pe); put("fpe", R(sd, "forwardPE") ?? R(ks, "forwardPE")); put("pb", pb); put("peg", R(ks, "pegRatio") ?? R(ks, "trailingPegRatio"));
    put("psr", R(sd, "priceToSalesTrailing12Months")); put("evebitda", R(ks, "enterpriseToEbitda")); put("roe", R(fd, "returnOnEquity")); put("roa", R(fd, "returnOnAssets"));
    put("de", R(fd, "debtToEquity")); put("cr", R(fd, "currentRatio")); put("qr", R(fd, "quickRatio")); put("fcf", fcf); put("fcfy", fcfy); put("ey", ey);
    put("pm", R(fd, "profitMargins")); put("gm", R(fd, "grossMargins")); put("om", R(fd, "operatingMargins")); put("rg", R(fd, "revenueGrowth")); put("eg", R(fd, "earningsGrowth"));
    put("cap", cap); put("capUsd", cap ? usdOf(sym, cap) : null); put("eps", eps); put("dy", R(sd, "dividendYield")); put("payout", R(sd, "payoutRatio"));
    put("insider", R(ks, "heldPercentInsiders")); put("beta", R(sd, "beta")); put("feps", R(ks, "forwardEps")); put("drate", R(sd, "dividendRate"));
    const d5 = R(sd, "fiveYearAvgDividendYield"); put("dy5", d5 != null ? d5 / 100 : null); put("exdiv", R(sd, "exDividendDate")); put("price", price || null);
    g = "💰 가격 수준 (밸류에이션)"; add("시가총액", cap ? bigS(cap) : null); add("PER", pe ? f2(pe) : eps < 0 ? "적자 (계산 불가)" : null); add("선행 PER", F(sd, "forwardPE") || F(ks, "forwardPE"));
    add("PEG", raw.peg != null ? f2(raw.peg) : null); add("PBR", pb ? f2(pb) : null); add("PSR", F(sd, "priceToSalesTrailing12Months")); add("EV/EBITDA", F(ks, "enterpriseToEbitda")); add("EV/매출", F(ks, "enterpriseToRevenue"));
    g = "🧾 이익 (주당 지표)"; add("EPS (주당순이익)", eps != null ? cash(eps) : null); add("선행 EPS", raw.feps != null ? cash(raw.feps) : null); add("이익수익률 (EPS ÷ 주가)", ey != null ? pct1(ey) : null); add("BPS (주당순자산)", R(ks, "bookValue") != null ? cash(R(ks, "bookValue")) : null);
    g = "📈 성장성"; add("매출 (최근 12개월)", rev ? bigS(rev) : null); add("매출 성장률 (전년 대비)", F(fd, "revenueGrowth")); add("이익 성장률 (전년 대비)", F(fd, "earningsGrowth"));
    g = "🏭 수익성"; add("매출총이익률", F(fd, "grossMargins")); add("영업이익률", F(fd, "operatingMargins")); add("순이익률", raw.pm != null ? pct1(raw.pm) : null); add("ROE (자기자본이익률)", raw.roe != null ? pct1(raw.roe) : null); add("ROA (총자산이익률)", F(fd, "returnOnAssets"));
    g = "🏦 재무 건전성"; add("부채비율 (부채/자본)", raw.de != null ? f1(raw.de) + "%" : null); add("유동비율", F(fd, "currentRatio")); add("당좌비율", F(fd, "quickRatio")); add("보유 현금", R(fd, "totalCash") ? bigS(R(fd, "totalCash")) : null); add("총부채", R(fd, "totalDebt") ? bigS(R(fd, "totalDebt")) : null); add("잉여현금흐름", fcf != null ? bigS(fcf) : null); add("FCF 수익률", fcfy != null ? pct1(fcfy) : null);
    g = "💵 주주환원"; add("배당수익률", F(sd, "dividendYield") || "배당 없음"); add("배당성향", raw.payout > 0 ? pct1(raw.payout) : null); add("연 배당금 (1주당)", raw.drate > 0 ? cash(raw.drate) : null); add("5년 평균 배당수익률", d5 != null ? f2(d5) + "%" : null);
    g = "👥 수급·변동성"; add("베타 (시장 대비 변동성)", F(sd, "beta")); add("공매도 비율 (유통주식 대비)", F(ks, "shortPercentOfFloat")); add("내부자 보유", F(ks, "heldPercentInsiders")); add("기관 보유", F(ks, "heldPercentInstitutions"));
    g = "🎯 애널리스트 전망"; const tg = R(fd, "targetMeanPrice"); if (tg && price > 0) add("애널리스트 평균 목표가", cash(tg) + ` (${pctStr((tg / price - 1) * 100)})`);
    const rk = fd.recommendationKey; if (rk && rk !== "none") add("투자의견 컨센서스", ({ strong_buy: "적극 매수", buy: "매수", hold: "보유 (중립)", underperform: "비중 축소", sell: "매도" })[rk] || rk);
    add("다음 실적 발표 (예정)", ce.earnings?.earningsDate?.[0]?.fmt);
  } else {
    const tr = res.fundPerformance?.trailingReturns || {}, fe = res.fundProfile?.feesExpensesInvestment || {}, ta = R(sd, "totalAssets");
    put("dy", R(sd, "yield")); put("ytd", R(tr, "ytd")); put("r1y", R(tr, "oneYear")); put("r3y", R(tr, "threeYear")); put("r5y", R(tr, "fiveYear")); put("er", R(fe, "annualReportExpenseRatio")); put("aum", ta ? usdOf(sym, ta) : null); put("price", price || null);
    g = "📈 ETF 수익률"; [["연초 대비 수익률", "ytd"], ["1년 수익률", "oneYear"], ["3년 연평균 수익률", "threeYear"], ["5년 연평균 수익률", "fiveYear"]].forEach(([l, k]) => { const v = R(tr, k); add(l, v != null ? pctStr(v * 100) : null); });
    g = "🧺 ETF 정보"; add("운용자산", ta ? bigS(ta) : null); add("분배금 수익률", F(sd, "yield")); add("총보수 (연)", F(fe, "annualReportExpenseRatio")); add("운용사", res.fundProfile?.family); add("베타 (3년)", F(ks, "beta3Year"));
    (res.topHoldings?.holdings || []).forEach(h => { const p = R(h, "holdingPercent"); if (p != null) holdings.push([h.symbol || "", h.holdingName || h.symbol || "", p]); });
  }
  [["섹터", ap.sector], ["업종", ap.industry], ["국가", ap.country], ["직원 수", ap.fullTimeEmployees ? ap.fullTimeEmployees.toLocaleString() + "명" : null], ["웹사이트", ap.website]].forEach(([k, v]) => v && prof.push([k, v]));
  if (ap.country) raw.us = ap.country === "United States" ? 1 : 0;
  return { stats, prof, about: (ap.longBusinessSummary || "").slice(0, 2500), raw, holdings, industry: [ap.sector, ap.industry].filter(Boolean).join(" ") };
}

// ───────────── 섹터 자동 분류 · 한글 검색 (Gemini 무료 키) ─────────────
async function geminiJson(prompt, schema, temp = 0) {
  const key = LS.get("gemFree", ""); if (!key) return null;
  for (const m of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: temp, responseMimeType: "application/json", responseSchema: schema } }) });
      if (r.ok) { const j = await r.json(); const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(""); return JSON.parse(t); }
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) { }
  }
  return null;
}
async function aiLookup(q) {
  const out = await geminiJson(`한국 사람이 한글로 부른 회사 또는 ETF 이름: "${q}"\n미국(NYSE·NASDAQ) 또는 한국(코스피·코스닥)에 상장된 해당 기업·ETF의 티커와 정식 회사명을 최대 3개까지 줘. 한국 종목 티커는 6자리 코드에 코스피면 .KS, 코스닥이면 .KQ를 붙여 (예: 005930.KS). 한국 종목의 name은 영문 회사명으로. 비슷한 발음의 다른 회사도 후보로 넣어도 돼. 모르면 영문 회사명만 추측해서 넣고 ticker는 빈 문자열로.`,
    { type: "ARRAY", items: { type: "OBJECT", properties: { ticker: { type: "STRING" }, name: { type: "STRING" } }, required: ["ticker", "name"] } }, 0.1);
  return Array.isArray(out) ? out.map(o => [String(o.ticker || "").trim().toUpperCase(), String(o.name || "").trim()]) : [];
}
const SECTOR_RULES = [["레버리지·인버스 ETF", /2x|3x|ultra|leveraged|bull|bear|inverse|short|레버리지|인버스/], ["양자컴퓨팅", /quantum|양자/], ["사이버보안", /security|cyber|보안/],
  ["AI·반도체", /semiconductor|반도체/], ["AI 소프트웨어", /software|internet content|information technology services/], ["생명과학", /biotech|drug|pharma|medical|diagnostic|health|바이오|제약/],
  ["우주항공", /space|satellite|우주|항공/], ["방산·드론", /aerospace|defense|방산|drone/], ["원자력·전력", /utilit|uranium|nuclear|electrical equipment|power|원자력|전력/],
  ["클린에너지·ESS", /solar|renewable|battery|batteries|배터리|에너지/], ["로봇·자율주행", /robot|automation|auto manufacturers|로봇/], ["화장품·뷰티", /personal products|household|cosmetic|beauty|화장품/],
  ["핀테크·디지털자산", /credit services|capital markets|crypto|fintech|payment/], ["고배당", /tobacco|telecom|reit|bank|oil & gas|insurance/]];
async function suggestSector(sym, name, etf) {
  const d = CATALOG.find(c => c.stocks.some(x => x.t === sym)); if (d) { const i = S.sectors.findIndex(s => s.name === d.name); if (i >= 0) return i; }
  const sm = await getSummary(sym), industry = sm?.industry || "";
  const names = S.sectors.map(s => s.name);
  const ai = await geminiJson(`주식 종목을 아래 섹터 중 가장 알맞은 하나로 분류해. 회사의 핵심 사업 기준으로.\n섹터 목록: ${[...names, "기타"].join(", ")}\n종목: ${name} (${sym})${industry ? "\n업종: " + industry : ""}\nETF는 지수·테마에 맞는 섹터로 (레버리지·인버스면 레버리지 섹터). 맞는 게 없으면 '기타'.`,
    { type: "OBJECT", properties: { sector: { type: "STRING", enum: [...names, "기타"] } }, required: ["sector"] });
  if (ai?.sector && names.includes(ai.sector)) return names.indexOf(ai.sector);
  const text = `${industry} ${name}`.toLowerCase();
  if (etf) { const n = SECTOR_RULES[0][1].test(text) ? "레버리지·인버스 ETF" : "대표 ETF"; const i = names.indexOf(n); if (i >= 0) return i; }
  for (const [n, re] of SECTOR_RULES) if (re.test(text)) { const i = names.indexOf(n); if (i >= 0) return i; }
  let i = names.indexOf("기타"); if (i < 0) { S.sectors.push({ name: "기타", emoji: "📁", stocks: [] }); i = S.sectors.length - 1; }
  return i;
}

// ═════════════ 홈 ═════════════
const SORT_NAMES = ["기본순", "상승률순", "하락률순", "시가총액순", "거래 활발순 🔥", "뉴스 많은 순 📰"];
const H = { tab: LS.get("tab", -1), sort: LS.get("sortMode", 0), pctMode: LS.get("pctMode", 0), guru: LS.get("guruSel", -1) };
const saveH = () => { LS.set("tab", H.tab); LS.set("sortMode", H.sort); LS.set("pctMode", H.pctMode); LS.set("guruSel", H.guru); };
const shownPct = q => H.pctMode === 0 ? q.pct : monthPct(q) ?? 0;
function visible() {
  let items;
  if (H.tab === -2) items = S.sectors.flatMap(s => s.stocks.map(st => [st, s.name])).filter(([st]) => S.favs.has(st.t));
  else if (H.tab >= 0) items = (S.sectors[H.tab]?.stocks || []).map(st => [st, ""]);
  else items = S.sectors.flatMap(s => s.stocks.map(st => [st, s.name]));
  items = items.filter(([st], i, a) => a.findIndex(([x]) => x.t === st.t) === i);
  const k = H.sort, val = ([st]) => { const q = Q[st.t];
    return k === 1 || k === 2 ? (q ? shownPct(q) : null) : k === 3 ? capUsd(st.t) : k === 4 ? turnoverUsd(st.t) : k === 5 ? MET[st.t]?.news48 : null; };
  if (k > 0) items.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return k === 2 ? x - y : y - x; });
  return items;
}
function baseLabel(qs) {
  const t = Math.max(0, ...qs.map(q => q.time || 0)); if (!t) return "";
  const allKr = qs.every(q => q._kr), mkt = allKr ? "한국장" : "미국장";
  const day = new Date(t * 1000).toLocaleDateString("ko-KR", { timeZone: allKr ? "Asia/Seoul" : "America/New_York", month: "numeric", day: "numeric", weekday: "short" }).replace(/\. /g, "/").replace(".", "");
  const cnt = {}; qs.filter(q => allKr || !q._kr).forEach(q => q.state && (cnt[q.state] = (cnt[q.state] || 0) + 1));
  const state = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  if (state === "REGULAR") return `🟢 ${mkt} 장중 · 약 20분 지연`;
  if (state.startsWith("PRE")) return `🟡 프리마켓 중 · 등락률은 ${day} 정규장 기준`;
  if (state.startsWith("POST")) return `🟣 애프터마켓 · ${day} 정규장 종가 기준`;
  return Date.now() - t * 1000 < 40 * 60_000 ? `🟢 ${mkt} 장중` : `⚪ ${mkt} 휴장 · ${day} 종가 기준`;
}
function extLine(q) {
  if (!q || !q.state) return null;
  if (q.state.startsWith("PRE") && q.pre) return [`프리 ${pct(q.prePct)}`, cls(q.prePct)];
  if ((q.state.startsWith("POST") || q.state === "CLOSED") && q.post) return [`애프터 ${pct(q.postPct)}`, cls(q.postPct)];
  return null;
}
function spark(sp, color) {
  if (!sp || sp.length < 2) return `<svg class="spark"></svg>`;
  const lo = Math.min(...sp), hi = Math.max(...sp), W = 64, Hh = 30;
  const pts = sp.map((v, i) => `${(i / (sp.length - 1) * W).toFixed(1)},${(2 + (1 - (v - lo) / (hi - lo || 1)) * (Hh - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${Hh}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}
function homeRow(st, secName, badge, badgeColor, badge2) {
  const q = Q[st.t];
  if (!badge && H.tab !== -3) {
    if (H.sort === 3) { const c = capUsd(st.t); if (c) [badge, badgeColor] = ["시총 " + bigUsd(c) + (isKr(st.t) && q?.cap ? ` (${krwBig(q.cap)})` : ""), "var(--accent)"]; }
    else if (H.sort === 4) { const v = turnoverUsd(st.t); if (v) [badge, badgeColor] = ["거래대금 " + bigUsd(v), ORG]; }
    else if (H.sort === 5) { const n = MET[st.t]?.news48; if (n != null) [badge, badgeColor] = [`최근 48시간 뉴스 ${n}건`, YEL]; }
    else if (sectorOf(st.t).includes("배당") && H.tab !== -1) { const d = divYield(st.t); if (d > 0) [badge, badgeColor] = ["배당 " + pct1(d), GOOD]; }
  }
  const sp = shownPct(q || {}), mp = monthPct(q), ex = extLine(q);
  return `<div class="srow" data-sym="${esc(st.t)}">
    <div class="grow" style="min-width:0"><div class="nm">${esc(st.t)}${S.favs.has(st.t) ? " ★" : ""}</div><div class="tk">${esc(st.ko)}${secName ? " · " + esc(secName) : ""}</div>
      ${badge ? `<div class="small b ell" style="color:${badgeColor};margin-top:2px">${esc(badge)}</div>` : ""}${badge2 ? `<div class="sub ell2" style="margin-top:2px">${esc(badge2)}</div>` : ""}</div>
    ${spark(q?.sp, mp == null ? "#8B8FA3" : mp >= 0 ? "#22C55E" : "#EF4444")}
    <div style="width:92px;text-align:right;flex:none"><div class="b">${q ? money(q.price, st.t) : "—"}</div>
      ${q ? `<span class="pill" data-tg="1" style="background:${sp >= 0 ? "var(--green)" : "var(--red)"}">${pct(sp)}</span>` : ""}${ex ? `<div class="small b ${ex[1]}" style="margin-top:3px">${ex[0]}</div>` : ""}</div></div>`;
}
function renderHome(quotesOnly, force) {
  setHeader("StockRadar", false);
  if (H.tab >= S.sectors.length) H.tab = -1;
  const tabs = [[-2, "★ 관심"], [-3, "🧠 대가별"], [-1, "📋 전체"], ...S.sectors.map((s, i) => [i, `${s.emoji} ${s.name}`])];
  let html = `<div class="chips" id="tabChips">${tabs.map(([i, l]) => `<button class="chip ${i === H.tab ? "on" : ""}" data-tab="${i}">${esc(l)}</button>`).join("")}</div>`;
  if (H.tab === -3) html += guruTabHtml();
  else {
    const items = visible(), qs = items.map(([st]) => Q[st.t] && { ...Q[st.t], _kr: isKr(st.t) }).filter(Boolean);
    let sum = items.length ? "시세 불러오는 중…" : "", sc = "muted";
    if (qs.length) {
      const ps = qs.map(shownPct), avg = ps.reduce((a, b) => a + b, 0) / ps.length;
      const divs = H.tab >= 0 && S.sectors[H.tab].name.includes("배당") ? items.map(([st]) => divYield(st.t)).filter(d => d > 0) : [];
      sum = `${baseLabel(qs)} · ${H.pctMode === 0 ? "전일 대비" : "최근 1개월"} ⇄<br>평균 ${pct(avg)} · 상승 ${ps.filter(p => p > 0).length} 하락 ${ps.filter(p => p < 0).length}${divs.length ? ` · 평균 배당 ${pct1(divs.reduce((a, b) => a + b, 0) / divs.length)}` : ""}`;
      sc = cls(avg);
    }
    html += econBannerHtml() + xBannerHtml();
    html += `<div class="between" style="margin:8px 2px"><div class="small b ${sc}" id="sumLine" style="line-height:1.45">${sum}</div><button class="chip sm" id="sortBtn">${SORT_NAMES[H.sort]} ⇅</button></div>`;
    if (H.tab === -2 && !items.length) html += `<div class="sub" style="text-align:center;padding:50px 16px;font-size:14px">관심 종목이 아직 없어요.<br><br>종목을 길게 누르거나, 상세 화면의 ☆를 눌러 추가하세요.</div>`;
    const kr = items.filter(([st]) => isKr(st.t)), us = items.filter(([st]) => !isKr(st.t));
    const group = (title, list) => { const p = list.map(([st]) => Q[st.t]).filter(Boolean).map(shownPct);
      return `<div class="flag">${title} ${list.length}${p.length ? " · 평균 " + pct(p.reduce((a, b) => a + b, 0) / p.length) : ""}</div>` + list.map(([st, s]) => homeRow(st, s)).join(""); };
    html += kr.length && us.length ? group("🇺🇸 미국", us) + group("🇰🇷 한국", kr) : items.map(([st, s]) => homeRow(st, s)).join("");
    html += `<button class="btn ghost" id="addBtnHome" style="margin-top:6px;color:var(--accent)">＋ 종목 추가${H.tab >= 0 ? "" : " (섹터 자동 분류)"}</button>`;
  }
  html += `<div class="sub" style="text-align:center;margin-top:16px">${Q._at ? "시세 기준: " + ago(Q._at) + " (약 20분마다 갱신)<br>" : ""}시세·지표는 Yahoo Finance 기준이며 지연될 수 있어요.<br>투자 권유가 아닌 정보 모음입니다. 투자 판단은 본인 책임이에요.</div>`;
  const y = window.scrollY, sx = $("#tabChips")?.scrollLeft || LS.get("tabScroll", 0), gx = $("#guruChips")?.scrollLeft;
  $("#app").innerHTML = html;
  $("#tabChips").scrollLeft = sx; if ($("#guruChips") && gx != null) $("#guruChips").scrollLeft = gx;
  if (quotesOnly) window.scrollTo(0, y);
  $("#tabChips").onscroll = e => LS.set("tabScroll", e.target.scrollLeft);
  bindChips($("#tabChips"), "tab", t => { if (CHIP_DRAG.justDragged) return; H.tab = t; saveH(); renderHome(true); window.scrollTo(0, 0); });
  $("#tabChips").querySelectorAll("[data-tab]").forEach(b => { if (+b.dataset.tab >= 0) chipDrag(b); });
  const app = $("#app");
  app.querySelectorAll(".srow").forEach(el => bindRow(el));
  if ($("#sortBtn")) $("#sortBtn").onclick = chooseSort;
  if ($("#sumLine")) $("#sumLine").onclick = () => { H.pctMode ^= 1; saveH(); renderHome(true); };
  if ($("#addBtnHome")) $("#addBtnHome").onclick = () => addStockSheet(H.tab >= 0 ? H.tab : -1);
  bindChips(app, "gs", i => { H.guru = i; saveH(); renderHome(true); });
  if (!quotesOnly) { refreshQuotes(force); refreshMetrics().then(() => { if (route().name === "home" && (H.tab === -3 || H.sort === 5)) renderHome(true); }); }
}
function bindRow(el) {
  let timer, long = false, sx = 0, sy = 0;
  el.addEventListener("pointerdown", e => { long = false; sx = e.clientX; sy = e.clientY; timer = setTimeout(() => { long = true; navigator.vibrate?.(20); rowMenu(el.dataset.sym); }, 520); });
  el.addEventListener("pointermove", e => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) clearTimeout(timer); });
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => el.addEventListener(ev, () => clearTimeout(timer)));
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("click", e => {
    if (long) { e.preventDefault(); return; }
    if (e.target.closest("[data-tg]")) { H.pctMode ^= 1; saveH(); renderHome(true); return; }
    go("s/" + encodeURIComponent(el.dataset.sym));
  });
}
function chooseSort() {
  sheet(`<div class="b" style="font-size:17px;margin-bottom:8px">정렬</div>` + SORT_NAMES.map((n, i) => `<div class="hit" data-s="${i}"><span class="grow ${i === H.sort ? "b ac" : ""}">${n}</span>${i === H.sort ? "✓" : ""}</div>`).join(""), el =>
    el.querySelectorAll("[data-s]").forEach(d => d.onclick = () => { H.sort = +d.dataset.s; saveH(); closeSheet(); renderHome(true); }));
}
function rowMenu(sym) {
  const st = findStock(sym), opts = [S.favs.has(sym) ? "관심 해제" : "관심 추가", "메모 편집", "다른 섹터로 이동"];
  if (H.tab >= 0) opts.push("이 섹터에서 삭제");
  sheet(`<div class="b" style="font-size:17px;margin-bottom:8px">${esc(sym)} ${esc(st.ko)}</div>` + opts.map((o, i) => `<div class="hit" data-o="${i}">${o}</div>`).join(""), el =>
    el.querySelectorAll("[data-o]").forEach(d => d.onclick = () => {
      const o = opts[+d.dataset.o];
      if (o === "메모 편집") return memoSheet(sym);
      if (o === "다른 섹터로 이동") return moveSheet(sym);
      if (o === "이 섹터에서 삭제") { const s = S.sectors[H.tab]; s.stocks = s.stocks.filter(x => x.t !== sym); S.deleted.add(s.name + ":" + sym); }
      else { S.favs.has(sym) ? S.favs.delete(sym) : S.favs.add(sym); toast(S.favs.has(sym) ? "관심 종목에 추가했어요" : "관심 종목에서 뺐어요"); }
      S.save(); closeSheet(); renderHome(true);
    }));
}
function memoSheet(sym, done) {
  sheet(`<div class="b" style="font-size:17px;margin-bottom:8px">${esc(sym)} 메모</div><textarea id="mm" style="min-height:120px" placeholder="매수 이유·목표가·체크할 점">${esc(S.memos[sym] || "")}</textarea>
    <button class="btn" id="mmSave" style="margin-top:8px">저장</button><button class="btn ghost" id="mmX" style="margin-top:6px">취소</button>`, el => {
    $("#mmSave", el).onclick = () => { S.memos[sym] = $("#mm", el).value.trim(); S.save(); closeSheet(); toast("저장했어요"); done && done(); };
    $("#mmX", el).onclick = closeSheet; setTimeout(() => $("#mm", el).focus(), 100);
  });
}
function moveSheet(sym) {
  const st = findStock(sym), from = sectorIdx(sym);
  sheet(`<div class="b" style="font-size:17px;margin-bottom:8px">${esc(st.ko)} → 어느 섹터로?</div>` + S.sectors.map((s, i) => `<div class="hit" data-to="${i}">${esc(s.emoji)} ${esc(s.name)}${s.stocks.some(x => x.t === sym) ? " <span class='muted'>(현재)</span>" : ""}</div>`).join(""), el =>
    el.querySelectorAll("[data-to]").forEach(d => d.onclick = () => {
      const to = +d.dataset.to; if (to === from) return closeSheet();
      if (from >= 0) { S.sectors[from].stocks = S.sectors[from].stocks.filter(x => x.t !== sym); S.deleted.add(S.sectors[from].name + ":" + sym); }
      if (!S.sectors[to].stocks.some(x => x.t === sym)) S.sectors[to].stocks.push(st);
      S.deleted.delete(S.sectors[to].name + ":" + sym); S.save(); closeSheet(); toast(`${S.sectors[to].name}(으)로 옮겼어요`); render();
    }));
}
function guruTabHtml() {
  const gl = STATIC.gurus; if (H.guru >= gl.length) H.guru = -1;
  let h = `<div class="sub b" style="margin:8px 2px">투자 대가들의 원칙으로 본 종목 적합도</div><div class="chips" id="guruChips">${[[-1, "🏆 공통 TOP 10"], ...gl.map((g, i) => [i, g.name])].map(([i, n]) => `<button class="chip ${i === H.guru ? "on" : ""}" data-gs="${i}">${esc(n)}</button>`).join("")}</div>`;
  if (H.guru === -1) h += `<div class="card" style="margin-top:8px"><div class="b ac">대가 ${gl.length}명이 공통으로 괜찮다고 볼 종목</div><div class="small" style="margin-top:4px;line-height:1.45">종목마다 ${gl.length}명의 기준을 모두 적용해서 '잘 맞음'이 많은 순서로 10개를 골랐어요. 같으면 평균 적합도가 높은 순이에요.</div>
    <div class="sub" style="margin-top:6px">가치투자(버핏·그레이엄)와 성장투자(캐시 우드·오닐) 기준은 서로 반대라 모두 만족하는 종목은 드물어요. 여러 관점에서 두루 무난한 '균형형' 종목을 찾는 용도로 보세요.</div></div>`;
  else { const g = gl[H.guru]; h += `<div class="card" style="margin-top:8px"><div class="b ac">${esc(g.style)}</div><div class="small" style="margin-top:4px;line-height:1.45">${esc(g.idea)}</div><div class="sub" style="margin-top:6px">공개된 투자 원칙을 지표 체크리스트로 단순화한 참고용이에요. 본인이 실제로 그 종목을 추천했다는 뜻은 아니에요.</div><a class="link" href="#/gurus/${H.guru}">📚 ${esc(g.name)}의 투자법·책 보기 →</a></div>`; }
  const all = S.sectors.flatMap(s => s.stocks.map(st => [st, s.name])).filter(([st], i, a) => !st.etf && a.findIndex(([x]) => x.t === st.t) === i);
  let rows = "";
  if (H.guru === -1) {
    const cons = all.filter(([st]) => MET[st.t]).map(([st, sec]) => ({ st, ...consensus(st.t, sec, MET[st.t]) })).filter(c => c.rated >= 6)
      .sort((a, b) => b.fits.length - a.fits.length || b.avg - a.avg).slice(0, 10);
    rows = cons.map((c, i) => homeRow(c.st, c.sec, `${i + 1}위 · ${c.fits.length}/${c.rated}명 잘 맞음 · 평균 적합도 ${Math.round(c.avg * 100)}%`, c.fits.length >= 5 ? GOOD : c.fits.length >= 3 ? YEL : "var(--sub)", c.fits.length ? "👍 " + c.fits.join(" · ") : "잘 맞는 대가 없음 (일부 맞음 위주)")).join("");
  } else {
    const g = gl[H.guru];
    rows = all.filter(([st]) => MET[st.t]).map(([st, sec]) => [st, sec, guruEval(g, MET[st.t], st.t, innov(sec))])
      .sort((a, b) => (b[2].total < 3 ? -1 : b[2].ratio) - (a[2].total < 3 ? -1 : a[2].ratio) || b[2].pass - a[2].pass)
      .map(([st, sec, r]) => homeRow(st, sec, `${g.name} 기준 ${r.pass}/${r.total} · ${r.verdict}`, verdictColor(r))).join("");
  }
  return h + (rows || `<div class="sub" style="padding:20px 4px">재무 지표를 불러오는 중이에요. 처음엔 GitHub이 지표를 다 모을 때까지(약 20분) 기다려 주세요.</div>`) +
    `<div class="sub" style="text-align:center;margin-top:12px">ETF는 개별 기업 재무가 없어 제외돼요. 지표는 Yahoo Finance 기준이며 12시간마다 갱신돼요.</div>`;
}

// 섹터 칩 꾹 누르기: 그대로 떼면 메뉴(이름·이모지·삭제), 누른 채 옆으로 끌면 순서 바꾸기
const CHIP_DRAG = { justDragged: false };
function chipDrag(chip) {
  const row = $("#tabChips");
  let timer, dragging = false, moved = false, startX = 0, base = 0;
  const end = () => {
    clearTimeout(timer);
    if (!dragging) return;
    dragging = false; chip.classList.remove("lift"); chip.style.transform = "";
    CHIP_DRAG.justDragged = true; setTimeout(() => CHIP_DRAG.justDragged = false, 350);
    const sec = S.sectors[+chip.dataset.tab];
    if (!moved) return chipMenu(sec);
    const cur = H.tab >= 0 ? S.sectors[H.tab] : null;
    const order = [...row.querySelectorAll("[data-tab]")].map(b => +b.dataset.tab).filter(i => i >= 0).map(i => S.sectors[i]);
    if (order.length === S.sectors.length) { S.sectors = order; if (cur) H.tab = S.sectors.indexOf(cur); S.save(); saveH(); renderHome(true); }
  };
  chip.addEventListener("touchstart", e => {
    startX = base = e.touches[0].clientX; moved = false;
    timer = setTimeout(() => { dragging = true; navigator.vibrate?.(20); chip.classList.add("lift"); }, 420);
  }, { passive: true });
  chip.addEventListener("touchmove", e => {
    const x = e.touches[0].clientX;
    if (!dragging) { if (Math.abs(x - startX) > 10) clearTimeout(timer); return; }
    e.preventDefault();
    if (Math.abs(x - startX) > 12) moved = true;
    chip.style.transform = `translateX(${x - base}px) scale(1.1)`;
    const r = chip.getBoundingClientRect(), cx = r.left + r.width / 2;
    const next = chip.nextElementSibling, prev = chip.previousElementSibling;
    if (next && +next.dataset.tab >= 0) { const n = next.getBoundingClientRect(); if (cx > n.left + n.width / 2) { const w = n.width + 8; row.insertBefore(next, chip); base += w; chip.style.transform = `translateX(${x - base}px) scale(1.1)`; } }
    if (prev && +prev.dataset.tab >= 0) { const p = prev.getBoundingClientRect(); if (cx < p.left + p.width / 2) { const w = p.width + 8; row.insertBefore(chip, prev); base -= w; chip.style.transform = `translateX(${x - base}px) scale(1.1)`; } }
    const rr = row.getBoundingClientRect();
    if (x > rr.right - 40) row.scrollLeft += 12; else if (x < rr.left + 40) row.scrollLeft -= 12;
  }, { passive: false });
  chip.addEventListener("touchend", end); chip.addEventListener("touchcancel", end);
  chip.addEventListener("contextmenu", e => { e.preventDefault(); if (!("ontouchstart" in window)) chipMenu(S.sectors[+chip.dataset.tab]); });
}
function chipMenu(sec) {
  const i = S.sectors.indexOf(sec); if (i < 0) return;
  const opts = ["✏️ 이름 바꾸기", "😀 이모지 바꾸기", "🗑 섹터 삭제", "＋ 새 섹터 추가"];
  sheet(`<div class="b" style="font-size:17px">${esc(sec.emoji)} ${esc(sec.name)} <span class="sub">(${sec.stocks.length}개)</span></div><div class="sub" style="margin:4px 0 8px">팁: 칩을 꾹 누른 채 옆으로 끌면 순서가 바뀌어요</div>` +
    opts.map((o, k) => `<div class="hit" data-cm="${k}">${o}</div>`).join(""), el => el.querySelectorAll("[data-cm]").forEach(d => d.onclick = () => {
      closeSheet();
      const k = +d.dataset.cm;
      const done = () => { if (route().name === "home") renderHome(true); if (!$("#drawer").classList.contains("hidden")) drawer(true); };
      if (k === 0) renameSector(S.sectors.indexOf(sec), done);
      else if (k === 1) { const e = prompt("이모지 하나", sec.emoji); if (e?.trim()) { sec.emoji = e.trim(); S.save(); done(); } }
      else if (k === 2) deleteSector(S.sectors.indexOf(sec), done);
      else addSector(done);
    }));
}

// ═════════════ 종목 상세 ═════════════
const RANGES2 = [["1일", "1d", "5m"], ["5일", "5d", "30m"], ["1개월", "1mo", "1d"], ["6개월", "6mo", "1d"], ["1년", "1y", "1d"], ["5년", "5y", "1wk"]];
let SP500 = null;
async function sp500Data() { if (!SP500) SP500 = await data("sp500.json", 3600_000); return SP500; }
async function renderDetail(sym) {
  const st0 = findStock(sym), st = { ...st0, ko: st0.ko !== sym ? st0.ko : TMP_NAMES[sym] || Q[sym]?.name || sym };
  setHeader(sym, true);
  const inList = sectorIdx(sym) >= 0, kr = isKr(sym);
  $("#app").innerHTML = `
    <div class="between"><div style="min-width:0"><div class="b" style="font-size:22px">${esc(sym)}</div><div class="sub" style="font-size:13px">${esc(st.ko)}${st.etf ? " · ETF" : ""}</div></div><button class="iconbtn" id="favBtn" style="font-size:26px;color:${S.favs.has(sym) ? "#FFC93C" : "var(--sub)"}">${S.favs.has(sym) ? "★" : "☆"}</button></div>
    <div id="spBadge"></div>${inList ? "" : `<button class="btn" id="addMine" style="width:auto;padding:8px 12px;font-size:13px;margin-top:6px">＋ 내 목록에 추가 (섹터 자동 분류)</button>`}
    <div class="big" id="dPrice" style="margin-top:8px">—</div><div id="dChg" class="b"></div><div id="dKrw" class="sub" style="font-size:13px"></div><div id="dExt" class="small b" style="margin-top:2px"></div>
    <div class="card" style="margin-top:10px"><div id="cInfo" class="sub" style="min-height:18px">차트를 손가락으로 밀면 그날 가격이 나와요</div><canvas class="chart" id="cv"></canvas>
      <div class="ranges">${RANGES2.map((r, i) => `<button data-r="${i}">${r[0]}</button>`).join("")}</div></div>
    <div class="card" id="dToday"></div>
    <div class="sec">🚦 매수 타이밍 신호</div><div class="card" id="dSig"><div class="spin">계산 중…</div></div>
    ${st.desc || st.pts?.length ? `<div class="sec">📌 핵심 포인트</div><div class="card">${st.desc ? `<div class="b" style="margin-bottom:6px;font-size:15px">${esc(st.desc)}</div>` : ""}${(st.pts || []).map(p => `<div style="margin-top:3px;font-size:14px;line-height:1.45">• ${esc(p)}</div>`).join("")}</div>` : ""}
    <div class="sec">📝 내 메모</div><div class="card" id="memoCard" style="font-size:14px;line-height:1.45"></div>
    <div class="sec">🗞️ 최근 뉴스 AI 요약</div><div class="card" id="dAI"><div class="spin">뉴스 모으는 중…</div></div>
    <div class="sec">📊 주요 지표</div><div class="card" id="dMetrics"><div class="spin">불러오는 중…</div></div>
    ${st.etf ? "" : `<div class="sec">📐 가치평가 지표</div><div class="card" id="dVM"><div class="spin">불러오는 중…</div></div>
    <div class="sec">⚖️ 적정 PER · 적정 주가</div><div class="card" id="dVal"><div class="spin">불러오는 중…</div></div>`}
    <div id="dDivWrap" class="hidden"><div class="sec">💵 배당 분석</div><div class="card" id="dDiv"></div></div>
    ${st.etf ? "" : `<div class="sec">🧠 투자 대가 관점</div><div id="dGuru"><div class="spin">불러오는 중…</div></div>`}
    <div id="dAboutWrap" class="hidden"><div class="sec">${st.etf ? "🧺 ETF 정보" : "🏢 회사 정보"}</div><div class="card" id="dAbout"></div></div>
    <div class="sec">📂 담긴 섹터</div><div class="card" id="dSecs"></div>
    <div class="sec">📰 뉴스</div><div class="seg" id="newsTabs"></div><div id="dNews"><div class="spin">불러오는 중…</div></div>
    <div class="sec">🔗 더 보기</div><div class="row" style="gap:8px">${(kr ? [["네이버 증권", `https://m.stock.naver.com/domestic/stock/${sym.split(".")[0]}/total`], ["Yahoo", `https://finance.yahoo.com/quote/${sym}`], ["DART 공시", `https://dart.fss.or.kr/dsab001/main.do?textCrpNm=${encodeURIComponent(st.ko)}`]]
      : [["Yahoo", `https://finance.yahoo.com/quote/${sym}`], ["Finviz", `https://finviz.com/quote.ashx?t=${sym}`], ["SEC 공시", `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=&dateb=&owner=include&count=40`]])
      .map(([l, u]) => `<a class="card b ac" style="flex:1;text-align:center;text-decoration:none;margin:0;padding:12px 0;font-size:13px" target="_blank" href="${u}">${l}</a>`).join("")}</div>`;
  $("#favBtn").onclick = () => { const on = !S.favs.has(sym); on ? S.favs.add(sym) : S.favs.delete(sym); S.save(); $("#favBtn").textContent = on ? "★" : "☆"; $("#favBtn").style.color = on ? "#FFC93C" : "var(--sub)"; toast(on ? "관심 종목에 추가했어요" : "관심 종목에서 뺐어요"); };
  const fillMemo = () => { const m = S.memos[sym] || ""; $("#memoCard").innerHTML = m ? esc(m).replace(/\n/g, "<br>") : `<span class="muted">탭해서 매수 이유·목표가·체크할 점 등을 적어두세요</span>`; };
  fillMemo(); $("#memoCard").onclick = () => memoSheet(sym, fillMemo);
  if ($("#addMine")) $("#addMine").onclick = async () => {
    const b = $("#addMine"); b.disabled = true; b.textContent = "분류 중…";
    const idx = await suggestSector(sym, st.ko, st.etf); const s = S.sectors[idx];
    if (!s.stocks.some(x => x.t === sym)) s.stocks.push({ t: sym, ko: st.ko, desc: "", pts: [], etf: !!st.etf });
    S.deleted.delete(s.name + ":" + sym); S.save(); b.textContent = `✓ ${s.name}에 추가됨`; toast(`${sym} → ${s.name}에 추가했어요`); drawSecs();
  };
  sp500Data().then(d => { const m = d?.m?.find(x => x[0] === sym); if (m && $("#spBadge")) $("#spBadge").innerHTML = `<div class="small b ac" style="margin-top:2px">🇺🇸 S&P 500 구성 종목 · ${esc(gicsKo(m[2]))}${/^\d{4}/.test(m[4] || "") ? ` · ${m[4].slice(0, 4)}년 편입` : ""}</div>`; });
  const drawSecs = () => {
    const ins = S.sectors.map((s, i) => [s, i]).filter(([s]) => s.stocks.some(x => x.t === sym));
    $("#dSecs").innerHTML = (ins.length ? ins.map(([s, i]) => `<div class="between" style="padding:6px 0"><span>${esc(s.emoji)} ${esc(s.name)}</span><button class="chip sm" data-rm="${i}">빼기 ✕</button></div>`).join("") : `<div class="sub">아직 어떤 섹터에도 없어요.</div>`) +
      `<div class="chips" style="margin-top:8px">${S.sectors.map((s, i) => ins.some(([, j]) => j === i) ? "" : `<button class="chip sm" data-addto="${i}">＋ ${esc(s.name)}</button>`).join("")}</div>`;
    $("#dSecs").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const s = S.sectors[+b.dataset.rm]; s.stocks = s.stocks.filter(x => x.t !== sym); S.deleted.add(s.name + ":" + sym); S.save(); toast(s.name + "에서 뺐어요"); drawSecs(); });
    $("#dSecs").querySelectorAll("[data-addto]").forEach(b => b.onclick = () => { const s = S.sectors[+b.dataset.addto]; s.stocks.push({ t: sym, ko: st.ko, desc: st.desc || "", pts: st.pts || [], etf: !!st.etf }); S.deleted.delete(s.name + ":" + sym); S.save(); toast(s.name + "에 담았어요"); drawSecs(); });
  };
  drawSecs();

  // 시세
  const qq = (await Y.quotes([sym]))[sym]; if (qq) Q[sym] = { ...Q[sym], ...qq };
  const q = Q[sym];
  if (q) {
    $("#dPrice").textContent = money(q.price, sym);
    $("#dChg").innerHTML = `<span class="${cls(q.pct)}">${q.chg > 0 ? "▲ " : q.chg < 0 ? "▼ " : ""}${q.chg != null ? fmt(Math.abs(q.chg), kr ? 0 : 2) : ""}  (${pct(q.pct)})  전일 대비</span>`;
    $("#dKrw").textContent = (!kr && RATE ? `≈ ${f0(q.price * RATE)}원  ·  ` : "") + (q.time ? new Date(q.time * 1000).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " 기준 (한국시간)" : "");
    const e = extLine(q); if (e) { $("#dExt").className = "small b " + e[1]; $("#dExt").textContent = (q.state.startsWith("PRE") ? `프리마켓 ${money(q.pre, sym)} ` : `애프터마켓 ${money(q.post, sym)} `) + e[0].split(" ")[1]; }
    const vol = v => v >= 1e8 ? (v / 1e8).toFixed(1) + "억주" : v >= 1e4 ? Math.round(v / 1e4).toLocaleString() + "만주" : (v || 0).toLocaleString() + "주";
    $("#dToday").innerHTML = `<div class="kv"><span class="k">당일 고가 / 저가</span><span class="v">${q.dayHigh ? money(q.dayHigh, sym) + " / " + money(q.dayLow, sym) : "—"}</span></div>
      <div class="kv"><span class="k">거래량</span><span class="v">${q.vol ? vol(q.vol) : "—"}</span></div>
      ${q.high52 && q.low52 ? `<div class="kv"><span class="k">52주 최저 / 최고</span><span class="v">${money(q.low52, sym)} / ${money(q.high52, sym)}</span></div>
      <div class="rbar"><div style="left:${Math.min(100, Math.max(0, (q.price - q.low52) / (q.high52 - q.low52 || 1) * 100))}%"></div></div>
      <div class="sub" style="text-align:right;margin-top:4px">52주 최고가 대비 ${pct((q.price / q.high52 - 1) * 100)}</div>` : ""}`;
  } else $("#dToday").innerHTML = `<div class="sub">시세를 불러오지 못했어요.</div>`;

  // 차트
  const loadRange = async i => {
    LS.set("range2", i);
    $("#app").querySelectorAll("[data-r]").forEach(b => b.classList.toggle("on", +b.dataset.r === i));
    const [, range, iv] = RANGES2[i];
    const d = await Y.chart(sym, range, iv);
    if (!d || d.closes.length < 2) { $("#cInfo").textContent = "차트를 불러오지 못했어요"; return; }
    d.intraday = iv.endsWith("m");
    const base = i === 0 && d.base > 0 ? d.base : d.closes[0], chg = (d.closes[d.closes.length - 1] / base - 1) * 100;
    $("#cInfo").innerHTML = `${RANGES2[i][0]} 수익률 <b class="${cls(chg)}">${pct(chg)}</b> · 손가락으로 밀어보세요`;
    priceChart($("#cv"), d, sym, $("#cInfo"));
  };
  $("#app").querySelectorAll("[data-r]").forEach(b => b.onclick = () => loadRange(+b.dataset.r));
  loadRange(LS.get("range2", 3));

  // 신호
  Promise.all([Y.chart(sym, "1y", "1d"), Y.chart(sym, "5y", "1wk")]).then(([d, w]) => {
    if (!$("#dSig")) return;
    const list = Sig.price(d, w, st.etf || sym.startsWith("^"), sym);
    $("#dSig").innerHTML = list.length ? sigSummary(list) + list.map(sigRow).join("") + `<a class="link" href="#/signals">시장 전체 신호(공포지수·VIX) 보기 ›</a>` : `<div class="sub">차트 데이터가 부족해 계산할 수 없어요.</div>`;
  });

  // 지표 → 가치평가·적정 PER·배당·대가·회사 정보
  getSummary(sym).then(sm => {
    if (!$("#dMetrics")) return;
    $("#dMetrics").innerHTML = !sm?.stats?.length ? `<div class="sub">지표를 불러오지 못했어요. 아래 Yahoo·Finviz 링크에서 확인할 수 있어요.</div>`
      : `<div class="sub">항목을 탭하면 자세한 설명이 나와요</div>` + sm.stats.map(([g, l, v], i, a) => (i === 0 || a[i - 1][0] !== g ? `<div class="b ac" style="margin:12px 0 2px">${esc(g)}</div>` : "") + statRow(l, v, sym, sm.raw)).join("");
    const raw = sm?.raw && Object.keys(sm.raw).length ? sm.raw : MET[sym];
    if (raw) { const dv = dividendHtml(sym, raw, st); if (dv) { $("#dDiv").innerHTML = dv; $("#dDivWrap").classList.remove("hidden"); } }
    if (!st.etf) {
      if (!raw) { ["#dVM", "#dVal"].forEach(s => $(s).innerHTML = `<div class="sub">재무 지표가 없어 계산할 수 없어요.</div>`); $("#dGuru").innerHTML = `<div class="sub" style="padding:0 4px">재무 지표가 없어 평가할 수 없어요.</div>`; }
      else {
        $("#dVM").innerHTML = valueMetricsHtml(sym, raw); fillHistoryVals(sym, raw);
        $("#dVal").innerHTML = valuationHtml(sym, raw);
        const sec = sectorOf(sym), cs = consensus(sym, sec, raw);
        $("#dGuru").innerHTML = `<div class="card"><div class="b" style="font-size:14px;color:${cs.fits.length >= 5 ? GOOD : cs.fits.length >= 3 ? YEL : "var(--text)"}">대가 ${cs.rated}명 중 ${cs.fits.length}명 '잘 맞음' · 평균 적합도 ${Math.round(cs.avg * 100)}%</div>${cs.fits.length ? `<div class="sub" style="margin-top:4px">👍 ${esc(cs.fits.join(" · "))}</div>` : ""}</div>` +
          STATIC.gurus.map(g => guruCardHtml(guruEval(g, raw, sym, innov(sec)))).join("") + `<div class="sub" style="padding:4px">각 대가의 공개된 투자 원칙을 지표로 단순화한 참고용이며, 본인의 실제 의견이나 추천이 아니에요. 카드를 탭하면 기준이 보여요.</div>`;
        bindFolds($("#dGuru"));
      }
    }
    let ab = "";
    if (st.etf) ab += `<div class="b" style="margin-bottom:6px">📦 상위 보유 종목 · 비중</div>` + holdingsHtml(sym, sm);
    if (sm && (sm.prof?.length || sm.about)) {
      ab += (ab ? `<div style="height:10px"></div>` : "") + sm.prof.map(([k, v]) => k === "웹사이트" ? `<div class="kv"><span class="k">${k}</span><a class="v" target="_blank" href="${esc(v)}">${esc(v.replace(/^https?:\/\//, ""))}</a></div>` : `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("");
      if (sm.about) ab += `<div class="sub" style="margin-top:8px">사업 개요 (영문 · 탭하면 펼치기)</div><div class="small clamp" id="aboutTxt" style="margin-top:4px;line-height:1.45;color:var(--sub)">${esc(sm.about)}</div>`;
    }
    if (ab) { $("#dAbout").innerHTML = ab; $("#dAboutWrap").classList.remove("hidden"); if ($("#aboutTxt")) $("#aboutTxt").onclick = e => e.target.classList.toggle("clamp"); }
  });

  // 뉴스 + AI 요약
  const pre = await data(`n/${fname(sym)}.json`, 600_000);
  const nm = (st.ko && st.ko !== sym ? st.ko.replace(/\(.*\)/, "").trim() : sym);
  const lists = [pre?.ko?.length ? pre.ko : null, kr ? [] : pre?.en?.length ? pre.en : null, pre?.an?.length ? pre.an : null];
  const fetchers = [() => newsSearch(/[가-힣]/.test(nm) ? nm + " 주가" : sym + " 주가"), () => newsSearch((Q[sym]?.name || sym) + " stock", true), () => newsSearch(`"${nm}" (기업분석 OR 심층분석 OR 분석 OR 리포트)`)];
  let sel = 0;
  const showNews = () => {
    $("#newsTabs").innerHTML = ["국내 뉴스", "해외 뉴스", "🔍 기업분석"].map((t, i) => `<button class="${i === sel ? "on" : ""}" data-n="${i}">${t}</button>`).join("");
    $("#newsTabs").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { sel = +b.dataset.n; showNews(); });
    const l = lists[sel];
    $("#dNews").innerHTML = l == null ? `<div class="spin">불러오는 중…</div>` : !l.length ? `<div class="sub" style="padding:8px 4px">뉴스가 없어요</div>` : l.slice(0, 15).map(n => newsCard(n)).join("");
    if (l == null) fetchers[sel]().then(x => { lists[sel] = x; if ($("#dNews")) showNews(); });
  };
  if (!lists[0]?.length && lists[1]?.length) sel = 1;
  showNews();
  const runAI = async force => {
    $("#dAI").innerHTML = `<div class="spin">AI가 최근 뉴스를 읽는 중… (10초쯤)</div>`;
    try {
      if (lists[0] == null) lists[0] = await fetchers[0]();
      if (lists[1] == null) lists[1] = await fetchers[1]();
      const week = Date.now() - 10 * 86400_000;
      let all = [...lists[0].slice(0, 12), ...lists[1].slice(0, 12)].filter(n => !n.time || n.time > week);
      if (!all.length) all = [...lists[0].slice(0, 8), ...lists[1].slice(0, 8)];
      const d = await AI.digest(st, sym, all.sort((a, b) => b.time - a.time), force);
      $("#dAI").innerHTML = digestHtml(d) + `<div class="between" style="margin-top:10px"><span class="sub">AI 요약은 틀릴 수 있어요. 중요한 내용은 아래 원문으로 확인하세요.</span><button class="chip sm" id="aiRe">다시 요약 ⟳</button></div>`;
      $("#aiRe").onclick = () => runAI(true);
    } catch (e) { $("#dAI").innerHTML = `<div class="small">${esc(e.msg || "요약 실패")}</div>` + (e.code === -1 ? `<a class="link" href="#/settings">Gemini 키 넣으러 가기 ›</a>` : `<button class="chip sm" id="aiRe" style="margin-top:8px">다시 시도</button>`); if ($("#aiRe")) $("#aiRe").onclick = () => runAI(true); }
  };
  runAI(false);
}

// ═════════════ 종목 비교 ═════════════
const CMP_METRICS = [["pe", "PER", 1, 0, "낮을수록 이익 대비 싸요. 적자 기업은 제외"], ["fpe", "선행 PER", 1, 0, "내년 예상 이익 기준. 낮을수록 싸요"], ["peg", "PEG", 1, 0, "PER ÷ 이익 성장률. 1 이하면 성장 대비 싸요"],
  ["pb", "PBR", 1, 0, "순자산 대비 가격. 낮을수록 싸요"], ["psr", "PSR", 1, 0, "매출 대비 가격. 적자 성장주 비교에 유용"], ["evebitda", "EV/EBITDA", 1, 0, "빚까지 반영한 몸값. 낮을수록 싸요"],
  ["rg", "매출 성장률", 0, 1, "높을수록 빠르게 성장"], ["eg", "이익 성장률", 0, 1, "높을수록 이익이 빠르게 증가"], ["roe", "ROE", 0, 1, "높을수록 자본을 효율적으로 씀"], ["om", "영업이익률", 0, 1, "높을수록 본업 수익성이 좋음"],
  ["fcfy", "FCF 수익률", 0, 1, "높을수록 주가 대비 현금 창출력이 큼"], ["dy", "배당수익률", 0, 1, "현재가 대비 1년 배당. 높을수록 배당이 많아요"], ["payout", "배당성향", 1, 1, "이익 중 배당 비율. 낮을수록 배당 여력이 있어요 (무배당 제외)"], ["m1", "1개월 수익률", 0, 1, "최근 한 달 주가 흐름"]]
  .map(([key, label, lb, p, note]) => ({ key, label, lowerBetter: !!lb, pct: !!p, note }));
const ETF_METRICS = [["m1", "1개월", 0, 1, "최근 한 달 수익률"], ["ytd", "연초 대비", 0, 1, "올해 들어 수익률 (분배금 포함)"], ["r1y", "1년", 0, 1, "최근 1년 수익률"], ["r3y", "3년 연평균", 0, 1, "최근 3년 연평균 수익률"],
  ["r5y", "5년 연평균", 0, 1, "최근 5년 연평균 수익률"], ["dy", "분배금 수익률", 0, 1, "1년 분배금(배당) ÷ 가격"], ["er", "총보수", 1, 1, "1년 운용 수수료. 낮을수록 좋아요"], ["aum", "운용자산(B$)", 0, 0, "운용 규모(십억 달러). 클수록 안정적"]]
  .map(([key, label, lb, p, note]) => ({ key, label, lowerBetter: !!lb, pct: !!p, note }));
const GLOSS_KEY = { pe: "PER", fpe: "선행 PER", peg: "PEG", pb: "PBR", psr: "PSR", evebitda: "EV/EBITDA", rg: "매출 성장률 (전년 대비)", eg: "이익 성장률 (전년 대비)", roe: "ROE (자기자본이익률)", om: "영업이익률", fcfy: "FCF 수익률", dy: "배당수익률", payout: "배당성향" };
const C = { group: -2, mode: 0, kind: -1, mi: 0, sortMi: 0, flip: false, matrix: -1, etf: null };
const validValue = (sym, m) => { const v = metricValue(sym, m.key); return v != null && (!m.lowerBetter || v > 0) ? v : null; };
function cellText(st, m) {
  const v = metricValue(st.t, m.key);
  if (v == null) return "—";
  if (m.lowerBetter && v <= 0) return st.etf ? "—" : "적자";
  if (m.key === "er") return (v * 100).toFixed(2) + "%";
  return m.pct ? pct1(v) : f1(v);
}
async function renderCompare(arg) {
  setHeader("⚖️ 종목 비교", true);
  if (arg?.length) { C.group = +arg[0]; C.mi = C.sortMi = +(arg[1] || 0); C.kind = -1; C.mode = 0; }
  await refreshMetrics();
  if (!Object.keys(Q).length) Object.assign(Q, await Y.quotes([...new Set(S.sectors.flatMap(s => s.stocks.map(x => x.t)))]));
  const raw = C.group === -2 ? S.sectors.flatMap(s => s.stocks).filter((x, i, a) => S.favs.has(x.t) && a.findIndex(y => y.t === x.t) === i) : S.sectors[C.group]?.stocks || [];
  const nonEtf = raw.filter(x => !x.etf), etfs = raw.filter(x => x.etf), mixed = nonEtf.length && etfs.length;
  const etfMode = mixed ? (C.kind === -1 ? etfs.length >= nonEtf.length : C.kind === 1) : etfs.length > 0;
  if (C.etf !== null && C.etf !== etfMode) { C.mi = C.sortMi = 0; C.flip = false; } C.etf = etfMode;
  const MS = etfMode ? ETF_METRICS : CMP_METRICS, stocks = etfMode ? etfs : nonEtf;
  C.mi = Math.min(C.mi, MS.length - 1); C.sortMi = Math.min(C.sortMi, MS.length - 1);
  let h = chipsHtml([[-2, "★ 관심"], ...S.sectors.map((s, i) => [i, `${s.emoji} ${s.name}`])], C.group, "cg") + `<div style="height:6px"></div>` + chipsHtml([[0, "📋 한눈에 표"], [1, "📊 지표별 순위"]], C.mode, "cm");
  if (mixed) h += `<div style="height:6px"></div>` + chipsHtml([[0, `📈 주식 ${nonEtf.length}개`], [1, `🧺 ETF ${etfs.length}개`]], etfMode ? 1 : 0, "ck");
  if (C.mode === 1) h += `<div style="height:6px"></div>` + chipsHtml(MS.map((m, i) => [i, m.label]), C.mi, "cmi");
  h += `<div style="height:8px"></div>`;
  if (!stocks.length) h += note(C.group === -2 ? "관심 종목이 없어요" : "종목이 없어요");
  else if (C.mode === 0) {
    const top3 = MS.map(m => new Set(stocks.map(s => [s.t, validValue(s.t, m)]).filter(x => x[1] != null).sort((a, b) => m.lowerBetter ? a[1] - b[1] : b[1] - a[1]).slice(0, 3).map(x => x[0])));
    const sm = MS[C.sortMi], withV = stocks.filter(s => validValue(s.t, sm) != null).sort((a, b) => sm.lowerBetter ? validValue(a.t, sm) - validValue(b.t, sm) : validValue(b.t, sm) - validValue(a.t, sm));
    const ordered = [...(C.flip ? withV.reverse() : withV), ...stocks.filter(s => validValue(s.t, sm) == null)];
    h += `<div class="tblwrap"><table class="cmp"><tr><th class="stick">종목</th>${MS.map((m, i) => `<th data-sort="${i}" class="${i === C.sortMi ? "ac" : ""}">${esc(m.label)}${i === C.sortMi ? (C.flip ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>` +
      ordered.map((st, ri) => `<tr class="${ri % 2 ? "alt" : ""}"><td class="stick" data-open="${esc(st.t)}"><b>${esc(st.t)}</b><div class="sub ell">${esc(st.ko)}</div></td>${MS.map((m, ci) => { const good = top3[ci].has(st.t), valid = validValue(st.t, m) != null;
        return `<td class="${good ? "g b" : valid ? (ci === C.sortMi ? "b" : "") : "muted"}">${cellText(st, m)}</td>`; }).join("")}</tr>`).join("") +
      `<tr><td class="stick ac b">중앙값</td>${MS.map(m => { const md = median(stocks.map(s => validValue(s.t, m)).filter(v => v != null)); return `<td class="ac b">${md == null ? "—" : m.pct ? pct1(md) : f1(md)}</td>`; }).join("")}</tr></table></div>
      <div class="sub" style="padding:10px 4px 0">${etfMode ? "초록 = 열마다 가장 좋은 3개 (수익률↑·보수↓) · 회색 = 데이터 없음" : "초록 = 열마다 가장 좋은 3개 · 회색 = 적자/데이터 없음"}<br>표는 좌우로 밀어서 보세요 · 열 제목 탭 = 정렬, 길게 누르기 = 설명 · 종목 탭 = 상세</div>`;
    if (etfMode) h += `<div id="etfHold"><div class="spin">ETF 보유 종목 불러오는 중…</div></div>`;
  } else {
    const m = MS[C.mi], gl = GLOSS(GLOSS_KEY[m.key] || ""), pg = GLOSS("적정 PER 가이드");
    h += `<div class="card"><div class="b" style="font-size:15px">${esc(m.label)}</div><div class="sub" style="margin-top:2px">${esc(m.note)} · ${m.lowerBetter ? "낮은 순 정렬" : "높은 순 정렬"}</div>
      ${gl ? `<div class="small b ac" style="margin-top:6px" data-pop="${popRef(gl.label, gl.long)}">ⓘ 자세한 설명</div>` : ""}${(m.key === "pe" || m.key === "fpe") && pg ? `<div class="small b ac" style="margin-top:6px" data-pop="${popRef(pg.label, pg.long)}">💡 적정 PER 가이드 보기</div>` : ""}</div>`;
    const vals = stocks.map(s => [s, metricValue(s.t, m.key)]), valid = vals.filter(([, v]) => v != null && (!m.lowerBetter || v > 0)).sort((a, b) => m.lowerBetter ? a[1] - b[1] : b[1] - a[1]);
    const invalid = vals.filter(x => !valid.includes(x)), md = median(valid.map(x => x[1]));
    const fv = v => m.key === "er" ? (v * 100).toFixed(2) + "%" : m.key === "aum" ? "$" + f1(v) + "B" : m.pct ? pct1(v) : m.key === "peg" ? f1(v) : f1(v) + "배";
    if (md != null) h += note(`중앙값 ${fv(md)} · ${valid.length}개 비교`);
    const mx = Math.max(...valid.map(x => Math.abs(x[1])), 0) || 1;
    h += valid.map(([s, v], i) => `<div class="card" style="padding:10px 14px;margin-bottom:6px" data-open="${esc(s.t)}"><div class="row"><b style="width:22px;color:${i < 3 ? GOOD : "var(--sub)"}">${i + 1}</b><b>${esc(s.t)}</b><span class="sub grow ell">${esc(s.ko)}</span><b style="color:${i < 3 ? GOOD : "var(--text)"}">${fv(v)}</b></div>
      <div class="bar" style="margin-left:22px"><div style="width:${Math.max(3, Math.abs(v) / mx * 100)}%;background:${v < 0 ? "var(--red)" : i < 3 ? GOOD : "var(--accent)"}"></div></div></div>`).join("");
    if (invalid.length) h += `<div class="sub b" style="padding:12px 4px 4px">비교 제외 (적자·데이터 없음)</div>` + note(invalid.map(x => x[0].t).join("  ·  "));
    h += note("초록색 = 이 지표 기준 상위 3개. 종목을 탭하면 상세 화면으로 가요.");
  }
  $("#app").innerHTML = h;
  const app = $("#app");
  bindChips(app, "cg", v => { C.group = v; C.kind = -1; renderCompare(); });
  bindChips(app, "cm", v => { C.mode = v; renderCompare(); });
  bindChips(app, "ck", v => { C.kind = v; renderCompare(); });
  bindChips(app, "cmi", v => { C.mi = v; renderCompare(); });
  app.querySelectorAll("[data-sort]").forEach(th => {
    const i = +th.dataset.sort; let t, long = false;
    th.addEventListener("pointerdown", () => { long = false; t = setTimeout(() => { long = true; const m = MS[i], g = GLOSS(GLOSS_KEY[m.key] || ""); popup(m.label, (g?.long || m.note) + "\n\n" + (m.lowerBetter ? "낮을수록 좋음" : "높을수록 좋음")); }, 520); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(e => th.addEventListener(e, () => clearTimeout(t)));
    th.addEventListener("click", () => { if (long) return; if (C.sortMi === i) C.flip = !C.flip; else { C.sortMi = i; C.flip = false; } renderCompare(); });
  });
  if ($("#etfHold")) etfHoldingsSection(etfs);
}
async function etfHoldingsSection(etfs) {
  const sums = await Promise.all(etfs.map(e => getSummary(e.t)));
  const box = $("#etfHold"); if (!box) return;
  const per = etfs.map((e, i) => holdingsOf(e.t, sums[i]).list);
  let h = `<div class="sec">📦 ETF별 상위 보유 종목 · 비중</div><div class="sub" style="padding:0 4px 8px">ETF가 실제로 어떤 회사를 몇 % 담았는지예요. 종목 탭 = 상세</div>`;
  if (etfs.length >= 2) {
    const maps = per.map(l => new Map(l.map(x => [x.key, x]))), names = new Map();
    maps.forEach(m => m.forEach((v, k) => names.has(k) || names.set(k, v)));
    const sc = C.matrix >= 0 && C.matrix < etfs.length ? C.matrix : null;
    const keys = [...names.keys()].sort((a, b) => sc != null ? (maps[sc].get(b)?.pct ?? -1) - (maps[sc].get(a)?.pct ?? -1)
      : (maps.reduce((s, m) => s + (m.get(b)?.pct || 0), 0) + maps.filter(m => m.has(b)).length * .001) - (maps.reduce((s, m) => s + (m.get(a)?.pct || 0), 0) + maps.filter(m => m.has(a)).length * .001)).slice(0, 20);
    const mx = Math.max(...keys.map(k => Math.max(...maps.map(m => m.get(k)?.pct || 0))), 0) || 1;
    h += `<div class="tblwrap"><table class="cmp mat"><tr><th class="stick ${sc == null ? "ac" : ""}" data-mx="-1">보유 종목${sc == null ? " ▼" : ""}</th>${etfs.map((e, i) => `<th data-mx="${i}" class="${i === sc ? "ac" : ""}">${esc(isKr(e.t) ? e.ko : e.t)}${i === sc ? " ▼" : ""}</th>`).join("")}</tr>` +
      keys.map((k, ri) => { const cnt = maps.filter(m => m.has(k)).length, hh = names.get(k), tg = holdingTarget(hh);
        return `<tr class="${ri % 2 ? "alt" : ""}"><td class="stick" ${tg ? `data-open="${esc(tg)}" data-name="${esc(holdingName(hh))}"` : ""}><b class="ell" style="display:block">${esc(holdingName(hh))}</b><div class="small" style="color:${cnt >= 2 ? YEL : "var(--sub)"}">${cnt >= 2 ? cnt + "개 ETF에 겹침" : "1개 ETF"}</div></td>` +
          maps.map(m => { const p = m.get(k)?.pct; return p == null ? `<td class="muted">·</td>` : `<td><span class="heat" style="background:rgba(108,123,255,${(0.16 + 0.66 * p / mx).toFixed(2)});${p >= mx * .5 ? "font-weight:700" : ""}">${(p * 100).toFixed(1)}%</span></td>`; }).join("") + `</tr>`; }).join("") +
      `<tr><td class="stick ac b small">상위 10개 합계</td>${per.map(l => { const t = [...l].sort((a, b) => b.pct - a.pct).slice(0, 10); return `<td class="ac b">${t.length ? Math.round(t.reduce((a, x) => a + x.pct, 0) * 100) + "%" : "없음"}</td>`; }).join("")}</tr></table></div>
      <div class="sub" style="padding:8px 4px 10px">행 = 보유 종목(여러 ETF 합산 비중 순) · 열 = ETF · 칸 = 그 ETF 안의 비중<br>가로로 밀어서 보세요 · 열 제목 탭 = 그 ETF 기준 정렬 · 여러 ETF에 겹치면 분산 효과가 작아요</div>`;
  }
  h += `<div class="b" style="margin:8px 4px 6px">ETF별 자세히</div>` + etfs.map((e, i) => `<div class="card"><div class="between" data-open="${esc(e.t)}" style="margin-bottom:6px"><b style="font-size:15px">${esc(isKr(e.t) ? e.ko : e.t)}</b><span class="sub">${esc(isKr(e.t) ? e.t.split(".")[0] : e.ko)}</span></div>${holdingsHtml(e.t, sums[i])}</div>`).join("");
  box.innerHTML = h;
  box.querySelectorAll("[data-mx]").forEach(th => th.onclick = () => { C.matrix = +th.dataset.mx; etfHoldingsSection(etfs); });
}

// ═════════════ 종목 발굴 ═════════════
const D = { tab: 0, scr: 0, feed: 0 };
async function renderDiscover() {
  setHeader("🔭 종목 발굴", true);
  const mine = new Set(S.sectors.flatMap(s => s.stocks.map(x => x.t)));
  let h = chipsHtml([[0, "🔥 지금 화제"], [4, "🆕 신규 상장"], [3, "🏆 전문가 픽 랭킹"], [1, "📈 조건별 발굴"], [2, "🗞 전문가 추천 기사"]], D.tab, "dt");
  if (D.tab === 1) h += `<div style="height:6px"></div>` + chipsHtml(STATIC.screens.map((s, i) => [i, s[1]]), D.scr, "ds");
  if (D.tab === 2) h += `<div style="height:6px"></div>` + chipsHtml(STATIC.expertFeeds.map((f, i) => [i, f[0]]), D.feed, "df");
  h += `<div id="dBody" style="margin-top:8px"><div class="spin">불러오는 중…</div></div>`;
  $("#app").innerHTML = h;
  bindChips($("#app"), "dt", v => { D.tab = v; renderDiscover(); });
  bindChips($("#app"), "ds", v => { D.scr = v; renderDiscover(); });
  bindChips($("#app"), "df", v => { D.feed = v; renderDiscover(); });
  const d = await data("disc.json", 300_000) || {};
  const row = (x, extra) => `<div class="srow" data-open="${esc(x.sym)}" data-name="${esc(x.name || x.sym)}"><div class="grow" style="min-width:0"><div class="nm">${esc(x.sym)}${mine.has(x.sym) ? ` <span class="small g">✓ 내 목록</span>` : ""}</div><div class="tk">${esc(x.name || "")}</div>
    <div class="sub">${[x.cap > 0 ? "시총 " + bigUsd(x.cap) : "", x.pe ? "PER " + f1(x.pe) : "", extra || ""].filter(Boolean).join(" · ")}</div></div>
    <div style="text-align:right;flex:none"><div class="b">${money(x.price, x.sym)}</div><span class="pill" style="background:${(x.pct || 0) >= 0 ? "var(--green)" : "var(--red)"}">${pct(x.pct)}</span></div></div>`;
  let b = "";
  const empty = note(d.at ? "불러오지 못했어요. 잠시 후 다시 열어주세요." : "아직 데이터가 없어요. GitHub이 30분마다 모아요.");
  if (D.tab === 4) {
    const ip = await data("ipo.json", 600_000) || {};
    b = `<div class="card"><div class="b ac">최근 4개월 미국 신규 상장 (시총 10억 달러 이상)</div><div class="small" style="margin-top:2px;line-height:1.45">시총 100억 달러 이상 큰 종목은 앱이 알맞은 섹터에 자동으로 넣어줘요 (지우면 다시 안 넣어요). 갓 상장한 종목은 재무 지표·차트가 짧고 주가가 크게 출렁여요.</div></div>` +
      ((ip.list || []).map(x => row({ ...x, name: x.ko }, [new Date(x.date).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }).replace(/\. /g, "/").replace(".", "") + " 상장",
        x.ipoPrice ? "공모가 $" + f2(x.ipoPrice) : "", x.sinceIpo != null ? "공모가 대비 " + pct(x.sinceIpo) : "", x.sector].filter(Boolean).join(" · "))).join("") || note("신규 상장 목록이 아직 없어요. GitHub이 3시간마다 모아요.")) +
      (ip.upcoming?.length ? `<div class="b" style="margin:14px 4px 6px">📅 상장 예정</div>` + ip.upcoming.map(u => `<div class="card"><b>${esc(u.sym)}</b>  ${esc(u.name)}<div class="sub" style="margin-top:2px">${[u.date || "날짜 미정", u.range ? "공모가 $" + esc(u.range) : "", esc(u.deal || "")].filter(Boolean).join(" · ")}</div></div>`).join("") : "") +
      note(`출처: ${esc(ip.src || "Nasdaq")} IPO 일정 · 3시간마다 갱신. 탭하면 상세 화면으로 가요.`);
  } else if (D.tab === 0) b = note("미국에서 지금 가장 많이 검색·거래되는 종목이에요 (Yahoo Finance 기준). 탭하면 상세 화면에서 지표·대가 점수를 확인하고 '내 목록에 추가'할 수 있어요.") + ((d.trend || []).map(x => row(x)).join("") || empty);
  else if (D.tab === 3) b = `<div class="card"><div class="b ac">모틀리 풀·잭스·모닝스타·배런스가 최근 공개 기사에서 많이 꼽은 종목</div><div class="small" style="margin-top:2px;line-height:1.45">여러 곳에서 동시에 언급될수록 위로 와요. 유료 추천 목록이 아니라 무료 기사에 나온 티커를 세어 만든 순위예요 (30분마다 갱신).</div></div>` +
    ((d.rank || []).map((x, i) => row(x, `${i + 1}위 · ${x.sources.join("·")} ${x.count}회 언급`)).join("") || empty);
  else if (D.tab === 1) { const [id, name, desc] = STATIC.screens[D.scr] || []; b = `<div class="card"><div class="b ac">${esc(name)}</div><div class="small" style="margin-top:2px">${esc(desc)}</div><div class="sub" style="margin-top:4px">Yahoo Finance 무료 스크리너 결과 · 30분마다 갱신</div></div>` + ((d.scr?.[id] || []).map(x => row(x)).join("") || empty); }
  else { const [label, , src] = STATIC.expertFeeds[D.feed] || []; b = `<div class="card"><div class="b ac">${esc(label)} (${esc(src)}) 공개 기사</div><div class="small" style="margin-top:2px;line-height:1.45">유료 추천 목록(회원 전용)은 가져올 수 없어서, 누구나 볼 수 있는 공개 기사를 모았어요. 기사 속 티커를 누르면 바로 종목 상세로 가요.</div></div>` +
    ((d.feeds?.[D.feed] || []).map(n => `<div class="card" style="margin-bottom:6px"><a class="news" style="padding:0;border:0" target="_blank" href="${esc(n.link)}"><div class="t">${esc(n.title)}</div><div class="m">${esc(n.src)} · ${n.time ? ago(n.time) : ""}</div></a>${n.tickers?.length ? `<div class="chips" style="margin-top:6px">${n.tickers.map(t => `<button class="chip sm ac" data-open="${esc(t)}">${esc(t)}${mine.has(t) ? " ✓" : ""}</button>`).join("")}</div>` : ""}</div>`).join("") || empty); }
  b += note("발굴 목록은 아이디어 출발점이에요. 추천·급등 종목일수록 변동성이 크니 지표·대가 점수·뉴스를 함께 확인하세요.");
  if ($("#dBody")) $("#dBody").innerHTML = b;
}

// ═════════════ 서학개미·고수 ═════════════
const CW = { tab: 0, news: 0 };
function periodReturns(d) {
  if (!d || d.closes.length < 2) return [null, null, null];
  const c = d.closes, p = d.price ?? c[c.length - 1], one = d.times.findIndex(t => t >= Date.now() - 365.25 * DAY);
  const m1 = c[Math.max(0, c.length - 22)] > 0 ? (p / c[Math.max(0, c.length - 22)] - 1) * 100 : null;
  const y1 = one >= 0 && c[one] > 0 ? (p / c[one] - 1) * 100 : null;
  const ys = new Date(new Date().getFullYear(), 0, 1).getTime(), idx = d.times.findIndex(t => t >= ys);
  return [m1, idx > 0 && c[idx - 1] > 0 ? (p / c[idx - 1] - 1) * 100 : null, y1];
}
async function renderCrowd() {
  setHeader("🐜 서학개미·고수 픽", true);
  const cr = STATIC.crowd || {};
  let h = chipsHtml([[0, "🐜 서학개미 TOP 20"], [1, "🏅 상위 1% 고수"], [2, "📉 번 곳·잃은 곳"], [3, "📰 최신 뉴스"]], CW.tab, "wt");
  if (CW.tab === 3) h += `<div style="height:6px"></div>` + chipsHtml((cr.newsQueries || []).map((q, i) => [i, q[0]]), CW.news, "wn");
  h += `<div id="wBody" style="margin-top:8px"></div>`;
  $("#app").innerHTML = h;
  bindChips($("#app"), "wt", v => { CW.tab = v; renderCrowd(); });
  bindChips($("#app"), "wn", v => { CW.news = v; renderCrowd(); });
  const body = $("#wBody"), pc = v => `<b class="${v == null ? "muted" : v >= 0 ? "g" : "r"}" style="width:58px;text-align:right;font-size:12px">${v == null ? "—" : pct1(v / 100)}</b>`;
  const chipsOf = (list, color) => `<div class="chips">${list.map(t => { const isSym = /^[A-Z]{1,5}$/.test(t), known = [...allStocks().values()].find(s => s.ko === t);
    return `<button class="chip sm b" style="color:${color}" ${isSym ? `data-open="${t}"` : known ? `data-open="${known.t}"` : `data-url="https://m.stock.naver.com/search?query=${encodeURIComponent(t)}"`}>${esc(t)}</button>`; }).join("")}</div>`;
  const hub = await data("hub.json", 600_000) || {};
  const newsList = q => { const l = hub.crowd?.[q]; if (l?.length) return l.slice(0, 15).map(n => newsCard(n)).join(""); return `<div id="cwN">${note("최신 기사 불러오는 중…")}</div>`; };
  const lazyNews = async q => { if (hub.crowd?.[q]?.length || !$("#cwN")) return; const l = await newsSearch(q); if ($("#cwN")) $("#cwN").innerHTML = l.length ? l.slice(0, 15).map(n => newsCard(n)).join("") : note("기사를 불러오지 못했어요."); };
  if (CW.tab === 0) {
    body.innerHTML = `<div class="card"><div class="b ac">한국 개인투자자가 가장 많이 가진 해외 주식</div><div class="sub" style="margin-top:3px">순위·보관액: ${esc(cr.topAsOf)}<br>${esc(cr.latest).replace(/\n/g, "<br>")}<br>수익률은 지금 시세로 계산해요. 종목 탭 = 상세</div></div>
      <div class="row sub b" style="padding:0 12px 4px"><span class="grow">종목 · 보관액</span><span style="width:58px;text-align:right">1개월</span><span style="width:58px;text-align:right">올해</span><span style="width:58px;text-align:right">1년</span></div><div id="cwRows">${note("수익률 계산 중…")}</div>` +
      note("레버리지 ETF(TQQQ·SOXL·TSLL·QLD)는 같은 기간 기초지수보다 훨씬 크게 오르내려요. 1년 수익률 차이를 비교해 보세요.");
    const charts = await Promise.all((cr.top || []).map(x => Y.chart(x.sym, "2y", "1d")));
    if (!$("#cwRows")) return;
    $("#cwRows").innerHTML = (cr.top || []).map((x, i) => { const d = charts[i], [m1, ytd, y1] = periodReturns(d);
      return `<div class="card row" style="padding:9px 12px;margin-bottom:5px" data-open="${esc(x.sym)}" data-name="${esc(x.name)}"><div class="grow" style="min-width:0"><b>${x.rank}. ${esc(x.sym)}</b><div class="sub ell">${esc(x.name)} · ${esc(x.amount)}원${d ? " · " + money(d.price, x.sym) : ""}</div></div>${pc(m1)}${pc(ytd)}${pc(y1)}</div>`; }).join("");
  } else if (CW.tab === 1) {
    const picks = (t, l) => `<div class="b" style="font-size:15px;margin:12px 4px 6px">${t}</div>` + (l || []).map(p => `<div class="card"><div class="sub b">${esc(p.date)} · ${esc(p.src)}</div>
      <div class="small b g" style="margin:6px 0 3px">🟢 많이 산 종목</div>${chipsOf(p.buy, "var(--text)")}${p.sell?.length ? `<div class="small b r" style="margin:8px 0 3px">🔴 많이 판 종목</div>${chipsOf(p.sell, "var(--sub)")}` : ""}<div class="small" style="margin-top:8px;line-height:1.45">${esc(p.why)}</div></div>`).join("");
    body.innerHTML = `<div class="card"><div class="b ac">상위 1% 고수들의 공통 패턴</div>${(cr.patterns || []).map(p => `<div class="small" style="margin-top:4px;line-height:1.45">• ${esc(p)}</div>`).join("")}<div class="sub" style="margin-top:6px">미래에셋증권 '최근 1개월 수익률 상위 1%' 고객의 그날 순매수·순매도 집계예요 (보유 목록 아님).</div></div>` +
      picks("🇰🇷 국내 주식 (최근)", cr.proKr) + picks("🇺🇸 해외 주식", cr.proUs) + `<div class="b" style="font-size:15px;margin:14px 4px 6px">🔄 매일 갱신되는 고수 기사</div>` + newsList("주식 초고수는 지금");
    lazyNews("주식 초고수는 지금");
  } else if (CW.tab === 2) {
    body.innerHTML = (cr.cases || []).map(c => `<div class="card"><div class="b" style="font-size:14.5px">${esc(c.title)}</div><div class="sub" style="margin:2px 0 6px">${esc(c.period)} · ${esc(c.src)}</div>${c.lines.map(([k, v]) => `<div class="between small" style="padding:4px 0"><span>${esc(k)}</span><b class="${v.trim().startsWith("+") ? "g" : v.trim().startsWith("-") ? "r" : ""}">${esc(v)}</b></div>`).join("")}</div>`).join("") +
      `<div class="card small" style="line-height:1.5">💡 ${esc(cr.lesson)}</div>`;
  } else { const q = cr.newsQueries?.[CW.news]?.[1]; body.innerHTML = newsList(q); lazyNews(q); }
}

// ═════════════ 뉴스·기업분석 ═════════════
const NH = { tab: 0, group: -2 };
const newsKw = () => LS.get("newsKw", ["박주근의 기업분석", "기업분석 심층"]);
function dayList(items, empty) {
  if (!items.length) return note(empty);
  let last = "", h = "";
  for (const n of items) { const day = n.time ? new Date(n.time).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }) : "날짜 미상";
    if (day !== last) { last = day; h += `<div class="sub b" style="margin:8px 4px 4px">${day}</div>`; } h += newsCard(n, n.tag); }
  return h;
}
const mergeNews = all => all.filter((n, i, a) => a.findIndex(x => x.title.slice(0, 40) === n.title.slice(0, 40)) === i).sort((a, b) => b.time - a.time).slice(0, 80);
async function renderNewsHub() {
  setHeader("📰 뉴스·기업분석", true);
  let h = chipsHtml([[0, "⭐ 내 종목 뉴스"], [1, "🔍 기업분석·칼럼"], [2, "🇺🇸 미국 증시"], [3, "🇰🇷 국내 증시"]], NH.tab, "nt");
  if (NH.tab === 0) h += `<div style="height:6px"></div>` + chipsHtml([[-2, "★ 관심"], ...S.sectors.map((s, i) => [i, `${s.emoji} ${s.name}`])], NH.group, "ng");
  h += `<div id="nBody" style="margin-top:8px"><div class="spin">불러오는 중…</div></div>`;
  $("#app").innerHTML = h;
  bindChips($("#app"), "nt", v => { NH.tab = v; renderNewsHub(); });
  bindChips($("#app"), "ng", v => { NH.group = v; renderNewsHub(); });
  const hub = await data("hub.json", 600_000) || {};
  let b = "";
  if (NH.tab === 0) {
    const stocks = (NH.group === -2 ? S.sectors.flatMap(s => s.stocks).filter((x, i, a) => S.favs.has(x.t) && a.findIndex(y => y.t === x.t) === i) : S.sectors[NH.group]?.stocks || []).filter(x => !x.etf).slice(0, 20);
    if (!stocks.length) b = note(NH.group === -2 ? "관심 종목이 없어요. 종목 상세에서 ☆를 누르거나 위에서 섹터를 골라보세요." : "종목이 없어요");
    else {
      const got = await Promise.all(stocks.map(async st => { const n = await data(`n/${fname(st.t)}.json`, 600_000); return (n?.ko || []).map(x => ({ ...x, tag: `${st.ko} ${st.t.split(".")[0]}` })); }));
      b = note(`${stocks.length}개 종목 최근 뉴스를 최신순으로 모았어요. 기사를 누르면 원문이 열려요.`) + dayList(mergeNews(got.flat()), "뉴스가 없어요");
    }
  } else if (NH.tab === 1) {
    const kws = newsKw(), favs = S.sectors.flatMap(s => s.stocks).filter((x, i, a) => S.favs.has(x.t) && !x.etf && a.findIndex(y => y.t === x.t) === i).slice(0, 10);
    b = `<div class="card"><div class="b ac small">구독 중인 연재·키워드</div>${kws.map(k => `<div class="between" style="padding:4px 0"><span style="font-size:14px">• ${esc(k)}</span><button class="iconbtn" style="font-size:16px;width:30px;height:30px" data-kx="${esc(k)}">✕</button></div>`).join("")}
      <div class="small b ac" id="kwAdd" style="margin-top:8px">＋ 연재·키워드 추가 (예: 박주근의 기업분석)</div>${favs.length ? `<div class="sub" style="margin-top:6px">+ 관심 종목 ${favs.length}개의 기업분석 기사도 함께 모아요</div>` : ""}</div><div id="kwList">${note("불러오는 중…")}</div>`;
    $("#nBody").innerHTML = b;
    $("#nBody").querySelectorAll("[data-kx]").forEach(x => x.onclick = () => { LS.set("newsKw", kws.filter(k => k !== x.dataset.kx)); renderNewsHub(); });
    $("#kwAdd").onclick = () => { const k = prompt("연재 이름이나 키워드", "예: 박주근의 기업분석"); if (k && k.trim() && !k.startsWith("예:")) { LS.set("newsKw", [...new Set([...kws, k.trim()])]); renderNewsHub(); } };
    const lists = await Promise.all([...kws.map(async k => (hub.kw?.[k] || await newsSearch(`"${k}"`)).map(n => ({ ...n, tag: "📌 " + k }))),
      ...favs.map(async st => ((await data(`n/${fname(st.t)}.json`, 600_000))?.an || []).map(n => ({ ...n, tag: "🔍 " + st.ko })))]);
    if ($("#kwList")) $("#kwList").innerHTML = dayList(mergeNews(lists.flat()), "기사가 없어요. 연재 이름을 정확히 넣었는지 확인해 보세요.");
    return;
  } else {
    let l = NH.tab === 2 ? hub.us : hub.kr;
    if (!l?.length) { const qs = NH.tab === 2 ? [["미국 증시", "뉴욕증시 OR 미국증시"], ["나스닥", "나스닥 마감"], ["연준", "연준 금리"]] : [["코스피", "코스피 마감"], ["코스닥", "코스닥 마감"], ["환율", "원달러 환율"]];
      l = mergeNews((await Promise.all(qs.map(async ([t, q]) => (await newsSearch(q)).map(n => ({ ...n, tag: t }))))).flat()); }
    b = dayList(l, "뉴스가 없어요");
  }
  if ($("#nBody")) $("#nBody").innerHTML = b;
}

// ═════════════ S&P 500 ═════════════
const GICS = { "Information Technology": "정보기술", "Health Care": "헬스케어", "Financials": "금융", "Consumer Discretionary": "경기소비재", "Communication Services": "커뮤니케이션", "Industrials": "산업재", "Consumer Staples": "필수소비재", "Energy": "에너지", "Utilities": "유틸리티", "Real Estate": "부동산", "Materials": "소재" };
const gicsKo = s => GICS[s] || s;
const SP = { tab: 0, mode: 0, q: "" }, MIN_CAP = 22.7e9;
async function renderSp500() {
  setHeader("🇺🇸 S&P 500", true);
  $("#app").innerHTML = chipsHtml([[0, "📋 전체 종목"], [1, "📰 편입·퇴출"], [2, "🎯 편입 후보"], [3, "⚠️ 퇴출 위험"]], SP.tab, "pt") + `<div id="pBody" style="margin-top:8px"><div class="spin">S&P 500 목록 불러오는 중…</div></div>`;
  bindChips($("#app"), "pt", v => { SP.tab = v; renderSp500(); });
  const d = await sp500Data();
  if (!d) { $("#pBody").innerHTML = note("S&P 500 목록을 아직 받지 못했어요. GitHub이 데이터를 모으는 중이에요 (최대 20분)."); return; }
  const cap = s => d.q?.[s]?.[0] > 0 ? d.q[s][0] : null;
  const row = (sym, name, right, color, sub) => `<div class="card row" style="padding:10px 12px;margin-bottom:4px" data-open="${esc(sym)}" data-name="${esc(name)}"><div class="grow" style="min-width:0"><b>${esc(sym)}</b><div class="sub ell">${esc(name)}</div>${sub ? `<div class="sub ell2">${esc(sub)}</div>` : ""}</div><b style="color:${color};text-align:right">${esc(right)}</b></div>`;
  let b = "";
  if (SP.tab === 0) {
    b = `<input id="spQ" placeholder="종목·티커 검색" value="${esc(SP.q)}" autocomplete="off"><div style="height:6px"></div>` + chipsHtml([[0, "💰 시가총액순"], [1, "🏭 업종별"]], SP.mode, "pm") + `<div id="spList" style="margin-top:6px"></div>`;
    $("#pBody").innerHTML = b;
    bindChips($("#pBody"), "pm", v => { SP.mode = v; renderSp500(); });
    const draw = () => {
      const q = SP.q.trim().toLowerCase(), ranked = d.m.filter(m => cap(m[0])).sort((a, b) => cap(b[0]) - cap(a[0])), rank = new Map(ranked.map((m, i) => [m[0], i + 1]));
      const total = d.m.reduce((a, m) => a + (cap(m[0]) || 0), 0), list = d.m.filter(m => !q || m[0].toLowerCase().includes(q) || m[1].toLowerCase().includes(q));
      const r = m => { const c = cap(m[0]), qq = d.q?.[m[0]]; return row(m[0], m[1], c ? bigUsd(c) : "—", "var(--text)", `${rank.get(m[0]) ? rank.get(m[0]) + "위 · " : ""}${gicsKo(m[2])}${c && total ? ` · 비중 ${(c / total * 100).toFixed(2)}%` : ""}${qq?.[1] ? `  ·  $${f2(qq[1])} ${pct(qq[2])}` : ""}`); };
      const byRank = l => [...l].sort((a, b) => (rank.get(a[0]) || 9999) - (rank.get(b[0]) || 9999));
      let h = note(`구성 종목 ${d.m.length}개 · 합계 시총 ${bigUsd(total)}${q ? " · 검색 결과 " + list.length : ""}${d.qat ? " · 시총 " + ago(d.qat) + " 기준" : ""}`);
      if (SP.mode === 0) h += byRank(list).slice(0, q ? 600 : 503).map(r).join("");
      else { const g = {}; list.forEach(m => (g[m[2]] = g[m[2]] || []).push(m));
        h += Object.entries(g).sort((a, b) => b[1].reduce((s, m) => s + (cap(m[0]) || 0), 0) - a[1].reduce((s, m) => s + (cap(m[0]) || 0), 0)).map(([sec, ms]) => { const sc = ms.reduce((s, m) => s + (cap(m[0]) || 0), 0);
          return `<div class="b ac small" style="margin:10px 4px 4px">${esc(gicsKo(sec))} (${ms.length}) · ${bigUsd(sc)}${total ? ` · ${(sc / total * 100).toFixed(1)}%` : ""}</div>` + byRank(ms).map(r).join(""); }).join(""); }
      $("#spList").innerHTML = h;
    };
    draw(); let t; $("#spQ").oninput = e => { SP.q = e.target.value; clearTimeout(t); t = setTimeout(draw, 250); };
    return;
  }
  if (SP.tab === 1) {
    b = `<div class="card small" style="line-height:1.5">S&P 500은 보통 3·6·9·12월 셋째 금요일 무렵 정기 변경(발표는 약 2주 전)하고, 인수합병 등이 생기면 수시로 바꿔요. 편입되면 지수 펀드들이 의무적으로 사야 해서 주가가 오르는 경우가 많고, 퇴출되면 반대예요.</div>`;
    const groups = []; d.c.forEach(c => { const g = groups.find(x => x[0] === c[0]); g ? g[1].push(c) : groups.push([c[0], [c]]); });
    b += groups.slice(0, 25).map(([date, l]) => { const up = Date.parse(date) > Date.now();
      return `<div class="b small" style="margin:12px 4px 4px;color:${up ? YEL : "var(--accent)"}">${up ? "🔜 " : ""}${esc(date)}${up ? "  (예정)" : ""}</div>` + l.map(c => (c[1] ? row(c[1], c[2], "➕ 편입", GOOD, c[5]) : "") + (c[3] ? row(c[3], c[4], "➖ 퇴출", ORG) : "")).join(""); }).join("");
    b += note("출처: 위키백과 'List of S&P 500 companies' (S&P 다우존스 발표를 정리). 종목을 탭하면 상세 화면으로 가요.");
  } else if (SP.tab === 2) {
    await refreshMetrics();
    const members = new Set(d.m.map(m => m[0]));
    b = `<div class="card"><div class="b ac">S&P 500 편입 조건 (S&P 다우존스)</div><div class="small" style="margin-top:4px;line-height:1.55">• 시가총액 ${bigUsd(MIN_CAP)} 이상<br>• 최근 4개 분기 순이익 합계 흑자 + 가장 최근 분기도 흑자<br>• 미국 기업 (본사·상장: NYSE·나스닥)<br>• 상장 후 12개월 경과<br>• 유동주식 10% 이상, 거래량 충분<br>• 조건을 채워도 위원회가 업종 균형을 보고 결정 — 자동 편입 아님</div></div>`;
    const pool = S.sectors.flatMap(s => s.stocks).filter((x, i, a) => a.findIndex(y => y.t === x.t) === i && !x.etf && !isKr(x.t) && !members.has(x.t) && !x.ko.includes("ADR") && MET[x.t]?.us !== 0);
    const rows = pool.map(st => [st, capUsd(st.t), MET[st.t]?.eps]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
    b += `<div class="b ac small" style="margin:12px 4px 4px">내 목록 중 S&P 500에 없는 미국 종목 (시총순)</div>` + (rows.map(([st, c, eps]) => { const capOk = c >= MIN_CAP, profit = eps == null ? null : eps > 0, ok = capOk && profit === true;
      return row(st.t, st.ko, ok ? "🎯 조건 충족" : capOk ? "흑자 아님" : "시총 미달", ok ? GOOD : capOk ? YEL : "var(--sub)", `시총 ${bigUsd(c)} ${capOk ? "✅" : "❌"}  ·  최근 1년 ${profit === true ? "흑자 ✅" : profit === false ? "적자 ❌" : "이익 정보 없음"}`); }).join("") || note("해당 종목이 없어요"));
    b += note("🎯 조건 충족 = 시총·흑자 기준만 통과한 '후보'예요. 상장 기간·유동주식·업종 균형 등은 앱이 확인할 수 없어서, 실제 편입은 S&P 발표로만 확정돼요.");
  } else {
    b = `<div class="card small" style="line-height:1.5">퇴출은 보통 ① 인수합병으로 사라지거나 ② 새 종목이 들어올 때 시가총액이 작아진 종목이 밀려나는 경우예요. 아래는 시총 하위 종목이라 다음 정기 변경 때 빠질 가능성이 상대적으로 높아요 (확정 아님).</div>`;
    const low = d.m.filter(m => cap(m[0])).sort((a, b) => cap(a[0]) - cap(b[0])).slice(0, 25);
    b += `<div class="b ac small" style="margin:12px 4px 4px">시가총액 하위 25 (신규 편입 기준 ${bigUsd(MIN_CAP)}과 비교)</div>` + low.map((m, i) => row(m[0], m[1], bigUsd(cap(m[0])), cap(m[0]) < MIN_CAP / 2 ? ORG : "var(--text)", `하위 ${i + 1}위 · ${gicsKo(m[2])}${cap(m[0]) < MIN_CAP ? " · 신규 편입 기준 미달" : ""}`)).join("");
  }
  $("#pBody").innerHTML = b;
}

// ═════════════ 지표 사전 · 대가들의 투자법 ═════════════
function renderGlossary() {
  setHeader("📖 지표 사전", true);
  let last = "", h = note("종목 상세 화면의 '주요 지표'에 나오는 용어들이에요. 각 지표는 업종마다 적정 수준이 다르니, 같은 업종끼리 비교하는 게 좋아요.");
  for (const t of STATIC.glossary) {
    if (t.group !== last) { last = t.group; h += `<div class="sec">${esc(t.group)}</div>`; }
    h += `<div class="card fold"><div class="b" style="font-size:15px">${esc(t.label)}</div><div class="small ac" style="margin-top:2px">${esc(t.short)}</div>${t.long !== t.short ? `<div class="more hidden small" style="margin-top:6px;white-space:pre-wrap;line-height:1.5;color:var(--sub)">${esc(t.long)}</div>` : ""}</div>`;
  }
  $("#app").innerHTML = h + `<div class="sub" style="text-align:center;margin-top:12px">카드를 탭하면 자세한 설명이 펼쳐져요.</div>`;
  bindFolds($("#app"));
}
function renderGuruIntro(arg) {
  setHeader("📚 대가들의 투자법·책", true);
  const focus = arg?.length ? +arg[0] : -1;
  let h = note("대가들이 어떤 기준으로, 어떻게 투자해서 성공했는지와 대표 책을 정리했어요. 카드를 탭하면 자세히 펼쳐져요.<br>앱의 '대가별' 점수는 이 원칙들을 숫자 체크리스트로 단순화한 참고용이에요.");
  h += `<div class="card"><div class="b" style="font-size:15px">📏 대가별 숫자 기준 한눈에</div><table class="mini guru"><tr><th>대가</th><th>가격(밸류) 기준</th><th>핵심 숫자</th></tr>` +
    STATIC.gurus.map((g, i) => { const t = STATIC.rulesTable[g.id]; return t ? `<tr data-gf="${i}"><td class="b">${esc(g.name)}</td><td>${esc(t[0]).replace(/\n/g, "<br>")}</td><td>${esc(t[1]).replace(/\n/g, "<br>")}</td></tr>` : ""; }).join("") +
    `</table><div class="sub" style="margin-top:6px">대가 이름을 탭하면 아래 상세 카드로 이동해요.</div></div>` + note("📘 본인이 책·주주서한에서 밝힌 기준   🔧 앱이 숫자로 옮긴 해석");
  STATIC.gurus.forEach((g, i) => {
    const s = STATIC.stories[g.id] || {}, rules = STATIC.rules[g.id] || [], open = i === focus;
    const hd = t => `<div class="b ac small" style="margin:12px 0 3px">${t}</div>`, bd = t => `<div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap">${esc(t)}</div>`;
    h += `<div class="card fold" id="gc${i}"><div class="b" style="font-size:17px">${esc(g.name)}</div><div class="small b ac" style="margin-top:2px">${esc(g.style)}</div><div class="small" style="margin-top:6px;line-height:1.45">${esc(g.idea)}</div>
      ${s.books?.length ? `<div class="sub" style="margin-top:8px">📖 ${esc(s.books[0])}</div>` : ""}
      ${rules.length ? hd("📏 숫자로 본 투자 기준") + rules.map(r => `<div class="small" style="margin-top:4px;line-height:1.5;${r.startsWith("🔧") ? "color:var(--sub)" : ""}">${esc(r)}</div>`).join("") : ""}
      <div class="more ${open ? "" : "hidden"}">${s.saying ? `<div class="card2 b" style="margin-top:10px;color:${YEL};line-height:1.45">💬 “${esc(s.saying)}”</div>` : ""}
        ${s.books ? hd("📚 대표 책") + bd(s.books.map(b => "•  " + b).join("\n")) : ""}${s.career ? hd("🏆 어떻게 성공했나") + bd(s.career) : ""}${s.principles ? hd("🧭 핵심 투자 원칙") + bd(s.principles.map(b => "•  " + b).join("\n")) : ""}
        ${s.cases ? hd("💡 대표 투자 사례") + bd(s.cases) : ""}${s.limits ? hd("⚠️ 한계·주의할 점") + bd(s.limits) : ""}
        <a class="link" href="#/" data-guru="${i}" style="font-size:14px">이 기준으로 종목 순위 보기 →</a></div>
      <div class="small b ac tg" data-c="자세히 ▾" style="margin-top:8px">${open ? "접기 ▴" : "자세히 ▾"}</div></div>`;
  });
  $("#app").innerHTML = h;
  bindFolds($("#app"));
  $("#app").querySelectorAll("[data-gf]").forEach(tr => tr.onclick = () => { const c = $("#gc" + tr.dataset.gf); $(".more", c).classList.remove("hidden"); $(".tg", c).textContent = "접기 ▴"; c.scrollIntoView({ behavior: "smooth" }); });
  $("#app").querySelectorAll("[data-guru]").forEach(a => a.onclick = e => { e.preventDefault(); H.tab = -3; H.guru = +a.dataset.guru; saveH(); go(""); });
  if (focus >= 0) setTimeout(() => $("#gc" + focus)?.scrollIntoView(), 50);
}

// ═════════════ 섹터 순서·관리 ═════════════
function renderSectors() {
  setHeader("🗂 섹터 순서·관리", true);
  $("#app").innerHTML = note("오른쪽 ≡ 를 누른 채 위아래로 끌면 순서가 바뀌어요. 홈 위쪽 탭과 메뉴에도 바로 반영돼요.") + `<div id="secList">${S.sectors.map((s, i) => `<div class="card row secrow" data-i="${i}" style="padding:10px 12px;margin-bottom:6px">
      <span style="font-size:20px">${esc(s.emoji)}</span><div class="grow"><b>${esc(s.name)}</b><div class="sub">${s.stocks.length}개 종목</div></div>
      <button class="iconbtn" style="font-size:16px" data-ren="${i}">✏️</button><button class="iconbtn" style="font-size:16px" data-del="${i}">🗑</button><span class="handle">≡</span></div>`).join("")}</div>
    <button class="btn ghost" id="secAdd" style="color:var(--accent)">＋ 섹터 추가</button>`;
  $("#app").querySelectorAll("[data-ren]").forEach(b => b.onclick = () => renameSector(+b.dataset.ren, renderSectors));
  $("#app").querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteSector(+b.dataset.del, renderSectors));
  $("#secAdd").onclick = () => addSector(renderSectors);
  // 끌어서 순서 바꾸기 (≡ 손잡이)
  const list = $("#secList");
  list.querySelectorAll(".handle").forEach(hd => hd.addEventListener("pointerdown", e => {
    e.preventDefault(); hd.setPointerCapture(e.pointerId);
    const row = hd.closest(".secrow"); let base = e.clientY; row.classList.add("drag");
    hd.onpointermove = ev => {
      row.style.transform = `translateY(${ev.clientY - base}px)`;
      const rows = [...list.children], idx = rows.indexOf(row), prev = rows[idx - 1], next = rows[idx + 1];
      const r = row.getBoundingClientRect(), mid = r.top + r.height / 2;
      const swap = (a, b, other) => { const before = row.getBoundingClientRect().top; list.insertBefore(a, b); base += row.getBoundingClientRect().top - before - 0; row.style.transform = `translateY(${ev.clientY - base}px)`; };
      if (prev) { const pr = prev.getBoundingClientRect(); if (mid < pr.top + pr.height / 2) swap(row, prev); }
      if (next) { const nr = next.getBoundingClientRect(); if (mid > nr.top + nr.height / 2) swap(next, row); }
    };
    hd.onpointerup = hd.onpointercancel = () => {
      hd.onpointermove = hd.onpointerup = hd.onpointercancel = null;
      const cur = H.tab >= 0 ? S.sectors[H.tab] : null;
      S.sectors = [...list.children].map(r => S.sectors[+r.dataset.i]); if (cur) H.tab = S.sectors.indexOf(cur);
      S.save(); saveH(); renderSectors();
    };
  }));
}
function addSector(done) {
  const name = prompt("새 섹터 이름 (예: 2차전지)"); if (!name?.trim()) return;
  const emoji = prompt("이모지 하나 (선택)", "📁") || "📁";
  S.sectors.push({ name: name.trim(), emoji: emoji.trim() || "📁", stocks: [] }); S.deleted.delete("sector:" + name.trim()); S.save(); toast("섹터를 추가했어요"); done ? done() : render();
}
function renameSector(i, done) {
  const s = S.sectors[i]; if (!s) return; const n = prompt("섹터 이름", s.name); if (!n?.trim()) return;
  S.deleted.add("sector:" + s.name); s.name = n.trim(); S.save(); done ? done() : render();
}
function deleteSector(i, done) {
  const s = S.sectors[i]; if (!s || !confirm(`'${s.name}' 섹터를 삭제할까요?`)) return;
  S.deleted.add("sector:" + s.name); S.sectors.splice(i, 1); if (H.tab === i) H.tab = -1; else if (H.tab > i) H.tab--; S.save(); saveH(); done ? done() : render();
}
function resetAll() {
  if (!confirm("추가·삭제한 종목과 섹터가 기본 목록으로 돌아가요. (관심 종목·메모는 유지)")) return;
  S.sectors = JSON.parse(JSON.stringify(CATALOG)); S.deleted.clear(); H.tab = -1; S.save(); saveH(); toast("초기화했어요"); go("");
}

// ═════════════ 메뉴 · 화면 이동 ═════════════
// 메뉴의 섹터 줄 꾹 누르기: 그대로 떼면 메뉴(이름·이모지·삭제), 누른 채 위아래로 끌면 순서 바꾸기
const DR_DRAG = { justDragged: false };
// 메뉴 줄 공통 꾹 누르기: 그대로 떼면 onMenu(row), 누른 채 위아래로 끌면 같은 묶음(box) 안에서 순서 바꾸고 onDrop(rows)
function rowDrag(row, box, onMenu, onDrop) {
  let timer, dragging = false, moved = false, startY = 0, base = 0;
  const end = () => {
    clearTimeout(timer);
    if (!dragging) return;
    dragging = false; row.classList.remove("lift"); row.style.transform = "";
    DR_DRAG.justDragged = true; setTimeout(() => DR_DRAG.justDragged = false, 350);
    if (!moved) onMenu(row); else onDrop([...box.children].filter(r => r.classList.contains("drsec")));
  };
  row.addEventListener("touchstart", e => {
    startY = base = e.touches[0].clientY; moved = false;
    timer = setTimeout(() => { dragging = true; navigator.vibrate?.(20); row.classList.add("lift"); }, 420);
  }, { passive: true });
  row.addEventListener("touchmove", e => {
    const y = e.touches[0].clientY;
    if (!dragging) { if (Math.abs(y - startY) > 10) clearTimeout(timer); return; }
    e.preventDefault();
    if (Math.abs(y - startY) > 12) moved = true;
    row.style.transform = `translateY(${y - base}px)`;
    const r = row.getBoundingClientRect(), cy = r.top + r.height / 2, next = row.nextElementSibling, prev = row.previousElementSibling;
    if (next) { const n = next.getBoundingClientRect(); if (cy > n.top + n.height / 2) { box.insertBefore(next, row); base += n.height; row.style.transform = `translateY(${y - base}px)`; } }
    if (prev) { const p = prev.getBoundingClientRect(); if (cy < p.top + p.height / 2) { box.insertBefore(row, prev); base -= p.height; row.style.transform = `translateY(${y - base}px)`; } }
  }, { passive: false });
  row.addEventListener("touchend", end); row.addEventListener("touchcancel", end);
  row.addEventListener("contextmenu", e => { e.preventDefault(); if (!("ontouchstart" in window)) onMenu(row); });
}
function drawerDrag(row) {
  const box = $("#drSecs");
  rowDrag(row, box, r => chipMenu(S.sectors[+r.dataset.si]), rows => {
    const cur = H.tab >= 0 ? S.sectors[H.tab] : null;
    const order = rows.map(r => S.sectors[+r.dataset.si]);
    if (order.length === S.sectors.length) { S.sectors = order; if (cur) H.tab = S.sectors.indexOf(cur); S.save(); saveH(); }
    drawer(true); if (route().name === "home") renderHome(true);
  });
}
// 공부하기 메뉴: 순서·숨김을 기기에 저장
const STUDY = t => ({
  compare: ["⚖️", "종목 비교 (PER·PBR·성장률…)", "go:compare/" + (t >= 0 ? t : -2) + "/0"],
  discover: ["🔭", "종목 발굴 (화제·스크리너·전문가)", "go:discover"],
  signals: ["🚦", "매수 타이밍 신호 (공포지수·VIX·RSI)", "go:signals"],
  screener: ["🟢", "매수 신호 많은 종목", "go:screener"],
  econ: ["📅", "경제 캘린더 (CPI·고용·금리 발표)", "go:econ"],
  x: ["🧙", "미너비니 X 글 (지금 위험한가?)", "go:x"],
  crowd: ["🐜", "서학개미·상위 1% 고수 픽", "go:crowd"],
  news: ["📰", "뉴스·기업분석 모아보기", "go:news"],
  sp500: ["🇺🇸", "S&P 500 · 편입/퇴출", "go:sp500"],
  glossary: ["📖", "지표 사전 (PER·PBR·EPS…)", "go:glossary"],
  gurus: ["📚", "대가들의 투자법·책", "go:gurus"],
});
function studyOrder(all) { const saved = LS.get("studyOrder", []).filter(k => k in all); return saved.concat(Object.keys(all).filter(k => !saved.includes(k))); }
function studyMenu(row) {
  const k = row.dataset.sk, [icon, label] = STUDY(H.tab)[k];
  sheet(`<div class="b" style="font-size:17px">${icon} ${esc(label)}</div><div class="sub" style="margin:4px 0 8px">팁: 꾹 누른 채 위아래로 끌면 순서가 바뀌어요</div><div class="hit" data-sm="hide">🙈 메뉴에서 숨기기</div><div class="hit" data-sm="close">닫기</div>`,
    el => el.querySelectorAll("[data-sm]").forEach(d => d.onclick = () => {
      closeSheet();
      if (d.dataset.sm === "hide") { const h = new Set(LS.get("studyHidden", [])); h.add(k); LS.set("studyHidden", [...h]); drawer(true); toast("숨겼어요. 맨 아래 '숨긴 메뉴'에서 다시 꺼낼 수 있어요"); }
    }));
}
function studyUnhide() {
  const all = STUDY(H.tab), hid = studyOrder(all).filter(k => LS.get("studyHidden", []).includes(k));
  sheet(`<div class="b" style="font-size:17px">다시 보일 메뉴</div>` + hid.map(k => `<div class="hit" data-uh="${k}">${all[k][0]} ${esc(all[k][1])}</div>`).join(""),
    el => el.querySelectorAll("[data-uh]").forEach(d => d.onclick = () => {
      closeSheet(); LS.set("studyHidden", LS.get("studyHidden", []).filter(x => x !== d.dataset.uh)); drawer(true);
    }));
}
function drawer(open) {
  $("#drawer").classList.toggle("hidden", !open); $("#drawerBg").classList.toggle("hidden", !open);
  if (!open) return;
  const r = route(), home = r.name === "home";
  const item = (icon, label, act, sel, sub) => `<a class="item row" data-act="${act}" style="${sel ? "background:var(--card2)" : ""}"><span style="width:30px;font-size:17px">${icon}</span><span class="grow ${sel ? "ac b" : ""}">${esc(label)}</span>${sub != null ? `<span class="sub">${sub}</span>` : ""}</a>`;
  const t = H.tab, hidden = LS.get("studyHidden", []).filter(k => k in STUDY(t));
  $("#drawer").innerHTML = `<div class="b" style="font-size:22px;padding:0 12px">StockRadar</div><div class="sub" style="padding:2px 12px 6px">${Q._at ? "시세 " + ago(Q._at) + " 기준" : ""}</div>
    <div class="grp">보기</div>${item("★", "관심 종목", "tab:-2", home && t === -2, S.favs.size)}${item("🧠", "대가별 종목 순위", "tab:-3", home && t === -3, STATIC.gurus.length + "명")}${item("📋", "전체 종목", "tab:-1", home && t === -1)}
    <div id="drSecs">${S.sectors.map((s, i) => item(s.emoji, s.name, "tab:" + i, home && t === i, s.stocks.length).replace('<a class="item row"', `<a class="item row drsec" data-si="${i}"`)).join("")}</div>
    <div class="sub" style="padding:2px 12px 6px">섹터를 꾹 누르면 이름 바꾸기·삭제, 꾹 누른 채 위아래로 끌면 순서 바꾸기</div><div class="divider"></div>
    <div class="grp">공부하기</div><div id="drStudy">${studyOrder(STUDY(t)).filter(k => !hidden.includes(k)).map(k => { const [ic, lb, act] = STUDY(t)[k]; return item(ic, lb, act).replace('<a class="item row"', `<a class="item row drsec" data-sk="${k}"`); }).join("")}</div>
    ${hidden.length ? item("🙈", `숨긴 메뉴 ${hidden.length}개 다시 보이기`, "unhide") : ""}
    <div class="sub" style="padding:2px 12px 6px">메뉴를 꾹 누르면 숨기기, 꾹 누른 채 위아래로 끌면 순서 바꾸기</div><div class="divider"></div>
    <div class="grp">관리</div>${item("＋", "종목 추가 (섹터 자동 분류)", "addstock")}${item("＋", "섹터 추가", "addsec")}
    ${item("↺", "기본 유망주 목록으로 초기화", "reset")}<div class="divider"></div>
    <div class="grp">설정</div>${item("🔑", "AI 뉴스 요약 설정", "go:settings", false, LS.get("gemFree", "") ? "사용 중" : "키 없음")}${item("⟳", "지금 시세 새로고침", "refresh")}
    <div class="sub" style="padding:14px 12px 0">시세·지표: Yahoo Finance · 뉴스: Google 뉴스·Yahoo<br>투자 권유가 아닌 정보 모음이에요.</div>`;
  $("#drSecs").querySelectorAll(".drsec").forEach(drawerDrag);
  $("#drStudy").querySelectorAll(".drsec").forEach(r => rowDrag(r, $("#drStudy"), studyMenu, rows => { LS.set("studyOrder", rows.map(x => x.dataset.sk).concat(LS.get("studyHidden", []))); drawer(true); }));
  $("#drawer").querySelectorAll("[data-act]").forEach(a => a.onclick = () => {
    if (DR_DRAG.justDragged) return;
    drawer(false); const [k, v] = a.dataset.act.split(/:(.*)/);
    if (k === "tab") { H.tab = +v; saveH(); route().name === "home" ? renderHome(true) : go(""); window.scrollTo(0, 0); }
    else if (k === "go") go(v);
    else if (k === "addstock") addStockSheet(-1);
    else if (k === "addsec") addSector();
    else if (k === "rensec") renameSector(H.tab);
    else if (k === "delsec") deleteSector(H.tab);
    else if (k === "reset") resetAll();
    else if (k === "unhide") { drawer(true); studyUnhide(); }
    else if (k === "refresh") { quotesAt = 0; _dc.clear(); render(true); toast("새로고침"); }
  });
}

async function render(force) {
  const r = route();
  $("#drawer").classList.add("hidden"); $("#drawerBg").classList.add("hidden"); closeSheet();
  LS.set("lastHash", location.hash);
  if (r.name !== "home") window.scrollTo(0, 0);
  const a = r.args;
  switch (r.name) {
    case "home": return renderHome(false, force);
    case "detail": return renderDetail(r.sym, force);
    case "signals": return renderSignals(force);
    case "settings": return renderSettings();
    case "compare": return renderCompare(a);
    case "discover": return renderDiscover();
    case "crowd": return renderCrowd();
    case "news": return renderNewsHub();
    case "sp500": return renderSp500();
    case "glossary": return renderGlossary();
    case "gurus": return renderGuruIntro(a);
    case "sectors": return renderSectors();
    case "screener": return renderScreener();
    case "econ": return renderEcon();
    case "x": return renderX();
  }
  go("");
}


// ═════════════ 매수 신호 많은 종목 ═════════════
const SC = { scope: LS.get("scScope", 0), min: LS.get("scMin", 2), view: 0, week: null };
const SIG_COLOR = { 2: GOOD, 1: AMB, 0: "#3A3F52", "-1": "var(--red)" };
async function renderScreener() {
  setHeader("🟢 매수 신호 많은 종목", true);
  const viewChips = chipsHtml([[0, "🟢 지금 신호"], [1, "📅 주별 기록 · 맞았나?"]], SC.view || 0, "scv") + `<div style="height:6px"></div>`;
  if (SC.view === 1) return renderSigHistory(viewChips);
  $("#app").innerHTML = viewChips + chipsHtml([[0, "⭐ 내 종목"], [1, "🇺🇸 S&P 500"], [2, "전체"]], SC.scope, "scs") + `<div style="height:6px"></div>` +
    chipsHtml([[1, "🟢 1개 이상"], [2, "🟢 2개 이상"], [3, "🟢 3개 이상"], [4, "🟢 4개 이상"]], SC.min, "scm") + `<div id="scBody" style="margin-top:8px"><div class="spin">신호 불러오는 중…</div></div>`;
  bindChips($("#app"), "scv", v => { SC.view = v; renderScreener(); });
  bindChips($("#app"), "scs", v => { SC.scope = v; LS.set("scScope", v); renderScreener(); });
  bindChips($("#app"), "scm", v => { SC.min = v; LS.set("scMin", v); renderScreener(); });
  const d = await data("signals.json", 600_000);
  if (!d?.rows) { $("#scBody").innerHTML = note("아직 계산된 신호가 없어요. GitHub이 20분마다 계산해요."); return; }
  const mine = allStocks();
  const list = Object.entries(d.rows).filter(([sym, r]) => SC.scope === 2 || (SC.scope === 0 ? mine.has(sym) : r.sp))
    .map(([sym, r]) => ({ sym, ...r, n: mine.get(sym)?.ko || r.n, g: r.s.filter(x => x[2] === 2).length, y: r.s.filter(x => x[2] === 1).length, total: r.s.length }))
    .filter(r => r.g >= SC.min)
    .sort((a, b) => b.g - a.g || b.y - a.y || parseFloat(a.s.find(x => x[0] === "MDD")?.[1] || 0) - parseFloat(b.s.find(x => x[0] === "MDD")?.[1] || 0));
  let h = `<div class="card small" style="line-height:1.5">종목마다 앱의 매수 타이밍 신호 5가지(RSI 일봉·주봉, 고점 대비 낙폭, 200일선, 200주선)를 계산해서 <b class="g">초록(매수 구간)</b>이 많이 켜진 순서로 모았어요.<br><span class="sub">개별 종목은 이유가 있어서 빠지는 경우가 많아요(실적 악화 등). 신호가 많다고 바로 사기보다 뉴스·지표를 먼저 확인하세요. ${ago(d.at)} 계산 · 20분마다 갱신</span></div>`;
  if (!list.length) h += note(`조건에 맞는 종목이 없어요. 위에서 '🟢 ${Math.max(1, SC.min - 1)}개 이상'으로 낮춰 보세요.`);
  let last = -1;
  for (const r of list.slice(0, 300)) {
    if (r.g !== last) { last = r.g; const cnt = list.filter(x => x.g === r.g).length;
      h += `<div class="b" style="margin:14px 4px 6px;font-size:15px;color:${r.g >= 4 ? GOOD : r.g >= 3 ? "#7BD88F" : "var(--text)"}">${r.g === r.total ? `🟢 ${r.g}개 모두 초록` : `🟢 ${r.g}개`} <span class="sub">· ${cnt}종목${r.g >= 4 ? " · 여러 지표가 같이 바닥권" : r.g === 3 ? " · 비중 크게 고려 구간" : r.g === 2 ? " · 매수 준비" : ""}</span></div>`; }
    h += `<div class="card" style="padding:11px 14px;margin-bottom:6px" data-open="${esc(r.sym)}" data-name="${esc(r.n)}"><div class="between"><div style="min-width:0"><b>${esc(r.sym)}</b>${r.my ? ` <span class="small g">✓ 내 목록</span>` : ""}<div class="sub ell">${esc(r.n)}${r.sec ? " · " + esc(gicsKo(r.sec)) : ""}</div></div>
      <div style="text-align:right;flex:none"><b class="g">🟢${r.g}</b> <span style="color:${AMB}">🟡${r.y}</span><div class="sub">/ ${r.total}개</div></div></div>
      <div class="chips" style="margin-top:6px;flex-wrap:wrap;overflow:visible">${r.s.map(([n, v, st]) => `<span class="badge" style="background:${SIG_COLOR[st]};font-size:11px;padding:3px 7px">${esc(n)} ${esc(v)}</span>`).join("")}</div></div>`;
  }
  if (list.length > 300) h += note(`상위 300개만 보여요 (전체 ${list.length}개).`);
  h += note("초록 = 매수 구간 · 노랑 = 관심 · 회색 = 해당 없음 · 빨강 = 과열. 공포·탐욕 지수와 VIX는 시장 전체 지표라 종목별 개수에는 넣지 않았어요 (매수 타이밍 신호 화면에서 확인).");
  $("#scBody").innerHTML = h;
}

// 주별 기록: 그 주에 초록이 켜졌던 종목을 그때 가격으로 저장해 두고, 지금까지 수익률로 '맞았는지' 확인
async function renderSigHistory(viewChips) {
  const idx = await data("history/signals/index.json", 600_000) || [];
  if (!idx.length) { $("#app").innerHTML = viewChips + note("아직 저장된 주가 없어요. 이번 주 기록은 곧 저장돼요 (매주 한 번 자동 저장)."); bindChips($("#app"), "scv", v => { SC.view = v; renderScreener(); }); return; }
  if (!SC.week || !idx.some(x => x.week === SC.week)) SC.week = idx[0].week;
  $("#app").innerHTML = viewChips + chipsHtml(idx.map(x => [x.week, `${x.date.slice(5).replace("-", "/")} 주`]), SC.week, "scw") + `<div style="height:6px"></div>` +
    chipsHtml([[0, "⭐ 내 종목"], [1, "🇺🇸 S&P 500"], [2, "전체"]], SC.scope, "scs") + `<div id="shBody" style="margin-top:8px"><div class="spin">불러오는 중…</div></div>`;
  bindChips($("#app"), "scv", v => { SC.view = v; renderScreener(); });
  bindChips($("#app"), "scw", v => { SC.week = v; renderScreener(); });
  bindChips($("#app"), "scs", v => { SC.scope = v; LS.set("scScope", v); renderScreener(); });
  const [wk, now] = await Promise.all([data(`history/signals/${SC.week}.json`, 3600_000), data("signals.json", 600_000)]);
  if (!wk) { $("#shBody").innerHTML = note("이 주 기록을 불러오지 못했어요."); return; }
  const mine = allStocks(), cur = s => now?.rows?.[s]?.p ?? Q[s]?.price;
  const ret = (a, b) => a && b ? (b / a - 1) * 100 : null;
  const spRet = ret(wk.bench?.["^GSPC"], now?.bench?.["^GSPC"]), ksRet = ret(wk.bench?.["^KS11"], now?.bench?.["^KS11"]);
  const rows = Object.entries(wk.rows).filter(([sym, r]) => SC.scope === 2 || (SC.scope === 0 ? (r.my || mine.has(sym)) : r.sp))
    .map(([sym, r]) => ({ sym, ...r, n: mine.get(sym)?.ko || r.n, now: cur(sym), r: ret(r.p, cur(sym)) })).filter(x => x.r != null);
  const days = Math.max(0, Math.round((Date.now() - wk.at) / 86400000));
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  let h = `<div class="card"><div class="b ac">${wk.date} (${days}일 전) 신호 → 지금까지 수익률</div><div class="sub" style="margin-top:3px">그 주에 초록이 켜졌던 종목을 그때 가격으로 샀다면 지금 몇 %인지예요. 같은 기간 S&P 500 ${spRet == null ? "—" : pct(spRet)}${ksRet == null ? "" : " · 코스피 " + pct(ksRet)}</div>`;
  h += `<table class="mini" style="margin-top:8px"><tr><th>초록 개수</th><th>종목</th><th>평균 수익률</th><th>오른 비율</th><th>S&P 대비</th></tr>`;
  const groups = [5, 4, 3, 2, 1].map(g => { const l = rows.filter(x => x.g === g).map(x => x.r); return [g, l]; }).filter(([, l]) => l.length)
    .sort((a, b) => avg(b[1]) - avg(a[1]));   // 수익률 높은 순
  h += groups.map(([g, l]) => { const a = avg(l), win = l.filter(x => x > 0).length / l.length * 100;
    return `<tr><td class="b">🟢 ${g}개</td><td>${l.length}</td><td class="b ${cls(a)}">${pct(a)}</td><td>${Math.round(win)}%</td><td class="${cls(a - (spRet ?? 0))}">${spRet == null ? "—" : pct(a - spRet)}</td></tr>`; }).join("") + `</table>`;
  h += `<div class="sub" style="margin-top:6px">초록이 많을수록 수익률이 높으면 신호가 잘 맞은 거예요. 기간이 짧으면 우연일 수 있어서 몇 주 이상 쌓아서 보는 게 좋아요.</div></div>`;
  if (!rows.length) h += note("이 조건에 맞는 종목이 없어요.");
  h += `<div class="b" style="margin:12px 4px 6px">종목별 (수익률 높은 순)</div>` + rows.sort((a, b) => b.r - a.r).map(x =>
    `<div class="card row" style="padding:10px 14px;margin-bottom:5px" data-open="${esc(x.sym)}" data-name="${esc(x.n)}"><div class="grow" style="min-width:0"><b>${esc(x.sym)}</b> <span class="small g">🟢${x.g}</span><div class="sub ell">${esc(x.n)} · ${money(x.p, x.sym)} → ${money(x.now, x.sym)}</div></div><b class="${cls(x.r)}" style="font-size:15px">${pct(x.r)}</b></div>`).join("");
  h += note("매주 한 번 자동 저장돼요. 기록은 계속 쌓이고 지워지지 않아요. 투자 판단의 참고용이에요.");
  $("#shBody").innerHTML = h;
}

// 홈 위쪽 공지: 24시간 안의 주요 발표
let ECON_SOON = [];
async function loadEconSoon() {
  const d = await data("econ.json", 600_000); if (!d?.up) return;
  const now = Date.now(); ECON_SOON = d.up.filter(e => e.imp === "High" && e.at > now - 3600_000 && e.at < now + 86400_000);
  if (ECON_SOON.length && route().name === "home" && H.tab !== -3) renderHome(true);
}
let X_NEW = [];
async function loadXNew() {
  const d = await data("x.json", 300_000); if (!d) return;
  const seen = LS.get("xSeen", 0); X_NEW = (d.posts || []).filter(p => p.at > seen && p.at > Date.now() - 3 * 86400_000);
  if (!seen && d.posts?.length) LS.set("xSeen", d.posts[0].at);   // 처음엔 지난 글로 알리지 않음
  if (X_NEW.length && route().name === "home") renderHome(true);
}
function xBannerHtml() {
  if (!X_NEW.length) return ""; const p = X_NEW[0];
  return `<a class="card" href="#/x" onclick="LS.set('xSeen', ${p.at}); X_NEW = []" style="display:block;text-decoration:none;margin-top:8px;padding:10px 14px;border-left:4px solid ${XV[p.v][1]}"><div class="small b">🧙 미너비니 새 글 ${X_NEW.length}개 · ${XV[p.v][0]}</div><div class="small" style="margin-top:3px;color:var(--text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.ko || p.text)}</div></a>`;
}
function econBannerHtml() {
  const now = Date.now(), l = ECON_SOON.filter(e => e.at > now - 3600_000); if (!l.length) return "";
  const t = ms => new Date(ms).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
  return `<a class="card" href="#/econ" style="display:block;text-decoration:none;margin-top:8px;padding:10px 14px"><div class="small b" style="color:${YEL}">🔔 오늘 주요 발표</div>` +
    l.slice(0, 4).map(e => `<div class="small" style="margin-top:3px;${e.at < now ? "color:var(--sub)" : ""}">${t(e.at)}  ${esc(e.ko)}${e.act ? ` · 실제 <b>${esc(e.act)}</b>` : ""}${e.fc ? ` · 예상 ${esc(e.fc)}` : ""}</div>`).join("") + `</a>`;
}

// ═════════════ 경제 캘린더 ═════════════
const EC = { open: null };
const XV = { risk: ["🔴 위험", "var(--red)"], mid: ["🟡 중립", AMB], ok: ["🟢 괜찮음", "var(--green)"] };
async function renderX() {
  setHeader("🧙 미너비니 X 글", true);
  $("#app").innerHTML = `<div class="spin">불러오는 중…</div>`;
  const d = await data("x.json", 300_000);
  if (!d) { $("#app").innerHTML = note("아직 데이터가 없어요."); return; }
  const ps = d.posts || [], kst = ms => new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const recent = ps.filter(p => p.at > Date.now() - 7 * 86400_000), cnt = k => recent.filter(p => p.v === k).length;
  const now = !recent.length ? null : cnt("risk") > cnt("ok") ? "risk" : cnt("ok") > cnt("risk") ? "ok" : "mid";
  let h = now ? `<div class="card" style="border-left:4px solid ${XV[now][1]}"><div class="sub">최근 7일 글 ${recent.length}개 기준</div><div class="b" style="font-size:20px;margin-top:2px">지금 ${XV[now][0]}</div>
    <div class="small" style="margin-top:4px">위험 ${cnt("risk")} · 중립 ${cnt("mid")} · 괜찮음 ${cnt("ok")}</div></div>` : "";
  h += note(d.hasKey ? `X 공식 API로 새 글만 받아요 (새 글 없으면 0원). 이번 달 ${(d.usage?.[new Date().toISOString().slice(0, 7)]?.reads) || 0}/${d.cap}개 읽음${d.capped ? " · 상한 도달, 다음 달까지 멈춤" : ""}` : "X API 키가 아직 없어요. 지금 보이는 글은 직접 정리해 둔 거예요.");
  for (const p of ps) h += `<div class="card" style="padding:12px 14px"><div class="between"><span class="badge" style="background:${XV[p.v][1]};font-size:11px;padding:2px 7px">${XV[p.v][0]}</span><span class="sub">${kst(p.at)}</span></div>
    <div style="margin-top:6px;line-height:1.55;font-size:14px">${esc(p.ko || p.text)}</div>
    ${p.text && p.ko ? `<details style="margin-top:6px"><summary class="sub">원문 보기</summary><div class="small muted" style="margin-top:4px;white-space:pre-wrap">${esc(p.text)}</div></details>` : ""}
    <a class="small ac" href="${p.url}" target="_blank" rel="noopener">X에서 보기 ↗</a></div>`;
  h += note("위험·중립·괜찮음은 글에 나온 단어(숏·조정·하락 / 돌파·매수·강세 등)로 자동 판정한 거라 참고용이에요. 투자 권유가 아니에요.");
  $("#app").innerHTML = h;
  if (ps[0]) { LS.set("xSeen", ps[0].at); X_NEW = []; }
}
async function renderEcon() {
  setHeader("📅 경제 캘린더", true);
  $("#app").innerHTML = `<div class="spin">불러오는 중…</div>`;
  const d = await data("econ.json", 600_000);
  if (!d) { $("#app").innerHTML = note("아직 데이터가 없어요. GitHub이 3시간마다 모아요."); return; }
  const kst = ms => new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const dayKey = ms => new Date(ms).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });
  let h = `<div class="sec">🗓 이번 주·다음 주 미국 주요 발표 (한국시간)</div>`;
  const up = (d.up || []).filter(e => e.at > Date.now() - 86400_000 * 2);
  if (!up.length) h += note("예정된 주요 발표가 없어요.");
  let last = "";
  for (const e of up) {
    const k = dayKey(e.at); if (k !== last) { last = k; h += `<div class="sub b" style="margin:10px 4px 4px">${k}</div>`; }
    const past = e.at < Date.now();
    h += `<div class="card" style="padding:10px 14px;margin-bottom:5px;${past ? "opacity:.6" : ""}"><div class="between"><span><span class="badge" style="background:${e.imp === "High" ? "var(--red)" : AMB};font-size:10.5px;padding:2px 6px">${e.imp === "High" ? "중요" : "보통"}</span> <b style="font-size:14px">${esc(e.ko)}</b></span>
      <span class="sub">${new Date(e.at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false })}</span></div>
      <div class="small" style="margin-top:4px">${[e.act ? `<b class="ac">실제 ${esc(e.act)}</b>` : "", e.fc ? `예상 <b>${esc(e.fc)}</b>` : "", e.pv ? `이전 ${esc(e.pv)}` : ""].filter(Boolean).join(" · ") || '<span class="muted">수치 없음 (연설·회의 등)</span>'}</div></div>`;
  }
  h += note("예상치는 전문가 평균(컨센서스)이에요. 주가는 수치 자체보다 '예상과 얼마나 다르게 나왔나'에 크게 반응해요. 출처: Forex Factory 경제 캘린더");
  h += `<div class="sec">📊 주요 지표 · 발표일에 주가는 어떻게 움직였나</div>` + note("탭하면 과거 발표마다 수치와 그날 S&P 500·나스닥 움직임이 나와요. 수치는 FRED(세인트루이스 연준) 기준 최근 약 8년치예요.");
  const fv = (x, v) => x.unit === "천 명" ? (v >= 0 ? "+" : "") + f0(v) + "천" : x.unit === "건" ? f0(v / 1000) + "천 건" : f1(v) + "%";
  for (const x of d.ind || []) {
    const L = x.hist[0], open = EC.open === x.id;
    const act = r => r.a ?? r.v, cmp = r => r.fc == null ? "" : act(r) > r.fc ? ">" : act(r) < r.fc ? "<" : "=";
    const cc = c => c === ">" ? `style="color:${AMB}"` : c === "<" ? 'class="ac"' : 'class="muted"';
    const st = (lab, s) => s?.n ? `<div class="between small" style="padding:3px 0"><span>${lab} <span class="muted">(${s.n}번)</span></span><span>S&P 평균 <b class="${cls(s.avg)}">${pct(s.avg)}</b> · 오른 날 ${s.win}%</span></div>` : "";
    h += `<div class="card" data-econ="${x.id}"><div class="between"><b style="font-size:15px">${esc(x.name)}</b><span class="sub">다음 ${x.next ? x.next.slice(5).replace("-", "/") : "—"}</span></div>
      ${L ? `<div class="small" style="margin-top:4px">최근 <b style="font-size:16px">${fv(x, act(L))}</b> ${L.fc != null ? `<b ${cc(cmp(L))} style="font-size:15px">${cmp(L)}</b> 예상 ${fv(x, L.fc)}` : `<span class="muted">(예상치 없음)</span>`} <span class="muted">· ${L.d.slice(5).replace("-", "/")} 발표</span></div>` : ""}
      <div class="sub" style="margin-top:4px;line-height:1.4">${esc(x.desc)}</div>
      <div style="margin-top:8px">${st("예상보다 높게 나온 날 (>)", x.up)}${st("예상보다 낮게 나온 날 (<)", x.down)}${st("예상과 같게 나온 날 (=)", x.same)}${st("전체 발표일", x.all)}</div>
      ${open ? `<table class="mini" style="margin-top:8px"><tr><th>발표일</th><th>실제</th><th></th><th>예상</th><th>S&P</th><th>나스닥</th></tr>${x.hist.slice(0, 36).map(r => `<tr><td>${r.d.slice(2).replace(/-/g, ".")}</td><td class="b">${fv(x, act(r))}</td><td style="text-align:center"><b ${cc(cmp(r))}>${cmp(r)}</b></td><td class="muted">${r.fc == null ? "—" : fv(x, r.fc)}</td><td class="${cls(r.sp)}">${r.sp == null ? "—" : pct(r.sp)}</td><td class="${cls(r.nq)}">${r.nq == null ? "—" : pct(r.nq)}</td></tr>`).join("")}</table>
        <div class="sub" style="margin-top:6px">실제 = 발표 당일 처음 나온 숫자, 예상 = 전문가 평균(컨센서스). &gt; 예상보다 높음 · &lt; 낮음. S&P·나스닥은 발표일 하루 등락률이에요. 출처: Nasdaq 경제 캘린더·FRED</div>` : `<div class="small b ac" style="margin-top:6px">과거 발표 기록 보기 ▾</div>`}</div>`;
  }
  h += note("같은 방향(예: 물가가 높게 나옴)이라도 그때 시장 분위기에 따라 반응이 달라요. 평균은 참고용이고 다음 발표 결과를 보장하지 않아요.");
  $("#app").innerHTML = h;
  $("#app").querySelectorAll("[data-econ]").forEach(c => c.onclick = () => { EC.open = EC.open === c.dataset.econ ? null : c.dataset.econ; const y = window.scrollY; renderEcon().then(() => window.scrollTo(0, y)); });
}

// ───────────── 섹터 추천 종목 자동 채우기 ─────────────
// 섹터마다 대표 테마 ETF 보유 상위(미국)·네이버 테마(한국) 중 시총 큰 종목을 채워 줌. 한 번 넣은(또는 지운) 종목은 다시 건드리지 않음
async function applyFill() {
  const f = await data("fill.json", 3600_000); if (!f?.sectors) return;
  const seen = new Set(LS.get("fillSeen", [])), added = [];
  for (const [name, list] of Object.entries(f.sectors)) {
    const sec = S.sectors.find(s => s.name === name); if (!sec) continue;
    for (const x of list) {
      if (seen.has(x.t)) continue;
      seen.add(x.t);
      if (sectorIdx(x.t) >= 0 || S.deleted.has(name + ":" + x.t)) continue;
      sec.stocks.push({ t: x.t, ko: x.ko, desc: `⭐ 추천 · ${x.src}`, pts: [], etf: false, auto: true });
      added.push(x.ko);
    }
  }
  LS.set("fillSeen", [...seen]);
  if (added.length) { S.save(); toast(`⭐ 섹터별 추천 종목 ${added.length}개를 채웠어요`); if (route().name === "home") renderHome(true); }
}

// ───────────── 신규 상장 자동 추가 ─────────────
// 시총 100억 달러 이상 신규 상장은 알맞은 섹터 맨 앞에 넣어 줌. 한 번 넣은(또는 지운) 종목은 다시 건드리지 않음
async function applyIpos() {
  const ip = await data("ipo.json", 600_000); if (!ip?.list) return;
  const seen = new Set(LS.get("ipoSeen", [])), added = [];
  for (const x of ip.list) {
    if (!x.auto || seen.has(x.sym)) continue;
    seen.add(x.sym);
    if (sectorIdx(x.sym) >= 0) continue;
    let i = x.sector ? S.sectors.findIndex(s => s.name === x.sector) : -1;
    if (i < 0) { i = S.sectors.findIndex(s => s.name === "신규 상장"); if (i < 0) { S.sectors.push({ name: "신규 상장", emoji: "🆕", stocks: [] }); i = S.sectors.length - 1; } }
    const day = new Date(x.date).toLocaleDateString("ko-KR");
    S.sectors[i].stocks.unshift({ t: x.sym, ko: x.ko, desc: `🆕 ${day} 신규 상장` + (x.ipoPrice ? ` · 공모가 $${f2(x.ipoPrice)}` : ""), pts: [x.ind, "갓 상장해서 재무 지표·과거 차트가 짧고 주가 변동이 큼"].filter(Boolean), etf: false });
    S.deleted.delete(S.sectors[i].name + ":" + x.sym);
    added.push(`${x.ko}(${x.sym}) → ${S.sectors[i].name}`);
  }
  LS.set("ipoSeen", [...seen]);
  if (added.length) { S.save(); toast("🆕 신규 상장 추가: " + added.join(", ")); if (route().name === "home") renderHome(true); }
}

// ───────────── 시작 ─────────────
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
  await Promise.all([loadCatalog(), loadStatic()]);
  if (!location.hash) { const last = LS.get("lastHash", ""); if (last && last !== "#/") { location.hash = last; return; } }
  render();
  applyIpos().then(applyFill); loadEconSoon(); loadXNew();
})();
document.addEventListener("visibilitychange", () => { if (!document.hidden && route().name === "home") refreshQuotes(false); });
