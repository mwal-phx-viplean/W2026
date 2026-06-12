/**
 * DEV-ONLY proxy for `ng serve`. Mirrors the production Cloudflare Worker
 * (deploy/cloudflare-worker.js). It is GENERIC: it routes `/__feed/<host>/*` to
 * `https://<host>/*` for ANY host (so rotating/hashed player subdomains work
 * without a hardcoded list). Jobs:
 *
 *  1. CORS workaround + host hiding — the browser only ever calls same-origin
 *     `/__feed/<host>/*`; this server fetches `https://<host>/*` server-side.
 *  2. Iframe embedding — strips `X-Frame-Options` / CSP from responses.
 *  3. Referer unlock — injects an allowed `Referer` so "domain protected"
 *     players serve the video instead of "NOT ALLOWED".
 *  4. HTML rewrite + runtime interceptor — keeps the whole chain (channel page ->
 *     nested player iframe -> player JS -> .m3u8/segments) flowing through the
 *     proxy, including URLs the obfuscated player builds at runtime.
 *
 * This file does NOT exist in a production build — the Worker does this in prod.
 */

/** The domain these players accept as the embedding ("allowed") site. */
const ALLOWED_REFERER = 'https://ww2.sporttsonline.click/';

const URL_ATTRS = ['src', 'data-src', 'poster', 'href'];

function absToFeed(abs) {
  try {
    const u = new URL(abs);
    return `/__feed/${u.host}${u.pathname}${u.search}`;
  } catch {
    return abs;
  }
}

/** Turn a proxied Referer (`.../__feed/<host>/<path>`) back into `https://<host>/<path>`. */
function unproxyReferer(ref) {
  if (!ref) return null;
  const i = ref.indexOf('/__feed/');
  if (i === -1) return null;
  const rest = ref.slice(i + '/__feed'.length);
  const m = rest.match(/^\/([^/]+)([^?#]*)/);
  if (!m) return null;
  return `https://${m[1]}${m[2] || '/'}`;
}

/** Map a URL found in a page to its `/__feed/<host>/...` equivalent. */
function proxify(value, currentHost) {
  const v = String(value).trim();
  if (
    !v ||
    v.startsWith('/__feed/') ||
    v.startsWith('data:') ||
    v.startsWith('blob:') ||
    v.startsWith('#') ||
    v.startsWith('javascript:') ||
    v.startsWith('mailto:')
  ) {
    return value;
  }
  if (v.startsWith('//')) return absToFeed('https:' + v);
  if (/^https?:\/\//i.test(v)) return absToFeed(v);
  if (v.startsWith('/')) return `/__feed/${currentHost}${v}`;
  return value; // relative — resolves correctly against the proxied URL
}

/**
 * Inline script injected into proxied HTML. Patches fetch/XHR so URLs the player
 * BUILDS at runtime (e.g. the obfuscated .m3u8 source) are also routed back
 * through `/__feed/<host>/...`, where the proxy re-injects the unlock Referer.
 */
function interceptor(currentHost) {
  const c = JSON.stringify(currentHost);
  return (
    '<script>(function(){var C=' +
    c +
    ';function f(u){try{var a=new URL(u,location.href);' +
    'if(a.protocol!=="http:"&&a.protocol!=="https:")return u;' +
    'if(a.pathname.indexOf("/__feed/")===0)return u;' +
    'if(a.host===location.host)return "/__feed/"+C+a.pathname+a.search;' +
    'return "/__feed/"+a.host+a.pathname+a.search;}catch(e){}return u;}' +
    'var of=window.fetch;if(of){window.fetch=function(i,n){try{if(typeof i==="string")i=f(i);' +
    'else if(i&&i.url)i=new Request(f(i.url),i);}catch(e){}return of.call(this,i,n);};}' +
    'var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){' +
    'try{arguments[1]=f(u);}catch(e){}return xo.apply(this,arguments);};})();</script>'
  );
}

/** Rewrite URL-bearing HTML attributes + inject the runtime interceptor. */
function rewriteHtml(html, currentHost) {
  const rewritten = html.replace(
    /\b(src|href|data-src|poster)=(["'])(.*?)\2/gi,
    (m, attr, q, val) => {
      const next = proxify(val, currentHost);
      return next === val ? m : `${attr}=${q}${next}${q}`;
    },
  );
  const script = interceptor(currentHost);
  if (/<head[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<head[^>]*>/i, (h) => h + script);
  }
  return script + rewritten;
}

// One generic entry. `target` is overridden per request inside `rewrite` — this
// is safe because Vite calls rewrite() and proxy.web() synchronously back-to-back
// (no await between), so no other request can interleave and read a stale target.
const entry = {
  target: 'https://sportsonline.pk', // placeholder, replaced per request
  secure: true,
  changeOrigin: true,
  selfHandleResponse: true, // we rewrite HTML bodies ourselves
  rewrite(path) {
    const m = path.match(/^\/__feed\/([^/]+)(\/.*)?$/);
    if (!m) return path;
    entry.target = `https://${m[1]}`;
    return m[2] || '/';
  },
  configure(proxy) {
    proxy.on('proxyReq', (proxyReq, req) => {
      proxyReq.setHeader('accept-encoding', 'identity'); // so we can rewrite HTML as text
      // Give each upstream the Referer it expects: un-proxy the browser's Referer
      // (`.../__feed/<host>/<path>` -> `https://<host>/<path>`) so the embed sees
      // the channel page (ww2 -> unlock) and the .m3u8 sees its own embed page.
      // Fall back to ALLOWED_REFERER for players, none for the schedule `.txt`.
      const fwdRef = unproxyReferer(req.headers['referer']);
      if (fwdRef) {
        proxyReq.setHeader('referer', fwdRef);
      } else if (!(req.url || '').split('?')[0].endsWith('.txt')) {
        proxyReq.setHeader('referer', ALLOWED_REFERER);
      } else {
        proxyReq.removeHeader('referer');
      }
      // Capture THIS request's upstream host now (synchronous, before the shared
      // `entry.target` can be reassigned by a later concurrent request).
      try {
        req.__feedHost = new URL(entry.target).host;
      } catch {
        req.__feedHost = '';
      }
    });

    proxy.on('proxyRes', (proxyRes, req, res) => {
      const host = req.__feedHost || '';

      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      const loc = headers['location'];
      if (typeof loc === 'string' && /^https?:\/\//i.test(loc)) headers['location'] = absToFeed(loc);
      headers['access-control-allow-origin'] = '*';
      // Force pages to send a full Referer to their subresources (some players
      // set `no-referrer` to hide their .m3u8 — that would break the chain).
      headers['referrer-policy'] = 'unsafe-url';

      const type = String(proxyRes.headers['content-type'] || '').toLowerCase();
      if (type.includes('text/html')) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = rewriteHtml(Buffer.concat(chunks).toString('utf8'), host);
          delete headers['content-length'];
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(body);
        });
        proxyRes.on('error', () => {
          try {
            res.writeHead(502);
            res.end();
          } catch {
            /* ignore */
          }
        });
      } else {
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    });
  },
};

module.exports = { '^/__feed/': entry };
