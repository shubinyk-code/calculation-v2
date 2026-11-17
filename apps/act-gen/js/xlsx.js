/* Минимальная работа с .xlsx без библиотек: запись одной таблицы (текстовые ячейки, стили, выпадающие списки)
   и чтение первого листа (общие и встроенные строки, числа). */
(function (g) {
  'use strict';

  function xe(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(name) { var n = 0; for (var i = 0; i < name.length; i++) n = n * 26 + name.charCodeAt(i) - 64; return n - 1; }

  var STYLE = { def: 0, head: 1, sec: 2, input: 3, label: 4, key: 5, note: 6 };

  /** @param rows [[{v,s}|string]]; opts {widths:[], freeze:{row,col}, lists:[{ref, items}], sheet} */
  function write(rows, opts) {
    opts = opts || {};
    var sd = '';
    rows.forEach(function (row, r) {
      var h = row.h ? ' ht="' + row.h + '" customHeight="1"' : '';
      sd += '<row r="' + (r + 1) + '"' + h + '>';
      row.forEach(function (c, ci) {
        if (c == null) return;
        if (typeof c === 'string') c = { v: c };
        var ref = colName(ci) + (r + 1), st = STYLE[c.s || 'def'] || 0;
        if (c.v === '' || c.v == null) sd += '<c r="' + ref + '" s="' + st + '"/>';
        else sd += '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + xe(c.v) + '</t></is></c>';
      });
      sd += '</row>';
    });
    var cols = (opts.widths || []).map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"' + (w === 0 ? ' hidden="1"' : '') + '/>'; }).join('');
    var fr = opts.freeze;
    var pane = fr ? '<pane xSplit="' + fr.col + '" ySplit="' + fr.row + '" topLeftCell="' + colName(fr.col) + (fr.row + 1) + '" activePane="bottomRight" state="frozen"/>' : '';
    var dv = '';
    if (opts.lists && opts.lists.length) {
      dv = '<dataValidations count="' + opts.lists.length + '">' + opts.lists.map(function (l) {
        return '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="' + l.ref + '"><formula1>"' + xe(l.items.join(',')) + '"</formula1></dataValidation>';
      }).join('') + '</dataValidations>';
    }
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' + pane + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>' +
      '<cols>' + cols + '</cols><sheetData>' + sd + '</sheetData>' + dv + '</worksheet>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><sz val="8"/><color rgb="FF999999"/><name val="Calibri"/></font>' +
      '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts>' +
      '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2B59C3"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFB"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFBE6"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFCCD3DE"/></left><right style="thin"><color rgb="FFCCD3DE"/></right><top style="thin"><color rgb="FFCCD3DE"/></top><bottom style="thin"><color rgb="FFCCD3DE"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>';
    var enc = new TextEncoder();
    var files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xe(opts.sheet || 'Данные') + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles],
      ['xl/worksheets/sheet1.xml', sheet]
    ];
    return Zip.write(files.map(function (f) { return { name: f[0], data: enc.encode(f[1]) }; }));
  }

  /** @returns {Promise<{cells:Object<string,string>, rows:number, cols:number}>} ячейки первого листа: «B5» → текст */
  function read(buf) {
    return Zip.read(buf).then(function (entries) {
      var dec = new TextDecoder('utf-8');
      function get(name) { var e = entries.filter(function (x) { return x.name === name; })[0]; return e ? dec.decode(e.data) : null; }
      var wb = get('xl/workbook.xml');
      if (!wb) throw new Error('Это не Excel-файл (.xlsx).');
      var sheetPath = 'xl/worksheets/sheet1.xml';
      var rels = get('xl/_rels/workbook.xml.rels'), rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
      if (rels && rid) {
        var rm = new RegExp('<Relationship\\b[^>]*Id="' + rid[1] + '"[^>]*>').exec(rels);
        var tm = rm && /Target="([^"]+)"/.exec(rm[0]);
        if (tm) sheetPath = 'xl/' + tm[1].replace(/^\/?xl\//, '').replace(/^\//, '');
      }
      var sx = get(sheetPath);
      if (!sx) throw new Error('В файле нет листа с данными.');
      var shared = [];
      var ss = get('xl/sharedStrings.xml');
      if (ss) {
        var sdoc = new DOMParser().parseFromString(ss, 'application/xml');
        Array.prototype.forEach.call(sdoc.getElementsByTagName('si'), function (si) {
          var t = '';
          Array.prototype.forEach.call(si.getElementsByTagName('t'), function (x) { if (!x.parentNode || x.parentNode.localName !== 'rPh') t += x.textContent; });
          shared.push(t);
        });
      }
      var doc = new DOMParser().parseFromString(sx, 'application/xml');
      var cells = {}, maxR = 0, maxC = 0;
      Array.prototype.forEach.call(doc.getElementsByTagName('c'), function (c) {
        var ref = c.getAttribute('r'), t = c.getAttribute('t'), v = '';
        var vv = c.getElementsByTagName('v')[0], is = c.getElementsByTagName('is')[0];
        if (t === 's' && vv) v = shared[+vv.textContent] || '';
        else if (t === 'inlineStr' && is) v = Array.prototype.map.call(is.getElementsByTagName('t'), function (x) { return x.textContent; }).join('');
        else if (vv) v = vv.textContent;
        if (v === '') return;
        cells[ref] = v;
        var m = /^([A-Z]+)(\d+)$/.exec(ref);
        if (m) { maxC = Math.max(maxC, colIndex(m[1]) + 1); maxR = Math.max(maxR, +m[2]); }
      });
      return { cells: cells, rows: maxR, cols: maxC };
    });
  }

  g.Xlsx = { write: write, read: read, colName: colName, colIndex: colIndex };
})(window);
