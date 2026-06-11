/**
 * Same-origin proxy prefix. The first path segment AFTER it is the real upstream
 * host, so a single generic proxy (dev: proxy.conf.cjs, prod: a Cloudflare
 * Worker) can reach ANY upstream host while the browser only ever sees this
 * origin. The real host never appears in the address bar, DOM, or network tab.
 */
export const FEED_PREFIX = '/__feed';

/**
 * Map an absolute http(s) URL to `/__feed/<host>/<path>`.
 * Returns the input unchanged if it is not an absolute URL.
 *
 * Example:
 *   https://ww2.sporttsonline.click/channels/pt/sporttv2.php
 *   -> /__feed/ww2.sporttsonline.click/channels/pt/sporttv2.php
 */
export function toFeedPath(url: string): string {
  try {
    const u = new URL(url);
    return `${FEED_PREFIX}/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
