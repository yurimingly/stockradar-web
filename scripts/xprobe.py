import requests, re, json
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
urls = [
 "https://syndication.twitter.com/srv/timeline-profile/screen-name/markminervini",
 "https://cdn.syndication.twimg.com/srv/timeline-profile/screen-name/markminervini",
 "https://nitter.net/markminervini/rss",
 "https://xcancel.com/markminervini/rss",
 "https://nitter.poast.org/markminervini/rss",
 "https://nitter.privacyredirect.com/markminervini/rss",
 "https://lightbrd.com/markminervini/rss",
 "https://nitter.space/markminervini/rss",
 "https://rsshub.app/twitter/user/markminervini",
]
for u in urls:
    try:
        r = requests.get(u, headers={"User-Agent": UA, "Accept-Language": "en"}, timeout=20)
        t = r.text
        print("==", u, r.status_code, len(t))
        m = re.search(r'__NEXT_DATA__[^>]*>(.*?)</script>', t, re.S)
        if m:
            d = json.loads(m.group(1)); ents = d["props"]["pageProps"]["timeline"]["entries"]
            print("  entries", len(ents))
            for e in ents[:3]:
                tw = e.get("content", {}).get("tweet", {}); print("  ", tw.get("created_at"), tw.get("id_str"), (tw.get("full_text") or tw.get("text") or "")[:100].replace("\n"," "))
        else:
            for it in re.findall(r"<item>.*?</item>", t, re.S)[:3]:
                print("  ", re.sub(r"\s+"," ",it)[:200])
            if "<item>" not in t: print("  ", re.sub(r"\s+"," ",t[:200]))
    except Exception as e: print("==", u, "ERR", e)
