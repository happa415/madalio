// HTMLの資産URL・script.jsのAPP_VERSIONと同時に更新する。
const VERSION = "1.4.5.4";
const BASE_URL = new URL("./", self.location.href);
const CACHE_PREFIX = `madalio-${BASE_URL.pathname}-assets-`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const ASSET_PATHS = [
  "./",
  "index.html",
  `style.css?v=${VERSION}`,
  `script.js?v=${VERSION}`,
  "manifest.webmanifest",
];
const ASSET_URLS = ASSET_PATHS.map((path) => new URL(path, BASE_URL).href);
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(BASE_URL.hostname);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      // すべて取得・検証してから、版ごとのキャッシュへ保存する。
      const responses = await Promise.all(ASSET_URLS.map(async (url) => {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (!response.ok || response.redirected) throw new Error(`取得失敗: ${url}`);
        return response;
      }));
      const html = await responses[1].clone().text();
      const topHtml = await responses[0].clone().text();
      const script = await responses[3].clone().text();
      for (const page of [html, topHtml]) {
        if (!page.includes(`style.css?v=${VERSION}`) || !page.includes(`script.js?v=${VERSION}`)) {
          throw new Error("HTMLと資産のバージョンが一致しません。");
        }
      }
      if (!script.includes(`const APP_VERSION = "${VERSION}";`)) {
        throw new Error("JavaScriptのバージョンが一致しません。");
      }
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(ASSET_URLS.map((url, index) => cache.put(url, responses[index])));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
  // skipWaitingしない。開いている旧版を使い終えるまで待つ。
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
  })());
  // clients.claimや強制リロードは行わない。
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== BASE_URL.origin) return;
  const isPage = event.request.mode === "navigate" &&
    (url.pathname === BASE_URL.pathname || url.pathname === `${BASE_URL.pathname}index.html`);
  if (!isPage && !ASSET_URLS.includes(url.href)) return;

  event.respondWith((async () => {
    // 登録解除前のWorkerが残っていても、通常のローカル開発はネットワークから読む。
    if (LOCAL) {
      const client = !isPage && event.clientId ? await self.clients.get(event.clientId) : null;
      const pageUrl = isPage ? url : client && new URL(client.url);
      if (!pageUrl || pageUrl.searchParams.get("pwa-test") !== "1") {
        return fetch(new Request(event.request, { cache: "no-store" }));
      }
    }
    const cache = await caches.open(CACHE_NAME);
    const cacheUrl = isPage ? new URL("index.html", BASE_URL).href : url.href;
    const cached = await cache.match(cacheUrl);
    return cached || fetch(event.request);
  })());
});
