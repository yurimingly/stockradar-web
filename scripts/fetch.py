"""GitHub Actions에서 주기적으로 돌면서 웹앱이 읽을 데이터를 미리 받아 data/ 에 저장.
아이폰 사파리는 Yahoo·CNN·구글뉴스를 직접 못 불러서(CORS) 이렇게 미리 받아둔다.

data/
  quotes.json          모든 종목 시세 (매번)
  c/<SYM>.i.json       5일치 15분봉 (매번)
  c/<SYM>.d.json       2년치 일봉 (3시간마다)
  c/<SYM>.w.json       전체 기간 주봉 (하루 1번)
  s/<SYM>.json         주요 지표·ETF 보유 종목 (하루 1번)
  n/<SYM>.json         뉴스 (2시간마다)
  h/<SYM>.json         지수·VIX·채권 등 전체 기간 일봉 (하루 1번, 백테스트용)
  fg.json / fgh.json   CNN 공포·탐욕 현재값 / 과거값
  meta.json            각 파일을 언제 받았는지
"""
import json, os, re, sys, time, urllib.parse, xml.etree.ElementTree as ET
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
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

meta = {}
try: meta = json.load(open(path("meta.json")))
except Exception: pass
def stale(key, sec): return NOW - meta.get(key, 0) > sec
def mark(key): meta[key] = int(NOW)

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

def chart(sym, rng, iv):
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={iv}&includePrePost=false")
    if not r or r.status_code != 200: return None
    try:
        res = r.json()["chart"]["result"][0]
    except Exception: return None
    m = res.get("meta", {})
    ts = res.get("timestamp") or []
    cl = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    t, c = [], []
    for a, b in zip(ts, cl):
        if b is not None: t.append(a); c.append(rnd(b))
    return {"t": t, "c": c, "m": {"price": m.get("regularMarketPrice"), "prev": m.get("chartPreviousClose") or m.get("previousClose"),
            "name": m.get("longName") or m.get("shortName"), "h52": m.get("fiftyTwoWeekHigh"), "l52": m.get("fiftyTwoWeekLow"),
            "hi": m.get("regularMarketDayHigh"), "lo": m.get("regularMarketDayLow"), "vol": m.get("regularMarketVolume"), "cur": m.get("currency")}}

def crumb():
    get("https://fc.yahoo.com", allow_redirects=True)
    r = get("https://query2.finance.yahoo.com/v1/test/getcrumb")
    return r.text.strip() if r and r.status_code == 200 else None

def quotes(syms, cr):
    out = {}
    for i in range(0, len(syms), 50):
        part = syms[i:i + 50]
        url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + urllib.parse.quote(",".join(part)) + (f"&crumb={cr}" if cr else "")
        r = get(url)
        ok = False
        if r and r.status_code == 200:
            try:
                for q in r.json()["quoteResponse"]["result"]:
                    out[q["symbol"]] = {k: q.get(v) for k, v in {
                        "price": "regularMarketPrice", "chg": "regularMarketChange", "pct": "regularMarketChangePercent", "prev": "regularMarketPreviousClose",
                        "cap": "marketCap", "name": "longName", "sname": "shortName", "state": "marketState", "vol": "regularMarketVolume",
                        "pre": "preMarketPrice", "prePct": "preMarketChangePercent", "post": "postMarketPrice", "postPct": "postMarketChangePercent",
                        "high52": "fiftyTwoWeekHigh", "low52": "fiftyTwoWeekLow", "pe": "trailingPE", "fpe": "forwardPE", "time": "regularMarketTime"}.items()}
                ok = True
            except Exception: pass
        if not ok:  # v7이 막히면 차트 API로 대신
            def one(s):
                c = chart(s, "5d", "1d")
                if c and c["m"]["price"]:
                    p, pv = c["m"]["price"], (c["c"][-2] if len(c["c"]) >= 2 else c["m"]["prev"])
                    out[s] = {"price": p, "prev": pv, "chg": p - pv if pv else None, "pct": (p / pv - 1) * 100 if pv else None, "name": c["m"]["name"]}
            with ThreadPoolExecutor(6) as ex: list(ex.map(one, part))
    return out

def summary(sym, cr):
    mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,topHoldings,fundProfile"
    r = get(f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(sym)}?modules={mods}" + (f"&crumb={cr}" if cr else ""))
    if not r or r.status_code != 200: return None
    try:
        res = r.json()["quoteSummary"]["result"][0]
        if "assetProfile" in res:  # 긴 회사 소개·임원 목록은 용량만 커서 줄임
            ap = res["assetProfile"]; ap.pop("companyOfficers", None)
            if ap.get("longBusinessSummary"): ap["longBusinessSummary"] = ap["longBusinessSummary"][:1500]
        return res
    except Exception: return None

