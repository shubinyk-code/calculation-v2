/*
    Пакет приложений записки: каталожные листы насосов и расчёты — с теми же номерами, что в записке.

    Номера приложений даёт сама записка (HydNote.build → context: баланс, расходы, счётчики, расчёты
    зон, каталожные листы), поэтому в перечне приложений и на листах они совпадают. Как в SprinklerWeb:

        каталожные листы   загруженные PDF складываются в один файл (PdfWrite.merge), на каждой
                           странице справа вверху штамп «Приложение N»;
        расчёты            приложения 2…N (баланс, расходы, счётчики, гидравлический расчёт зон)
                           идут на печать листами; в окне печати «Сохранить как PDF», каждый лист
                           со штампом «Приложение N».

    Байты PDF хранятся в проекте (`pumpSel[id].data`, base64) — без них штамп поставить нельзя.
*/

var HydPackage = (function () {
    'use strict';

    /* Блоки приложений из записки: { no, blocks }, по порядку; первый кусок (перечень) пропускается. */
    function appendixBlocks(blocks) {
        var start = -1;
        blocks.forEach(function (b, i) { if (start < 0 && b.kind === 'heading' && /^ПРИЛАГАЕМЫЕ ДОКУМЕНТЫ/.test(b.text)) start = i; });
        if (start < 0) return [];

        var out = [];
        var cur = null;

        blocks.slice(start + 1).forEach(function (b) {
            if (b.kind === 'break') { cur = null; return; }
            var m = b.kind === 'heading' ? /^Приложение № (\d+)\./.exec(b.text) : null;
            if (m) { cur = { no: Number(m[1]), blocks: [] }; out.push(cur); }
            if (cur) cur.blocks.push(b);
        });

        return out;
    }

    /*
        Каталожные листы: PDF со штампами. Возвращает Promise<{ bytes, count, missing }>;
        missing — зоны, у которых нет сохранённого файла листа (подбор введён руками или лист
        загружен до того, как программа стала хранить файлы).
    */
    function sheetsPdf(project, result, hyd, options) {
        var out = HydNote.build(project, result, hyd);
        var items = [];
        var missing = [];

        out.context.zones.forEach(function (z) {
            var sel = hyd.pumpSel[z.sys.id];
            if (sel && sel.data) items.push({ bytes: Zip.fromBase64(sel.data), stamp: 'Приложение ' + z.appCat, no: z.appCat });
            else missing.push(z.sys.name + (sel && sel.name ? ' (' + sel.name + ')' : ''));
        });

        items.sort(function (a, b) { return a.no - b.no; });

        if (!items.length) return Promise.resolve({ bytes: null, count: 0, missing: missing });

        return PdfWrite.merge(items, options || {}).then(function (bytes) {
            return { bytes: bytes, count: items.length, missing: missing };
        });
    }

    function fileName(project, hyd, tail) {
        var base = (hyd.survey.objectName || (project.object && project.object.name) || 'Объект').replace(/[\\\/:*?"<>|]/g, '-');
        return base + ' — ' + tail;
    }

    /* Листы расчётов для печати: по приложению на страницу, штамп справа вверху. */
    function calcHtml(project, result, hyd) {
        var out = HydNote.build(project, result, hyd);
        var list = appendixBlocks(out.blocks);
        var esc = Format.html;

        return {
            count: list.length,
            html: list.map(function (a) {
                return '<div class="pk-page"><div class="pk-stamp">Приложение ' + a.no + '</div><div class="np-paper">'
                    + UiHydPreview.render(a.blocks).html + '</div></div>';
            }).join('')
        };
    }

    return { appendixBlocks: appendixBlocks, sheetsPdf: sheetsPdf, calcHtml: calcHtml, fileName: fileName };
})();
