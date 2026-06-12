/**
 * Kill-switch service worker.
 *
 * The app used to ship Angular's service worker at this same path. Returning
 * visitors still have that old SW registered; their browser checks THIS url for
 * an update, sees these (different) bytes, installs them, and this worker then
 * unregisters itself + wipes all caches + reloads open tabs. Result: the PWA is
 * cleanly removed for everyone, with no stale cache left behind.
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
