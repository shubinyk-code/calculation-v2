/* Минимальные чтение и запись ZIP (для .docx) без библиотек.
   Чтение: методы 0 (stored) и 8 (deflate, через DecompressionStream).
   Запись: stored (без сжатия) + CRC32 — Word такой файл открывает без вопросов. */
(function (g) {
  'use strict';

  var crcTable = null;
  function crc32(u8) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = crcTable[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function inflateRaw(u8) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /** @returns {Promise<Array<{name:string,data:Uint8Array}>>} */
  function readZip(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Это не .docx: не найден каталог ZIP.'));
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');
    var jobs = [];
    var p = cdOff;
    for (var e = 0; e < count; e++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error('Повреждён каталог ZIP.'));
      var flags = dv.getUint16(p + 8, true);
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.charAt(name.length - 1) === '/') continue;
      var lnlen = dv.getUint16(lho + 26, true);
      var lelen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lnlen + lelen;
      var raw = u8.subarray(start, start + csize);
      (function (nm, mt, rw) {
        if (mt === 0) jobs.push(Promise.resolve({ name: nm, data: new Uint8Array(rw) }));
        else if (mt === 8) jobs.push(inflateRaw(rw).then(function (d) { return { name: nm, data: d }; }));
        else jobs.push(Promise.reject(new Error('Неподдерживаемый способ сжатия в ZIP: ' + mt)));
      })(name, method, raw);
    }
    return Promise.all(jobs);
  }

  function writeZip(entries) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    entries.forEach(function (en) {
      var nameB = enc.encode(en.name);
      var data = en.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + nameB.length);
      var d = new DataView(lh.buffer);
      d.setUint32(0, 0x04034b50, true);
      d.setUint16(4, 20, true);
      d.setUint16(6, 0x0800, true);
      d.setUint16(8, 0, true);
      d.setUint16(10, dosTime, true);
      d.setUint16(12, dosDate, true);
      d.setUint32(14, crc, true);
      d.setUint32(18, data.length, true);
      d.setUint32(22, data.length, true);
      d.setUint16(26, nameB.length, true);
      d.setUint16(28, 0, true);
      lh.set(nameB, 30);
      parts.push(lh, data);
      var ch = new Uint8Array(46 + nameB.length);
      var c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true);
      c.setUint16(14, dosDate, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, nameB.length, true);
      c.setUint32(42, offset, true);
      ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var end = new Uint8Array(22);
    var ed = new DataView(end.buffer);
    ed.setUint32(0, 0x06054b50, true);
    ed.setUint16(8, entries.length, true);
    ed.setUint16(10, entries.length, true);
    ed.setUint32(12, cdSize, true);
    ed.setUint32(16, offset, true);
    var all = parts.concat(central, [end]);
    var total = 0;
    all.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  g.Zip = { read: readZip, write: writeZip, crc32: crc32 };
})(window);
