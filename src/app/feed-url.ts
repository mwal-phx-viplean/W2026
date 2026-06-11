import { isDevMode } from '@angular/core';

/**
 * Same-origin proxy prefix. The first path segment AFTER it is the real upstream
 * host, so a single generic proxy can reach ANY upstream host while the real
 * host never appears in the address bar, DOM, or network tab.
 */
export const FEED_PREFIX = '/__feed';

/**
 * Where `/__feed/*` is served from.
 *  - dev (`ng serve`): same-origin '' — handled by proxy.conf.cjs.
 *  - prod: the Cloudflare Worker directly (deploy/cloudflare-worker.js). The app
 *    calls it cross-origin (the Worker returns `Access-Control-Allow-Origin: *`),
 *    so we don't depend on a host rewrite that mangles the path.
 *
 * Point this at your own Worker URL (or a custom domain mapped to it).
 */
export const FEED_ORIGIN = isDevMode() ? '' : 'https://blue-bush-6294.mwal-phx.workers.dev';

/**
 * Map an absolute http(s) URL to `<feed-origin>/__feed/<host>/<path>`.
 * Returns the input unchanged if it is not an absolute URL.
 *
 * Example (prod):
 *   https://ww2.sporttsonline.click/channels/pt/sporttv2.php
 *   -> https://blue-bush-6294.mwal-phx.workers.dev/__feed/ww2.sporttsonline.click/channels/pt/sporttv2.php
 */
export function toFeedPath(url: string): string {
  try {
    const u = new URL(url);
    return `${FEED_ORIGIN}${FEED_PREFIX}/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
