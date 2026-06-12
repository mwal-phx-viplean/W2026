/**
 * Production server — serves the built Angular app AND a same-origin reverse
 * proxy at `/__feed/<host>/<path>`. Mirrors proxy.conf.cjs (dev) and the
 * Cloudflare Worker, but runs as a normal Node process so it can be deployed in
 * a SPECIFIC region.
 *
 * WHY a server instead of the Cloudflare Worker: the schedule feed
 * (sportsonline.pk) is geo-blocked (HTTP 451) in some countries, and a Worker
 * egresses from the Cloudflare edge nearest the visitor — so it stays blocked.
 * Deploy THIS on a host in an allowed region (e.g. Render's Frankfurt region)
 * and every upstream fetch originates there, bypassing the country block.
 *
 * DEPLOY ON RENDER:
 *   New + -> Web Service -> connect this repo
 *     Region:  Frankfurt (EU Central)        <-- important: an allowed country
 *     Build:   npm ci && npm run build
 *     Start:   node server.js
 *   The app calls everything same-origin as `/__feed/<host>/...`, so there is
 *   nothing else to configure (no Cloudflare Worker, no rewrite rule).
 */
const express = require('express');
const path = require('node:path');
const { Readable, pipeline } = require('node:stream');

const app = express();
const PORT = process.env.PORT || 3000;
const STATIC_DIR = path.join(__dirname, 'dist', 'prog-viewer', 'browser');

// A single bad upstream/stream must never take the whole server down (a crashed
// process is what returns "Not Found" to every visitor on the free tier).
process.on('uncaughtException', (e) => console.error('uncaughtException:', e?.message || e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e?.message || e));

/** Fallback referer for domain-protected players that send no usable referer. */
const ALLOWED_REFERER = 'https://ww2.sporttsonline.click/';
const URL_ATTRS = ['src', 'data-src', 'poster', 'href'];
const DROP_RESPONSE_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'referrer-policy',
];

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
  return value;
}

/** Runtime fetch/XHR interceptor injected into proxied HTML. */
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

function rewriteHtml(html, currentHost) {
  const rewritten = html.replace(
    /\b(src|href|data-src|poster)=(["'])(.*?)\2/gi,
    (m, attr, q, val) => {
      const next = proxify(val, currentHost);
      return next === val ? m : `${attr}=${q}${next}${q}`;
    },
  );
  const script = interceptor(currentHost);
  return /<head[^>]*>/i.test(rewritten)
    ? rewritten.replace(/<head[^>]*>/i, (h) => h + script)
    : script + rewritten;
}

// ---- the reverse proxy --------------------------------------------------
app.use('/__feed', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  try {
    const u = req.url; // /<host>/<path>?<query>  (the /__feed mount is stripped)
    const qi = u.indexOf('?');
    const pathname = qi === -1 ? u : u.slice(0, qi);
    const search = qi === -1 ? '' : u.slice(qi);

    const m = pathname.match(/^\/([^/]+)(\/.*)?$/);
    if (!m) return res.status(400).send('Bad proxy path');
    const host = m[1];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
      return res.status(400).send('Bad upstream host: ' + host);
    }
    const upath = m[2] || '/';
    const target = `https://${host}${upath}${search}`;

    const headers = {};
    for (const h of ['user-agent', 'accept', 'accept-language', 'range']) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    const fwdRef = unproxyReferer(req.headers['referer']);
    if (fwdRef) headers['referer'] = fwdRef;
    else if (!upath.endsWith('.txt')) headers['referer'] = ALLOWED_REFERER;

    // Abort the upstream when the client goes away (seek/close), so segment
    // fetches don't pile up on a small free instance.
    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const bodyless = req.method === 'GET' || req.method === 'HEAD';
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: bodyless || !req.body || !req.body.length ? undefined : req.body,
      redirect: 'follow',
      signal: ac.signal,
    });

    const out = {};
    upstream.headers.forEach((v, k) => {
      out[k] = v;
    });
    for (const h of DROP_RESPONSE_HEADERS) delete out[h];
    out['access-control-allow-origin'] = '*';
    out['referrer-policy'] = 'unsafe-url';
    if (out['location'] && /^https?:\/\//i.test(out['location'])) {
      out['location'] = absToFeed(out['location']);
    }

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    res.status(upstream.status);
    if (type.includes('text/html')) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.set(out).send(rewriteHtml(buf.toString('utf8'), host));
    } else {
      res.set(out);
      if (upstream.body) {
        // Stream through, but swallow client-abort/upstream errors so they can't
        // crash the process.
        pipeline(Readable.fromWeb(upstream.body), res, (err) => {
          if (err && err.name !== 'AbortError') {
            console.error('proxy pipe:', err.message);
            if (!res.headersSent) {
              try {
                res.status(502).end();
              } catch {
                /* ignore */
              }
            } else {
              res.destroy();
            }
          }
        });
      } else {
        res.end();
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // client went away — not an error
    console.error('proxy error:', e?.message || e);
    if (!res.headersSent) res.status(502).send('Proxy error: ' + (e?.message || e));
  }
});

// ---- the Angular app (static files + SPA fallback) ----------------------
app.use(express.static(STATIC_DIR));
app.get('*', (_req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

app.listen(PORT, () => console.log(`app + /__feed proxy listening on :${PORT}`));
