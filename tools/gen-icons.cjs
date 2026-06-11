/**
 * Generates the app's "stream" PWA icons as PNGs — no external dependencies
 * (pure Node + zlib). Re-run with `node tools/gen-icons.cjs` after tweaking the
 * design below. Output: public/icons/*.png
 *
 * Design: a purple gradient tile with a white play triangle and two broadcast
 * "signal" arcs — i.e. a live-stream mark.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---- palette ---------------------------------------------------------------
const TOP = [139, 92, 246]; // #8b5cf6
const BOTTOM = [91, 33, 194]; // #5b21c2
const WHITE = [255, 255, 255];

// ---- tiny vector helpers ---------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;

function inRoundedRect(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

// Right-pointing play triangle, given its bounding box.
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Arc band centered at (cx,cy), radius range, angle range (radians).
function inArc(x, y, cx, cy, rInner, rOuter, a0, a1) {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < rInner || r > rOuter) return false;
  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;
  return ang >= a0 && ang <= a1;
}

/**
 * Color of a single sub-sample point, or null for transparent.
 * `full` = maskable/apple variant (background bleeds to the edges).
 */
function sample(x, y, size, full) {
  const S = size;
  const bgRadius = full ? 0 : S * 0.22;
  const onBg = full ? true : inRoundedRect(x, y, S, bgRadius);
  if (!onBg) return null;

  // Keep art inside the maskable safe zone when `full`.
  const inset = full ? S * 0.14 : 0;
  const ox = inset;
  const oy = inset;
  const k = (S - inset * 2) / S; // scale art down for maskable padding

  const px = (x - ox) / k;
  const py = (y - oy) / k;

  // Play triangle.
  const ax = S * 0.42, ay = S * 0.34;
  const bx = S * 0.42, by = S * 0.66;
  const cx = S * 0.70, cy = S * 0.50;
  if (inTriangle(px, py, ax, ay, bx, by, cx, cy)) return WHITE;

  // Two broadcast arcs to the left of the triangle (signal emanating).
  const sc = S * 0.30, scy = S * 0.50; // arc center
  const a0 = Math.PI * 0.72, a1 = Math.PI * 1.28; // opening left
  const t = S * 0.035; // stroke thickness
  if (inArc(px, py, sc, scy, S * 0.16 - t, S * 0.16 + t, a0, a1)) return WHITE;
  if (inArc(px, py, sc, scy, S * 0.26 - t, S * 0.26 + t, a0, a1)) return WHITE;

  // Background gradient (top -> bottom).
  const t2 = y / S;
  return [
    Math.round(lerp(TOP[0], BOTTOM[0], t2)),
    Math.round(lerp(TOP[1], BOTTOM[1], t2)),
    Math.round(lerp(TOP[2], BOTTOM[2], t2)),
  ];
}

function render(size, full) {
  const SS = 4; // supersampling factor
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = sample(px, py, size, full);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return buf;
}

// ---- minimal PNG encoder ---------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10..12 already 0 (compression, filter, interlace)

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- emit ------------------------------------------------------------------
const outDir = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, full: false },
  { file: 'icon-512.png', size: 512, full: false },
  { file: 'icon-maskable-512.png', size: 512, full: true },
  { file: 'apple-touch-icon.png', size: 180, full: true },
  { file: 'favicon-48.png', size: 48, full: false },
  { file: 'favicon-32.png', size: 32, full: false },
];

for (const t of targets) {
  const png = encodePng(t.size, render(t.size, t.full));
  fs.writeFileSync(path.join(outDir, t.file), png);
  console.log('wrote', path.relative(process.cwd(), path.join(outDir, t.file)), png.length, 'bytes');
}
