'use strict';

/*
    Рабочее место «Принципиальная схема».

    Лист рисуется теми же примитивами, что уходят в AutoCAD: сначала Scheme
    собирает описание, потом одно и то же описание превращается в SVG на
    экране и в DXF в файле. Рисовать схему дважды — верный способ получить
    два разных чертежа, поэтому рисовалка здесь ровно одна.

    SVG, а не холст: лист получается векторным, печать и «Сохранить в PDF»
    работают сами собой, а масштаб меняется кнопками без перерисовки.
*/

var SchemeUI = (function () {

    var zoom = null;        // null — вписать лист в панель при первом показе
    var last = null;

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }

    /* --- SVG из примитивов канона ------------------------------------------- */

    /*
        Ось Y на чертеже смотрит вверх, в SVG — вниз. Поэтому рисуем в системе
        чертежа, а переворачиваем одной матрицей на всю картинку: так числа в
        описании листа совпадают с тем, что уйдёт в DXF.
    */
    function colorOf(book, layer) {
        var all = Canon.layers(book);
        for (var i = 0; i < all.length; i++) {
            if (all[i].name === layer) return all[i].color;
        }
        return '#1B2A38';
    }

    function weightOf(book, layer) {
        var all = Canon.layers(book);
        for (var i = 0; i < all.length; i++) {
            if (all[i].name === layer) return (all[i].weight || 25) / 100;
        }
        return 0.25;
    }

    function shape(e, color, width, out) {
        if (e.t === 'l') {
            out.push('<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2
                + '" stroke="' + color + '" stroke-width="' + width + '"/>');
        } else if (e.t === 'pl') {
            var pts = [];
            for (var i = 0; i < e.v.length; i += 2) pts.push(e.v[i] + ',' + e.v[i + 1]);
            out.push('<' + (e.closed ? 'polygon' : 'polyline') + ' points="' + pts.join(' ')
                + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/>');
        } else if (e.t === 'c') {
            out.push('<circle cx="' + e.x + '" cy="' + e.y + '" r="' + e.r
                + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/>');
        } else if (e.t === 'a') {
            out.push(arcPath(e, color, width));
        } else if (e.t === 's') {
            var p = [];
            for (var j = 0; j < e.v.length; j += 2) p.push(e.v[j] + ',' + e.v[j + 1]);
            out.push('<polygon points="' + p.join(' ') + '" fill="' + color + '"/>');
        }
    }

    function arcPath(e, color, width) {
        var a0 = e.a0 * Math.PI / 180;
        var a1 = e.a1 * Math.PI / 180;
        var sweep = e.a1 - e.a0;
        while (sweep < 0) sweep += 360;

        var x0 = e.x + e.r * Math.cos(a0), y0 = e.y + e.r * Math.sin(a0);
        var x1 = e.x + e.r * Math.cos(a1), y1 = e.y + e.r * Math.sin(a1);

        return '<path d="M ' + x0 + ' ' + y0 + ' A ' + e.r + ' ' + e.r + ' 0 '
            + (sweep > 180 ? 1 : 0) + ' 1 ' + x1 + ' ' + y1
            + '" fill="none" stroke="' + color + '" stroke-width="' + width + '"/>';
    }

    /** Надпись: в SVG ось Y перевёрнута, поэтому текст разворачивается обратно. */
    function label(x, y, h, text, color, align, rot) {
        var anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
        return '<text x="0" y="0" transform="translate(' + x + ',' + y + ') scale(1,-1)'
            + (rot ? ' rotate(' + (-rot) + ')' : '') + '" font-size="' + h
            + '" fill="' + color + '" text-anchor="' + anchor + '"'
            + ' font-family="Arial, sans-serif">' + esc(text) + '</text>';
    }

    /** Вставка условного знака: геометрия блока с поворотом и масштабом. */
    function insert(book, e, out) {
        var block = Canon.block(e.name);
        if (!block) return;

        var color = colorOf(book, e.layer);
        var width = weightOf(book, e.layer) * 100;
        var scale = e.scale === undefined ? Canon.BLOCK_SCALE : e.scale;
        var inner = [];

        (block.ents || []).forEach(function (g) { shape(g, color, width / scale, inner); });

        (block.attrs || []).forEach(function (a) {
            var value = (e.attrs || {})[a.tag];
            if (value === undefined || value === '') return;
            inner.push(label(a.x, a.y, a.h, value, color, a.align, 0));
        });

        out.push('<g transform="translate(' + e.x + ',' + e.y + ')'
            + (e.rot ? ' rotate(' + e.rot + ')' : '') + ' scale(' + scale + ')">' + inner.join('') + '</g>');
    }

    function svg(book, sheet) {
        var out = [];
        var pad = 2000;
        var box = sheet.box || DxfWrite.bounds(sheet.ents);

        sheet.ents.forEach(function (e) {
            var color = colorOf(book, e.layer);
            var width = weightOf(book, e.layer) * 100;

            if (e.t === 'ins') insert(book, e, out);
            else if (e.t === 'txt') out.push(label(e.x, e.y, e.h, e.s, color, e.align, e.rot));
            else shape(e, color, width, out);
        });

        var w = box.x1 - box.x0 + pad * 2;
        var h = box.y1 - box.y0 + pad * 2;
        var mm = Canon.SCALE;      // 1 мм бумаги = 100 мм чертежа

        return '<svg xmlns="http://www.w3.org/2000/svg" class="sch-sheet"'
            + ' width="' + (w / mm * zoom).toFixed(1) + 'mm" height="' + (h / mm * zoom).toFixed(1) + 'mm"'
            + ' viewBox="' + (box.x0 - pad) + ' ' + (-box.y1 - pad) + ' ' + w + ' ' + h + '">'
            + '<g transform="scale(1,-1)">' + out.join('') + '</g></svg>';
    }

    /* --- форма --------------------------------------------------------------- */

    function form(book, sheet) {
        var owners = sheet.owners;
        var html = '<h3>Лист «Насосная станция»</h3>';

        html += '<div class="inspector">'
            + '<div class="row"><span>Модулей на листе</span><b>' + owners + '</b></div>'
            + '<div class="row"><span>Размер листа</span><b>' + Fmt.num(sheet.width / Canon.SCALE, 0)
            + ' × ' + Fmt.num(sheet.height / Canon.SCALE, 0) + ' мм</b></div>'
            + '<div class="row"><span>Масштаб</span><b>1 : ' + Canon.SCALE + '</b></div>'
            + '</div>';

        html += '<p class="hint">Лист собирается из расчёта: насосная добавилась в окне «Системы…» — '
            + 'на листе появился модуль, убралась — исчез. Подача и напор берутся из насосной, '
            + 'марки — из каталожных листов, диаметры и расходы стояков — из расчётов систем.</p>';

        html += '<p class="hint">Цвета и слои — канонные (окно «Системы…», столбец «Цвет и слой»). '
            + 'В DXF уходят те же примитивы, что видно здесь: условные знаки вставками блоков '
            + '<b>ВК_*</b> с атрибутами, так что в AutoCAD они подменятся вашими.</p>';

        if (!owners) {
            html += '<p class="note-warn">Насосные установки не требуются: ни одной системе не нужен напор. '
                + 'Проверьте гарантированный напор и расчёты.</p>';
        }

        return html;
    }

    /* --- рабочее место ------------------------------------------------------- */

    /** Вписать лист в панель: 1 мм бумаги — 96/25,4 экранных точек. */
    function fitZoom(sheet) {
        var box = $('schPreview').clientWidth || 900;
        var mm = (sheet.width + 4000) / Canon.SCALE;
        return Math.max(0.15, Math.min(2, (box - 40) / (mm * 96 / 25.4)));
    }

    function refresh() {
        var book = App.book;
        if (!book) return;

        last = Scheme.station(book);
        if (zoom === null) zoom = fitZoom(last);
        $('schForm').innerHTML = form(book, last);
        $('schPreview').innerHTML = svg(book, last);
        $('schInfo').textContent = 'лист ' + Fmt.num(last.width / Canon.SCALE, 0) + ' × '
            + Fmt.num(last.height / Canon.SCALE, 0) + ' мм, 1:' + Canon.SCALE + ', масштаб показа '
            + Math.round(zoom * 100) + ' %';
    }

    function exportDxf() {
        var book = App.book;
        if (!last) refresh();

        var text = DxfWrite.build({
            layers: Canon.layers(book),
            blocks: Canon.BLOCKS,
            entities: last.ents,
            box: last.box
        });

        DxfWrite.save(text, Storage.safeName(book.object.name, ' — схема насосной станции.dxf'));
        App.status('Схема выгружена в DXF. Вставляйте её в свой чертёж — одноимённые блоки ВК_* '
            + 'подменятся вашими, слои придут с цветами систем.', 'done');
    }

    function print() {
        var area = document.getElementById('printArea');
        area.innerHTML = '<div class="report sch-print">' + svg(App.book, last || Scheme.station(App.book)) + '</div>';
        App.print();
    }

    function action(name) {
        if (name === 'sch-dxf') exportDxf();
        else if (name === 'sch-print') print();
        else if (name === 'sch-zoom-in') { zoom = Math.min(4, zoom * 1.25); refresh(); }
        else if (name === 'sch-zoom-out') { zoom = Math.max(0.25, zoom / 1.25); refresh(); }
    }

    function init() {
        document.getElementById('schMain').addEventListener('click', function (e) {
            var button = e.target.closest('[data-action]');
            if (button) action(button.dataset.action);
        });
    }

    return {
        init: init,
        refresh: refresh,
        svg: svg,
        last: function () { return last; }
    };
})();
