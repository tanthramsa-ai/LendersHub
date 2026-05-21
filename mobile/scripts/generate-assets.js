/**
 * Generates placeholder PNG assets required by Expo prebuild.
 * Uses only Node.js built-ins — no external packages needed.
 * Run: node scripts/generate-assets.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Brand blue from app.json
const BRAND = { r: 0x0F, g: 0x4C, b: 0x81 };
const WHITE = { r: 0xFF, g: 0xFF, b: 0xFF };

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([t, data]);
  return Buffer.concat([u32be(data.length), t, data, u32be(crc32(crcInput))]);
}

function makePNG(width, height, { r, g, b }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // RGB
  // compression, filter, interlace = 0

  // Raw scanlines: 1 filter byte + width*3 RGB bytes
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const base = y * stride;
    raw[base] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draw a centred "LH" letter-mark on the icon (two white squares as a simple mark)
function makeIconPNG(size) {
  const { r: br, g: bg, b: bb } = BRAND;
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);

  // Fill with brand blue
  for (let y = 0; y < size; y++) {
    const base = y * stride;
    raw[base] = 0;
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3] = br;
      raw[base + 2 + x * 3] = bg;
      raw[base + 3 + x * 3] = bb;
    }
  }

  // White square mark centred (20% of icon size)
  const pad = Math.floor(size * 0.35);
  const sq = Math.floor(size * 0.30);
  for (let y = pad; y < pad + sq; y++) {
    const base = y * stride;
    for (let x = pad; x < pad + sq; x++) {
      raw[base + 1 + x * 3] = 0xFF;
      raw[base + 2 + x * 3] = 0xFF;
      raw[base + 3 + x * 3] = 0xFF;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 2;

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(ASSETS_DIR, { recursive: true });

const assets = [
  { file: 'icon.png',          gen: () => makeIconPNG(1024) },
  { file: 'adaptive-icon.png', gen: () => makeIconPNG(1024) },
  { file: 'splash-icon.png',   gen: () => makeIconPNG(512) },
  { file: 'favicon.png',       gen: () => makePNG(64, 64, BRAND) },
];

for (const { file, gen } of assets) {
  const dest = path.join(ASSETS_DIR, file);
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, gen());
    console.log(`✓ Created ${file}`);
  } else {
    console.log(`  Skipped ${file} (already exists)`);
  }
}

console.log('\nDone. Replace with real brand assets before production release.');
