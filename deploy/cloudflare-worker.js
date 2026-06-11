/**
 * Cloudflare Worker — production reverse proxy for the stream feed + channels.
 *
 * WHY: in production the dev `proxy.conf.cjs` does not exist, and a plain static
 * host (Render) rewrite cannot strip `X-Frame-Options`/CSP or inject a `Referer`.
 * This Worker does all of that AND hides every upstream host: the browser only
 * ever talks to this Worker via same-origin `/__feed/<host>/...` paths.
 *
 * It mirrors proxy.conf.cjs:
 *   1. Routes `/__feed/<host>/<path>` -> `https://<host>/<path>` (any host).
 *   2. Strips `X-Frame-Options` / CSP so pages can be framed.
 *   3. Injects an unlock `Referer` for "domain protected" players (REFERER_BY_HOST).
 *   4. Rewrites HTML resource URLs onto `/__feed/<host>/...` (HTMLRewriter) and
 *      injects a runtime fetch/XHR interceptor so URLs the player BUILDS in JS
 *      (the obfuscated .m3u8) also flow back through the proxy (with the referer).
 *
 * DEPLOY (free, no domain needed):
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker. Paste, Deploy.
 *      You get e.g. https://stream-proxy.<you>.workers.dev
 *   2. Render -> static site -> Redirects/Rewrites, add a Rewrite:
 *        Source:      /__feed/*
 *        Destination: https://stream-proxy.<you>.workers.dev/:splat
 *      (Replaces the old single `/__feed/prog.txt` rule.) The app already
 *      requests everything as `/__feed/<host>/...`, so nothing else changes.
 *
 * If a stream still fails, open DevTools -> Network, find the denied request's
 * host, and add it to REFERER_BY_HOST with the allowed referer.
 */

/** Hosts that only serve content when the request Referer is an allowed domain. */
const REFERER_BY_HOST = {
  'swopglow.net': 'https://ww2.sporttsonline.click/',
};

const URL_ATTRS = ['src', 'data-src', 'poster', 'href'];

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    // Accept both `/__feed/<host>/...` and `/<host>/...` (Render strips /__feed).
    let rest = incoming.pathname;
    if (rest.startsWith('/__feed/')) rest = rest.slice('/__feed'.length);
    const m = rest.match(/^\/([^/]+)(\/.*)?$/);
    if (!m) return new Response('Bad proxy path', { status: 400 });

    const host = m[1];
    const path = m[2] || '/';
    const target = `https://${host}${path}${incoming.search}`;

    const reqHeaders = stripRequestHeaders(request.headers);
    const referer = REFERER_BY_HOST[host];
    if (referer) {
      reqHeaders.set('referer', referer);
      try {
        reqHeaders.set('origin', new URL(referer).origin);
      } catch {
        /* ignore */
      }
    }

    const upstream = await fetch(target, {
      method: request.method,
      headers: reqHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
    });

    const headers = new Headers(upstream.headers);
    headers.delete('x-frame-options');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');
    headers.set('access-control-allow-origin', '*');

    const type = headers.get('content-type') || '';
    if (!type.includes('text/html')) {
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
    return new HTMLRewriter()
      .on('*', new UrlRewriter(host))
      .on('head', new ScriptInjector(host))
      .transform(response);
  },
};

class UrlRewriter {
  constructor(currentHost) {
    this.currentHost = currentHost;
  }
  element(el) {
    for (const attr of URL_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) {
        const next = proxify(val, this.currentHost);
        if (next !== val) el.setAttribute(attr, next);
      }
    }
  }
}

/** Prepend the runtime fetch/XHR interceptor into <head>. */
class ScriptInjector {
  constructor(currentHost) {
    this.currentHost = currentHost;
  }
  element(el) {
    el.prepend(interceptor(this.currentHost), { html: true });
  }
}

/** Map a URL found in the page to its `/__feed/<host>/...` equivalent. */
function proxify(value, currentHost) {
  const v = value.trim();
  if (v.startsWith('/__feed/')) return value;
  if (v.startsWith('//')) return absToFeed('https:' + v);
  if (/^https?:\/\//i.test(v)) return absToFeed(v);
  if (v.startsWith('/')) return `/__feed/${currentHost}${v}`;
  return value;
}

function absToFeed(abs) {
  try {
    const u = new URL(abs);
    return `/__feed/${u.host}${u.pathname}${u.search}`;
  } catch {
    return abs;
  }
}

/**
 * Runtime interceptor: rewrites fetch/XHR URLs onto `/__feed/<host>/...`. In
 * production the Worker proxies ANY host, so it rewrites every absolute URL.
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

/** Drop headers that would reveal our app or trip origin checks. */
function stripRequestHeaders(incoming) {
  const headers = new Headers(incoming);
  headers.delete('referer');
  headers.delete('origin');
  headers.delete('cookie');
  return headers;
}
