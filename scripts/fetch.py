"""GitHub Actions에서 20분마다 돌면서 웹앱이 읽을 데이터를 미리 받아 data/ 에 저장.
아이폰 사파리는 Yahoo·CNN·구글뉴스를 직접 못 불러서(CORS) 이렇게 미리 받아둔다.
지표 계산·문구는 안드로이드 앱(Data.kt)과 똑같이 맞춤.

data/
  quotes.json          모든 종목 시세 + 환율 (매번)
  c/<SYM>.i.json       5일치 15분봉 (매번)
  c/<SYM>.d.json       2년치 일봉 (3시간마다)
  c/<SYM>.w.json       전체 기간 주봉 (하루 1번)
  s/<SYM>.json         주요 지표(안드로이드와 같은 문구)·회사 정보·ETF 보유 종목 (12시간마다)
  metrics.json         종목별 원시 지표 모음 (섹터 비교·비교 표·대가 점수용)
  vh/<SYM>.json        연도별 PER·PBR·PSR 추이 (하루 1번)
  n/<SYM>.json         뉴스 국내·해외·기업분석 (2시간마다)
  h/<SYM>.json         지수·VIX·채권 등 전체 기간 일봉 (하루 1번, 백테스트용)
  fg.json / fgh.json   CNN 공포·탐욕 현재값 / 과거값
  sp500.json           S&P 500 구성 종목·변경 내역·시총 (3시간마다)
  disc.json            종목 발굴 (화제·스크리너·전문가 기사·전문가 픽 랭킹) (30분마다)
  hub.json             뉴스 모아보기 (미국·국내 증시·기업분석 연재) (30분마다)
  meta.json            각 항목을 언제 받았는지
"""
import json, os, re, sys, time, urllib.parse, xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor
import requests

