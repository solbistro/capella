/* ─────────────────────────────────────────────
   Plum 訂單系統 — Service Worker  v1.0
   快取策略：
     App Shell   → Cache-First（離線可用）
     CDN 靜態     → Cache-First + 背景更新
     Google Sheets API → Network-Only（需即時資料）
   ───────────────────────────────────────────── */

const CACHE_VER  = 'plum-v1';
const SHELL_URLS = [
  './plum_order_system.html',
  './manifest.json',
  './icon.svg',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.x/tabler-icons.min.css',
];

/* ── Install：預快取 App Shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VER)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install cache failed:', err))
  );
});

/* ── Activate：清除舊版快取 ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch：依 URL 分策略 ── */
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  /* Google Sheets gviz / pub → 永遠走網路，不快取 */
  if (
    url.hostname === 'docs.google.com' ||
    url.hostname === 'spreadsheets.google.com' ||
    url.hostname.endsWith('googleapis.com')
  ) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  /* CDN（Tabler Icons / fonts）→ Cache-First，快取缺漏時再 fetch 並存入 */
  if (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('fonts.googleapis.com')
  ) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VER).then(c => c.put(request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }

  /* App Shell（HTML / SVG / manifest）→ Cache-First + 背景 revalidate */
  e.respondWith(
    caches.open(CACHE_VER).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(resp => {
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        }).catch(() => null);

        return cached || networkFetch;
      })
    )
  );
});

/* ── Message：強制更新指令 ── */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
