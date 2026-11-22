// 앱 껍데기(html·css·js)만 캐시 — 데이터는 항상 새로 받음
const V = "sr-v5";
const SHELL = ["./", "index.html", "style.css", "app.js", "pages.js", "static.json", "catalog.json", "icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.pathname.includes("/data/") || u.origin !== location.origin) return;   // 데이터는 항상 새로
  // 네트워크 우선, 실패하면 캐시 (업데이트가 바로 반영되도록)
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
