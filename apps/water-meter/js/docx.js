/* Выгрузка в Word без единой внешней библиотеки.

   .docx — это обычный zip с несколькими XML внутри, поэтому здесь сначала
   маленький упаковщик zip (метод «без сжатия» — Word его понимает и файлы
   у нас крошечные), а потом сборка самого документа. Так браузерная версия
   отдаёт такой же настоящий .docx, как и настольная: с рамками и с
   объединёнными по вертикали ячейками, а не картинку из HTML.              */
var Docx = (function () {
  "use strict";

  /* ------------------------------------------------------------- упаковка zip */

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }

  function crc32(bytes) {
    var t = crcTable(), crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(text) { return new TextEncoder().encode(text); }

  function zip(files) {
    return new Blob([zipBytes(files)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  function zipBytes(files) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    var items = [], local = 0, central = 0, i;
    for (i = 0; i < files.length; i++) {
      var name = utf8(files[i].name);
      var data = utf8(files[i].text);
      items.push({ name: name, data: data, crc: crc32(data), offset: local });
      local += 30 + name.length + data.length;
      central += 46 + name.length;
    }

    var buf = new Uint8Array(local + central + 22);
    var view = new DataView(buf.buffer);
    var pos = 0;

    function u32(v) { view.setUint32(pos, v >>> 0, true); pos += 4; }
    function u16(v) { view.setUint16(pos, v & 0xFFFF, true); pos += 2; }
    function raw(bytes) { buf.set(bytes, pos); pos += bytes.length; }

    for (i = 0; i < items.length; i++) {
      var it = items[i];
      u32(0x04034b50);
      u16(20); u16(0x0800); u16(0);            // версия, флаг «имена в UTF-8», метод «без сжатия»
      u16(dosTime); u16(dosDate);
      u32(it.crc); u32(it.data.length); u32(it.data.length);
      u16(it.name.length); u16(0);
      raw(it.name); raw(it.data);
    }

    var cdStart = pos;
    for (i = 0; i < items.length; i++) {
      var c = items[i];
      u32(0x02014b50);
      u16(20); u16(20); u16(0x0800); u16(0);
      u16(dosTime); u16(dosDate);
      u32(c.crc); u32(c.data.length); u32(c.data.length);
      u16(c.name.length); u16(0); u16(0);
      u16(0); u16(0); u32(0);
      u32(c.offset);
      raw(c.name);
    }

    // Размер каталога снимаем здесь: ниже pos уже уедет внутрь самой записи EOCD.
    var cdSize = pos - cdStart;

    u32(0x06054b50);
    u16(0); u16(0);
    u16(items.length); u16(items.length);
    u32(cdSize); u32(cdStart);
    u16(0);

    return buf;
  }

  /* ------------------------------------------------------------- документ */

  // A4 книжная, поля по 2 см: 11906 − 2·1134 = 9638 твипов полезной ширины.
  var PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134, CONTENT_W = 9638;
  var WIDTHS6 = [1500, 2350, 1200, 1200, 1350, 2038];
  var WIDTHS5 = [1800, 3000, 1500, 1500, 1838];

  var HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n";

  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function par(text, bold, align, spaceAfter) {
    var s = "<w:p><w:pPr>";
    if (align === "center") s += "<w:jc w:val=\"center\"/>";
    else if (align === "right") s += "<w:jc w:val=\"right\"/>";
    if (spaceAfter > 0) s += "<w:spacing w:after=\"" + spaceAfter + "\"/>";
    s += "</w:pPr>";
    if (text) {
      s += "<w:r>";
      if (bold) s += "<w:rPr><w:b/></w:rPr>";
      s += "<w:t xml:space=\"preserve\">" + esc(text) + "</w:t></w:r>";
    }
    return s + "</w:p>";
  }

  /* vMerge: null — обычная ячейка, "restart" — начало объединения,
     "continue" — продолжение объединённой ячейки сверху. */
  function cell(text, width, bold, align, vMerge) {
    var s = "<w:tc><w:tcPr><w:tcW w:w=\"" + width + "\" w:type=\"dxa\"/>";
    if (vMerge === "restart") s += "<w:vMerge w:val=\"restart\"/>";
    else if (vMerge === "continue") s += "<w:vMerge/>";
    s += "<w:vAlign w:val=\"center\"/></w:tcPr>";
    return s + par(text, bold, align, 0) + "</w:tc>";
  }

  function tableProperties(widths) {
    var sides = ["top", "left", "bottom", "right", "insideH", "insideV"];
    var s = "<w:tblPr><w:tblW w:w=\"" + CONTENT_W + "\" w:type=\"dxa\"/><w:tblBorders>";
    for (var i = 0; i < sides.length; i++)
      s += "<w:" + sides[i] + " w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"000000\"/>";
    s += "</w:tblBorders><w:tblLayout w:type=\"fixed\"/><w:tblCellMar>";
    s += "<w:top w:w=\"20\" w:type=\"dxa\"/><w:left w:w=\"60\" w:type=\"dxa\"/>";
    s += "<w:bottom w:w=\"20\" w:type=\"dxa\"/><w:right w:w=\"60\" w:type=\"dxa\"/>";
    s += "</w:tblCellMar></w:tblPr><w:tblGrid>";
    for (var j = 0; j < widths.length; j++) s += "<w:gridCol w:w=\"" + widths[j] + "\"/>";
    return s + "</w:tblGrid>";
  }

  function sectionProperties() {
    return "<w:sectPr><w:pgSz w:w=\"" + PAGE_W + "\" w:h=\"" + PAGE_H + "\"/>" +
      "<w:pgMar w:top=\"" + MARGIN + "\" w:right=\"" + MARGIN + "\" w:bottom=\"" + MARGIN +
      "\" w:left=\"" + MARGIN + "\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>" +
      "<w:cols w:space=\"708\"/></w:sectPr>";
  }

  function styles(settings) {
    var half = Math.round(settings.docFontSize * 2);      // кегль в OOXML — полупункты
    if (!(half > 2)) half = 20;
    var font = esc(settings.docFont);
    return HEAD +
      "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
      "<w:docDefaults><w:rPrDefault><w:rPr>" +
      "<w:rFonts w:ascii=\"" + font + "\" w:hAnsi=\"" + font + "\" w:cs=\"" + font + "\"/>" +
      "<w:sz w:val=\"" + half + "\"/><w:szCs w:val=\"" + half + "\"/><w:lang w:val=\"ru-RU\"/>" +
      "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>" +
      "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>" +
      "</w:pPr></w:pPrDefault></w:docDefaults>" +
      "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\">" +
      "<w:name w:val=\"Normal\"/><w:qFormat/></w:style></w:styles>";
  }

  function documentXml(bodyXml) {
    return HEAD +
      "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
      "<w:body>" + bodyXml + sectionProperties() + "</w:body></w:document>";
  }

  function parts(bodyXml, settings) {
    var document = documentXml(bodyXml);

    return [
      { name: "[Content_Types].xml", text: HEAD +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
        "</Types>" },
      { name: "_rels/.rels", text: HEAD +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
        "</Relationships>" },
      { name: "word/_rels/document.xml.rels", text: HEAD +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
        "</Relationships>" },
      { name: "word/document.xml", text: document },
      { name: "word/styles.xml", text: styles(settings) }
    ];
  }

  function pack(bodyXml, settings) { return zip(parts(bodyXml, settings)); }

  /* ------------------------------------------------------------- таблица подбора */

  function tableBody(settings, rows) {
    var withNote = false, i;
    for (i = 0; i < rows.length; i++) if (rows[i].note) { withNote = true; break; }

    var w = withNote ? WIDTHS6 : WIDTHS5;
    var spans = Rows.spans(rows, settings.mergePlaces);
    var body = "";

    if (settings.tableTitle) body += par(settings.tableTitle, true, "left", 120);

    body += "<w:tbl>" + tableProperties(w);

    // Шапка повторяется на каждой странице — таблицы подбора часто длинные.
    var head = "<w:trPr><w:tblHeader/></w:trPr>";
    head += cell("Место установки счетчика", w[0], true, "center", null);
    head += cell("Наименование системы", w[1], true, "center", null);
    head += cell("Расход, поступающий на счетчик, л/с", w[2], true, "center", null);
    head += cell("Потери в счетчике, м", w[3], true, "center", null);
    head += cell("Счетчик", w[4], true, "center", null);
    if (withNote) head += cell("Примечание", w[5], true, "center", null);
    body += "<w:tr>" + head + "</w:tr>";

    for (i = 0; i < rows.length; i++) {
      var r = rows[i], tr = "";
      var vMerge = null, placeText = r.place;
      if (settings.mergePlaces) {
        if (spans[i] === 0) { vMerge = "continue"; placeText = ""; }
        else if (spans[i] > 1) { vMerge = "restart"; }
      }
      tr += cell(placeText, w[0], false, "center", vMerge);
      tr += cell(r.systemName, w[1], false, "center", null);
      tr += cell(U.fmt(r.qLs, 2), w[2], false, "center", null);
      tr += cell(U.fmt(Rows.loss(r), 2), w[3], false, "center", null);
      tr += cell(r.mark, w[4], false, "center", null);
      if (withNote) tr += cell(r.note, w[5], false, "left", null);
      body += "<w:tr>" + tr + "</w:tr>";
    }

    body += "</w:tbl>";

    if (settings.tableFooter) {
      body += par("", false, "left", 0);
      body += par(settings.tableFooter, false, "left", 0);
    }

    return body;
  }

  function table(settings, rows) { return pack(tableBody(settings, rows), settings); }

  /* Тот же документ строкой — нужен проверкам, чтобы заглянуть внутрь. */
  function tableXml(settings, rows) { return documentXml(tableBody(settings, rows)); }

  /* ------------------------------------------------------------- лист расчёта */

  function reportBody(settings, lines) {
    var body = "";
    if (settings.reportTitle) body += par(settings.reportTitle, true, "center", 200);
    for (var i = 0; i < lines.length; i++) body += par(lines[i], false, "left", 0);
    return body;
  }

  function report(settings, lines) { return pack(reportBody(settings, lines), settings); }

  return {
    table: table, report: report, tableXml: tableXml,
    parts: parts, zip: zip, zipBytes: zipBytes, crc32: crc32
  };
})();
