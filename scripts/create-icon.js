// Generates a simple 32x32 PNG icon for the system tray
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function createPNG(w, h, drawFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = drawFn(x, y, w, h);
      const off = y * (1 + w * 4) + 1 + x * 4;
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = a;
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Draw a rounded cyan/blue square with a snowflake-like pattern
function draw(x, y, w, h) {
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxR = w / 2;

  // Rounded shape
  const cornerR = 6;
  const inset = cornerR;
  let inside = true;
  if (x < inset && y < inset) {
    inside = Math.sqrt((x - inset) ** 2 + (y - inset) ** 2) <= cornerR;
  } else if (x >= w - inset && y < inset) {
    inside = Math.sqrt((x - (w - 1 - inset)) ** 2 + (y - inset) ** 2) <= cornerR;
  } else if (x < inset && y >= h - inset) {
    inside = Math.sqrt((x - inset) ** 2 + (y - (h - 1 - inset)) ** 2) <= cornerR;
  } else if (x >= w - inset && y >= h - inset) {
    inside = Math.sqrt((x - (w - 1 - inset)) ** 2 + (y - (h - 1 - inset)) ** 2) <= cornerR;
  }

  if (!inside) return [0, 0, 0, 0];

  // Gradient: cyan to blue
  const t = dist / maxR;
  const r = Math.round(30 + t * 20);
  const g = Math.round(180 - t * 60);
  const b = Math.round(220 + t * 35);

  // Cross/snowflake highlight
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  const onCross = (absDx < 1.5 || absDy < 1.5) && dist < maxR * 0.65;
  const onDiag = (Math.abs(absDx - absDy) < 1.5) && dist < maxR * 0.5;

  if (onCross || onDiag) {
    return [Math.min(255, r + 80), Math.min(255, g + 60), Math.min(255, b + 30), 255];
  }

  return [r, g, b, 255];
}

const outDir = path.join(__dirname, '..', 'src', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const png = createPNG(32, 32, draw);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('Created: src/assets/icon.png (' + png.length + ' bytes)');