OUT = "data"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept": "*/*", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"})
NOW = time.time()
HIST_SYMS = ["^GSPC", "^IXIC", "^KS11", "^VIX", "TLT", "HYG", "IEF", "RSP", "SPY"]
INDEX_SYMS = ["^GSPC", "^IXIC", "^KS11", "^VIX", "KRW=X"]

def fname(sym): return sym.replace("^", "_").replace("=", "-")
def path(*p): return os.path.join(OUT, *p)
def save(p, obj):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
def load(p, d=None):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return d

meta = load(path("meta.json"), {})
DATA_VER = 2   # 올리면 긴 기간 차트(주봉·전체 일봉)를 한 번 다시 받음
if meta.get("ver") != DATA_VER:
    meta = {k: v for k, v in meta.items() if not k.startswith(("w:", "h:", "fgh"))}
    meta["ver"] = DATA_VER
def stale(key, sec): return NOW - meta.get(key, 0) > sec
def mark(key): meta[key] = int(NOW)
def is_kr(s): return s.endswith(".KS") or s.endswith(".KQ")

def get(url, **kw):
    for i in range(3):
        try:
            r = S.get(url, timeout=20, **kw)
            if r.status_code == 429: time.sleep(3 + i * 5); continue
            return r
        except Exception:
            time.sleep(2)
    return None

def rnd(v):
    if v is None: return None
    return float(f"{v:.6g}")

# ───────── 포맷 (안드로이드 Data.kt와 같은 모양) ─────────
def f2(v): return f"{v:,.2f}"
def f1(v): return f"{v:,.1f}"
def pct_str(v): return ("+" if v > 0 else "") + f"{v:.2f}%"
def pct1(v): return f"{v * 100:.1f}%"
def krw_big(w):
    a = abs(w)
    if a >= 1e12: return f1(w / 1e12) + "조원"
    if a >= 1e8: return f"{w / 1e8:,.0f}억원"
    return f"{w:,.0f}원"
def big(v, rate, kr=False):
    if kr: return krw_big(v)
    a = abs(v)
    usd = f2(v / 1e12) + "T" if a >= 1e12 else f2(v / 1e9) + "B" if a >= 1e9 else f1(v / 1e6) + "M" if a >= 1e6 else f"{v:,.0f}"
    return "$" + usd + (f" (약 {krw_big(v * rate)})" if rate > 0 else "")
def cash(v, kr): return f"{v:,.0f}원" if kr else "$" + f2(v)

# ───────── Yahoo ─────────
def chart(sym, rng, iv):
    # range=max 로 부르면 Yahoo가 일봉·주봉 대신 월봉·분기봉을 줄 때가 있어서, 긴 기간은 시작~끝 날짜로 요청
    span = {"max": None, "10y": 3653, "5y": 1827}.get(rng, -1)
    q = f"range={rng}" if span == -1 else f"period1={-2208988800 if span is None else int(NOW - span * 86400)}&period2={int(NOW) + 86400}"
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{q}&interval={iv}&includePrePost=false")
    if not r or r.status_code != 200: return None
    try: res = r.json()["chart"]["result"][0]
    except Exception: return None
    m = res.get("meta", {})
    ts = res.get("timestamp") or []
    cl = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    gaps = sorted(b - a for a, b in zip(ts, ts[1:]))
    want = {"1d": 4, "1wk": 10}.get(iv)
    if want and gaps and gaps[len(gaps) // 2] > want * 86400: return None   # 월봉 등으로 바뀌어 온 데이터는 버림
    t, c = [], []
    for a, b in zip(ts, cl):
        if b is not None: t.append(a); c.append(rnd(b))
    return {"t": t, "c": c, "m": {"price": m.get("regularMarketPrice"), "prev": m.get("chartPreviousClose") or m.get("previousClose"),
            "name": m.get("longName") or m.get("shortName"), "h52": m.get("fiftyTwoWeekHigh"), "l52": m.get("fiftyTwoWeekLow"),
            "hi": m.get("regularMarketDayHigh"), "lo": m.get("regularMarketDayLow"), "vol": m.get("regularMarketVolume"),
            "time": m.get("regularMarketTime"), "cur": m.get("currency")}}

CRUMB = None
def crumb():
    global CRUMB
    for seed in ["https://fc.yahoo.com", "https://finance.yahoo.com/quote/AAPL"]:
        get(seed, allow_redirects=True)
        r = get("https://query2.finance.yahoo.com/v1/test/getcrumb")
        if r and r.status_code == 200 and r.text.strip() and "<" not in r.text and len(r.text) < 40:
            CRUMB = r.text.strip(); return CRUMB
    return None
def cq(): return f"&crumb={urllib.parse.quote(CRUMB)}" if CRUMB else ""

QFIELDS = {"price": "regularMarketPrice", "chg": "regularMarketChange", "pct": "regularMarketChangePercent", "prev": "regularMarketPreviousClose",
           "cap": "marketCap", "name": "longName", "sname": "shortName", "state": "marketState", "vol": "regularMarketVolume",
           "pre": "preMarketPrice", "prePct": "preMarketChangePercent", "post": "postMarketPrice", "postPct": "postMarketChangePercent",
           "high52": "fiftyTwoWeekHigh", "low52": "fiftyTwoWeekLow", "pe": "trailingPE", "fpe": "forwardPE", "time": "regularMarketTime",
           "dayHigh": "regularMarketDayHigh", "dayLow": "regularMarketDayLow", "divRate": "dividendRate", "divTrail": "trailingAnnualDividendYield"}

def quotes(syms):
    out = {}
    for i in range(0, len(syms), 50):
        part = syms[i:i + 50]
        r = get("https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + urllib.parse.quote(",".join(part)) + cq())
        ok = False
        if r and r.status_code == 200:
            try:
                for q in r.json()["quoteResponse"]["result"]:
                    out[q["symbol"]] = {k: q.get(v) for k, v in QFIELDS.items()}
                ok = True
            except Exception: pass
        if not ok:
            def one(s):
                c = chart(s, "5d", "1d")
                if c and c["m"]["price"]:
                    p, pv = c["m"]["price"], (c["c"][-2] if len(c["c"]) >= 2 else c["m"]["prev"])
                    out[s] = {"price": p, "prev": pv, "chg": p - pv if pv else None, "pct": (p / pv - 1) * 100 if pv else None, "name": c["m"]["name"]}
            with ThreadPoolExecutor(6) as ex: list(ex.map(one, part))
    return out

def raw(o, k):
    if not isinstance(o, dict): return None
    v = o.get(k)
    if isinstance(v, dict): v = v.get("raw")
    if isinstance(v, (int, float)) and v == v and abs(v) != float("inf"): return float(v)
    return None
def fmtv(o, k):
    if not isinstance(o, dict): return None
    v = o.get(k)
    return v.get("fmt") if isinstance(v, dict) and v.get("fmt") else None

def timeseries(sym, types, years):
    now = int(NOW); frm = now - years * 365 * 86400
    r = get(f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{urllib.parse.quote(sym)}?type={','.join(types)}&period1={frm}&period2={now}" + cq())
    if not r or r.status_code != 200: return {}
    out = {}
    try:
        for o in r.json()["timeseries"]["result"]:
            tp = (o.get("meta") or {}).get("type", [None])[0]
            arr = o.get(tp) or []
            out[tp] = sorted([(e["asOfDate"], e["reportedValue"]["raw"]) for e in arr if e and e.get("reportedValue")], key=lambda x: x[0])
    except Exception: pass
    return out

def fundamentals_ttm(sym):
    s = timeseries(sym, ["quarterlyDilutedEPS", "quarterlyBasicEPS", "quarterlyNetIncome", "quarterlyTotalRevenue", "quarterlyStockholdersEquity",
                         "quarterlyOrdinarySharesNumber", "annualDilutedEPS", "annualNetIncome", "annualTotalRevenue", "annualStockholdersEquity",
                         "annualOrdinarySharesNumber"], 3)
    def vals(k): return [v for _, v in s.get(k, [])]
    def ttm(q, a):
        qv = vals(q)
        if len(qv) >= 4: return sum(qv[-4:])
        av = vals(a); return av[-1] if av else None
    def last(q, a):
        qv = vals(q) or vals(a); return qv[-1] if qv else None
    ni = ttm("quarterlyNetIncome", "annualNetIncome"); rev = ttm("quarterlyTotalRevenue", "annualTotalRevenue")
    eq = last("quarterlyStockholdersEquity", "annualStockholdersEquity"); sh = last("quarterlyOrdinarySharesNumber", "annualOrdinarySharesNumber")
    eps = ttm("quarterlyDilutedEPS", "annualDilutedEPS")
    if eps is None and len(vals("quarterlyBasicEPS")) >= 4: eps = sum(vals("quarterlyBasicEPS")[-4:])
    if eps is None and ni is not None and sh: eps = ni / sh
    out = {}
    if eps is not None: out["eps"] = eps
    if eq is not None and sh: out["bvps"] = eq / sh
    if ni is not None and eq and eq > 0: out["roe"] = ni / eq
    if ni is not None and rev and rev > 0: out["pm"] = ni / rev
    if rev is not None: out["rev"] = rev
    if ni is not None: out["ni"] = ni
    return out

def valuation_history(sym):
    s = timeseries(sym, ["annualDilutedEPS", "annualTotalRevenue", "annualStockholdersEquity", "annualDilutedAverageShares"], 7)
    by = {}
    for tp, arr in s.items():
        for d, v in arr: by.setdefault(d, {})[tp] = v
    px = chart(sym, "10y", "1mo")
    if not px or not px["c"]: return []
    rows = []
    for d in sorted(by):
        f = by[d]
        t = int(time.mktime(time.strptime(d, "%Y-%m-%d")))
        idx = max([i for i, x in enumerate(px["t"]) if x <= t + 5 * 86400], default=-1)
        if idx < 0: continue
        p = px["c"][idx]
        eps, sh, eq, rev = f.get("annualDilutedEPS"), f.get("annualDilutedAverageShares"), f.get("annualStockholdersEquity"), f.get("annualTotalRevenue")
        per = p / eps if eps and eps > 0 else None
        pbr = p * sh / eq if sh and eq and eq > 0 else None
        psr = p * sh / rev if sh and rev and rev > 0 else None
        if per or pbr or psr: rows.append([d[:4], per, pbr, psr])
    return rows[-5:]

REC = {"strong_buy": "적극 매수", "buy": "매수", "hold": "보유 (중립)", "underperform": "비중 축소", "sell": "매도"}

def summary(sym, etf, rate, price):
    kr = is_kr(sym)
    mods = "price,summaryDetail,defaultKeyStatistics,fundProfile,topHoldings,fundPerformance,assetProfile" if etf else \
        "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile"
    r = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules={mods}" + cq())
    if not r or r.status_code != 200: return None
    try: res = r.json()["quoteSummary"]["result"][0]
    except Exception: return None
    pr, sd, ks, fd = res.get("price") or {}, res.get("summaryDetail") or {}, res.get("defaultKeyStatistics") or {}, res.get("financialData") or {}
    ce, ap, fp, th = res.get("calendarEvents") or {}, res.get("assetProfile") or {}, res.get("fundProfile") or {}, res.get("topHoldings") or {}
    stats, prof, rw, holdings = [], [], {}, []
    g = [""]
    def add(l, v):
        if v not in (None, ""): stats.append([g[0], l, v])
    def addp(l, v):
        if v not in (None, ""): prof.append([l, v])
    def put(k, v):
        if v is not None and v == v and abs(v) != float("inf"): rw[k] = v
    if not price: price = raw(pr, "regularMarketPrice") or 0
    if not etf:
        cap = raw(pr, "marketCap")
        pb_raw = raw(ks, "priceToBook")
        if pb_raw is not None and not (0.05 <= pb_raw <= 300): pb_raw = None
        need_ex = raw(sd, "trailingPE") is None or raw(ks, "trailingEps") is None or pb_raw is None or raw(fd, "returnOnEquity") is None or raw(fd, "profitMargins") is None
        ex = fundamentals_ttm(sym) if need_ex else {}
        eps = raw(ks, "trailingEps") if raw(ks, "trailingEps") is not None else ex.get("eps")
        pe = raw(sd, "trailingPE") or (price / eps if eps and eps > 0 and price > 0 else None)
        bvps = raw(ks, "bookValue") or ex.get("bvps")
        pb = pb_raw
        if pb is None and ex.get("bvps") and ex["bvps"] > 0 and price > 0:
            x = price / ex["bvps"]; pb = x if 0.05 <= x <= 300 else None
        roe = raw(fd, "returnOnEquity") if raw(fd, "returnOnEquity") is not None else ex.get("roe")
        pm = raw(fd, "profitMargins") if raw(fd, "profitMargins") is not None else ex.get("pm")
        rev = raw(fd, "totalRevenue") or ex.get("rev")
        fcf = raw(fd, "freeCashflow")
        ey = eps / price if eps is not None and price > 0 else (1 / pe if pe else None)
        fcfy = fcf / cap if fcf is not None and cap else None
        put("pe", pe); put("fpe", raw(sd, "forwardPE") or raw(ks, "forwardPE"))
        put("pb", pb); put("peg", raw(ks, "pegRatio") or raw(ks, "trailingPegRatio"))
        put("psr", raw(sd, "priceToSalesTrailing12Months") or (cap / rev if cap and rev and rev > 0 else None)); put("evebitda", raw(ks, "enterpriseToEbitda"))
        put("roe", roe); put("roa", raw(fd, "returnOnAssets"))
        put("de", raw(fd, "debtToEquity")); put("cr", raw(fd, "currentRatio")); put("qr", raw(fd, "quickRatio"))
        put("fcf", fcf); put("fcfy", fcfy); put("ey", ey)
        put("pm", pm); put("gm", raw(fd, "grossMargins")); put("om", raw(fd, "operatingMargins"))
        put("rg", raw(fd, "revenueGrowth")); put("eg", raw(fd, "earningsGrowth"))
        put("cap", cap); put("capUsd", (cap / rate if rate > 0 and cap else None) if kr else cap); put("eps", eps); put("dy", raw(sd, "dividendYield")); put("payout", raw(sd, "payoutRatio"))
        put("insider", raw(ks, "heldPercentInsiders")); put("beta", raw(sd, "beta")); put("feps", raw(ks, "forwardEps"))
        put("drate", raw(sd, "dividendRate")); d5 = raw(sd, "fiveYearAvgDividendYield"); put("dy5", d5 / 100 if d5 is not None else None)
        put("exdiv", raw(sd, "exDividendDate")); put("divdate", raw(ce.get("dividendDate") if isinstance(ce.get("dividendDate"), dict) else {"raw": ce.get("dividendDate")}, "raw"))
        put("price", price if price > 0 else None)

        g[0] = "💰 가격 수준 (밸류에이션)"
        add("시가총액", big(cap, rate, kr) if cap else None)
        add("PER", f2(pe) if pe else ("적자 (계산 불가)" if (eps or 0) < 0 else None))
        add("선행 PER", fmtv(sd, "forwardPE") or fmtv(ks, "forwardPE"))
        pg = raw(ks, "pegRatio") or raw(ks, "trailingPegRatio"); add("PEG", f2(pg) if pg is not None else None)
        add("PBR", f2(pb) if pb else None)
        add("PSR", fmtv(sd, "priceToSalesTrailing12Months"))
        add("EV/EBITDA", fmtv(ks, "enterpriseToEbitda"))
        add("EV/매출", fmtv(ks, "enterpriseToRevenue"))
        g[0] = "🧾 이익 (주당 지표)"
        add("EPS (주당순이익)", cash(eps, kr) if eps is not None else None)
        fe = raw(ks, "forwardEps"); add("선행 EPS", cash(fe, kr) if fe is not None else None)
        add("이익수익률 (EPS ÷ 주가)", pct1(ey) if ey is not None else None)
        add("BPS (주당순자산)", cash(bvps, kr) if bvps is not None else None)
        g[0] = "📈 성장성"
        add("매출 (최근 12개월)", big(rev, rate, kr) if rev else None)
        add("매출 성장률 (전년 대비)", fmtv(fd, "revenueGrowth"))
        add("이익 성장률 (전년 대비)", fmtv(fd, "earningsGrowth"))
        g[0] = "🏭 수익성"
        add("매출총이익률", fmtv(fd, "grossMargins")); add("영업이익률", fmtv(fd, "operatingMargins"))
        add("순이익률", pct1(pm) if pm is not None else None)
        add("ROE (자기자본이익률)", pct1(roe) if roe is not None else None)
        add("ROA (총자산이익률)", fmtv(fd, "returnOnAssets"))
        g[0] = "🏦 재무 건전성"
        de = raw(fd, "debtToEquity"); add("부채비율 (부채/자본)", f1(de) + "%" if de is not None else None)
        add("유동비율", fmtv(fd, "currentRatio")); add("당좌비율", fmtv(fd, "quickRatio"))
        tc = raw(fd, "totalCash"); add("보유 현금", big(tc, rate, kr) if tc else None)
        td = raw(fd, "totalDebt"); add("총부채", big(td, rate, kr) if td else None)
        add("잉여현금흐름", big(fcf, rate, kr) if fcf is not None else None)
        add("FCF 수익률", pct1(fcfy) if fcfy is not None else None)
        g[0] = "💵 주주환원"
        add("배당수익률", fmtv(sd, "dividendYield") or "배당 없음")
        po = raw(sd, "payoutRatio"); add("배당성향", pct1(po) if po and po > 0 else None)
        dr = raw(sd, "dividendRate"); add("연 배당금 (1주당)", cash(dr, kr) if dr and dr > 0 else None)
        add("5년 평균 배당수익률", f2(d5) + "%" if d5 is not None else None)
        g[0] = "👥 수급·변동성"
        add("베타 (시장 대비 변동성)", fmtv(sd, "beta")); add("공매도 비율 (유통주식 대비)", fmtv(ks, "shortPercentOfFloat"))
        add("내부자 보유", fmtv(ks, "heldPercentInsiders")); add("기관 보유", fmtv(ks, "heldPercentInstitutions"))
        g[0] = "🎯 애널리스트 전망"
        tg = raw(fd, "targetMeanPrice")
        if tg and price > 0: add("애널리스트 평균 목표가", cash(tg, kr) + " (" + pct_str((tg / price - 1) * 100) + ")")
        lo, hi = raw(fd, "targetLowPrice"), raw(fd, "targetHighPrice")
        if lo is not None and hi is not None: add("목표가 범위", cash(lo, kr) + " ~ " + cash(hi, kr))
        rk = fd.get("recommendationKey") or ""
        if rk and rk != "none":
            n = raw(fd, "numberOfAnalystOpinions")
            add("투자의견 컨센서스", REC.get(rk, rk) + (f" · {int(n)}명" if n else ""))
        try: add("다음 실적 발표 (예정)", ce["earnings"]["earningsDate"][0]["fmt"])
        except Exception: pass
    else:
        put("dy", raw(sd, "yield")); put("price", price if price > 0 else None)
        tr = (res.get("fundPerformance") or {}).get("trailingReturns") or {}
        fe = fp.get("feesExpensesInvestment") or {}
        er = raw(fe, "annualReportExpenseRatio")
        put("ytd", raw(tr, "ytd")); put("r1y", raw(tr, "oneYear")); put("r3y", raw(tr, "threeYear")); put("r5y", raw(tr, "fiveYear"))
        ta = raw(sd, "totalAssets"); put("er", er); put("aum", (ta / rate if kr and rate > 0 else ta) if ta else None)
        g[0] = "📈 ETF 수익률"
        for lab, k in [("연초 대비 수익률", "ytd"), ("1년 수익률", "oneYear"), ("3년 연평균 수익률", "threeYear"), ("5년 연평균 수익률", "fiveYear")]:
            v = raw(tr, k); add(lab, pct_str(v * 100) if v is not None else None)
        g[0] = "🧺 ETF 정보"
        add("운용자산", big(ta, rate, kr) if ta else None); add("분배금 수익률", fmtv(sd, "yield"))
        add("총보수 (연)", fmtv(fe, "annualReportExpenseRatio")); add("운용사", fp.get("family")); add("베타 (3년)", fmtv(ks, "beta3Year"))
        for h in th.get("holdings") or []:
            p = raw(h, "holdingPercent")
            if p is not None: holdings.append([h.get("symbol") or "", h.get("holdingName") or h.get("symbol") or "", p])
    addp("섹터", ap.get("sector")); addp("업종", ap.get("industry")); addp("국가", ap.get("country"))
    if ap.get("country"): rw["us"] = 1.0 if ap["country"] == "United States" else 0.0
    if ap.get("fullTimeEmployees"): addp("직원 수", f"{int(ap['fullTimeEmployees']):,}명")
    addp("웹사이트", ap.get("website"))
    return {"stats": stats, "prof": prof, "about": (ap.get("longBusinessSummary") or "")[:2500], "raw": rw, "holdings": holdings,
            "industry": ((ap.get("sector") or "") + " " + (ap.get("industry") or "")).strip()}

# ───────── 한국 ETF 구성 종목 (Yahoo에 없을 때) ─────────
def num(v):
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        try: return float(v.replace(",", "").replace("%", "").strip())
        except Exception: return None
    return None
def scan_json(root):
    best = []
    def visit(x):
        nonlocal best
        if isinstance(x, dict):
            for v in x.values(): visit(v)
        elif isinstance(x, list):
            got = []
            for o in x:
                if not isinstance(o, dict): visit(o); continue
                name = code = ""; w = None
                for k, v in o.items():
                    lk = k.lower()
                    if ("name" in lk or "nm" in lk) and isinstance(v, str) and not name: name = v
                    elif ("code" in lk or "symbol" in lk or lk == "cd") and isinstance(v, str) and not code: code = v
                    elif any(t in lk for t in ("weight", "ratio", "percent", "rate", "wght")) and "change" not in lk and "fluct" not in lk and w is None: w = num(v)
                if name and w is not None and 0 < w <= 100: got.append([code, name, w])
                else: visit(o)
            if len(got) > len(best): best = got
    visit(root)
    if not best: return []
    scale = sum(b[2] for b in best) > 1.5
    return [[c, n, w / 100 if scale else w] for c, n, w in best]
def ranked_text(html):
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text).replace("&amp;", "&").replace("&nbsp;", " ")
    starts = [text.find(k) for k in ("상위 보유종목", "상위 보유 종목", "보유종목", "보유 비율") if text.find(k) >= 0]
    if not starts: return []
    lines = [l.strip() for l in text[min(starts):].split("\n") if l.strip()]
    out, i, expect = [], 0, 1
    while i < len(lines) and len(out) < 20:
        if lines[i] == str(expect):
            j, name, code, pct = i + 1, "", "", None
            while j < len(lines) and j <= i + 6:
                l = lines[j]; m = re.search(r"(\d+(?:\.\d+)?)%$", l)
                if m:
                    pct = float(m.group(1)); rest = l[: m.start()].strip()
                    for w in dict.fromkeys(rest.split()):
                        if re.fullmatch(r"[0-9A-Z]{5,6}", w): code = w
                        elif len(w) > 1 and w != str(expect): name = (name + " " + w).strip()
                    break
                if re.fullmatch(r"[0-9A-Z]{5,6}", l): code = code or l
                elif not name: name = l
                j += 1
            if pct is not None:
                out.append([code, name or code, pct / 100]); expect += 1; i = j + 1; continue
        i += 1
    return out
def kr_etf_holdings(sym):
    code = sym.split(".")[0]
    tries = [(f"https://m.stock.naver.com/api/stock/{code}/integration", "json", "네이버 증권"),
             (f"https://m.stock.naver.com/api/stock/{code}/etfAnalysis", "json", "네이버 증권"),
             (f"https://m.stock.naver.com/domestic/stock/{code}/total", "next", "네이버 증권"),
             (f"https://stockhub.kr/etf/{code}", "rank", "stockhub.kr")]
    for url, kind, src in tries:
        r = get(url)
        if not r or r.status_code != 200 or not r.text: continue
        try:
            if kind == "json": items = scan_json(r.json())
            elif kind == "next":
                m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
                items = scan_json(json.loads(m.group(1))) if m else []
            else: items = ranked_text(r.text)
            items = [x for x in items if x[2] > 0 and x[1]]
            if len(items) >= 2: return sorted(items, key=lambda x: -x[2]), src
        except Exception: pass
    return None, None

# ───────── 뉴스 ─────────
def rss(url):
    r = get(url)
    if not r or r.status_code != 200: return []
    try:
        root = ET.fromstring(r.content)
        out = []
        for it in root.iter("item"):
            src = (it.findtext("source") or "").strip()
            t = (it.findtext("title") or "").strip()
            if src and t.endswith(" - " + src): t = t[: -len(src) - 3]
            try: ts = int(parsedate_to_datetime(it.findtext("pubDate") or "").timestamp() * 1000)
            except Exception: ts = 0
            desc = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", it.findtext("description") or "")).strip()[:300]
            if t: out.append({"title": t, "link": (it.findtext("link") or "").strip(), "src": src, "time": ts, "desc": desc})
        return sorted(out, key=lambda x: -x["time"])[:15]
    except Exception: return []
def gnews(q, en=False):
    return rss(f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en" if en
               else f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=ko&gl=KR&ceid=KR:ko")
def clean_name(ko): return re.sub(r"[()]", " ", ko).strip()
def has_hangul(s): return any("가" <= ch <= "힣" for ch in s)
def news_korean(st):
    c = clean_name(st["ko"]); return gnews((c if has_hangul(c) else st["t"]) + " 주가")
def news_english(t):
    return rss(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={urllib.parse.quote(t)}&region=US&lang=en-US") or gnews(t + " stock", True)
def news_analysis(st):
    c = clean_name(st["ko"]); n = c if has_hangul(c) else st["t"]
    return gnews(f'"{n}" (기업분석 OR 심층분석 OR 분석 OR 리포트)')

# ───────── S&P 500 ─────────
GICS = {"Information Technology": "정보기술", "Health Care": "헬스케어", "Financials": "금융", "Consumer Discretionary": "경기소비재",
        "Communication Services": "커뮤니케이션", "Industrials": "산업재", "Consumer Staples": "필수소비재", "Energy": "에너지",
        "Utilities": "유틸리티", "Real Estate": "부동산", "Materials": "소재"}
def wclean(h):
    h = re.sub(r"<sup.*?</sup>", "", h, flags=re.S); h = re.sub(r"<[^>]+>", "", h)
    return re.sub(r"\s+", " ", h.replace("&amp;", "&").replace("&#160;", " ").replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", '"')).strip()
def wrows(table):
    return [r for r in ([wclean(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)] for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)) if r]
def table_with_id(html, id_):
    i = html.find(f'id="{id_}"')
    if i < 0: return None
    s = html.rfind("<table", 0, i); e = html.find("</table>", i)
    return html[s:e] if s >= 0 and e >= 0 else None
def sp500():
    r = get("https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=text&format=json&formatversion=2")
    if not r or r.status_code != 200: return None
    html = r.json()["parse"]["text"]
    ysym = lambda s: s.strip().replace(".", "-")
    members = [[ysym(c[0]), c[1], c[2], c[3], c[5]] for c in wrows(table_with_id(html, "constituents") or "") if len(c) >= 6]
    changes, last = [], ""
    for c in wrows(table_with_id(html, "changes") or ""):
        if len(c) >= 6: last = c[0]; changes.append([c[0], ysym(c[1]), c[2], ysym(c[3]), c[4], c[5]])
        elif len(c) == 5: changes.append([last, ysym(c[0]), c[1], ysym(c[2]), c[3], c[4]])
    return (members, changes[:80]) if len(members) >= 400 else None

# ───────── 종목 발굴 ─────────
def tickers_in(text):
    out = []
    for m in re.finditer(r"(?:NASDAQ|NYSE|Nasdaq|NYSEMKT|AMEX)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)", text): out.append(m.group(1))
    for m in re.finditer(r"\(([A-Z]{1,5})\)", text): out.append(m.group(1))
    bad = {"A", "I", "AI", "CEO", "ETF", "IPO", "EPS", "US", "USA", "FDA", "GDP", "SEC"}
    res = []
    for t in out:
        t = t.replace(".", "-")
        if t not in bad and t not in res: res.append(t)
    return res[:6]
def disc_quote(q):
    return {"sym": q.get("symbol"), "name": q.get("longName") or q.get("shortName") or q.get("symbol"), "price": q.get("regularMarketPrice") or 0,
            "pct": q.get("regularMarketChangePercent") or 0, "cap": q.get("marketCap") or 0, "pe": q.get("trailingPE")}

def main():
    cat = load("web/catalog.json", [])
    static = load("web/static.json", {})
    stocks = {}
    for s in cat:
        for st in s["stocks"]: stocks.setdefault(st["t"], st)
    crowd_syms = [x["sym"] for x in static.get("crowd", {}).get("top", [])]
    syms = list(stocks)
    chart_syms = list(dict.fromkeys(syms + crowd_syms))
    crumb()
    print("crumb", bool(CRUMB), "tickers", len(syms))

    # 1) 시세 (매번)
    q = quotes(list(dict.fromkeys(chart_syms + INDEX_SYMS)))
    rate = (q.get("KRW=X") or {}).get("price") or (load(path("quotes.json"), {}) or {}).get("rate") or 1400
    save(path("quotes.json"), {"at": int(NOW * 1000), "rate": rate, "q": q})
    print("quotes", len(q), "rate", rate)

    # 2) 차트
    def do_chart(sym):
        try: _do_chart(sym)
        except Exception as e: print("chart fail", sym, e)
    def _do_chart(sym):
        f = fname(sym)
        c = chart(sym, "5d", "15m")
        if c: save(path("c", f + ".i.json"), c)
        if stale("d:" + sym, 3 * 3600) or not os.path.exists(path("c", f + ".d.json")):
            c = chart(sym, "2y", "1d")
            if c: save(path("c", f + ".d.json"), c); mark("d:" + sym)
        if stale("w:" + sym, 20 * 3600) or not os.path.exists(path("c", f + ".w.json")):
            c = chart(sym, "10y", "1wk")
            if c: save(path("c", f + ".w.json"), c); mark("w:" + sym)
    with ThreadPoolExecutor(6) as ex: list(ex.map(do_chart, chart_syms + ["^GSPC", "^IXIC", "^KS11", "^VIX"]))
    # 목록용 미니 차트·1개월 수익률: 최근 1개월 일봉 종가 (안드로이드 목록과 같은 기준)
    for sym in chart_syms:
        d = load(path("c", fname(sym) + ".d.json"))
        if d and d.get("t") and sym in q:
            cut = NOW - 31 * 86400
            sp = [c for t, c in zip(d["t"], d["c"]) if t >= cut]
            if q[sym].get("price") and sp: sp[-1] = q[sym]["price"]
            q[sym]["sp"] = sp
    save(path("quotes.json"), {"at": int(NOW * 1000), "rate": rate, "q": q})
    print("charts done")

    # 3) 지표 (12시간마다) + 한국 ETF 구성 종목 + 연도별 추이 (하루 1번)
    metrics = load(path("metrics.json"), {}) or {}
    def do_sum(sym):
        try: _do_sum(sym)
        except Exception as e: print("summary fail", sym, e)
    def _do_sum(sym):
        st = stocks[sym]; f = fname(sym)
        old = load(path("s", f + ".json"))
        if stale("s:" + sym, 12 * 3600) or not (old and "stats" in old):
            sm = summary(sym, st.get("etf"), rate, (q.get(sym) or {}).get("price") or 0)
            if sm:
                if st.get("etf") and not sm["holdings"] and is_kr(sym):
                    items, src = kr_etf_holdings(sym)
                    if items: sm["holdings"] = items; sm["holdSrc"] = src
                save(path("s", f + ".json"), sm); mark("s:" + sym)
                metrics[sym] = {**sm["raw"], "_ind": sm.get("industry", "")}
        elif sym not in metrics and old and "raw" in old:
            metrics[sym] = {**old["raw"], "_ind": old.get("industry", "")}
        if not st.get("etf") and (stale("vh:" + sym, 24 * 3600) or not os.path.exists(path("vh", f + ".json"))):
            save(path("vh", f + ".json"), valuation_history(sym)); mark("vh:" + sym)
    with ThreadPoolExecutor(4) as ex: list(ex.map(do_sum, syms))
    print("summaries done")

    # 4) 뉴스 (2시간마다) + 최근 48시간 뉴스 건수 ('뉴스 많은 순' 정렬용)
    def do_news(sym):
        try: _do_news(sym)
        except Exception as e: print("news fail", sym, e)
    def _do_news(sym):
        f = fname(sym)
        if stale("n:" + sym, 2 * 3600) or not os.path.exists(path("n", f + ".json")):
            st = stocks[sym]
            save(path("n", f + ".json"), {"ko": news_korean(st), "en": [] if is_kr(sym) else news_english(sym), "an": news_analysis(st)})
            mark("n:" + sym)
        n = load(path("n", f + ".json"), {}) or {}
        since = NOW * 1000 - 48 * 3600_000
        metrics.setdefault(sym, {})["news48"] = sum(1 for x in (n.get("ko", []) + n.get("en", [])) if x.get("time", 0) >= since)
    with ThreadPoolExecutor(4) as ex: list(ex.map(do_news, syms))
    save(path("metrics.json"), metrics)
    print("news done")

    # 5) 백테스트용 전체 기간 (하루 1번)
    for sym in HIST_SYMS:
        if stale("h:" + sym, 20 * 3600) or not os.path.exists(path("h", fname(sym) + ".json")):
            c = chart(sym, "max", "1d")
            if c: save(path("h", fname(sym) + ".json"), c); mark("h:" + sym)

    # 6) CNN 공포·탐욕
    hdr = {"User-Agent": UA, "Referer": "https://edition.cnn.com/", "Origin": "https://edition.cnn.com", "Accept": "application/json, text/plain, */*"}
    r = get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", headers=hdr)
    if r and r.status_code == 200:
        try:
            j = r.json(); j.pop("fear_and_greed_historical", None); save(path("fg.json"), j); print("cnn ok")
        except Exception: pass
    if stale("fgh", 20 * 3600):
        r = get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2011-01-01", headers=hdr)
        if r and r.status_code == 200:
            try:
                d = r.json().get("fear_and_greed_historical", {}).get("data", [])
                save(path("fgh.json"), [[int(p["x"]), round(p["y"], 1)] for p in d]); mark("fgh")
            except Exception: pass

    # 7) S&P 500 (목록 하루 1번, 시총 3시간마다)
    try: do_sp500()
    except Exception as e: print('sp500 fail', e)
    try: do_disc(static)
    except Exception as e: print('disc fail', e)
    try: do_hub(static)
    except Exception as e: print('hub fail', e)

    meta["updatedAt"] = int(NOW * 1000)
    save(path("meta.json"), meta)
    print("done in", int(time.time() - NOW), "s")

