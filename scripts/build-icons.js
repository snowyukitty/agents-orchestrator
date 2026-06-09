// ============================================================
// build-icons.js — Icon asset generator
// ------------------------------------------------------------
// The source artwork (src/assets/icon-source.png) is decoded via
// Electron's nativeImage, re-encoded to a TRUE PNG, and packed into
// a multi-size Windows .ico so the packaged .exe, taskbar, window
// and tray all use the real snowflake icon instead of the default
// Electron icon.
//
// Run with:  npm run icons      (which calls `electron scripts/build-icons.js`)
// ============================================================
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'src', 'assets');
const SOURCE = path.join(ASSETS, 'icon-source.png'); // original high-res artwork
const PNG_OUT = path.join(ASSETS, 'icon.png');       // true 256x256 PNG (window/tray)
const ICO_OUT = path.join(ASSETS, 'icon.ico');       // multi-size Windows icon

// Sizes embedded in the .ico (Windows picks the best fit per context).
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

// Build a Windows .ico container from an array of PNG buffers.
// Modern Windows (Vista+) reads PNG-compressed entries directly, so we can
// embed the PNG bytes verbatim — no BMP/DIB conversion needed.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];

  entries.forEach((e, i) => {
    const b = i * 16;
    // width/height: 0 means 256
    dir[b + 0] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0; // palette count
    dir[b + 3] = 0; // reserved
    dir.writeUInt16LE(1, b + 4);  // color planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8);  // size of image data
    dir.writeUInt32LE(offset, b + 12);        // offset of image data
    offset += e.png.length;
    blobs.push(e.png);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[icons] Source artwork not found: ${SOURCE}`);
    console.error('[icons] Place the high-res artwork at src/assets/icon-source.png');
    app.exit(1);
    return;
  }

  const master = nativeImage.createFromPath(SOURCE);
  if (master.isEmpty()) {
    console.error('[icons] Failed to decode source artwork (unsupported format?)');
    app.exit(1);
    return;
  }

  // True 256x256 PNG for the window/tray (replaces the mislabeled JPEG).
  const png256 = master.resize({ width: 256, height: 256, quality: 'best' });
  fs.writeFileSync(PNG_OUT, png256.toPNG());
  console.log(`[icons] Wrote ${path.basename(PNG_OUT)} (${fs.statSync(PNG_OUT).size} bytes)`);

  // Multi-size .ico.
  const entries = ICO_SIZES.map((size) => ({
    size,
    png: master.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  const ico = buildIco(entries);
  fs.writeFileSync(ICO_OUT, ico);
  console.log(`[icons] Wrote ${path.basename(ICO_OUT)} (${ico.length} bytes, sizes: ${ICO_SIZES.join(', ')})`);

  app.exit(0);
}

app.whenReady().then(main);
