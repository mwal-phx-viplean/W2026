import { HttpInterceptorFn } from '@angular/common/http';

/**
 * CORS workaround, active in BOTH dev and prod.
 *
 * Any absolute http(s) request is transparently rewritten to the same-origin
 * `/__feed/*` path, so the browser never makes a cross-origin call and CORS
 * never applies. Something server-side then proxies `/__feed/*` to the remote
 * host (where CORS does not exist) and streams the response back:
 *   - dev  (`ng serve`): the dev server proxy — see proxy.conf.json
 *   - prod (Render static site): a Rewrite rule
 *       Source `/__feed/prog.txt` → Destination `https://sportsonline.pk/prog.txt`
 *
 * If you host elsewhere, replicate that one rewrite rule on your host.
 */
export const devProxyInterceptor: HttpInterceptorFn = (req, next) => {
  if (/^https?:\/\//i.test(req.url)) {
    try {
      const u = new URL(req.url);
      return next(req.clone({ url: '/__feed' + u.pathname + u.search }));
    } catch {
      // Malformed URL — fall through and let it fail normally.
    }
  }
  return next(req);
};
