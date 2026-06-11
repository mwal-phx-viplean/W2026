import { HttpInterceptorFn } from '@angular/common/http';
import { toFeedPath } from './feed-url';

/**
 * CORS workaround, active in BOTH dev and prod.
 *
 * Any absolute http(s) request is transparently rewritten to the same-origin
 * `/__feed/<host>/*` path, so the browser never makes a cross-origin call and
 * CORS never applies. Something server-side then proxies it to the remote host
 * (where CORS does not exist) and streams the response back:
 *   - dev  (`ng serve`): the dev server proxy — see proxy.conf.cjs
 *   - prod (Render static site): a Rewrite rule `/__feed/* -> Cloudflare Worker`
 *
 * The `<host>` segment lets one generic proxy reach any upstream host. See
 * feed-url.ts (shared with the in-app stream player) and deploy/cloudflare-worker.js.
 */
export const devProxyInterceptor: HttpInterceptorFn = (req, next) => {
  if (/^https?:\/\//i.test(req.url)) {
    return next(req.clone({ url: toFeedPath(req.url) }));
  }
  return next(req);
};
