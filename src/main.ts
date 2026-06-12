import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

// Network-only proxy Service Worker (NOT a cache). It reroutes the stream
// player's escaped cross-origin requests through the same-origin /__feed proxy,
// which runs in an allowed country to bypass the geo-block. See public/sw.js.
// Registering it at scope "/" also replaces (and its activate wipes the caches
// of) any previously-installed Angular service worker.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
