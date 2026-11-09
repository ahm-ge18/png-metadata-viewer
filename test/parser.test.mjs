import zlib from 'node:zlib';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
await import('../js/png.js');

const { parse, crc32, isPNG } = globalThis.PNGInspect;

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

function utf8z(s) { return Buffer.from(s + '\0', 'utf8'); }
function latin1z(s) { return Buffer.from(s + '\0', 'latin1'); }

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(3, 0);
ihdr.writeUInt32BE(2, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const phys = Buffer.alloc(9);
phys.writeUInt32BE(2835, 0); phys.writeUInt32BE(2835, 4); phys[8] = 1;

const gama = Buffer.alloc(4); gama.writeUInt32BE(45455, 0);
const srgb = Buffer.from([0]);

const text = Buffer.concat([latin1z('Software'), Buffer.from('png.inspect test', 'latin1')]);
const ztxt = Buffer.concat([latin1z('Comment'), Buffer.from([0]), zlib.deflateSync(Buffer.from('Compressed hello', 'latin1'))]);
const itxt = Buffer.concat([
  latin1z('Title'), Buffer.from([0, 0]), utf8z('en'), utf8z('Titel'), Buffer.from('Hello ✓ PNG', 'utf8')
]);
const itxtZ = Buffer.concat([
  latin1z('Description'), Buffer.from([1, 0]), utf8z('de'), utf8z('Beschreibung'), zlib.deflateSync(Buffer.from('UTF-8 zipped ✓', 'utf8'))
]);

const time = Buffer.alloc(7);
time.writeUInt16BE(2024, 0); time[2] = 5; time[3] = 3; time[4] = 14; time[5] = 32; time[6] = 9;

// minimal little-endian TIFF: one IFD entry: Make = "Nikon"
const make = Buffer.from('Nikon\0', 'latin1');
const tiff = Buffer.alloc(8 + 2 + 12 + 4 + make.length);
tiff.write('II', 0, 'latin1');
tiff.writeUInt16LE(42, 2);
tiff.writeUInt32LE(8, 4);
tiff.writeUInt16LE(1, 8);
tiff.writeUInt16LE(0x010f, 10);
tiff.writeUInt16LE(2, 12);
tiff.writeUInt32LE(make.length, 14);
tiff.writeUInt32LE(26, 18);
tiff.writeUInt32LE(0, 22);
make.copy(tiff, 26);

const pixels = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 128, 0, 0, 255, 255]); // junk but valid zlib
const idat = zlib.deflateSync(pixels);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('gAMA', gama),
  chunk('sRGB', srgb),
  chunk('pHYs', phys),
  chunk('tIME', time),
  chunk('tEXt', text),
  chunk('zTXt', ztxt),
  chunk('iTXt', itxt),
  chunk('iTXt', itxtZ),
  chunk('eXIf', tiff),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
  Buffer.from('TRAILING', 'latin1')
]);

assert.equal(isPNG(new Uint8Array(png)), true);

const file = { name: 'test.png', size: png.length, type: 'image/png', lastModified: 1714665600000 };
const r = await parse(png, file);

assert.equal(r.header.width, 3);
assert.equal(r.header.height, 2);
assert.equal(r.header.colorType, 6);
assert.equal(r.header.colourName, 'Truecolor + alpha');
assert.equal(r.header.channels, 4);
assert.equal(r.header.aspect.w, 3);
assert.equal(r.header.aspect.h, 2);
assert.equal(r.physical.xppm, 2835);
assert.equal(Math.round(r.physical.dpiX), 72);
assert.equal(r.colour.gamma, 0.45455);
assert.equal(r.colour.srgbName, 'Perceptual');
assert.equal(r.time.iso, '2024-05-03T14:32:09Z');
assert.equal(r.text.length, 4, 'four text entries');
assert.equal(r.exif[0][0], 'Camera make');
assert.equal(r.exif[0][1], 'Nikon');
assert.equal(r.trailingBytes, 8);
assert.equal(r.totals.crcBad, 0);
assert.ok(r.warnings.some(w => /follow IEND/.test(w)));
assert.equal(r.animation, null);

const byKeyword = Object.fromEntries(r.text.map(t => [t.keyword, t]));
assert.equal(byKeyword.Software.text, 'png.inspect test');
assert.equal(byKeyword.Comment.text, 'Compressed hello');
assert.equal(byKeyword.Title.text, 'Hello ✓ PNG');
assert.equal(byKeyword.Title.language, 'en');
assert.equal(byKeyword.Title.translated, 'Titel');
assert.equal(byKeyword.Description.text, 'UTF-8 zipped ✓');
assert.equal(byKeyword.Description.compressed, true);

// detail rows exist for known chunks
const ihdrChunk = r.chunks.find(c => c.type === 'IHDR');
assert.ok(ihdrChunk.details.some(d => d[0] === 'Width' && d[1] === '3 px'));

// bad signature
assert.throws(() => parse(Buffer.from('not a png at all'), null), /signature/);

// CRC mismatch detection
const broken = Buffer.from(png);
broken[8 + 4 + 13 + 1] ^= 0xff; // corrupt gAMA CRC region
const r2 = await parse(broken, null);
assert.ok(r2.totals.crcBad >= 1, 'detects bad CRC');

// APNG counters
const actl = Buffer.alloc(8); actl.writeUInt32BE(2, 0); actl.writeUInt32BE(0, 4);
const fctl = Buffer.alloc(26); fctl.writeUInt32BE(0, 0); fctl.writeUInt32BE(3, 4); fctl.writeUInt32BE(2, 8);
const apng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('acTL', actl), chunk('fcTL', fctl), chunk('fcTL', fctl), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
]);
const r3 = await parse(apng, null);
assert.equal(r3.animation.isAPNG, true);
assert.equal(r3.animation.frames, 2);
assert.equal(r3.animation.plays, 0);
assert.equal(r3.animation.controlChunks, 2);

// truncated file
const truncated = png.subarray(0, png.length - 40);
const r4 = await parse(truncated, null);
assert.ok(r4.warnings.some(w => /truncated|incomplete|No IEND/.test(w)));


// indexed colour + palette + tRNS
const ihdrIdx = Buffer.alloc(13);
ihdrIdx.writeUInt32BE(4, 0); ihdrIdx.writeUInt32BE(4, 4);
ihdrIdx[8] = 8; ihdrIdx[9] = 3; ihdrIdx[10] = 0; ihdrIdx[11] = 0; ihdrIdx[12] = 0;
const plte = Buffer.from([0x11, 0x22, 0x33, 0xaa, 0xbb, 0xcc]);
const trns = Buffer.from([255, 64]);
const indexed = zlib.deflateSync(Buffer.alloc(4 * (1 + 4), 1));
const pngIdx = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdrIdx), chunk('PLTE', plte), chunk('tRNS', trns),
  chunk('IDAT', indexed), chunk('IEND', Buffer.alloc(0))
]);
const r5 = await parse(pngIdx, null);
assert.deepEqual(r5.palette, ['#112233', '#aabbcc']);
assert.equal(r5.header.colourName, 'Indexed');
assert.match(r5.colour.transparency, /Palette alpha/);
assert.equal(r5.totals.crcBad, 0);

console.log('parser tests passed');
console.log({
  chunks: r.chunks.length,
  text: r.text.length,
  warnings: r.warnings.length,
  dpi: r.physical.dpiX,
  exif: r.exif
});
