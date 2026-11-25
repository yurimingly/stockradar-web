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
        try: return float(v.replace(",", "").replace("%", "").replace("$", "").strip())
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

# ───────── 종목별 매수 타이밍 신호 (안드로이드 Signals.price 와 같은 계산) ─────────
def rsi(c, n=14):
    if len(c) <= n + 1: return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = c[i] - c[i - 1]
        if d > 0: g += d
        else: l -= d
    g /= n; l /= n
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n; l = (l * (n - 1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)
def ma(c, n): return sum(c[-n:]) / n if len(c) >= n else None

def price_signals(daily, weekly, px, is_index=False, sym=""):
    """[이름, 값, 상태] 상태: 2 매수 구간 · 1 관심 · 0 해당 없음 · -1 과열"""
    out = []
    if daily:
        r = rsi(daily)
        if r is not None: out.append(["RSI 일봉", f"{r:.0f}", 2 if r <= 30 else 1 if r <= 40 else -1 if r >= 70 else 0])
    if weekly:
        r = rsi(weekly)
        if r is not None: out.append(["RSI 주봉", f"{r:.0f}", 2 if r <= 35 else 1 if r <= 45 else -1 if r >= 70 else 0])
    hi = max([max(x) for x in (weekly, daily) if x] or [0])
    if hi > 0:
        dd = (px / hi - 1) * 100
        if is_index:
            avg = -20.0 if sym in ("^IXIC", "^NDX", "QQQ", "QQQM") else -14.0
            out.append(["MDD", f"{dd:.1f}%", 2 if dd <= avg else 1 if dd <= avg / 2 else 0])
        else: out.append(["MDD", f"{dd:.1f}%", 2 if dd <= -30 else 1 if dd <= -20 else 0])
    m = ma(daily, 200) if daily else None
    if m:
        gap = (px / m - 1) * 100
        out.append(["200일선", f"{gap:+.1f}%", 2 if gap <= -5 else 1 if gap < 0 else -1 if gap > 25 else 0])
    m = ma(weekly, 200) if weekly else None
    if m:
        gap = (px / m - 1) * 100
        out.append(["200주선", f"{gap:+.1f}%", 2 if gap <= 3 else 1 if gap <= 10 else 0])
    return out

def closes_since(f, days):
    d = load(f)
    if not d or not d.get("t"): return None
    cut = NOW - days * 86400
    return [c for t, c in zip(d["t"], d["c"]) if t >= cut and c is not None]

BENCH = ["^GSPC", "^IXIC", "^KS11"]
HIST_DIR = "history/signals"   # 주별 기록은 main 브랜치에 커밋해서 영구 보관

def weekly_snapshot(rows, bench):
    """매주 한 번(한국시간 기준 그 주 첫 실행) 신호 초록 1개 이상 종목과 그때 가격을 저장 → 나중에 수익률로 '맞았는지' 확인"""
    kst = time.gmtime(NOW + 9 * 3600)
    y, w, _ = __import__("datetime").date(kst.tm_year, kst.tm_mon, kst.tm_mday).isocalendar()
    key = f"{y}-W{w:02d}"
    os.makedirs(HIST_DIR, exist_ok=True)
    idx_path = os.path.join(HIST_DIR, "index.json")
    idx = load(idx_path, []) or []
    if any(x["week"] == key for x in idx): return
    snap = {sym: {"n": r["n"], "my": r["my"], "sp": r["sp"], "p": r["p"], "g": sum(1 for x in r["s"] if x[2] == 2),
                  "y": sum(1 for x in r["s"] if x[2] == 1), "s": r["s"]}
            for sym, r in rows.items() if any(x[2] == 2 for x in r["s"]) and r.get("p")}
    date = time.strftime("%Y-%m-%d", kst)
    save(os.path.join(HIST_DIR, key + ".json"), {"week": key, "date": date, "at": int(NOW * 1000), "bench": bench, "rows": snap})
    idx.insert(0, {"week": key, "date": date, "count": len(snap), "g5": sum(1 for r in snap.values() if r["g"] >= 5)})
    save(idx_path, idx)
    print("weekly snapshot", key, len(snap))

def do_signals(stocks, q):
    """내 목록 + S&P 500 전 종목의 신호를 계산해서 signals.json 으로 (앱·웹앱의 '매수 신호 많은 종목' 화면용)"""
    sp = load(path("sp500.json"), {}) or {}
    names = {m[0]: m[1] for m in sp.get("m", [])}
    sectors = {m[0]: m[2] for m in sp.get("m", [])}
    # S&P 500 중 내 목록에 없는 종목은 하루 1번 차트만 받아 둠
    extra = [m for m in names if m not in stocks]
    def do_chart(sym):
        try:
            f = fname(sym)
            if stale("d:" + sym, 20 * 3600) or not os.path.exists(path("c", f + ".d.json")):
                c = chart(sym, "2y", "1d")
                if c: save(path("c", f + ".d.json"), c); mark("d:" + sym)
            if stale("w:" + sym, 20 * 3600) or not os.path.exists(path("c", f + ".w.json")):
                c = chart(sym, "10y", "1wk")
                if c: save(path("c", f + ".w.json"), c); mark("w:" + sym)
        except Exception as e: print("chart fail", sym, e)
    with ThreadPoolExecutor(6) as ex: list(ex.map(do_chart, extra))
    spq = sp.get("q", {})
    rows = {}
    for sym in list(stocks) + extra:
        f = fname(sym)
        daily, weekly = closes_since(path("c", f + ".d.json"), 366), closes_since(path("c", f + ".w.json"), 5 * 365.25)
        px = (q.get(sym) or {}).get("price") or (spq.get(sym) or [None, None])[1] or (daily[-1] if daily else None)
        if not px or not (daily or weekly): continue
        if daily: daily[-1] = px
        st = stocks.get(sym) or {}
        sig = price_signals(daily, weekly, px, sym.startswith("^"), sym)
        if not sig: continue
        rows[sym] = {"n": st.get("ko") or names.get(sym, sym), "etf": bool(st.get("etf")), "my": sym in stocks, "sp": sym in names,
                     "sec": sectors.get(sym, ""), "s": sig, "p": rnd(px)}
    bench = {b: rnd((q.get(b) or {}).get("price")) for b in BENCH}
    save(path("signals.json"), {"at": int(NOW * 1000), "rows": rows, "bench": bench})
    weekly_snapshot(rows, bench)
    good = sorted(rows.items(), key=lambda kv: -sum(1 for x in kv[1]["s"] if x[2] == 2))[:5]
    print("signals", len(rows), [(k, sum(1 for x in v["s"] if x[2] == 2)) for k, v in good])

# ───────── 섹터 추천 종목 자동 채우기 (일주일에 1번) ─────────
# 미국: 섹터 대표 테마 ETF의 보유 상위 종목 · 한국: 네이버 증권 '테마별 시세'
FILL = {  # 섹터: ([미국 테마 ETF], [네이버 테마 이름에 들어간 말], 업종·사업설명이 맞아야 하는 조건)
    # ETF 보유 종목엔 테마와 상관없는 대형주(아마존 등)도 섞여 있어서, 업종·사업설명이 섹터와 맞는 종목만 받음
    "양자컴퓨팅": (["QTUM"], ["양자"], r"quantum"),
    "사이버보안": (["CIBR", "HACK", "BUG"], ["보안"], r"cyber|security"),
    "생명과학": (["XBI", "IBB"], ["바이오", "유전자"], r"biotech|drug manufacturers|medical|diagnostic"),
    "AI·반도체": (["SMH", "SOXX"], ["HBM", "반도체"], r"semiconductor"),
    "우주항공": (["UFO", "ARKX", "ROKT"], ["우주"], r"space|satellite|launch vehicle"),
    "원자력·전력": (["NLR", "URA", "NUKZ", "GRID"], ["원자력", "전력설비", "전선"], r"uranium|nuclear|utilities|electrical equipment|power generation"),
    "로봇·자율주행": (["BOTZ", "ROBO"], ["로봇"], r"robot|automation|autonomous"),
    "AI 소프트웨어": (["IGV", "AIQ", "WCLD"], ["인공지능"], r"software"),
    "AI 인프라·데이터센터": (["DTCR", "SRVR"], ["데이터센터"], r"data cent"),
    "핀테크·디지털자산": (["ARKF", "FINX", "IPAY"], ["핀테크", "가상화폐", "스테이블"], r"credit services|capital markets|financial data|payment|crypto|blockchain|stablecoin"),
    "방산·드론": (["ITA", "XAR", "PPA"], ["방위산업", "드론"], r"aerospace & defense|defense"),
    "클린에너지·ESS": (["ICLN", "TAN", "QCLN"], ["2차전지", "태양광", "ESS"], r"solar|renewable|battery|batteries|energy storage|fuel cell"),
    "화장품·뷰티": ([], ["화장품"], r"cosmetic|beauty|personal products"),
    "고배당": (["SCHD", "VYM", "HDV"], [], r""),
}
FILL_VER = 5
FILL_TARGET, FILL_MAX_ADD = 15, 8          # 섹터당 15개까지 채우되, 한 번에 최대 8개
US_MIN_CAP, KR_MIN_CAP_KRW = 2e9, 3e11      # 미국 20억 달러 · 한국 3,000억 원 이상만

def etf_top(sym):
    r = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules=topHoldings" + cq())
    try: hs = r.json()["quoteSummary"]["result"][0]["topHoldings"]["holdings"]
    except Exception: return []
    return [(h.get("symbol") or "").replace(".", "-") for h in hs if h.get("symbol") and re.fullmatch(r"[A-Z]{1,5}(\.[A-Z])?", h.get("symbol") or "")]

PROFILE = {}
def fits(sym, pattern):
    """업종 + 사업설명 앞부분이 섹터 조건에 맞는지"""
    if sym not in PROFILE:
        r = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules=assetProfile" + cq())
        try: ap = r.json()["quoteSummary"]["result"][0].get("assetProfile") or {}
        except Exception: ap = {}
        PROFILE[sym] = f"{ap.get('sector', '')} {ap.get('industry', '')} {(ap.get('longBusinessSummary') or '')[:400]}".lower()
    return bool(re.search(pattern, PROFILE[sym]))

def naver_text(url):
    r = get(url)
    if not r or r.status_code != 200: return ""
    return r.content.decode("euc-kr", "ignore")

NAVER_THEMES = None
def naver_theme_stocks(words):
    """네이버 증권 테마 → 종목 (m.stock.naver.com 공개 API)"""
    global NAVER_THEMES
    if NAVER_THEMES is None:
        NAVER_THEMES = {}
        for page in range(1, 5):
            r = get(f"https://m.stock.naver.com/api/stocks/theme?page={page}&pageSize=100")
            try: groups = r.json().get("groups") or []
            except Exception: groups = []
            for g in groups: NAVER_THEMES[g["name"]] = g["no"]
            if len(groups) < 100: break
        print("naver themes", len(NAVER_THEMES))
    out, dbg = [], True
    for name, no in NAVER_THEMES.items():
        if not any(w in name for w in words): continue
        r = get(f"https://m.stock.naver.com/api/stocks/theme/{no}?page=1&pageSize=100")
        try: j = r.json()
        except Exception: j = {}
        found = []
        def visit(x):
            if isinstance(x, dict):
                code = x.get("itemCode") or x.get("reutersCode") or x.get("code")
                nm = x.get("stockName") or x.get("itemName") or x.get("name")
                if isinstance(code, str) and re.fullmatch(r"\d{6}", code) and isinstance(nm, str): found.append((code, nm.strip()))
                for v in x.values(): visit(v)
            elif isinstance(x, list):
                for v in x: visit(v)
        visit(j)
        if dbg: print("  naver theme", name, no, len(found), str(j)[:160]); dbg = False
        for f in found:
            if f not in out: out.append(f)
    return out

def do_fill(catalog):
    old = load(path("fill.json"), None)
    if old and old.get("v") == FILL_VER and not stale("fill", 7 * 86400): return old
    have = {x["t"] for s in catalog for x in s["stocks"]}
    rate = (quotes(["KRW=X"]).get("KRW=X") or {}).get("price") or 1400
    res = {}
    for sec_name, (etfs, words, must) in FILL.items():
        sec = next((s for s in catalog if s["name"] == sec_name), None)
        if not sec: continue
        room = min(FILL_MAX_ADD, FILL_TARGET - len(sec["stocks"]))
        if room <= 0: res[sec_name] = []; continue
        cand = {}
        for e in etfs:
            for t in etf_top(e):
                if t not in have: cand.setdefault(t, {"t": t, "src": f"{e} 보유 상위"})
        for code, nm in (naver_theme_stocks(words) if words else []):
            for suf in (".KS", ".KQ"):
                if code + suf in have: break
            else: cand.setdefault(code, {"t": code, "ko": nm, "src": "네이버 테마", "kr": True})
        # 한국 종목은 코스피(.KS)·코스닥(.KQ) 둘 다 물어봐서 시세가 나오는 쪽으로
        ask = [c["t"] for c in cand.values() if not c.get("kr")] + [c["t"] + suf for c in cand.values() if c.get("kr") for suf in (".KS", ".KQ")]
        qs = quotes(ask) if ask else {}
        rows = []
        for c in cand.values():
            if c.get("kr"):
                hit = next((c["t"] + suf for suf in (".KS", ".KQ") if (qs.get(c["t"] + suf) or {}).get("cap")), None)
                if not hit: continue
                cap = qs[hit]["cap"]
                if cap < KR_MIN_CAP_KRW: continue
                rows.append({"t": hit, "ko": c["ko"], "capUsd": cap / rate, "src": c["src"]})
            else:
                qq = qs.get(c["t"]) or {}
                if (qq.get("cap") or 0) < US_MIN_CAP: continue
                if must and not fits(c["t"], must): continue
                if not must and sec_name == "고배당" and not ((qq.get("divRate") or 0) / (qq.get("price") or 1) >= 0.03): continue
                rows.append({"t": c["t"], "ko": qq.get("sname") or qq.get("name") or c["t"], "capUsd": qq["cap"], "src": c["src"]})
        rows.sort(key=lambda x: -x["capUsd"])
        res[sec_name] = rows[:room]
        print("fill", sec_name, [r["t"] for r in res[sec_name]])
    out = {"at": int(NOW * 1000), "v": FILL_VER, "sectors": res}
    save(path("fill.json"), out); mark("fill")
    return out

# ───────── 경제 캘린더 (발표 일정 · 실제 수치 · 발표일 주가 반응) ─────────
FRED_KEY = os.environ.get("FRED_API_KEY", "")
# (FRED 발표 ID, 시리즈, 이름, 값 계산: yoy=전년비 %, mom=전월비 %, chg=전월 대비 증감, lvl=그대로, 단위, 설명)
ECON = [
    (10, "CPIAUCSL", "소비자물가(CPI)", "yoy", "%", "물가가 1년 전보다 얼마나 올랐는지. 예상보다 높으면 금리 인하 기대가 줄어 주가에 부담"),
    (10, "CPILFESL", "근원 CPI (식품·에너지 제외)", "yoy", "%", "변동 큰 식품·에너지를 뺀 물가. 연준이 더 중요하게 봐요"),
    (50, "PAYEMS", "비농업 고용 (고용보고서)", "chg", "천 명", "한 달 동안 늘어난 일자리 수. 너무 강하면 금리 부담, 너무 약하면 경기 걱정"),
    (50, "UNRATE", "실업률", "lvl", "%", "일자리를 찾는데 못 구한 사람 비율. 빠르게 오르면 경기 침체 신호"),
    (46, "PPIFIS", "생산자물가(PPI)", "yoy", "%", "기업이 받는 가격. 소비자물가보다 먼저 움직이는 경우가 많아요"),
    (54, "PCEPILFE", "근원 PCE 물가", "yoy", "%", "연준이 목표(2%)로 삼는 물가 지표"),
    (53, "A191RL1Q225SBEA", "GDP 성장률 (연율)", "lvl", "%", "경제가 얼마나 성장했는지 (분기)"),
    (9, "RSAFS", "소매판매", "mom", "%", "소비가 한 달 전보다 얼마나 늘었는지. 미국 경제의 70%가 소비"),
    (180, "ICSA", "신규 실업수당 청구", "lvl", "건", "매주 새로 실업수당을 신청한 사람 수. 늘어나면 고용 둔화 신호"),
]
FF_KO = {"CPI m/m": "소비자물가 (전월비)", "CPI y/y": "소비자물가 (전년비)", "Core CPI m/m": "근원 소비자물가 (전월비)", "Non-Farm Employment Change": "비농업 고용",
         "Unemployment Rate": "실업률", "PPI m/m": "생산자물가 (전월비)", "Core PPI m/m": "근원 생산자물가 (전월비)", "Core PCE Price Index m/m": "근원 PCE 물가 (전월비)",
         "Advance GDP q/q": "GDP 속보치", "Prelim GDP q/q": "GDP 잠정치", "Final GDP q/q": "GDP 확정치", "Retail Sales m/m": "소매판매", "Core Retail Sales m/m": "근원 소매판매",
         "Unemployment Claims": "신규 실업수당 청구", "Federal Funds Rate": "기준금리 결정 (FOMC)", "FOMC Statement": "FOMC 성명", "FOMC Press Conference": "파월 의장 기자회견",
         "FOMC Meeting Minutes": "FOMC 의사록", "ISM Manufacturing PMI": "ISM 제조업 지수", "ISM Services PMI": "ISM 서비스업 지수", "JOLTS Job Openings": "구인건수 (JOLTS)",
         "ADP Non-Farm Employment Change": "ADP 민간 고용", "CB Consumer Confidence": "소비자신뢰지수", "Prelim UoM Consumer Sentiment": "미시간대 소비심리 (예비)",
         "Revised UoM Consumer Sentiment": "미시간대 소비심리 (확정)", "Average Hourly Earnings m/m": "시간당 임금 (전월비)", "Durable Goods Orders m/m": "내구재 주문",
         "Core Durable Goods Orders m/m": "근원 내구재 주문", "Pending Home Sales m/m": "잠정 주택판매", "New Home Sales": "신규 주택판매", "Existing Home Sales": "기존 주택판매",
         "Building Permits": "건축허가", "Housing Starts": "주택착공", "Empire State Manufacturing Index": "뉴욕 제조업 지수", "Philly Fed Manufacturing Index": "필라델피아 제조업 지수",
         "Flash Manufacturing PMI": "제조업 PMI (예비)", "Flash Services PMI": "서비스업 PMI (예비)", "Personal Spending m/m": "개인소비", "Personal Income m/m": "개인소득",
         "Trade Balance": "무역수지", "Crude Oil Inventories": "원유 재고", "Prelim GDP Price Index q/q": "GDP 물가지수", "Employment Cost Index q/q": "고용비용지수"}

def fred(path_, **params):
    params.update(api_key=FRED_KEY, file_type="json")
    r = get("https://api.stlouisfed.org/fred/" + path_ + "?" + urllib.parse.urlencode(params))
    try: return r.json() if r and r.status_code == 200 else None
    except Exception: return None

def day_moves(sym):
    d = load(path("h", fname(sym) + ".json"))
    if not d: return {}
    out, prev = {}, None
    for t, c in zip(d["t"], d["c"]):
        if c is None: continue
        if prev: out[time.strftime("%Y-%m-%d", time.gmtime(t))] = (c / prev - 1) * 100
        prev = c
    return out

def ff_week(which):
    r = get(f"https://nfs.faireconomy.media/ff_calendar_{which}.json")
    try: return r.json() if r and r.status_code == 200 else []
    except Exception: return []

NQ_HDR = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
# 지표별 Nasdaq 경제 캘린더 이름 (예상치·첫 발표 실제치를 여기서 가져옴)
NQ_NAMES = {"CPIAUCSL": ["CPI (YoY)"], "CPILFESL": ["Core CPI (YoY)"], "PAYEMS": ["Nonfarm Payrolls"], "UNRATE": ["Unemployment Rate"],
            "PPIFIS": ["PPI (YoY)"], "PCEPILFE": ["Core PCE Price Index (YoY)"], "A191RL1Q225SBEA": ["GDP (QoQ)"], "RSAFS": ["Retail Sales (MoM)"],
            "ICSA": ["Initial Jobless Claims"]}
def nq_num(x):
    x = (x or "").replace("&nbsp;", "").replace(",", "").strip()
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*([KMB%]?)", x)
    if not m: return None
    v = float(m.group(1))
    return v * {"K": 1e3, "M": 1e6, "B": 1e9}.get(m.group(2), 1)
def nq_day(date, cache):
    """그날 미국 경제지표 발표 (이름 → (실제, 예상)). 지난 날짜는 바뀌지 않으니 한 번 받으면 저장"""
    if date in cache: return cache[date]
    r = get(f"https://api.nasdaq.com/api/calendar/economicevents?date={date}", headers=NQ_HDR)
    try: rows = r.json()["data"]["rows"] or []
    except Exception: return {}
    out = {}
    for x in rows:
        if x.get("country") != "United States": continue
        a, c = nq_num(x.get("actual")), nq_num(x.get("consensus"))
        if a is not None or c is not None: out[x["eventName"].strip()] = [a, c]
    if date < time.strftime("%Y-%m-%d", time.gmtime(NOW - 86400)): cache[date] = out
    return out

def do_econ():
    old = load(path("econ.json"), {}) or {}
    if not stale("econ", 3 * 3600) and old.get("ind") and old.get("v") == 3: return
    up = []
    for wk in ("thisweek", "nextweek"):
        for e in ff_week(wk):
            if e.get("country") != "USD" or e.get("impact") not in ("High", "Medium"): continue
            try: ms = int(__import__("datetime").datetime.fromisoformat(e["date"]).timestamp() * 1000)
            except Exception: continue
            up.append({"t": e.get("title"), "ko": FF_KO.get(e.get("title"), e.get("title")), "at": ms, "imp": e.get("impact"),
                       "fc": e.get("forecast") or "", "pv": e.get("previous") or "", "act": e.get("actual") or ""})
    up.sort(key=lambda x: x["at"])
    print("econ calendar", len(up), "fred key", bool(FRED_KEY))
    ind = []
    if FRED_KEY:
        sp, nq = day_moves("^GSPC"), day_moves("^IXIC")
        start = time.strftime("%Y-%m-%d", time.gmtime(NOW - 8 * 365 * 86400))
        rel_cache = {}
        nqc = load(path("nqcal.json"), {}) or {}
        for rid, sid, name, how, unit, desc in ECON:
            try:
                if rid not in rel_cache:
                    j = fred("release/dates", release_id=rid, realtime_start=start, realtime_end="9999-12-31", include_release_dates_with_no_data="true", limit=10000)
                    rel_cache[rid] = sorted({x["date"] for x in (j or {}).get("release_dates", [])})
                dates = rel_cache[rid]
                today = time.strftime("%Y-%m-%d", time.gmtime(NOW))
                past, future = [d for d in dates if d <= today], [d for d in dates if d > today]
                j = fred("series/observations", series_id=sid, observation_start=time.strftime("%Y-%m-%d", time.gmtime(NOW - 10 * 365 * 86400)))
                obs = [(o["date"], float(o["value"])) for o in (j or {}).get("observations", []) if o.get("value") not in (".", None)]
                if len(obs) < 14: continue
                vals = []
                for i, (d, v) in enumerate(obs):
                    if how == "yoy":
                        if i >= 12 and obs[i - 12][1]: vals.append((d, (v / obs[i - 12][1] - 1) * 100))
                    elif how == "mom":
                        if i >= 1 and obs[i - 1][1]: vals.append((d, (v / obs[i - 1][1] - 1) * 100))
                    elif how == "chg":
                        if i >= 1: vals.append((d, v - obs[i - 1][1]))
                    else: vals.append((d, v))
                # 발표일 ↔ 관측치: 각 관측 기간이 끝난 뒤 첫 발표일이 그 수치의 첫 발표 (GDP처럼 같은 분기를 여러 번 고쳐 발표해도 첫 발표만)
                import datetime as _dt
                gap = (_dt.date.fromisoformat(obs[-1][0]) - _dt.date.fromisoformat(obs[-2][0])).days
                def period_end(od):
                    d0 = _dt.date.fromisoformat(od)
                    if gap <= 8: return d0                                  # 주간: 관측일 = 그 주 마지막 날
                    months = 3 if gap > 40 else 1
                    m = d0.month - 1 + months
                    return _dt.date(d0.year + m // 12, m % 12 + 1, 1) - _dt.timedelta(days=1)
                hist = []
                for i in range(len(vals) - 1, 0, -1):
                    od, v = vals[i]; pv = vals[i - 1][1]
                    pe = period_end(od).isoformat()
                    rd = next((d for d in past if d > pe), None)
                    if not rd: continue
                    hist.append({"d": rd, "obs": od, "v": round(v, 3), "pv": round(pv, 3), "sp": round(sp[rd], 2) if rd in sp else None, "nq": round(nq[rd], 2) if rd in nq else None})
                # 예상치(컨센서스)와 첫 발표 실제치 붙이기 — 최근 8년(주간 지표는 2년)
                names = NQ_NAMES.get(sid, [])
                todo = [h for h in hist if h["d"] >= time.strftime("%Y-%m-%d", time.gmtime(NOW - (2 if sid == "ICSA" else 8) * 365 * 86400))]
                with ThreadPoolExecutor(6) as ex: days = list(ex.map(lambda h: nq_day(h["d"], nqc), todo))
                hit = 0
                for h, day in zip(todo, days):
                    ev = next((day[n] for n in names if n in day), None)
                    if not ev: continue
                    a, c = ev
                    scale = 1e-3 if sid == "PAYEMS" else 1          # 고용은 천 명 단위로
                    if a is not None: h["a"] = round(a * scale, 3)
                    if c is not None: h["fc"] = round(c * scale, 3); hit += 1
                print("  consensus", sid, hit, "/", len(todo))
                def stat(rows):
                    m = [x["sp"] for x in rows if x["sp"] is not None]
                    return {"n": len(m), "avg": round(sum(m) / len(m), 2) if m else None, "win": round(sum(1 for x in m if x > 0) / len(m) * 100) if m else None}
                act = lambda x: x.get("a", x["v"])
                withfc = [x for x in hist if x.get("fc") is not None]
                ind.append({"id": sid, "name": name, "unit": unit, "desc": desc, "how": how, "next": future[0] if future else None,
                            "hist": hist[:120], "up": stat([x for x in withfc if act(x) > x["fc"]]), "down": stat([x for x in withfc if act(x) < x["fc"]]),
                            "same": stat([x for x in withfc if act(x) == x["fc"]]), "all": stat(hist)})
                print("econ", sid, len(hist), "next", future[:1], hist[:2])
            except Exception as e: print("econ fail", sid, e)
        save(path("nqcal.json"), nqc)
    save(path("econ.json"), {"at": int(NOW * 1000), "v": 3, "up": up, "ind": ind or old.get("ind", [])}); mark("econ")

# ───────── 신규 상장 (IPO) ─────────
# 큰 신규 상장은 앱·웹앱이 알맞은 섹터에 자동으로 넣어 줌 (사용자가 지우면 다시 안 넣음)
AUTO_ADD_CAP = 10e9          # 시총 100억 달러 이상이면 자동 추가
LIST_MIN_CAP = 1e9           # 목록에는 10억 달러 이상만
KO_NAMES = {"ANT": "앤트로픽 (Claude)", "SPCX": "스페이스X", "OPAI": "오픈AI", "CRWV": "코어위브", "CRCL": "써클", "FIG": "피그마",
            "KLAR": "클라르나", "NBIS": "네비우스", "CBRS": "세레브라스", "DBX": "드롭박스"}
IPO_SECTOR_RULES = [("레버리지·인버스 ETF", r"2x|3x|leveraged|inverse"), ("양자컴퓨팅", r"quantum"), ("사이버보안", r"security|cyber"),
    ("AI 소프트웨어", r"artificial intelligence|\bai\b|large language|machine learning|software"),
    ("AI·반도체", r"semiconductor"), ("AI 인프라·데이터센터", r"data cent|cloud infrastructure|gpu cloud|computer hardware"),
    ("생명과학", r"biotech|drug|pharma|medical|diagnostic|health"), ("우주항공", r"\bspace|satellite|launch vehicle"),
    ("방산·드론", r"aerospace|defense|drone"), ("원자력·전력", r"utilit|uranium|nuclear|electrical equipment|power producer"),
    ("클린에너지·ESS", r"solar|renewable|battery|batteries|hydrogen"), ("로봇·자율주행", r"robot|automation|autonomous|auto manufacturers"),
    ("화장품·뷰티", r"personal products|cosmetic|beauty"), ("핀테크·디지털자산", r"credit services|capital markets|crypto|fintech|payment|stablecoin|financial data")]

def ipo_sector(sym, name):
    r = get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules=assetProfile" + cq())
    ap = {}
    try: ap = r.json()["quoteSummary"]["result"][0].get("assetProfile") or {}
    except Exception: pass
    head = f"{ap.get('sector', '')} {ap.get('industry', '')} {name}".lower()
    body = (ap.get("longBusinessSummary") or "")[:600].lower()
    for text in (head, head + " " + body):
        for sec, pat in IPO_SECTOR_RULES:
            if re.search(pat, text): return sec, f"{ap.get('sector', '')} · {ap.get('industry', '')}".strip(" ·")
    return "", f"{ap.get('sector', '')} · {ap.get('industry', '')}".strip(" ·")

def nasdaq_ipos():
    hdr = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
    priced, upcoming = [], []
    t = time.gmtime(NOW)
    months = [(t.tm_year, t.tm_mon - i) for i in range(4)]
    months = [(y - 1, m + 12) if m <= 0 else (y, m) for y, m in months]
    for y, m in months:
        r = get(f"https://api.nasdaq.com/api/ipo/calendar?date={y}-{m:02d}", headers=hdr)
        try: d = r.json()["data"]
        except Exception: continue
        for row in ((d.get("priced") or {}).get("rows") or []):
            priced.append({"sym": row.get("proposedTickerSymbol"), "name": row.get("companyName"), "date": row.get("pricedDate"),
                           "ipoPrice": num(row.get("proposedSharePrice")), "deal": row.get("dollarValueOfSharesOffered"), "exch": row.get("proposedExchange")})
        if (y, m) == months[0]:
            for row in (((d.get("upcoming") or {}).get("upcomingTable") or {}).get("rows") or []):
                upcoming.append({"sym": row.get("proposedTickerSymbol"), "name": row.get("companyName"), "date": row.get("expectedPriceDate"),
                                 "range": row.get("proposedSharePrice"), "deal": row.get("dollarValueOfSharesOffered"), "exch": row.get("proposedExchange")})
    return priced, upcoming

def stockanalysis_ipos():
    r = get("https://stockanalysis.com/ipos/")
    if not r or r.status_code != 200: return []
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        m = re.search(r'href="/stocks/([a-z0-9.\-]+)/"', tr)
        cells = [wclean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if m and len(cells) >= 4:
            out.append({"sym": m.group(1).upper(), "name": cells[2], "date": cells[0], "ipoPrice": num(cells[3].replace("$", ""))})
    return out

def to_ms(d):
    for fmt in ("%m/%d/%Y", "%b %d, %Y", "%Y-%m-%d"):
        try: return int(time.mktime(time.strptime(d.strip(), fmt)) * 1000)
        except Exception: pass
    return 0

def do_ipo():
    old = load(path("ipo.json"), {}) or {}
    if not stale("ipo", 3 * 3600) and old.get("list") is not None and all(x.get("rv") == 2 for x in old["list"]): return old
    priced, upcoming = nasdaq_ipos()
    src = "Nasdaq"
    if not priced: priced, src = stockanalysis_ipos(), "stockanalysis.com"
    print("ipo source", src, len(priced), "upcoming", len(upcoming))
    since = NOW * 1000 - 120 * 86400_000
    seen, rows = set(), []
    for p in priced:
        sym = (p.get("sym") or "").strip().upper().replace(".", "-")
        ms = to_ms(p.get("date") or "")
        if not sym or sym in seen or (ms and ms < since) or re.search(r"spac|acquisition corp|blank check", (p.get("name") or "").lower()): continue
        seen.add(sym); p["sym"] = sym; p["ms"] = ms; rows.append(p)
    qs = quotes([p["sym"] for p in rows]) if rows else {}
    prev = {x["sym"]: x for x in old.get("list", [])}
    out = []
    for p in rows:
        q = qs.get(p["sym"]) or {}
        cap = q.get("cap") or 0
        if cap < LIST_MIN_CAP: continue
        sec, ind = (prev[p["sym"]].get("sector", ""), prev[p["sym"]].get("ind", "")) if p["sym"] in prev and prev[p["sym"]].get("ind") and prev[p["sym"]].get("rv") == 2 else ipo_sector(p["sym"], p.get("name") or "")
        price = q.get("price")
        out.append({"sym": p["sym"], "name": q.get("name") or p.get("name"), "ko": KO_NAMES.get(p["sym"], q.get("name") or p.get("name")), "date": p["ms"],
                    "ipoPrice": p.get("ipoPrice"), "price": price, "pct": q.get("pct"), "cap": cap, "sector": sec, "ind": ind,
                    "sinceIpo": (price / p["ipoPrice"] - 1) * 100 if price and p.get("ipoPrice") else None, "auto": cap >= AUTO_ADD_CAP, "rv": 2})
    out.sort(key=lambda x: -x["cap"])
    spac = lambda n: re.search(r"spac|acquisition corp|blank check", (n or "").lower())
    up = [u for u in upcoming if u.get("sym") and not spac(u.get("name"))][:20]
    res = {"at": int(NOW * 1000), "src": src, "list": out[:40], "upcoming": up, "autoCap": AUTO_ADD_CAP}
    save(path("ipo.json"), res); mark("ipo")
    print("ipo", len(out), [x["sym"] for x in out[:8]])
    return res

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
    crumb()
    # 신규 상장: 큰 종목은 다른 종목처럼 차트·지표·뉴스도 미리 받아 둠
    try:
        ipo = do_ipo()
        for x in ipo.get("list", []):
            if x["sym"] not in stocks: stocks[x["sym"]] = {"t": x["sym"], "ko": x["ko"], "etf": False}
    except Exception as e: print("ipo fail", e)
    try:
        fill = do_fill(cat)
        for lst in fill.get("sectors", {}).values():
            for x in lst:
                if x["t"] not in stocks: stocks[x["t"]] = {"t": x["t"], "ko": x["ko"], "etf": False}
    except Exception as e: print("fill fail", e)
    syms = list(stocks)
    chart_syms = list(dict.fromkeys(syms + crowd_syms))
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
    try: do_signals(stocks, q)
    except Exception as e: print('signals fail', e)
    try: do_econ()
    except Exception as e: print('econ fail', e)

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
