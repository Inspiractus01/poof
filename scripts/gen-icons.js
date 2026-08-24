// Generates the tray template icons and the app icon (.icns) from pure math.
// No design assets, no external deps -- just a tiny PNG encoder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const BUILD = path.join(__dirname, '..', 'build');

// --- minimal PNG encoder ---------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shapes (all in 0..1 space, sampled 4x4 per pixel) ---------------------
const SS = 4;

function render(size, shade) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = shade(u, v);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      rgba[i] = a > 0 ? Math.round(r / a) : 0;
      rgba[i + 1] = a > 0 ? Math.round(g / a) : 0;
      rgba[i + 2] = a > 0 ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

// The mark: a power ring whose stem breaks apart into rising dots -- power,
// dissipating. Coordinates are fractions of the canvas, sampled 4x4 per pixel.
function disc(u, v, cx, cy, r) {
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}

function mark(u, v, { r = 0.28, t = 0.095, gap = 0.44, dissolve = true } = {}) {
  const cx = 0.5, cy = 0.56;
  const half = t / 2;
  const dx = u - cx, dy = v - cy;

  // the ring, minus a wedge at the top
  const d = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(d - r) <= half) {
    if (Math.abs(Math.atan2(dx, -dy)) > gap) return true;
  }

  const stemBottom = cy - r * 0.2;
  const stemTop = dissolve ? cy - r - t * 0.1 : cy - r - t * 0.5;

  // the stem, tapering as it rises so the break reads as evaporation
  if (v >= stemTop && v <= stemBottom) {
    const k = (stemBottom - v) / (stemBottom - stemTop);
    if (Math.abs(dx) <= half * (1 - 0.42 * k)) return true;
  }

  if (!dissolve) return false;

  // a trail drifting up and to the side, each puff smaller than the last
  const trail = [
    [0.75, 0.85, 0.30],
    [1.55, 1.75, 0.20],
    [2.35, 2.75, 0.12],
  ];
  for (const [ox, oy, rr] of trail) {
    if (disc(u, v, cx + t * ox, stemTop - t * oy, t * rr)) return true;
  }

  return false;
}

function roundedRect(u, v, inset, radius) {
  const x = Math.min(u - inset, 1 - inset - u);
  const y = Math.min(v - inset, 1 - inset - v);
  if (x < 0 || y < 0) return false;
  if (x >= radius || y >= radius) return true;
  const dx = radius - x, dy = radius - y;
  return dx * dx + dy * dy <= radius * radius;
}

// --- tray icons (template: black + alpha, macOS recolors them) -------------
// At 18px the dots would land on half a pixel, so the menu bar gets the solid
// stem and the dissolve stays on the @2x and app icons.
for (const [name, size, dissolve] of [['trayTemplate.png', 18, false], ['trayTemplate@2x.png', 36, true]]) {
  const rgba = render(size, (u, v) =>
    mark(u, v, { r: 0.3, t: 0.1, dissolve }) ? [0, 0, 0, 1] : [0, 0, 0, 0]
  );
  fs.writeFileSync(path.join(BUILD, name), encodePng(size, size, rgba));
}

// --- app icon --------------------------------------------------------------
const ICON = 1024;
const appIcon = render(ICON, (u, v) => {
  if (!roundedRect(u, v, 0.06, 0.215)) return [0, 0, 0, 0];
  if (mark(u, v, { r: 0.23, t: 0.078 })) return [255, 255, 255, 1];
  // Flat electric violet with a single soft light from the top -- a gradient
  // corner to corner is the stock answer and reads as decoration.
  const light = Math.max(0, 1 - v * 1.7);
  return [
    Math.round(104 + 26 * light),
    Math.round(72 + 26 * light),
    255,
    1,
  ];
});

const iconset = path.join(BUILD, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });
const base = path.join(BUILD, 'icon.png');
fs.writeFileSync(base, encodePng(ICON, ICON, appIcon));

for (const [px, file] of [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
]) {
  execFileSync('sips', ['-z', String(px), String(px), base, '--out', path.join(iconset, file)], {
    stdio: 'ignore',
  });
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });

console.log('icons: build/trayTemplate.png, build/trayTemplate@2x.png, build/icon.icns');
