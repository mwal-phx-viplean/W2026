/**
 * Network-only Service Worker (NOT a cache / PWA).
 *
 * It reroutes EVERY cross-origin http(s) request made by any page or worker on
 * this origin (notably the stream player's hidden SwarmCloud/hls.js worker
 * fetches that the inline fetch/XHR patch can't reach) through the same-origin
 * `/__feed/<host>/...` proxy. That proxy runs in an allowed country, so the
 * geo-blocked stream is fetched from there — the closest a web app can get to a
 * VPN's full tunnel. Caveat: WebRTC/WebSocket traffic can't be intercepted here.
 *
 * It caches nothing; on activate it also wipes any leftover caches from the old
 * Angular service worker.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        /* ignore */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Only touch cross-origin web requests that aren't already proxied.
  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin !== self.location.origin &&
    !url.pathname.startsWith('/__feed/')
  ) {
    const proxied = `${self.location.origin}/__feed/${url.host}${url.pathname}${url.search}`;
    event.respondWith(
      (async () => {
        try {
          // Reissue the request same-origin to the proxy, keeping method/body.
          return await fetch(new Request(proxied, req));
        } catch (e) {
          try {
            return await fetch(req); // fall back to the original request
          } catch (e2) {
            return new Response('', { status: 502 });
          }
        }
      })(),
    );
  }
  // same-origin (app shell, /__feed, assets): leave untouched.
});
