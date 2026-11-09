(function () {
  'use strict';

  var MAX_BYTES = 100 * 1024 * 1024;
  var THEME_KEY = 'png-inspect-theme';

  var els = {
    hero: document.getElementById('hero'),
    result: document.getElementById('result'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    dropOverlay: document.getElementById('dropOverlay'),
    fileName: document.getElementById('fileName'),
    fileSub: document.getElementById('fileSub'),
    preview: document.getElementById('preview'),
    previewCaption: document.getElementById('previewCaption'),
    railBytes: document.getElementById('railBytes'),
    railChunks: document.getElementById('railChunks'),
    railTime: document.getElementById('railTime'),
    facts: document.getElementById('facts'),
    statusStrip: document.getElementById('statusStrip'),
    sections: document.getElementById('sections'),
    copyJson: document.getElementById('copyJson'),
    downloadJson: document.getElementById('downloadJson'),
    resetBtn: document.getElementById('resetBtn'),
    themeToggle: document.getElementById('themeToggle'),
    toast: document.getElementById('toast')
  };

  var state = { result: null, file: null, url: null, json: '' };
  var toastTimer = null;
  var dragDepth = 0;

  var ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 3.5 2.8 20h18.4L12 3.5Z"/><path d="M12 9.4v4.4M12 16.7v.1"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/></svg>'
  };

  var COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/></svg>';
  var CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  /* ---------- small helpers ---------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nf(n) {
    return Number(n).toLocaleString('en-US');
  }

  function round(n, d) {
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(n * p) / p;
  }

  function fmtBytes(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + units[i];
  }

  function fmtDpi(n) {
    if (n == null) return '—';
    return Number.isInteger(n) ? String(n) : String(round(n, 2));
  }

  function colourShort(type) {
    return { 0: 'Gray', 2: 'RGB', 3: 'Indexed', 4: 'Gray + alpha', 6: 'RGBA' }[type] || 'Unknown';
  }

  function aspectText(h) {
    if (!h || !h.aspect) return '—';
    return h.aspect.w + ':' + h.aspect.h;
  }

  function describeFormat(bytes) {
    var head = function (start, end) {
      return String.fromCharCode.apply(null, bytes.subarray(start, end));
    };
    if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'a JPEG';
    if (bytes.length > 3 && head(0, 4) === 'GIF8') return 'a GIF';
    if (bytes.length > 11 && head(0, 4) === 'RIFF' && head(8, 12) === 'WEBP') return 'a WebP';
    if (bytes.length > 11 && head(4, 8) === 'ftyp') return 'a HEIC or AVIF file';
    if (bytes.length > 1 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'a BMP';
    if (bytes.length > 4 && head(0, 5) === '%PDF-') return 'a PDF';
    if (bytes.length > 4 && head(0, 4) === '\x7fELF') return 'an executable';
    return 'not a PNG';
  }

  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('show');
    }, isError ? 4600 : 2200);
  }

  function copyText(text, label, onDone) {
    var done = function () {
      if (label) toast(label);
      if (onDone) onDone();
    };
    var fallback = function () {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { toast('Clipboard is not available in this browser.', true); }
      document.body.removeChild(area);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function flashButton(btn, label) {
    var span = btn.querySelector('span');
    if (!span || btn.dataset.flashing) return;
    var original = span.textContent;
    btn.dataset.flashing = '1';
    span.textContent = label;
    btn.classList.add('is-done');
    setTimeout(function () {
      span.textContent = original;
      btn.classList.remove('is-done');
      delete btn.dataset.flashing;
    }, 1600);
  }

  /* ---------- load ---------- */

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast('That file is ' + fmtBytes(file.size) + '. The limit is 100 MB.', true);
      return;
    }
    if (file.size === 0) {
      toast('That file is empty.', true);
      return;
    }
    file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      if (!PNGInspect.isPNG(bytes)) {
        throw new Error('That file is ' + describeFormat(bytes) + '. This tool only reads PNG chunk data.');
      }
      var start = performance.now();
      return PNGInspect.parse(buffer, {
        name: file.name,
        size: file.size,
        type: file.type || 'image/png',
        lastModified: file.lastModified || null
      }).then(function (result) {
        result.parseMs = Math.max(1, Math.round(performance.now() - start));
        return result;
      });
    }).then(function (result) {
      showResult(result, file);
    }).catch(function (err) {
      toast(err && err.message ? err.message : 'The file could not be read.', true);
    });
  }

  function showResult(result, file) {
    state.result = result;
    state.file = file;

    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);

    els.preview.style.display = '';
    els.preview.src = state.url;
    els.preview.alt = 'Preview of ' + file.name;

    state.json = JSON.stringify(buildExport(result), null, 2);

    var h = result.header;
    els.fileName.textContent = file.name;
    els.fileName.title = file.name;
    els.fileSub.textContent = [
      fmtBytes(file.size),
      (result.totals.chunks || result.chunks.length) + ' chunks',
      'read in ' + result.parseMs + ' ms'
    ].join(' · ');

    els.previewCaption.textContent = h
      ? h.width + ' × ' + h.height + ' px · ' + h.bitDepth + '-bit ' + colourShort(h.colorType)
      : 'No IHDR header found';

    els.railBytes.textContent = fmtBytes(file.size);
    els.railChunks.textContent = String(result.chunks.length);
    els.railTime.textContent = result.parseMs + ' ms';

    document.title = file.name + ' — png.inspect';
    els.hero.hidden = true;
    els.result.hidden = false;

    render(result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    if (state.url) URL.revokeObjectURL(state.url);
    state = { result: null, file: null, url: null, json: '' };
    els.result.hidden = true;
    els.hero.hidden = false;
    els.facts.innerHTML = '';
    els.statusStrip.innerHTML = '';
    els.sections.innerHTML = '';
    els.fileInput.value = '';
    els.preview.removeAttribute('src');
    els.preview.style.display = '';
    els.fileName.textContent = '';
    els.fileSub.textContent = '';
    els.previewCaption.textContent = '';
    els.railBytes.textContent = '—';
    els.railChunks.textContent = '—';
    els.railTime.textContent = '—';
    document.title = 'png.inspect — every byte a PNG carries';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    els.dropzone.focus({ preventScroll: true });
  }

  /* ---------- render ---------- */

  function render(r) {
    els.statusStrip.innerHTML = statusPills(r);
    els.facts.innerHTML = factsHtml(r);

    var parts = [];
    parts.push(sectionHtml('Header', '13 bytes', '', headerBody(r)));
    parts.push(sectionHtml('Physical & colour', '', '', colourBody(r)));
    parts.push(sectionHtml('Text entries', r.text.length ? r.text.length + (r.text.length === 1 ? ' entry' : ' entries') : 'none', '', textBody(r)));
    if (r.exif) parts.push(sectionHtml('EXIF', r.exif.length + ' fields', '', exifBody(r)));
    if (r.animation && r.animation.isAPNG) parts.push(sectionHtml('Animation', 'APNG', '', animationBody(r)));
    parts.push(sectionHtml('Chunk map', r.chunks.length + (r.chunks.length === 1 ? ' chunk' : ' chunks'), chunkTools(), chunkBody(r)));
    parts.push(sectionHtml('JSON', fmtBytes(state.json.length), '', jsonBody()));

    els.sections.innerHTML = parts.join('');
    numberSections();
    bindChunkFilter();
  }

  function numberSections() {
    var sections = els.sections.querySelectorAll('.section');
    for (var i = 0; i < sections.length; i++) {
      var num = sections[i].querySelector('.section-num');
      if (num) num.textContent = String(i + 1).padStart(2, '0');
    }
  }

  function sectionHtml(title, count, tools, body) {
    return '<section class="section">' +
      '<div class="section-head">' +
        '<span class="section-num"></span>' +
        '<h3 class="section-title">' + esc(title) + '</h3>' +
        (count ? '<span class="section-count">' + esc(count) + '</span>' : '') +
        (tools ? '<div class="section-tools">' + tools + '</div>' : '') +
      '</div>' + body + '</section>';
  }

  function pill(label, kind, icon) {
    return '<span class="pill ' + (kind || '') + '">' + (icon ? ICONS[icon] : '') + esc(label) + '</span>';
  }

  function statusPills(r) {
    var h = r.header;
    var t = r.totals || {};
    var out = [];
    var hasIEND = r.chunks.some(function (c) { return c.type === 'IEND'; });

    out.push(pill('PNG signature', 'ok', 'check'));
    if (!r.chunks.length) {
      out.push(pill('No chunks', 'bad', 'warn'));
    } else {
      out.push(pill(t.crcBad ? t.crcBad + ' CRC mismatch' : 'CRC ' + (t.crcOk || 0) + '/' + r.chunks.length + ' ok', t.crcBad ? 'bad' : 'ok', t.crcBad ? 'warn' : 'check'));
    }
    if (!hasIEND) out.push(pill('No IEND', 'bad', 'warn'));
    if (h && h.interlace === 1) out.push(pill('Adam7 interlaced', 'info', 'info'));
    if (r.animation && r.animation.isAPNG) out.push(pill('APNG · ' + (r.animation.frames || '?') + ' frames', 'info', 'info'));
    if (r.exif) out.push(pill('EXIF present', 'info', 'info'));
    if (r.colour.icc) out.push(pill('ICC embedded', 'info', 'info'));
    if (r.warnings.length) {
      out.push(pill(r.warnings.length + (r.warnings.length === 1 ? ' warning' : ' warnings'), 'warn', 'warn'));
    }
    return out.join('');
  }

  function factsHtml(r) {
    var h = r.header;
    var t = r.totals || {};
    var facts = [];

    if (h) {
      facts.push(['Dimensions', h.width + ' × ' + h.height, aspectText(h) + ' · ' + round(t.megapixels, 2) + ' MP']);
      facts.push(['Pixel format', h.bitDepth + '-bit ' + colourShort(h.colorType), 'colour type ' + h.colorType + ' · ' + h.channels + (h.channels === 1 ? ' channel' : ' channels')]);
    } else {
      facts.push(['Dimensions', '—', 'no IHDR chunk']);
    }

    facts.push(['File size', fmtBytes(r.file.size), [
      t.idatBytes ? fmtBytes(t.idatBytes) + ' IDAT' : null,
      t.compressionRatio ? round(t.compressionRatio, 1) + '× vs raw' : null
    ].filter(Boolean).join(' · ') || 'no pixel data']);

    if (r.physical && r.physical.dpiX != null) {
      facts.push(['Resolution', fmtDpi(r.physical.dpiX) + ' × ' + fmtDpi(r.physical.dpiY) + ' DPI', nf(r.physical.xppm) + ' px/m · ' + round(r.physical.mmX, 3) + ' mm/px']);
    } else if (r.physical) {
      facts.push(['Resolution', 'No unit', 'pHYs present, unit unknown']);
    } else {
      facts.push(['Resolution', 'Not recorded', 'no pHYs chunk']);
    }

    facts.push(['Chunks', String(r.chunks.length), (t.types || 0) + ' types · ' + (t.idatChunks || 0) + ' IDAT']);

    if (r.time && !isNaN(r.time.timestamp)) {
      facts.push(['Last modified', r.time.iso.slice(0, 10), r.time.iso.slice(11, 19) + ' UTC · tIME']);
    } else {
      facts.push(['Last modified', 'Not recorded', 'no tIME chunk']);
    }

    return facts.map(function (f) {
      return '<div class="fact">' +
        '<span class="fact-label">' + esc(f[0]) + '</span>' +
        '<span class="fact-value" title="' + esc(f[1]) + '">' + esc(f[1]) + '</span>' +
        '<span class="fact-note">' + esc(f[2]) + '</span>' +
        '</div>';
    }).join('');
  }

  function defsHtml(pairs) {
    return '<dl class="defs">' + pairs.map(function (p) {
      return '<div class="def"><dt>' + p[0] + '</dt><dd>' + p[1] + '</dd></div>';
    }).join('') + '</dl>';
  }

  function headerBody(r) {
    var h = r.header;
    if (!h) {
      return '<p class="note">This file has <strong>no readable IHDR chunk</strong>. Without it the dimensions, bit depth and colour type cannot be determined.</p>';
    }
    var t = r.totals || {};
    var pairs = [
      ['PNG signature', '89 50 4E 47 0D 0A 1A 0A <span class="sub">· 8 bytes</span>'],
      ['Width', nf(h.width) + ' px'],
      ['Height', nf(h.height) + ' px'],
      ['Bit depth', h.bitDepth + (h.bitDepth === 1 ? ' bit' : ' bits')],
      ['Colour type', h.colorType + ' · ' + esc(h.colourName)],
      ['Channels', h.channels],
      ['Compression', h.compression === 0 ? '0 · deflate' : h.compression + ' · unknown'],
      ['Filter method', h.filter === 0 ? '0 · adaptive' : h.filter + ' · unknown'],
      ['Interlace', h.interlace === 0 ? '0 · none' : h.interlace === 1 ? '1 · Adam7' : h.interlace + ' · unknown'],
      ['Bits per pixel', (t.bitsPerPixel || 0) + ''],
      ['Aspect ratio', aspectText(h) + (h.aspect ? ' <span class="sub">· ' + round(h.aspect.value, 3) + ':1</span>' : '')],
      ['Uncompressed', fmtBytes(t.rawBytes) + ' <span class="sub">pixels only</span>']
    ];
    return defsHtml(pairs);
  }

  function colourBody(r) {
    var physical = [];
    var colour = [];

    if (r.physical) {
      physical.push(['Pixels per metre', nf(r.physical.xppm) + (r.physical.yppm !== r.physical.xppm ? ' × ' + nf(r.physical.yppm) : '')]);
      physical.push(['Unit', r.physical.unit === 1 ? '1 · metre' : '0 · unknown']);
      if (r.physical.dpiX != null) {
        physical.push(['Resolution', fmtDpi(r.physical.dpiX) + ' × ' + fmtDpi(r.physical.dpiY) + ' DPI']);
        physical.push(['Pixel pitch', round(r.physical.mmX, 3) + ' mm']);
      }
    }
    if (r.header && r.header.aspect) {
      physical.push(['Aspect ratio', aspectText(r.header) + ' <span class="sub">· ' + round(r.header.aspect.value, 3) + ':1</span>']);
    }
    if (r.totals && r.totals.rawBytes) {
      physical.push(['Raw pixels', fmtBytes(r.totals.rawBytes)]);
    }
    if (r.totals && r.totals.compressionRatio) {
      physical.push(['Compression', round(r.totals.compressionRatio, 2) + '× <span class="sub">raw ÷ IDAT</span>']);
    }

    if (r.colour.gamma != null) {
      var inv = 1 / r.colour.gamma;
      colour.push(['Gamma', r.colour.gamma.toFixed(5) + ' <span class="sub">≈ 1/' + round(inv, 2) + '</span>']);
    }
    if (r.colour.srgb != null) {
      colour.push(['sRGB intent', r.colour.srgb + ' · ' + esc(r.colour.srgbName)]);
    }
    if (r.colour.chromaticity) {
      var c = r.colour.chromaticity;
      colour.push(['White point', c.wx.toFixed(4) + ', ' + c.wy.toFixed(4)]);
      colour.push(['Primaries R / G / B', c.rx.toFixed(2) + ', ' + c.ry.toFixed(2) + ' · ' + c.gx.toFixed(2) + ', ' + c.gy.toFixed(2) + ' · ' + c.bx.toFixed(2) + ', ' + c.by.toFixed(2)]);
    }
    if (r.colour.icc) {
      colour.push(['ICC profile', esc(r.colour.icc.name || 'unnamed') + '<br><span class="sub">' +
        (r.colour.icc.size ? fmtBytes(r.colour.icc.size) + ' uncompressed · ' : '') +
        fmtBytes(r.colour.icc.compressedSize) + ' stored</span>']);
    }
    if (r.colour.significantBits) {
      colour.push(['Significant bits', r.colour.significantBits.join(', ')]);
    }
    if (r.colour.background) {
      colour.push(['Background', r.colour.background.join(', ') + ' <span class="sub">samples</span>']);
    }
    if (r.colour.transparency) {
      colour.push(['Transparency', esc(r.colour.transparency)]);
    }
    if (r.palette.length) {
      colour.push(['Palette', r.palette.length + (r.palette.length === 1 ? ' entry' : ' entries')]);
    }

    var physicalBody = physical.length
      ? defsHtml(physical)
      : '<p class="note">No <strong>pHYs</strong> chunk: this file records no physical size or resolution.</p>';
    var colourBodyHtml = colour.length
      ? defsHtml(colour)
      : '<p class="note">No colour-management chunks. A viewer will assume the sRGB defaults.</p>';

    var palette = '';
    if (r.palette.length) {
      var shown = r.palette.slice(0, 96);
      palette = '<div class="palette">' +
        '<div class="palette-head"><span>Palette</span><span>' + r.palette.length + ' colours' + (r.palette.length > 96 ? ' · first 96' : '') + '</span></div>' +
        '<div class="swatches">' + shown.map(function (hex) {
          return '<span class="swatch" style="background:' + hex + '" title="' + hex + '"></span>';
        }).join('') + '</div></div>';
    }

    return '<div class="colour-split">' +
      '<div><p class="fact-label" style="margin:0 0 8px">Physical</p>' + physicalBody + '</div>' +
      '<div><p class="fact-label" style="margin:0 0 8px">Colour</p>' + colourBodyHtml + palette + '</div>' +
      '</div>';
  }

  function textBody(r) {
    if (!r.text.length) {
      return '<p class="note">No <strong>tEXt</strong>, <strong>zTXt</strong> or <strong>iTXt</strong> chunks. This PNG carries no text metadata.</p>';
    }
    return '<div class="text-grid">' + r.text.map(function (t, i) {
      var meta = [];
      if (t.language) meta.push('lang ' + t.language);
      if (t.translated) meta.push('“' + t.translated + '”');
      if (t.compressed) meta.push('deflated');
      return '<article class="text-card">' +
        '<div class="text-card-head">' +
          '<span class="keyword">' + esc(t.keyword || '(no keyword)') + '</span>' +
          '<span class="badge">' + esc(t.format) + '</span>' +
          '<button class="copy-mini" type="button" data-copy-text="' + i + '" aria-label="Copy ' + esc(t.keyword || 'text') + '">' + COPY_ICON + '</button>' +
        '</div>' +
        '<pre class="text-body">' + esc(t.text) + '</pre>' +
        (meta.length ? '<p class="text-meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</p>' : '') +
        '</article>';
    }).join('') + '</div>';
  }

  function exifBody(r) {
    return defsHtml(r.exif.map(function (pair) {
      return [esc(pair[0]), esc(pair[1])];
    })) + '<p class="note" style="margin-top:14px">PNG has no native EXIF; this data lives in an optional <strong>eXIf</strong> chunk and is shown as stored.</p>';
  }

  function animationBody(r) {
    var a = r.animation;
    return defsHtml([
      ['Format', 'APNG (animated PNG)'],
      ['Frames', a.frames || '—'],
      ['Plays', a.plays === 0 ? 'forever' : (a.plays || '—')],
      ['Control chunks', a.controlChunks],
      ['Frame data', fmtBytes(a.dataBytes)]
    ]) + '<p class="note" style="margin-top:14px">Most viewers show only the first frame unless they support APNG.</p>';
  }

  function chunkTools() {
    return '<div class="chunk-tools"><input type="search" id="chunkFilter" placeholder="Filter chunks…" aria-label="Filter chunks" spellcheck="false"></div>';
  }

  function chunkBody(r) {
    var rows = r.chunks.map(function (chunk) {
      var dot = '<span class="chunk-dot" aria-hidden="true"></span>';
      var desc = chunk.keyword ? chunk.description + ' · ' + chunk.keyword : chunk.description;
      return '<tr class="chunk-row" data-i="' + chunk.index + '" tabindex="0" aria-expanded="false">' +
        '<td class="num-cell">' + String(chunk.index + 1).padStart(2, '0') + '</td>' +
        '<td class="type-cell' + (chunk.critical ? '' : ' ancillary') + '"><span class="type-wrap">' + dot + esc(chunk.type) + '</span></td>' +
        '<td class="size-cell r">' + fmtBytes(chunk.length) + '</td>' +
        '<td class="crc-cell ' + (chunk.crc.ok ? 'ok' : 'bad') + '">' + (chunk.crc.ok ? 'ok' : 'bad') + '</td>' +
        '<td class="desc-cell" title="' + esc(desc) + '">' + esc(desc) + '</td>' +
        '<td class="chev-cell">' + CHEVRON_ICON + '</td>' +
        '</tr>' +
        '<tr class="chunk-detail" data-for="' + chunk.index + '" hidden><td colspan="6"></td></tr>';
    }).join('');

    return '<div class="chunk-scroll"><table class="chunk-table">' +
      '<colgroup><col class="c-num"><col class="c-type"><col class="c-size"><col class="c-crc"><col><col class="c-chev"></colgroup>' +
      '<thead><tr><th scope="col">#</th><th scope="col">Type</th><th scope="col" class="r">Size</th><th scope="col">CRC</th><th scope="col">Description</th><th scope="col"><span hidden>Expand</span></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="section-count" id="chunkShown" style="display:block;margin-top:9px">' + r.chunks.length + ' of ' + r.chunks.length + ' shown</p>';
  }

  function jsonBody() {
    return '<div class="json-wrap"><pre class="json">' + esc(state.json) + '</pre></div>';
  }

  function chunkDetailHtml(chunk) {
    var pairs = (chunk.details || []).map(function (p) {
      return '<div class="detail-def"><span>' + esc(p[0]) + '</span><span>' + esc(p[1]) + '</span></div>';
    }).join('');
    pairs += '<div class="detail-def"><span>Offset</span><span>0x' + chunk.offset.toString(16).toUpperCase().padStart(8, '0') + '</span></div>';
    pairs += '<div class="detail-def"><span>CRC stored</span><span>0x' + chunk.crc.stored.toString(16).toUpperCase().padStart(8, '0') + '</span></div>';
    pairs += '<div class="detail-def"><span>CRC computed</span><span>0x' + chunk.crc.computed.toString(16).toUpperCase().padStart(8, '0') + '</span></div>';

    var flags = [chunk.critical ? 'critical' : 'ancillary'];
    if (chunk.flags.private) flags.push('private');
    if (chunk.flags.safeToCopy) flags.push('safe-to-copy');
    if (chunk.flags.reserved) flags.push('reserved bit set');

    return '<div class="detail-inner">' +
      '<div><div class="detail-defs">' + pairs + '</div>' +
      '<p class="detail-flags">' + esc(flags.join(' · ')) + '</p></div>' +
      '<pre class="hexdump">' + esc(hexdump(chunk.data)) + '</pre>' +
      '</div>';
  }

  function hexdump(data, maxBytes) {
    var limit = Math.min(data.length, maxBytes || 160);
    var lines = [];
    for (var i = 0; i < limit; i += 16) {
      var end = Math.min(i + 16, limit);
      var hexParts = [];
      var ascii = '';
      for (var j = i; j < end; j++) {
        hexParts.push(data[j].toString(16).padStart(2, '0'));
        ascii += data[j] >= 32 && data[j] < 127 ? String.fromCharCode(data[j]) : '.';
      }
      lines.push(i.toString(16).toUpperCase().padStart(4, '0') + '  ' + hexParts.join(' ').padEnd(47, ' ') + '  ' + ascii);
    }
    if (!data.length) return '(empty chunk)';
    if (data.length > limit) lines.push('…   ' + nf(data.length - limit) + ' more bytes');
    return lines.join('\n');
  }

  /* ---------- chunk interactions ---------- */

  function fillDetail(index) {
    var detail = els.sections.querySelector('.chunk-detail[data-for="' + index + '"]');
    if (!detail) return null;
    var cell = detail.querySelector('td');
    if (!cell.dataset.filled) {
      cell.innerHTML = chunkDetailHtml(state.result.chunks[index]);
      cell.dataset.filled = '1';
    }
    return detail;
  }

  function toggleChunk(row) {
    var index = Number(row.dataset.i);
    var detail = fillDetail(index);
    if (!detail) return;
    var open = row.classList.toggle('is-open');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
    detail.hidden = !open;
  }

  function bindChunkFilter() {
    var input = document.getElementById('chunkFilter');
    var counter = document.getElementById('chunkShown');
    if (!input) return;
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      var rows = els.sections.querySelectorAll('.chunk-row');
      var shown = 0;
      Array.prototype.forEach.call(rows, function (row) {
        var chunk = state.result.chunks[Number(row.dataset.i)];
        var match = !q || chunk.type.toLowerCase().indexOf(q) !== -1 || chunk.description.toLowerCase().indexOf(q) !== -1;
        row.hidden = !match;
        var detail = els.sections.querySelector('.chunk-detail[data-for="' + chunk.index + '"]');
        if (!match) {
          row.classList.remove('is-open');
          row.setAttribute('aria-expanded', 'false');
          if (detail) detail.hidden = true;
        } else {
          shown++;
        }
      });
      if (counter) counter.textContent = shown + ' of ' + rows.length + ' shown';
    });
  }

  /* ---------- export ---------- */

  function buildExport(r) {
    var h = r.header;
    return {
      file: r.file ? {
        name: r.file.name,
        size: r.file.size,
        type: r.file.type || null,
        lastModified: r.file.lastModified ? new Date(r.file.lastModified).toISOString() : null
      } : null,
      png: {
        signature: r.signature,
        complete: r.chunks.some(function (c) { return c.type === 'IEND'; }),
        crcErrors: (r.totals && r.totals.crcBad) || 0,
        trailingBytes: r.trailingBytes,
        warnings: r.warnings
      },
      header: h ? {
        width: h.width,
        height: h.height,
        bitDepth: h.bitDepth,
        colorType: h.colorType,
        color: h.colourName,
        channels: h.channels,
        compression: h.compression,
        filter: h.filter,
        interlace: h.interlace === 1 ? 'Adam7' : 'none',
        aspectRatio: h.aspect ? h.aspect.w + ':' + h.aspect.h : null,
        megapixels: r.totals ? round(r.totals.megapixels, 4) : null
      } : null,
      physical: r.physical ? {
        pixelsPerMetreX: r.physical.xppm,
        pixelsPerMetreY: r.physical.yppm,
        unit: r.physical.unit === 1 ? 'metre' : 'unknown',
        dpiX: r.physical.dpiX ? round(r.physical.dpiX, 2) : null,
        dpiY: r.physical.dpiY ? round(r.physical.dpiY, 2) : null,
        millimetresPerPixelX: r.physical.mmX ? round(r.physical.mmX, 4) : null,
        millimetresPerPixelY: r.physical.mmY ? round(r.physical.mmY, 4) : null
      } : null,
      colour: {
        gamma: r.colour.gamma != null ? r.colour.gamma : null,
        sRGBIntent: r.colour.srgb != null ? { code: r.colour.srgb, name: r.colour.srgbName } : null,
        chromaticity: r.colour.chromaticity || null,
        iccProfile: r.colour.icc ? { name: r.colour.icc.name, size: r.colour.icc.size, compressedSize: r.colour.icc.compressedSize } : null,
        significantBits: r.colour.significantBits || null,
        background: r.colour.background || null,
        transparency: r.colour.transparency || null,
        palette: r.palette.length ? r.palette : null
      },
      lastModified: r.time ? r.time.iso : null,
      text: r.text.map(function (t) {
        return {
          keyword: t.keyword,
          format: t.format,
          text: t.text,
          language: t.language || null,
          translatedKeyword: t.translated || null,
          compressed: !!t.compressed
        };
      }),
      exif: r.exif ? r.exif.reduce(function (acc, pair) {
        acc[pair[0]] = pair[1];
        return acc;
      }, {}) : null,
      animation: r.animation ? {
        isAPNG: !!r.animation.isAPNG,
        frames: r.animation.frames,
        plays: r.animation.plays === 0 ? 'forever' : r.animation.plays,
        dataBytes: r.animation.dataBytes
      } : null,
      totals: r.totals,
      chunks: r.chunks.map(function (c) {
        var flags = [c.critical ? 'critical' : 'ancillary'];
        if (c.flags.private) flags.push('private');
        if (c.flags.safeToCopy) flags.push('safe-to-copy');
        if (c.flags.reserved) flags.push('reserved');
        return {
          index: c.index + 1,
          type: c.type,
          size: c.length,
          description: c.description,
          critical: c.critical,
          flags: flags,
          crc: c.crc.ok ? 'ok' : 'mismatch'
        };
      })
    };
  }

  /* ---------- events ---------- */

  function initTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    els.themeToggle.setAttribute('aria-label', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    els.themeToggle.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
      els.themeToggle.setAttribute('aria-label', next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });
  }

  function initDropzone() {
    els.dropzone.addEventListener('click', function (e) {
      if (e.target !== els.fileInput) els.fileInput.click();
    });
    els.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener('change', function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      if (file) loadFile(file);
      els.fileInput.value = '';
    });
    els.dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      els.dropzone.classList.add('is-over');
    });
    els.dropzone.addEventListener('dragleave', function () {
      els.dropzone.classList.remove('is-over');
    });
    els.dropzone.addEventListener('drop', function () {
      els.dropzone.classList.remove('is-over');
    });
  }

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function initGlobalDrag() {
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      els.dropOverlay.classList.add('show');
    });
    window.addEventListener('dragover', function (e) {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', function (e) {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 || e.clientX <= 0 || e.clientY <= 0 || !e.relatedTarget) {
        dragDepth = 0;
        els.dropOverlay.classList.remove('show');
        els.dropzone.classList.remove('is-over');
      }
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e) && !(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.classList.remove('show');
      els.dropzone.classList.remove('is-over');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  function initPaste() {
    window.addEventListener('paste', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          var file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            loadFile(file);
            return;
          }
        }
      }
    });
  }

  function initActions() {
    els.copyJson.addEventListener('click', function () {
      if (!state.json) return;
      copyText(state.json, 'Metadata copied as JSON', function () { flashButton(els.copyJson, 'Copied'); });
    });

    els.downloadJson.addEventListener('click', function () {
      if (!state.json || !state.file) return;
      var base = state.file.name.replace(/\.png$/i, '');
      var blob = new Blob([state.json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = base + '.metadata.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('JSON downloaded');
    });

    els.resetBtn.addEventListener('click', reset);

    els.sections.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('[data-copy-text]');
      if (copyBtn) {
        var entry = state.result.text[Number(copyBtn.dataset.copyText)];
        if (entry) copyText(entry.text, 'Copied “' + (entry.keyword || 'text') + '”');
        return;
      }
      var row = e.target.closest('.chunk-row');
      if (row) toggleChunk(row);
    });

    els.sections.addEventListener('keydown', function (e) {
      var row = e.target.closest('.chunk-row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleChunk(row);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.result.hidden) reset();
    });
  }

  function initPreview() {
    els.preview.addEventListener('error', function () {
      els.preview.style.display = 'none';
      els.previewCaption.textContent = 'Preview unavailable — the pixel data may be incomplete.';
    });
  }

  initTheme();
  initPreview();
  initDropzone();
  initGlobalDrag();
  initPaste();
  initActions();
})();
