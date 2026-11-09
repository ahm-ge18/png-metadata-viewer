/*
 * png.js — a small, dependency-free PNG chunk parser.
 * Reads bytes only: nothing is decoded, uploaded or re-encoded.
 */
(function (global) {
  'use strict';

  var SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  var COLOR_TYPES = {
    0: { name: 'Grayscale', channels: 1, depths: [1, 2, 4, 8, 16] },
    2: { name: 'Truecolor', channels: 3, depths: [8, 16] },
    3: { name: 'Indexed', channels: 1, depths: [1, 2, 4, 8] },
    4: { name: 'Grayscale + alpha', channels: 2, depths: [8, 16] },
    6: { name: 'Truecolor + alpha', channels: 4, depths: [8, 16] }
  };

  var CHUNK_NAMES = {
    IHDR: 'Image header',
    PLTE: 'Palette',
    IDAT: 'Image data',
    IEND: 'End of image',
    tRNS: 'Transparency',
    cHRM: 'Chromaticity',
    gAMA: 'Gamma',
    iCCP: 'ICC profile',
    sBIT: 'Significant bits',
    sRGB: 'sRGB rendering intent',
    bKGD: 'Background colour',
    hIST: 'Palette histogram',
    pHYs: 'Physical pixel size',
    sPLT: 'Suggested palette',
    tIME: 'Last modification time',
    iTXt: 'International text',
    tEXt: 'Text entry',
    zTXt: 'Compressed text',
    eXIf: 'EXIF metadata',
    oFFs: 'Image offset',
    pCAL: 'Pixel calibration',
    sCAL: 'Physical scale',
    acTL: 'APNG animation control',
    fcTL: 'APNG frame control',
    fdAT: 'APNG frame data',
    sTER: 'Stereo mode',
    dSIG: 'Digital signature',
    cICP: 'Coding-independent code points',
    mDCv: 'Mastering display colour volume',
    cLLi: 'Content light level'
  };

  var CRITICAL = { IHDR: 1, PLTE: 1, IDAT: 1, IEND: 1 };

  var SRGB_INTENT = {
    0: 'Perceptual',
    1: 'Relative colorimetric',
    2: 'Saturation',
    3: 'Absolute colorimetric'
  };

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  var latin1 = new TextDecoder('iso-8859-1');
  var utf8 = new TextDecoder('utf-8');

  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    for (var i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function isPNG(bytes) {
    if (bytes.length < 8) return false;
    for (var i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
    return true;
  }

  function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('This browser cannot inflate compressed chunks.'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function readName(bytes, start, end) {
    if (start >= end) return { text: '', next: end };
    var zero = bytes.indexOf(0, start);
    if (zero === -1 || zero > end) zero = end;
    return { text: latin1.decode(bytes.subarray(start, zero)), next: Math.min(zero + 1, end) };
  }

  function hex(n, width) {
    return '0x' + n.toString(16).toUpperCase().padStart(width || 2, '0');
  }

  /* ---------- EXIF (TIFF inside eXIf) ---------- */

  var EXIF_TAGS = {
    0x010e: 'Image description',
    0x010f: 'Camera make',
    0x0110: 'Camera model',
    0x0112: 'Orientation',
    0x011a: 'X resolution',
    0x011b: 'Y resolution',
    0x0128: 'Resolution unit',
    0x0131: 'Software',
    0x0132: 'Modified',
    0x013b: 'Artist',
    0x8298: 'Copyright',
    0x829a: 'Exposure time',
    0x829d: 'Aperture',
    0x8769: 'EXIF IFD',
    0x8827: 'ISO',
    0x9003: 'Taken',
    0x9004: 'Digitised',
    0x920a: 'Focal length',
    0x9291: 'Sub-second',
    0xa002: 'Pixel X dimension',
    0xa003: 'Pixel Y dimension',
    0xa434: 'Lens'
  };

  var ORIENTATION = {
    1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored, 180°',
    5: 'Mirrored, 90° CW', 6: 'Rotated 90° CW', 7: 'Mirrored, 270° CW', 8: 'Rotated 270° CW'
  };

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function parseExif(bytes) {
    if (bytes.length < 8) throw new Error('EXIF block is too short.');
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var bom = dv.getUint16(0);
    var le;
    if (bom === 0x4949) le = true;
    else if (bom === 0x4d4d) le = false;
    else throw new Error('EXIF block has no TIFF byte-order mark.');
    if (dv.getUint16(2, le) !== 42) throw new Error('EXIF block has a bad TIFF magic number.');

    var tags = [];
    var wanted = {};
    function readIfd(offset, label) {
      if (offset <= 0 || offset + 2 > dv.byteLength) return;
      var count = dv.getUint16(offset, le);
      for (var i = 0; i < count; i++) {
        var entry = offset + 2 + i * 12;
        if (entry + 12 > dv.byteLength) break;
        var tag = dv.getUint16(entry, le);
        var type = dv.getUint16(entry + 2, le);
        var n = dv.getUint32(entry + 4, le);
        var size = (TYPE_SIZE[type] || 0) * n;
        var ptr = size <= 4 ? entry + 8 : dv.getUint32(entry + 8, le);
        if (type === 5 || type === 10) {
          if (ptr + 8 <= dv.byteLength) {
            var num = type === 5 ? dv.getUint32(ptr, le) : dv.getInt32(ptr, le);
            var den = type === 5 ? dv.getUint32(ptr + 4, le) : dv.getInt32(ptr + 4, le);
            wanted[tag] = den ? num / den : 0;
          }
        } else if (type === 2) {
          if (ptr + n <= dv.byteLength) {
            var arr = bytes.subarray(ptr, ptr + n);
            var z = arr.indexOf(0);
            wanted[tag] = latin1.decode(z === -1 ? arr : arr.subarray(0, z));
          }
        } else if (type === 1 || type === 7) {
          if (ptr + n <= dv.byteLength) wanted[tag] = bytes[ptr];
        } else if (type === 3 || type === 4) {
          if (ptr + size <= dv.byteLength) {
            wanted[tag] = type === 3 ? dv.getUint16(ptr, le) : dv.getUint32(ptr, le);
          }
        }
      }
    }

    var ifd0 = dv.getUint32(4, le);
    readIfd(ifd0);
    if (wanted[0x8769]) readIfd(wanted[0x8769], 'exif');

    Object.keys(wanted).forEach(function (key) {
      var tag = Number(key);
      var name = EXIF_TAGS[tag];
      if (!name || tag === 0x8769) return;
      var value = wanted[tag];
      if (tag === 0x0112 && ORIENTATION[value]) value = ORIENTATION[value] + ' (' + value + ')';
      if (tag === 0x829a && typeof value === 'number') {
        value = value < 1 ? '1/' + Math.round(1 / value) + ' s' : value + ' s';
      }
      if (tag === 0x829d && typeof value === 'number') value = 'f/' + (Math.round(value * 10) / 10);
      if (tag === 0x920a && typeof value === 'number') value = (Math.round(value * 10) / 10) + ' mm';
      if (tag === 0x8827) value = 'ISO ' + value;
      if (tag === 0x0128) value = value === 2 ? 'inch' : value === 3 ? 'centimetre' : String(value);
      if (typeof value === 'string' && !value.trim()) return;
      tags.push([name, String(value)]);
    });

    return tags.length ? tags : null;
  }

  /* ---------- chunk payloads ---------- */

  function chunkDetails(type, data, header) {
    var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var out = [];
    var i;
    try {
      switch (type) {
        case 'IHDR':
          out.push(['Width', dv.getUint32(0) + ' px']);
          out.push(['Height', dv.getUint32(4) + ' px']);
          out.push(['Bit depth', dv.getUint8(8)]);
          out.push(['Colour type', header ? header.colourName + ' (' + dv.getUint8(9) + ')' : dv.getUint8(9)]);
          out.push(['Compression', dv.getUint8(10) === 0 ? '0 · deflate' : String(dv.getUint8(10))]);
          out.push(['Filter', dv.getUint8(11) === 0 ? '0 · adaptive' : String(dv.getUint8(11))]);
          out.push(['Interlace', dv.getUint8(12) === 0 ? '0 · none' : dv.getUint8(12) === 1 ? '1 · Adam7' : String(dv.getUint8(12))]);
          break;
        case 'pHYs':
          out.push(['Pixels per metre X', dv.getUint32(0).toLocaleString('en-US')]);
          out.push(['Pixels per metre Y', dv.getUint32(4).toLocaleString('en-US')]);
          out.push(['Unit', dv.getUint8(8) === 1 ? '1 · metre' : '0 · unknown']);
          break;
        case 'gAMA':
          out.push(['Gamma', (dv.getUint32(0) / 100000).toFixed(5)]);
          break;
        case 'sRGB':
          out.push(['Intent', dv.getUint8(0) + ' · ' + (SRGB_INTENT[dv.getUint8(0)] || 'unknown')]);
          break;
        case 'cHRM':
          ['White x', 'White y', 'Red x', 'Red y', 'Green x', 'Green y', 'Blue x', 'Blue y'].forEach(function (label, n) {
            out.push([label, (dv.getUint32(n * 4) / 100000).toFixed(5)]);
          });
          break;
        case 'PLTE':
          out.push(['Entries', data.length / 3]);
          out.push(['Palette bytes', data.length]);
          break;
        case 'tRNS':
          out.push(['Transparency', header && header.colorType === 3 ? 'palette alpha (' + data.length + ' entries)' : header && header.colorType === 0 ? 'grey key' : 'colour key']);
          break;
        case 'sBIT':
          out.push(['Channels', data.length]);
          out.push(['Bits', Array.prototype.join.call(data, ', ')]);
          break;
        case 'bKGD':
          out.push(['Sample bytes', data.length]);
          out.push(['Values', Array.prototype.join.call(data, ', ')]);
          break;
        case 'hIST':
          out.push(['Entries', data.length / 2]);
          break;
        case 'tIME':
          out.push(['UTC time', dv.getUint16(0) + '-' + String(dv.getUint8(2)).padStart(2, '0') + '-' + String(dv.getUint8(3)).padStart(2, '0') + ' ' + String(dv.getUint8(4)).padStart(2, '0') + ':' + String(dv.getUint8(5)).padStart(2, '0') + ':' + String(dv.getUint8(6)).padStart(2, '0')]);
          break;
        case 'eXIf':
          out.push(['TIFF block', data.length + ' bytes']);
          break;
        case 'acTL':
          out.push(['Frames', dv.getUint32(0)]);
          out.push(['Plays', dv.getUint32(4) === 0 ? 'forever' : dv.getUint32(4)]);
          break;
        case 'fcTL':
          out.push(['Frame', dv.getUint32(0)]);
          out.push(['Size', dv.getUint32(4) + ' × ' + dv.getUint32(8)]);
          out.push(['Offset', dv.getUint32(12) + ', ' + dv.getUint32(16)]);
          var den = dv.getUint16(22) || 100;
          out.push(['Delay', ((dv.getUint16(20) / den) * 1000).toFixed(0) + ' ms']);
          break;
        case 'fdAT':
          out.push(['Sequence', dv.getUint32(0)]);
          out.push(['Frame bytes', Math.max(0, data.length - 4)]);
          break;
        case 'oFFs':
          out.push(['X offset', dv.getInt32(0) + ' px']);
          out.push(['Y offset', dv.getInt32(4) + ' px']);
          out.push(['Unit', dv.getUint8(8)]);
          break;
        case 'iCCP': {
          var iccName = readName(data, 0, data.length);
          out.push(['Profile name', iccName.text || '—']);
          out.push(['Compressed size', data.length - iccName.next]);
          break;
        }
        case 'iTXt':
        case 'tEXt':
        case 'zTXt': {
          var name = readName(data, 0, data.length);
          out.push(['Keyword', name.text || '—']);
          out.push(['Payload bytes', data.length - name.next]);
          break;
        }
        case 'sPLT': {
          var pltName = readName(data, 0, data.length);
          out.push(['Name', pltName.text || '—']);
          out.push(['Depth', data[pltName.next] ? data[pltName.next] + '-bit' : '—']);
          break;
        }
        case 'IDAT':
          out.push(['Pixel data', data.length.toLocaleString('en-US') + ' bytes']);
          break;
        default:
          break;
      }
    } catch (err) {
      out.push(['Warning', 'Chunk is shorter than its spec requires.']);
    }
    return out;
  }

  function textEntry(type, data) {
    var out = { format: type, keyword: '', text: '', compressed: type === 'zTXt', language: '', translated: '' };
    var name = readName(data, 0, data.length);
    out.keyword = name.text;
    var pos = name.next;

    if (type === 'tEXt') {
      out.text = latin1.decode(data.subarray(pos));
      return Promise.resolve(out);
    }

    if (type === 'zTXt') {
      out.method = data[pos];
      pos += 1;
      return inflate(data.subarray(pos)).then(function (raw) {
        out.text = latin1.decode(raw);
        return out;
      });
    }

    // iTXt
    out.compressed = data[pos] === 1;
    out.method = data[pos + 1];
    pos += 2;
    var lang = readName(data, pos, data.length);
    out.language = lang.text;
    pos = lang.next;
    var transEnd = data.indexOf(0, pos);
    if (transEnd === -1) transEnd = data.length;
    out.translated = utf8.decode(data.subarray(pos, transEnd));
    pos = Math.min(transEnd + 1, data.length);

    if (!out.compressed) {
      out.text = utf8.decode(data.subarray(pos));
      return Promise.resolve(out);
    }
    return inflate(data.subarray(pos)).then(function (raw) {
      out.text = utf8.decode(raw);
      return out;
    });
  }

  /* ---------- main ---------- */

  function parse(buffer, fileInfo) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (!isPNG(bytes)) {
      var err = new Error('That file is not a PNG — its 8-byte signature is missing.');
      err.code = 'NOT_PNG';
      throw err;
    }

    var result = {
      file: fileInfo || null,
      signature: Array.prototype.map.call(bytes.subarray(0, 8), function (b) {
        return b.toString(16).toUpperCase().padStart(2, '0');
      }).join(' '),
      header: null,
      chunks: [],
      text: [],
      palette: [],
      physical: null,
      colour: {},
      time: null,
      exif: null,
      animation: null,
      warnings: [],
      trailingBytes: 0,
      totals: {}
    };

    var warnings = result.warnings;
    var offset = 8;
    var index = 0;
    var idatBytes = 0;
    var idatChunks = 0;
    var crcOk = 0;
    var crcBad = 0;
    var typeCounts = {};
    var sawIEND = false;
    var acTL = null;
    var fcTLCount = 0;
    var fdATCount = 0;
    var fdATBytes = 0;
    var pendingText = [];

    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) {
        warnings.push('File ends in the middle of a chunk header at byte ' + offset + '.');
        break;
      }
      var length = dv.getUint32(offset);
      var type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (!/^[A-Za-z]{4}$/.test(type)) {
        warnings.push('Chunk ' + index + ' has an invalid type code at byte ' + offset + '.');
        break;
      }
      if (length > 0x7fffffff) {
        warnings.push('Chunk ' + index + ' (' + type + ') declares an impossible length of ' + length + ' bytes.');
        break;
      }
      var dataStart = offset + 8;
      var dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) {
        warnings.push('Chunk ' + type + ' at byte ' + offset + ' is truncated: ' + length + ' bytes declared, ' + (bytes.length - dataStart) + ' available.');
        break;
      }
      var data = bytes.subarray(dataStart, dataEnd);
      var stored = dv.getUint32(dataEnd);
      var computed = crc32(bytes, offset + 4, dataEnd);
      var ok = stored === computed;
      if (ok) crcOk++; else crcBad++;

      var chunk = {
        index: index,
        type: type,
        length: length,
        offset: offset,
        data: data,
        critical: !!CRITICAL[type],
        crc: { stored: stored, computed: computed, ok: ok },
        description: CHUNK_NAMES[type] || 'Unknown chunk',
        known: !!CHUNK_NAMES[type],
        flags: {
          ancillary: (bytes[offset + 4] & 0x20) !== 0,
          private: (bytes[offset + 5] & 0x20) !== 0,
          reserved: (bytes[offset + 6] & 0x20) !== 0,
          safeToCopy: (bytes[offset + 7] & 0x20) !== 0
        }
      };

      typeCounts[type] = (typeCounts[type] || 0) + 1;

      if (!chunk.known && chunk.critical) {
        warnings.push('Unknown critical chunk "' + type + '" — a decoder may refuse this file.');
      }
      if (chunk.flags.reserved) {
        warnings.push('Chunk "' + type + '" has the reserved bit set (third letter lowercase).');
      }

      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        try { chunk.keyword = readName(data, 0, data.length).text; } catch (e) { /* ignore */ }
      }

      if (type === 'IHDR') {
        if (length !== 13) {
          warnings.push('IHDR should be 13 bytes, found ' + length + '.');
        }
        if (result.header) {
          warnings.push('More than one IHDR chunk.');
        }
        var ct = bytes[dataStart + 9];
        var info = COLOR_TYPES[ct];
        result.header = {
          width: dv.getUint32(dataStart),
          height: dv.getUint32(dataStart + 4),
          bitDepth: bytes[dataStart + 8],
          colorType: ct,
          colourName: info ? info.name : 'Unknown',
          channels: info ? info.channels : 0,
          compression: bytes[dataStart + 10],
          filter: bytes[dataStart + 11],
          interlace: bytes[dataStart + 12]
        };
        if (bytes[dataStart + 8] === 0) warnings.push('IHDR bit depth is zero.');
        if (info && info.depths.indexOf(bytes[dataStart + 8]) === -1) {
          warnings.push('Bit depth ' + bytes[dataStart + 8] + ' is not valid for colour type ' + ct + '.');
        }
        if (bytes[dataStart + 10] !== 0) warnings.push('Unknown compression method ' + bytes[dataStart + 10] + '.');
        if (bytes[dataStart + 11] !== 0) warnings.push('Unknown filter method ' + bytes[dataStart + 11] + '.');
        if (bytes[dataStart + 12] > 1) warnings.push('Unknown interlace method ' + bytes[dataStart + 12] + '.');
      } else if (type === 'PLTE') {
        if (length % 3 !== 0) warnings.push('PLTE length is not a multiple of 3.');
        for (var p = 0; p + 2 < data.length && result.palette.length < 256; p += 3) {
          result.palette.push('#' + [data[p], data[p + 1], data[p + 2]].map(function (b) {
            return b.toString(16).padStart(2, '0');
          }).join(''));
        }
      } else if (type === 'IDAT') {
        idatBytes += length;
        idatChunks++;
      } else if (type === 'pHYs') {
        var xppm = dv.getUint32(dataStart);
        var yppm = dv.getUint32(dataStart + 4);
        var unit = bytes[dataStart + 8];
        result.physical = {
          xppm: xppm,
          yppm: yppm,
          unit: unit,
          dpiX: unit === 1 ? xppm * 0.0254 : null,
          dpiY: unit === 1 ? yppm * 0.0254 : null,
          mmX: unit === 1 && xppm ? 1000 / xppm : null,
          mmY: unit === 1 && yppm ? 1000 / yppm : null
        };
      } else if (type === 'gAMA') {
        result.colour.gamma = dv.getUint32(dataStart) / 100000;
      } else if (type === 'sRGB') {
        result.colour.srgb = bytes[dataStart];
        result.colour.srgbName = SRGB_INTENT[bytes[dataStart]] || 'Unknown intent';
      } else if (type === 'cHRM') {
        if (length >= 32) {
          result.colour.chromaticity = {
            wx: dv.getUint32(dataStart) / 100000,
            wy: dv.getUint32(dataStart + 4) / 100000,
            rx: dv.getUint32(dataStart + 8) / 100000,
            ry: dv.getUint32(dataStart + 12) / 100000,
            gx: dv.getUint32(dataStart + 16) / 100000,
            gy: dv.getUint32(dataStart + 20) / 100000,
            bx: dv.getUint32(dataStart + 24) / 100000,
            by: dv.getUint32(dataStart + 28) / 100000
          };
        }
      } else if (type === 'iCCP') {
        var icc = readName(data, 0, data.length);
        chunk.keyword = icc.text;
        var iccChunk = { name: icc.text, compressedSize: Math.max(0, data.length - icc.next - 1), size: null };
        result.colour.icc = iccChunk;
        pendingText.push(
          inflate(data.subarray(icc.next + 1)).then(function (raw) {
            iccChunk.size = raw.length;
          }).catch(function () { /* keep compressed size only */ })
        );
      } else if (type === 'sBIT') {
        result.colour.significantBits = Array.prototype.slice.call(data);
      } else if (type === 'bKGD') {
        result.colour.background = Array.prototype.slice.call(data);
      } else if (type === 'tRNS') {
        result.colour.transparency = result.header && result.header.colorType === 3
          ? 'Palette alpha · ' + data.length + ' entries'
          : result.header && result.header.colorType === 0
            ? 'Greyscale colour key'
            : 'RGB colour key';
      } else if (type === 'tIME' && length >= 7) {
        var y = dv.getUint16(dataStart);
        var mo = bytes[dataStart + 2];
        var d = bytes[dataStart + 3];
        var h = bytes[dataStart + 4];
        var mi = bytes[dataStart + 5];
        var s = bytes[dataStart + 6];
        var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') + 'T' +
          String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(s).padStart(2, '0') + 'Z';
        result.time = { iso: iso, timestamp: Date.parse(iso), raw: { year: y, month: mo, day: d, hour: h, minute: mi, second: s } };
      } else if (type === 'eXIf') {
        try {
          result.exif = parseExif(data);
        } catch (e) {
          warnings.push('eXIf chunk could not be parsed: ' + e.message);
        }
      } else if (type === 'acTL') {
        acTL = { frames: dv.getUint32(dataStart), plays: dv.getUint32(dataStart + 4) };
      } else if (type === 'fcTL') {
        fcTLCount++;
      } else if (type === 'fdAT') {
        fdATCount++;
        fdATBytes += Math.max(0, length - 4);
      }

      if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
        try {
          pendingText.push(
            textEntry(type, data).then(function (entry) {
              result.text.push(entry);
            }).catch(function (e) {
              warnings.push('A ' + type + ' entry could not be read: ' + e.message);
            })
          );
        } catch (e) {
          warnings.push('A ' + type + ' entry could not be read: ' + e.message);
        }
      }

      chunk.details = chunkDetails(type, data, result.header);
      result.chunks.push(chunk);

      offset = dataEnd + 4;
      index++;

      if (type === 'IEND') {
        sawIEND = true;
        break;
      }
    }

    if (sawIEND && bytes.length > offset) {
      result.trailingBytes = bytes.length - offset;
      warnings.push(result.trailingBytes + ' bytes follow IEND.');
    }

    if (!sawIEND) warnings.push('No IEND chunk — this PNG looks incomplete.');
    if (result.chunks.length && result.chunks[0].type !== 'IHDR') warnings.push('The first chunk is not IHDR.');
    if (!idatChunks) warnings.push('No IDAT chunk — there is no pixel data in this file.');

    var h = result.header;
    if (h) {
      var bitsPerPixel = h.channels * h.bitDepth;
      var rawBytes = h.width * h.height * bitsPerPixel / 8;
      result.totals = {
        chunks: result.chunks.length,
        types: Object.keys(typeCounts).length,
        idatChunks: idatChunks,
        idatBytes: idatBytes,
        crcOk: crcOk,
        crcBad: crcBad,
        trailingBytes: result.trailingBytes,
        rawBytes: rawBytes,
        bitsPerPixel: bitsPerPixel,
        megapixels: (h.width * h.height) / 1e6,
        compressionRatio: idatBytes > 0 ? rawBytes / idatBytes : null,
        pixelSize: fileInfo && fileInfo.size > 0 ? rawBytes / fileInfo.size : null
      };
    }

    var gcd = function (a, b) { while (b) { var t = b; b = a % b; a = t; } return a; };
    if (h && h.width > 0 && h.height > 0) {
      var g = gcd(h.width, h.height);
      h.aspect = { w: h.width / g, h: h.height / g, value: h.width / h.height };
    }

    if (acTL || fcTLCount) {
      result.animation = {
        isAPNG: true,
        frames: acTL ? acTL.frames : fcTLCount,
        plays: acTL ? acTL.plays : 0,
        controlChunks: fcTLCount + fdATCount,
        dataBytes: fdATBytes
      };
    }

    return Promise.all(pendingText).then(function () {
      result.text.sort(function (a, b) {
        return a.keyword.localeCompare(b.keyword, undefined, { sensitivity: 'base' });
      });
      return result;
    });
  }

  global.PNGInspect = {
    parse: parse,
    isPNG: isPNG,
    crc32: crc32,
    names: CHUNK_NAMES,
    colourTypes: COLOR_TYPES
  };
})(typeof window !== 'undefined' ? window : globalThis);