def do_sp500():
    sp = load(path("sp500.json"), None)
    if stale("sp", 20 * 3600) or not sp:
        got = sp500()
        if got: sp = {"m": got[0], "c": got[1], "q": (sp or {}).get("q", {})}; mark("sp")
    if sp and (stale("spq", 3 * 3600) or not sp.get("q")):
        qs = quotes([m[0] for m in sp["m"]])
        sp["q"] = {k: [v.get("cap"), v.get("price"), v.get("pct")] for k, v in qs.items()}; sp["qat"] = int(NOW * 1000); mark("spq")
    if sp: save(path("sp500.json"), sp)
    print("sp500", len(sp["m"]) if sp else 0)

def do_disc(static):
    # 8) 종목 발굴 (30분마다)
    if stale("disc", 30 * 60):
        disc = {"at": int(NOW * 1000)}
        r = get("https://query1.finance.yahoo.com/v1/finance/trending/US?count=25")
        try:
            ts = [x["symbol"] for x in r.json()["finance"]["result"][0]["quotes"]]
            ts = [t for t in ts if t and "=" not in t and "^" not in t and ("-" not in t or t.endswith("-B"))]
            tq = quotes(ts)
            disc["trend"] = [{"sym": t, "name": tq[t].get("name") or tq[t].get("sname"), "price": tq[t].get("price"), "pct": tq[t].get("pct"), "cap": tq[t].get("cap")} for t in ts if t in tq]
        except Exception: disc["trend"] = []
        disc["scr"] = {}
        for sid, _, _ in static.get("screens", []):
            r = get(f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds={sid}&count=25" + cq())
            try: disc["scr"][sid] = [disc_quote(x) for x in r.json()["finance"]["result"][0]["quotes"] if x.get("symbol") and "=" not in x["symbol"]]
            except Exception: disc["scr"][sid] = []
        disc["feeds"] = []
        cnt, srcs, titles = {}, {}, {}
        for label, qq, _ in static.get("expertFeeds", []):
            items = gnews(qq, True)
            for n in items: n["tickers"] = tickers_in(n["title"] + " " + n.get("desc", ""))
            disc["feeds"].append(items)
            for n in items:
                for t in n["tickers"]:
                    cnt[t] = cnt.get(t, 0) + 1; srcs.setdefault(t, []); titles.setdefault(t, [])
                    if label not in srcs[t]: srcs[t].append(label)
                    if len(titles[t]) < 2: titles[t].append(n["title"])
        rank = sorted(cnt, key=lambda t: (-len(srcs[t]), -cnt[t]))[:25]
        rq = quotes(rank)
        disc["rank"] = [{"sym": t, "count": cnt[t], "sources": srcs[t], "name": (rq[t].get("name") or rq[t].get("sname")), "price": rq[t].get("price"),
                         "pct": rq[t].get("pct"), "cap": rq[t].get("cap")} for t in rank if t in rq]
        save(path("disc.json"), disc); mark("disc")

def do_hub(static):
    # 9) 뉴스 모아보기 (30분마다)
    if stale("hub", 30 * 60):
        hub = {"at": int(NOW * 1000)}
        def merged(jobs):
            allv = []
            for tag, items in jobs: allv += [dict(n, tag=tag) for n in items]
            seen, out = set(), []
            for n in sorted(allv, key=lambda x: -x["time"]):
                k = n["title"][:40]
                if k not in seen: seen.add(k); out.append(n)
            return out[:80]
        hub["us"] = merged([("미국 증시", gnews("뉴욕증시 OR 미국증시")), ("나스닥", gnews("나스닥 마감")), ("연준", gnews("연준 금리"))])
        hub["kr"] = merged([("코스피", gnews("코스피 마감")), ("코스닥", gnews("코스닥 마감")), ("환율", gnews("원달러 환율"))])
        hub["kw"] = {k: gnews(f'"{k}"') for k in ["박주근의 기업분석", "기업분석 심층"]}
        hub["crowd"] = {q2: gnews(q2) for _, q2 in static.get("crowd", {}).get("newsQueries", [])}
        save(path("hub.json"), hub); mark("hub")

if __name__ == "__main__":
    main()
