/**
 * Same-origin proxy prefix. The first path segment AFTER it is the real upstream
 * host, so a single generic proxy reaches ANY upstream host while the real host
 * never appears in the address bar, DOM, or network tab.
 *
 * `/__feed/*` is served same-origin by:
 *  - dev  (`ng serve`): proxy.conf.cjs
 *  - prod: server.js (a Node Web Service, e.g. on Render's Frankfurt region —
 *    runs the proxy from an allowed country so the geo-blocked feed loads).
 */
export const FEED_PREFIX = '/__feed';

/**
 * Map an absolute http(s) URL to `/__feed/<host>/<path>`.
 * Returns the input unchanged if it is not an absolute URL.
 */
export function toFeedPath(url: string): string {
  try {
    const u = new URL(url);
    return `${FEED_PREFIX}/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
