'use strict';

/*
    Приложения тома — единым счётом.

    Раньше номер приложения вписывали руками в каждом расчёте, и в томе легко
    было получить два приложения с одним номером. Теперь номера раздаются сами
    и подряд, от первого номера, заданного в записке:

        сначала насосное оборудование — по каждой насосной (или системе, если
        она сама по себе): основная установка, за ней жокей-насос, если он у
        этой насосной есть;

        дальше расчёты — АПТ по плану, стояк ВПВ, у АПТ по этажам свой лист на
        каждый план этажа, в порядке систем книги.

    Насосная, которой нужен напор, обязана иметь каталожный лист: приложение ей
    заводится сразу, даже если лист ещё не загружен, — тогда программа ставит
    замечание, а не сдвигает номера задним числом.

    Жокей-насос есть не у всех: он включается галочкой у насосной или у системы
    (поле jockey), и своё приложение получает только тогда.
*/

var Appendix = (function () {

    function rowOf(list, id, role) {
        for (var i = 0; i < (list || []).length; i++) {
            if (list[i].id === id && (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    /** Жокей у этой насосной (или системы вне насосных) — по галочке. */
    function jockeyOn(owner) {
        var holder = owner.kind === 'station' ? owner.station : owner.sys;
        return !holder || holder.jockey !== false;
    }

    function startNo(book) {
        var t = book && book.text;
        var n = t && t.appendixStart !== undefined ? Number(t.appendixStart) : 1;
        return Math.max(1, Math.round(n > 0 ? n : 1));
    }

    function pumpTitle(role, row, who) {
        var what = role === 'jockey' ? 'Каталожный лист жокей-насоса' : 'Каталожный лист насосной установки';
        var mark = row && row.name ? row.name : '';
        return what + (mark ? ' ' + mark : '') + (who ? (mark ? ' — ' : ' ') + who : '');
    }

    function build(book, data) {
        var pumps = (book.text && book.text.pumps) || [];
        var out = [];
        var no = startNo(book);

        function put(entry) {
            entry.no = no++;
            out.push(entry);
        }

        /* --- насосное оборудование ------------------------------------------ */
        Tch.owners(data).forEach(function (owner) {
            var id = owner.sys.id;
            var need = Tch.pumpNeed(owner);
            var who = owner.sys.code + (need.zone ? ', ' + need.zone : '');
            var main = rowOf(pumps, id, 'main');
            var jockey = rowOf(pumps, id, 'jockey');

            // Насосная нужна — приложение заводится даже без загруженного листа.
            if (need.H > 0 || (main && (main.name || main.sheet))) {
                put({
                    key: 'pump:' + id, kind: 'pump', owner: id, role: 'main',
                    who: who, code: owner.sys.code,
                    title: pumpTitle('main', main, who),
                    sheet: main && main.sheet ? main.sheet : '',
                    ready: !!(main && (main.name || main.sheet))
                });
            }

            if (jockeyOn(owner) && (need.H > 0 || (jockey && (jockey.name || jockey.sheet)))) {
                put({
                    key: 'jockey:' + id, kind: 'jockey', owner: id, role: 'jockey',
                    who: who, code: owner.sys.code,
                    title: pumpTitle('jockey', jockey, who),
                    sheet: jockey && jockey.sheet ? jockey.sheet : '',
                    ready: !!(jockey && (jockey.name || jockey.sheet))
                });
            }
        });

        /* --- расчёты --------------------------------------------------------- */
        book.systems.forEach(function (s) {
            if (s.kind === 'apt' || s.kind === 'vpvplan') {
                put({
                    key: 'apt:' + s.id, kind: 'calc', sys: s.id, code: s.code, ready: true,
                    title: 'Расчёт требуемого напора системы ' + s.code
                });
            } else if (s.kind === 'vpv') {
                put({
                    key: 'vpv:' + s.id, kind: 'calc', sys: s.id, code: s.code, ready: true,
                    title: 'Расчёт требуемого напора системы ' + s.code
                });
            } else if (s.floors) {
                s.floors.plans.forEach(function (p) {
                    put({
                        key: 'plan:' + s.id + ':' + p.id, kind: 'calc', sys: s.id, code: s.code, ready: true,
                        title: 'Расчёт требуемого напора системы ' + s.code + ' — план «' + p.name + '»'
                    });
                });
            }
        });

        return out;
    }

    /**
     * Приложения книги по порядку. data — готовый Tch.systems, если он уже
     * посчитан: иначе системы решаются заново, чтобы знать, нужна ли насосная.
     */
    function list(book, data) {
        if (!book || !book.systems) return [];
        return build(book, data || Tch.systems(book));
    }

    /** Номера по ключам: 'apt:s1', 'vpv:s2', 'plan:s3:p1', 'pump:s1', 'jockey:s1'. */
    function numbers(book, data) {
        var map = {};
        list(book, data).forEach(function (e) { map[e.key] = e.no; });
        return map;
    }

    function of(book, key, data) {
        var map = numbers(book, data);
        return map[key] === undefined ? '' : String(map[key]);
    }

    /** Номер расчёта системы: у АПТ по этажам — номер первого плана. */
    function ofSystem(book, sysId, data) {
        var found = '';
        list(book, data).forEach(function (e) {
            if (found || e.kind !== 'calc' || e.sys !== sysId) return;
            found = String(e.no);
        });
        return found;
    }

    /** Ключ рабочего места: план этажа — свой, иначе расчёт системы. */
    function keyOf(book, sys, plan) {
        if (!sys) return '';
        if (sys.kind === 'floors') {
            // У системы по этажам приложение на каждый план; без плана — первый.
            var id = plan || (sys.floors.plans[0] && sys.floors.plans[0].id);
            return id ? 'plan:' + sys.id + ':' + id : '';
        }
        return (sys.kind === 'vpv' ? 'vpv:' : 'apt:') + sys.id;
    }

    /** Чего не хватает: насосная без каталожного листа. */
    function warnings(book, data) {
        return list(book, data).filter(function (e) {
            return (e.kind === 'pump' || e.kind === 'jockey') && !e.ready;
        }).map(function (e) {
            return 'Приложение ' + e.no + ': каталожный лист '
                + (e.kind === 'jockey' ? 'жокей-насоса ' : 'насосной установки ') + e.who
                + ' не загружен — окно «Насосы…».';
        });
    }

    return {
        list: list,
        numbers: numbers,
        of: of,
        ofSystem: ofSystem,
        keyOf: keyOf,
        warnings: warnings,
        jockeyOn: jockeyOn
    };
})();