def gnews(q, en=False):
    url = (f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=en-US&gl=US&ceid=US:en" if en
           else f"https://news.google.com/rss/search?q={urllib.parse.quote(q)}&hl=ko&gl=KR&ceid=KR:ko")
    r = get(url)
    if not r or r.status_code != 200: return []
    try:
        root = ET.fromstring(r.content)
        out = []
        for it in root.iter("item"):
            src = (it.findtext("source") or "")
            t = it.findtext("title") or ""
            if src and t.endswith(" - " + src): t = t[: -len(src) - 3]
            pd = it.findtext("pubDate") or ""
            try: ts = int(time.mktime(time.strptime(pd[:25], "%a, %d %b %Y %H:%M:%S")) - time.timezone) * 1000
            except Exception: ts = 0
            out.append({"title": t, "link": it.findtext("link"), "src": src, "time": ts})
            if len(out) >= 15: break
        return out
    except Exception: return []

def main():
    cat = json.load(open("web/catalog.json", encoding="utf-8"))
    stocks = {}
    for s in cat:
        for st in s["stocks"]: stocks.setdefault(st["t"], st)
    syms = list(stocks)
    cr = crumb()
    print("crumb", bool(cr), "tickers", len(syms))

    # 1) 시세 (매번)
    q = quotes(syms + INDEX_SYMS, cr)
    save(path("quotes.json"), {"at": int(NOW * 1000), "q": q})
    print("quotes", len(q))

    # 2) 차트
    def do_chart(sym):
        f = fname(sym)
        c = chart(sym, "5d", "15m")
        if c: save(path("c", f + ".i.json"), c)
        if stale("d:" + sym, 3 * 3600) or not os.path.exists(path("c", f + ".d.json")):
            c = chart(sym, "2y", "1d")
            if c: save(path("c", f + ".d.json"), c); mark("d:" + sym)
        if stale("w:" + sym, 20 * 3600) or not os.path.exists(path("c", f + ".w.json")):
            c = chart(sym, "max", "1wk")
            if c: save(path("c", f + ".w.json"), c); mark("w:" + sym)
    with ThreadPoolExecutor(6) as ex: list(ex.map(do_chart, syms + ["^GSPC", "^IXIC", "^KS11", "^VIX"]))
    print("charts done")

    # 3) 지표 (하루 1번)
    def do_sum(sym):
        if stale("s:" + sym, 20 * 3600) or not os.path.exists(path("s", fname(sym) + ".json")):
            sm = summary(sym, cr)
            if sm: save(path("s", fname(sym) + ".json"), sm); mark("s:" + sym)
    with ThreadPoolExecutor(4) as ex: list(ex.map(do_sum, syms))
    print("summaries done")

    # 4) 뉴스 (2시간마다)
    def do_news(sym):
        if not stale("n:" + sym, 2 * 3600) and os.path.exists(path("n", fname(sym) + ".json")): return
        st = stocks[sym]
        ko = re.sub(r"\(.*?\)", "", st.get("ko") or sym).strip()
        en_name = (q.get(sym) or {}).get("sname") or (q.get(sym) or {}).get("name") or sym
        save(path("n", fname(sym) + ".json"), {"ko": gnews(ko + " 주가"), "en": [] if sym.endswith((".KS", ".KQ")) else gnews(en_name + " stock", True), "an": gnews(ko + " 기업분석")})
        mark("n:" + sym)
    with ThreadPoolExecutor(4) as ex: list(ex.map(do_news, syms))
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
            j = r.json(); j.pop("fear_and_greed_historical", None)
            save(path("fg.json"), j); print("cnn ok")
        except Exception: pass
    else: print("cnn blocked", r.status_code if r else None)
    if stale("fgh", 20 * 3600):
        r = get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2011-01-01", headers=hdr)
        if r and r.status_code == 200:
            try:
                d = r.json().get("fear_and_greed_historical", {}).get("data", [])
                save(path("fgh.json"), [[int(p["x"]), round(p["y"], 1)] for p in d]); mark("fgh")
            except Exception: pass

    meta["updatedAt"] = int(NOW * 1000)
    save(path("meta.json"), meta)
    print("done in", int(time.time() - NOW), "s")

if __name__ == "__main__":
    main()
