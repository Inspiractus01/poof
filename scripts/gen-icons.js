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

// Power glyph: a ring with a gap at the top plus a vertical bar through it.
// cx, cy, radius and thickness are fractions of the canvas.
function powerGlyph(u, v, { cx = 0.5, cy = 0.53, r = 0.3, t = 0.1, gap = 0.42 } = {}) {
  const dx = u - cx, dy = v - cy;
  const half = t / 2;
  // vertical bar
  const barTop = cy - r - t * 0.35;
  const barBottom = cy - r * 0.15;
  if (Math.abs(dx) <= half && v >= barTop && v <= barBottom) return true;
  // ring, minus the wedge at the top
  const d = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(d - r) <= half) {
    const angle = Math.atan2(dx, -dy); // 0 = straight up
    if (Math.abs(angle) > gap) return true;
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
for (const [name, size] of [['trayTemplate.png', 18], ['trayTemplate@2x.png', 36]]) {
  const rgba = render(size, (u, v) =>
    powerGlyph(u, v, { r: 0.29, t: 0.11 }) ? [0, 0, 0, 1] : [0, 0, 0, 0]
  );
  fs.writeFileSync(path.join(BUILD, name), encodePng(size, size, rgba));
}

// --- app icon --------------------------------------------------------------
const ICON = 1024;
const appIcon = render(ICON, (u, v) => {
  if (!roundedRect(u, v, 0.055, 0.205)) return [0, 0, 0, 0];
  if (powerGlyph(u, v, { cy: 0.52, r: 0.235, t: 0.085 })) return [255, 255, 255, 1];
  // diagonal gradient, indigo -> violet
  const k = Math.max(0, Math.min(1, (u + v) / 2));
  return [
    Math.round(46 + (139 - 46) * k),
    Math.round(42 + (92 - 42) * k),
    Math.round(120 + (246 - 120) * k),
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
