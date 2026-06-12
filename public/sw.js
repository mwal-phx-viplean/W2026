/**
 * Kill-switch service worker.
 *
 * Earlier builds registered a service worker at this path. Channels now open in
 * a new tab (no embedded player), so no service worker is needed. Browsers that
 * still have the old one check this url, see these bytes, install them, and this
 * worker unregisters itself + wipes any leftover caches + reloads open tabs.
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
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});
