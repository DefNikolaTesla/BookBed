import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "icons");
mkdirSync(OUT, { recursive: true });

const crcTable = (() => {
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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
  lerp(c1[3] ?? 255, c2[3] ?? 255, t),
];

function roundedRectMask(size, radius) {
  const m = new Float32Array(size * size);
  const r = radius * size;
  const r2 = r * r;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(Math.max(x, r), size - 1 - r);
      const dy = Math.min(Math.max(y, r), size - 1 - r);
      const cx = x - dx;
      const cy = y - dy;
      m[y * size + x] = cx * cx + cy * cy <= r2 ? 1 : 0;
    }
  }
  return m;
}

function renderIcon(size, { rounded = false, maskable = false } = {}) {
  const S = 4;
  const s = size * S;
  const rgba = Buffer.alloc(s * s * 4);
  const diag = s * 2;
  const cornerMask = rounded
    ? roundedRectMask(s, 0.222)
    : maskable
      ? new Float32Array(s * s).fill(1)
      : roundedRectMask(s, 0.222);

  const c1 = [0x4f, 0x46, 0xe5];
  const c2 = [0xa8, 0x55, 0xf7];
  const c3 = [0x22, 0x1f, 0x52];
  const legs = [0xc9, 0xc4, 0xff];
  const moon = [0xfd, 0xe6, 0x8a];
  const spine = [0xd9, 0xd6, 0xff];

  const inQuad = (x, y, quad) => {
    const [A, B, C, D] = quad;
    const cross = (p, q, r) =>
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return (
      cross(A, B, [x, y]) >= 0 &&
      cross(B, C, [x, y]) >= 0 &&
      cross(C, D, [x, y]) >= 0 &&
      cross(D, A, [x, y]) >= 0
    );
  };

  const distRoundedRect = (x, y, cx, cy, hw, hh, r) => {
    const dx = Math.max(Math.abs(x - cx) - hw, 0);
    const dy = Math.max(Math.abs(y - cy) - hh, 0);
    return Math.hypot(dx, dy) - r;
  };

  const leftPage = [
    [0.2, 0.66],
    [0.5, 0.56],
    [0.5, 0.82],
    [0.2, 0.84],
  ];
  const rightPage = [
    [0.8, 0.66],
    [0.5, 0.56],
    [0.5, 0.82],
    [0.8, 0.84],
  ];

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      const alpha = cornerMask[i];
      let col = [0, 0, 0];
      if (alpha > 0) {
        const nx = x / s;
        const ny = y / s;
        const t = (x + y) / diag;
        col = mix(mix(c1, c2, Math.min(1, t)), c3, Math.max(0, Math.min(1, (t - 0.55) * 1.4)));
        if (Math.abs(nx - 0.5) < 0.008 && ny >= 0.56 && ny <= 0.82) {
          col = spine;
        } else if (inQuad(nx, ny, leftPage) || inQuad(nx, ny, rightPage)) {
          const pageGrad = 0.85 + 0.15 * ny;
          col = [255, 255, 255].map((v) => v * pageGrad);
          if (nx >= 0.5) col = col.map((v) => v * 0.965);
        }
        if (distRoundedRect(nx, ny, 0.27, 0.87, 0.018, 0.026, 0.012) < 0) col = legs;
        if (distRoundedRect(nx, ny, 0.73, 0.87, 0.018, 0.026, 0.012) < 0) col = legs;
        const dOuter = Math.hypot(nx - 0.655, ny - 0.6) - 0.075;
        const dInner = Math.hypot(nx - 0.685, ny - 0.555) - 0.06;
        if (dOuter < 0 && dInner > 0) col = moon;
      }
      rgba[i * 4] = col[0];
      rgba[i * 4 + 1] = col[1];
      rgba[i * 4 + 2] = col[2];
      rgba[i * 4 + 3] = Math.round(alpha * 255);
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const si = (y * S + sy) * s + (x * S + sx);
          r += rgba[si * 4];
          g += rgba[si * 4 + 1];
          b += rgba[si * 4 + 2];
          a += rgba[si * 4 + 3];
        }
      }
      const n = S * S;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, out);
}

const targets = [
  ["icon-192.png", 192, { rounded: true }],
  ["icon-512.png", 512, { rounded: true }],
  ["icon-512-maskable.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { rounded: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT, name), renderIcon(size, opts));
  console.log(`✓ ${name} (${size}px)`);
}
console.log("Icons generated.");
