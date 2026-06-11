/**
 * DEV-ONLY proxy for `ng serve`. Mirrors the production Cloudflare Worker
 * (deploy/cloudflare-worker.js) for local development. Jobs:
 *
 *  1. CORS workaround + host hiding — the browser only ever calls same-origin
 *     `/__feed/<host>/*`; this dev server fetches `https://<host>/*` server-side
 *     and streams it back. The real host never appears in the browser.
 *
 *  2. Iframe embedding — strips `X-Frame-Options` / CSP from responses.
 *
 *  3. Referer unlock — some stream players are "domain protected": they only
 *     serve the video when the request `Referer` is an allowed domain. For those
 *     hosts we inject the allowed `Referer`/`Origin` server-side (see HOSTS).
 *
 *  4. HTML rewrite — resource URLs in proxied HTML (src/href/poster/data-src)
 *     are rewritten back onto `/__feed/<host>/...` so the nested player and its
 *     same-host assets keep flowing through the proxy (and keep the referer).
 *
 * Add any upstream host the feed/players use to HOSTS below. URLs that pages
 * build at RUNTIME in JavaScript cannot be rewritten here and may still hit
 * their origin directly.
 *
 * This file does NOT exist in a production build.
 */

/**
 * Upstream hosts to proxy. `referer` (optional) is injected on forwarded
 * requests to satisfy that host's domain protection.
 */
const HOSTS = {
  'sportsonline.pk': {}, // the prog.txt schedule feed
  'ww2.sporttsonline.click': {}, // the channel pages
  'swopglow.net': { referer: 'https://ww2.sporttsonline.click/' }, // the nested player (domain-locked)
};

const PROXY_HOSTS = new Set(Object.keys(HOSTS));

function hostOf(abs) {
  try {
    return new URL(abs).host;
  } catch {
    return '';
  }
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
 * Map a URL found in a page to its `/__feed/<host>/...` equivalent.
 * Only known PROXY_HOSTS are rewritten; public CDNs (jsdelivr, etc.) are left
 * absolute so they load directly. Root-relative URLs stay on the current host.
 */
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
  if (v.startsWith('//')) {
    return PROXY_HOSTS.has(hostOf('https:' + v)) ? absToFeed('https:' + v) : value;
  }
  if (/^https?:\/\//i.test(v)) {
    return PROXY_HOSTS.has(hostOf(v)) ? absToFeed(v) : value;
  }
  if (v.startsWith('/')) {
    return `/__feed/${currentHost}${v}`;
  }
  return value; // relative — resolves correctly against the proxied URL
}

/**
 * Inline script injected into proxied HTML. It patches fetch/XHR at runtime so
 * URLs the player BUILDS in JavaScript (e.g. the obfuscated .m3u8 source) are
 * also routed back through `/__feed/<host>/...` — which is where the proxy
 * re-injects the unlock `Referer`. Without this, a runtime absolute URL would
 * hit its origin directly with the wrong referer and the stream would be denied.
 */
function buildInterceptor(currentHost) {
  const hosts = JSON.stringify([...PROXY_HOSTS]);
  const current = JSON.stringify(currentHost);
  return (
    '<script>(function(){var H=' +
    hosts +
    ',C=' +
    current +
    ';function f(u){try{var a=new URL(u,location.href);' +
    'if(a.protocol!=="http:"&&a.protocol!=="https:")return u;' +
    'if(a.pathname.indexOf("/__feed/")===0)return u;' +
    'if(a.host===location.host)return "/__feed/"+C+a.pathname+a.search;' +
    'if(H.indexOf(a.host)>=0)return "/__feed/"+a.host+a.pathname+a.search;}catch(e){}return u;}' +
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
  const script = buildInterceptor(currentHost);
  if (/<head[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<head[^>]*>/i, (h) => h + script);
  }
  return script + rewritten;
}

/** Rewrite an absolute Location back onto the same-origin /__feed/<host> path. */
function hideRedirectHost(headers) {
  const loc = headers['location'];
  if (typeof loc === 'string' && /^https?:\/\//i.test(loc)) {
    headers['location'] = absToFeed(loc);
  }
}

const config = {};
for (const [host, hostOpts] of Object.entries(HOSTS)) {
  config[`/__feed/${host}`] = {
    target: `https://${host}`,
    secure: true,
    changeOrigin: true,
    selfHandleResponse: true, // we rewrite HTML bodies ourselves
    pathRewrite: { [`^/__feed/${host.replace(/\./g, '\\.')}`]: '' },
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        // Ask for uncompressed bodies so we can rewrite HTML as text.
        proxyReq.setHeader('accept-encoding', 'identity');
        if (hostOpts.referer) {
          proxyReq.setHeader('referer', hostOpts.referer);
          try {
            proxyReq.setHeader('origin', new URL(hostOpts.referer).origin);
          } catch {
            /* ignore */
          }
        }
      });

      proxy.on('proxyRes', (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        delete headers['content-security-policy-report-only'];
        hideRedirectHost(headers);
        headers['access-control-allow-origin'] = '*';

        const type = String(proxyRes.headers['content-type'] || '').toLowerCase();
        if (type.includes('text/html')) {
          const chunks = [];
          proxyRes.on('data', (c) => chunks.push(c));
          proxyRes.on('end', () => {
            const body = rewriteHtml(Buffer.concat(chunks).toString('utf8'), host);
            delete headers['content-length']; // length changed by the rewrite
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
          // Non-HTML (text, JS, images, video segments): stream through untouched.
          res.writeHead(proxyRes.statusCode || 200, headers);
          proxyRes.pipe(res);
        }
      });
    },
  };
}

module.exports = config;
