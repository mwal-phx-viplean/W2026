import { HttpInterceptorFn } from '@angular/common/http';
import { isDevMode } from '@angular/core';

/**
 * DEV-ONLY CORS workaround.
 *
 * Under `ng serve`, any absolute http(s) request is transparently rewritten to
 * the local `/__feed` proxy (see proxy.conf.json), so the browser stays
 * same-origin and CORS never applies. The dev server then fetches the remote
 * file server-side (where CORS does not exist) and streams it back.
 *
 * In a production build isDevMode() is false → this is a no-op and the absolute
 * URL is used as-is (the remote host must then send Access-Control-Allow-Origin,
 * or you must front it with your own proxy).
 */
export const devProxyInterceptor: HttpInterceptorFn = (req, next) => {
  if (isDevMode() && /^https?:\/\//i.test(req.url)) {
    try {
      const u = new URL(req.url);
      return next(req.clone({ url: '/__feed' + u.pathname + u.search }));
    } catch {
      // Malformed URL — fall through and let it fail normally.
    }
  }
  return next(req);
};
