/*
    Вкладка «Гидравлика» → «Просмотр записки»: текстовая часть ИОС2 в том виде, как она уйдёт в Word.

    Лист строится из тех же блоков, что и выгрузка (HydNote.build), поэтому на экране и в файле одно
    и то же. Жёлтые места — то, что не заполнено на вкладке «Данные записки»; щелчок по ним ведёт
    туда. Слева — оглавление по разделам А–Т7 и приложениям.
*/

var UiHydPreview = (function () {
    'use strict';

    var esc = Format.html;
    var body, state;

    function init(b, s) { body = b; state = s; }

    function hyd() { return App.project.hyd; }

    /* Текст абзаца: экранирование и жёлтые пометки. */
    function text(value) {
        return String(value === null || value === undefined ? '' : value).split(/(\[\[[^\]]*\]\])/).map(function (part) {
            var m = /^\[\[([^\]]*)\]\]$/.exec(part);
            return m ? '<mark data-np="note" title="Не заполнено — открыть «Данные записки»">[' + esc(m[1]) + ']</mark>' : esc(part);
        }).join('');
    }

    function cell(v, digits, align) {
        var numeric = typeof v === 'number' && isFinite(v);
        var shown = numeric ? Format.num(v, digits) : text(v);
        var cls = align ? (align === 'center' ? 'c' : '') : (numeric ? 'c' : '');
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + shown + '</td>';
    }

    function digitsOf(block, i) {
        if (block.digits === undefined || block.digits === null) return undefined;
        if (Object.prototype.toString.call(block.digits) === '[object Array]') return block.digits[i] === null ? undefined : block.digits[i];
        return block.digits;
    }

    function table(b) {
        var out = ['<table>'];
        var count = Math.max((b.head || []).length, b.rows.length ? b.rows[0].length : 0);

        if (b.headRows) {
            b.headRows.forEach(function (row) {
                out.push('<tr>' + row.map(function (c) {
                    return '<th' + (c.span > 1 ? ' colspan="' + c.span + '"' : '') + (c.rows > 1 ? ' rowspan="' + c.rows + '"' : '') + '>' + text(c.t) + '</th>';
                }).join('') + '</tr>');
            });
        } else if (b.head) {
            out.push('<tr>' + b.head.map(function (t) { return '<th>' + text(String(t).replace(/\n/g, ' ')) + '</th>'; }).join('') + '</tr>');
        }

        b.rows.forEach(function (row, r) {
            var strong = (b.total !== undefined && r >= b.total) || (b.bold && b.bold.indexOf(r) >= 0);
            var cells = '';
            for (var i = 0; i < count; i++) cells += cell(row[i], digitsOf(b, i), b.aligns ? b.aligns[i] : undefined);
            out.push('<tr' + (strong ? ' class="b"' : '') + '>' + cells + '</tr>');
        });

        out.push('</table>');
        return out.join('');
    }

    function render(blocks) {
        var toc = [];
        var html = [];
        var n = 0;

        blocks.forEach(function (b) {
            if (b.kind === 'heading') {
                var id = 'np' + (n++);
                var short = b.text.length > 60 ? b.text.slice(0, 58) + '…' : b.text;
                toc.push('<a data-np-go="' + id + '" title="' + esc(b.text) + '">' + esc(short) + '</a>');
                html.push('<h3 id="' + id + '">' + text(b.text) + '</h3>');
            } else if (b.kind === 'sub') html.push('<h4>' + text(b.text) + '</h4>');
            else if (b.kind === 'para') html.push('<p>' + text(b.text) + '</p>');
            else if (b.kind === 'item') html.push('<p class="item">' + text(b.text) + '</p>');
            else if (b.kind === 'title') html.push('<div class="np-title">' + text(b.text) + '</div>');
            else if (b.kind === 'note') html.push('<p class="np-note">' + text(b.text) + '</p>');
            else if (b.kind === 'mono') html.push('<pre>' + esc(b.text) + '</pre>');
            else if (b.kind === 'table') html.push(table(b));
            else if (b.kind === 'break') html.push('<hr class="np-break">');
        });

        return { toc: toc.join(''), html: html.join('') };
    }

    function show(res) {
        if (!res || !res.input) { body.innerHTML = '<div class="card"><p class="hint">Записка строится по расчёту гидравлики: на схеме нужен ввод и стояки.</p></div>'; return; }

        var out;
        try { out = HydNote.build(App.project, res, hyd()); } catch (e) { body.innerHTML = '<div class="card"><div class="verdict fail">' + esc(e.message) + '</div></div>'; return; }

        var r = render(out.blocks);

        body.innerHTML = '<div class="card"><div class="ctitle"><b>Просмотр записки — текстовая часть ИОС2</b><span class="no-print">'
            + '<button type="button" class="small" data-np="data">Данные записки</button> '
            + '<button type="button" class="small" data-np="word">Записка ИОС2 (Word)</button></span></div>'
            + '<p class="hint">Так записка уйдёт в Word. <mark style="background:#ffe94d">Жёлтое</mark> — не заполнено; щелчок по нему открывает «Данные записки». '
            + (out.marks ? 'Пометок в тексте: ' + out.marks + '.' : 'Пометок в тексте нет.') + '</p></div>'
            + '<div class="np-wrap"><div class="np-toc no-print"><b>Содержание</b>' + r.toc + '</div><div class="np-paper">' + r.html + '</div></div>';
    }

    function onClick(e) {
        var go = e.target.closest('[data-np-go]');
        if (go) {
            var el = document.getElementById(go.getAttribute('data-np-go'));
            if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return true;
        }

        var b = e.target.closest('[data-np]');
        if (!b) return false;
        var act = b.getAttribute('data-np');

        if (act === 'note' || act === 'data') { state.sub = 'note'; UiHyd.renderBody(); }
        else if (act === 'word') {
            var t = document.getElementById('hydHist');
            try {
                var out = HydNote.save(App.project, UiHyd.result, hyd());
                if (t) t.textContent = 'Записка выгружена; пометок в тексте: ' + out.marks;
            } catch (error) { if (t) t.textContent = 'Записка не выгружена: ' + error.message; }
        }
        return true;
    }

    return { init: init, show: show, onClick: onClick, render: render };
})();
