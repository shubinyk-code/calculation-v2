'use strict';

/*
    Принципиальная схема противопожарного водоснабжения — лист «Насосная
    станция», собранный из расчёта.

    Лист повторяет рабочий чертёж: слева вводы в здание с водомерным узлом,
    от них всасывающая магистраль В2 идёт вдоль всего помещения насосной; в
    самом помещении стоят группы насосных установок — по группе на насосную,
    в каждой рабочий и резервный насос и жокей-насос со своим мембранным
    баком; над группой напорный коллектор, из него гребёнкой вверх уходят
    стояки систем — задвижка, узел управления, марка системы и выноска с
    диаметром и расчётным расходом.

    Насосная добавилась или убралась — ряд пересобрался, помещение стало
    шире или уже. Ничего не двигают руками: координаты считаются от размеров
    группы.

    Все числа берутся из расчёта: подача и напор — из насосной (Stations),
    марки — из каталожных листов, диаметры и расходы стояков — из решателей
    ВПВ и АПТ. Единицы — миллиметры натуры, лист 1:100, как в каноне.
*/

var Scheme = (function () {

    /* --- размеры листа ------------------------------------------------------ */

    var M = {
        roomY: 0,               // пол насосной
        roomTop: 8500,          // верх помещения
        mainY: 1800,            // всасывающая магистраль В2
        pumpY: 4600,            // ось насосов
        headerY: 7200,          // напорный коллектор группы

        inletStep: 2800,        // между нитками ввода
        inletRun: 7000,         // длина ввода до помещения

        groupX: 9000,           // левый край первой группы
        groupGap: 2600,         // просвет между группами
        groupW: 9000,           // группа без стояков
        riserStep: 1800,        // шаг стояков в гребёнке

        valveY: 8600,           // задвижка на стояке
        cuY: 10600,             // узел управления
        markY: 13200,           // марка системы
        labelY: 15200,          // полка выноски

        legendY: -3000          // условные обозначения ниже магистрали
    };

    function n2(v) { return Fmt.num(v, 2); }

    /* --- что выводит насосная ------------------------------------------------ */

    /**
     * Стояк системы: обозначение, диаметр и расчётный расход — то, что стоит
     * над выноской на листе.
     */
    function outlet(item) {
        var sys = item.sys;
        var out = { code: sys.code, dn: '', q: 0, cu: '' };

        if (item.kind === 'vpv') {
            var r = item.res;
            var size = Catalog.find(item.v.riser.material, item.v.riser.od, item.v.riser.wall);
            out.dn = size ? 'Ду' + size.dn : '';
            out.q = r.ok ? r.dict.Q : 0;
        } else if (item.kind === 'floors') {
            var f = item.res;
            var rs = Catalog.find(item.f.riser.material, item.f.riser.od, item.f.riser.wall);
            out.dn = rs ? 'Ду' + rs.dn : '';
            out.q = f.ok ? f.dict.Qr : 0;
            out.cu = item.f.inlet.cuKind + ' Ду' + item.f.inlet.cuDn;
        } else {
            var p = item.sys.project;
            var seg = inletSegment(p);
            var ps = seg ? Catalog.find(seg.material, seg.od, seg.wall) : null;
            out.dn = ps ? 'Ду' + ps.dn : '';
            out.q = item.calc && item.calc.ok ? item.calc.head.Q : 0;
            // У внутреннего пожаротушения по плану узла управления нет.
            if (item.kind !== 'vpvplan') out.cu = p.settings.cuKind + ' Ду' + p.settings.cuDn;
        }

        return out;
    }

    /** Посчитанная система книги по её id — из Tch.systems. */
    function itemOf(data, id) {
        for (var i = 0; i < data.all.length; i++) {
            if (data.all[i].sys.id === id) return data.all[i];
        }
        return null;
    }

    /** Участок, которым система приходит на ввод: по нему и диаметр стояка. */
    function inletSegment(p) {
        var src = p.nodes.filter(function (n) { return n.src; })[0];
        if (!src) return null;

        var found = null;
        p.segments.forEach(function (s) {
            if (!found && (s.a === src.id || s.b === src.id)) found = s;
        });
        return found;
    }

    function pumpRow(book, id, role) {
        var list = (book.text && book.text.pumps) || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id && (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    /** Сколько систем выходит из этой насосной — от этого ширина группы. */
    function itemsOf(data, owner) {
        if (owner.kind !== 'station') return [owner];
        return owner.need.parts.map(function (p) { return itemOf(data, p.sys.id); }).filter(Boolean);
    }

    /** Ширина группы: насосы и жокей плюс место под гребёнку стояков. */
    function groupWidth(items) {
        return M.groupW + Math.max(1, items.length) * M.riserStep;
    }

    /* --- группа насосной ----------------------------------------------------- */

    /**
     * Группа: рабочий и резервный насосы, жокей с баком, напорный коллектор
     * и гребёнка стояков над ним. x — левый край группы.
     */
    function group(book, data, owner, x, width, out) {
        var need = Tch.pumpNeed(owner);
        var main = pumpRow(book, owner.sys.id, 'main');
        var jockey = pumpRow(book, owner.sys.id, 'jockey');
        var delta = (book.text && book.text.jockeyDelta > 0) ? book.text.jockeyDelta : 5;
        var items = itemsOf(data, owner);

        var right = x + width;
        var mark = owner.sys.code + (need.zone && owner.sys.code.indexOf(need.zone) < 0 ? ' (' + need.zone + ')' : '');

        /* Рамка насосной установки: в неё входят оба насоса с обвязкой. */
        out.push({ t: 'pl', closed: true, layer: 'ВК_Оси',
            v: [x + 1000, M.pumpY - 2000, x + 6200, M.pumpY - 2000, x + 6200, M.pumpY + 2600, x + 1000, M.pumpY + 2600] });

        /* Насосы: рабочий и резервный, каждый со своей обвязкой. */
        [0, 1].forEach(function (k) {
            var px = x + 2200 + k * 2800;

            out.push({ t: 'l', x1: px, y1: M.mainY, x2: px, y2: M.pumpY - 600, layer: 'ВК_В2' });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА', x: px, y: M.mainY + 900, rot: 90, layer: 'ВК_Арматура' });

            out.push({ t: 'ins', name: 'ВК_НАСОС', x: px, y: M.pumpY, layer: 'ВК_Оборудование',
                attrs: k === 0 ? {
                    'МАРКА': (main && main.name) || 'насосная установка',
                    'Q': 'Q = ' + n2(need.Q) + ' л/с',
                    'H': 'H = ' + n2(need.H) + ' м'
                } : {} });

            out.push({ t: 'l', x1: px, y1: M.pumpY + 600, x2: px, y2: M.headerY, layer: 'ВК_В2' });
            out.push({ t: 'ins', name: 'ВК_КЛАПАН_ОБРАТНЫЙ', x: px, y: M.pumpY + 1200, rot: 90, layer: 'ВК_Арматура' });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА', x: px, y: M.pumpY + 2200, rot: 90, layer: 'ВК_Арматура' });
        });

        out.push({ t: 'txt', x: x + 3600, y: M.pumpY - 2400, h: Canon.TEXT.small, layer: 'ВК_Текст',
            s: '1 раб., 1 рез.' });

        /* Жокей-насос с мембранным баком — там, где он включён. */
        if (Appendix.jockeyOn(owner) && need.H > 0) {
            var jx = x + 7600;

            out.push({ t: 'pl', closed: true, layer: 'ВК_Оси',
                v: [jx - 1300, M.pumpY - 1800, jx + 1900, M.pumpY - 1800, jx + 1900, M.pumpY + 1800, jx - 1300, M.pumpY + 1800] });
            out.push({ t: 'l', x1: jx, y1: M.mainY, x2: jx, y2: M.pumpY - 400, layer: 'ВК_В2' });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА', x: jx, y: M.mainY + 900, rot: 90, layer: 'ВК_Арматура' });
            out.push({ t: 'ins', name: 'ВК_ЖОКЕЙ', x: jx, y: M.pumpY, layer: 'ВК_Оборудование',
                attrs: {
                    'МАРКА': (jockey && jockey.name) || 'жокей-насос',
                    'Q': 'Q = 1 м³/ч',
                    // Напор самого жокея: на запас выше основной установки.
                    'H': 'H = ' + n2(need.H + delta) + ' м'
                } });
            out.push({ t: 'l', x1: jx, y1: M.pumpY + 400, x2: jx, y2: M.headerY, layer: 'ВК_В2' });
            out.push({ t: 'ins', name: 'ВК_БАК_МЕМБРАННЫЙ', x: jx + 1400, y: M.pumpY + 200, layer: 'ВК_Оборудование',
                attrs: { 'V': Fmt.trim((book.text && book.text.jockeyMembrane) || 40, 0) + ' л' } });
        }

        /* Напорный коллектор группы и слив после испытаний. */
        out.push({ t: 'l', x1: x + 1400, y1: M.headerY, x2: right - 1000, y2: M.headerY, layer: 'ВК_В2' });
        out.push({ t: 'l', x1: right - 1000, y1: M.headerY, x2: right - 1000, y2: M.mainY + 700, layer: 'ВК_В2' });
        out.push({ t: 'ins', name: 'ВК_КРАН_СЛИВНОЙ', x: right - 1000, y: M.mainY + 1600, rot: 90, layer: 'ВК_Арматура' });
        out.push({ t: 'txt', x: right - 800, y: M.mainY + 1500, h: 200, align: 'left', layer: 'ВК_Легенда',
            s: 'слив после' });
        out.push({ t: 'txt', x: right - 800, y: M.mainY + 1200, h: 200, align: 'left', layer: 'ВК_Легенда',
            s: 'испытаний' });

        /* Подпись группы — короткой выноской вниз, под помещение насосной. */
        out.push({ t: 'l', x1: x + 3600, y1: M.pumpY - 2000, x2: x + 3600, y2: M.legendY + 900, layer: 'ВК_Выноски' });
        out.push({ t: 'txt', x: x + 3600, y: M.legendY + 500, h: Canon.TEXT.small, layer: 'ВК_Текст', s: mark });
        out.push({ t: 'txt', x: x + 3600, y: M.legendY + 100, h: Canon.TEXT.small, layer: 'ВК_Текст',
            s: 'Q = ' + n2(need.Q) + ' л/с, H = ' + n2(need.H) + ' м' });

        /* Гребёнка стояков: задвижка, узел управления, марка, выноска. */
        items.forEach(function (item, i) {
            var o = outlet(item);
            var rx = x + 1800 + i * M.riserStep;
            var layer = Canon.layerOf(item.sys);

            out.push({ t: 'l', x1: rx, y1: M.headerY, x2: rx, y2: M.labelY, layer: layer });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА', x: rx, y: M.valveY, rot: 90, layer: 'ВК_Арматура' });

            if (o.cu) {
                out.push({ t: 'ins', name: 'ВК_УЗЕЛ_УПРАВЛЕНИЯ', x: rx, y: M.cuY, layer: 'ВК_Арматура',
                    attrs: { 'МАРКА': o.cu } });
            } else {
                out.push({ t: 'ins', name: 'ВК_СИГНАЛИЗАТОР_ПОТОКА', x: rx, y: M.cuY, layer: 'ВК_Арматура' });
            }

            out.push({ t: 'ins', name: 'ВК_МАРКА_СИСТЕМЫ', x: rx, y: M.markY, rot: 90, layer: layer,
                attrs: { 'КОД': o.code } });
            out.push({ t: 'ins', name: 'ВК_ВЫНОСКА', x: rx, y: M.labelY, layer: 'ВК_Выноски',
                attrs: { 'ДУ': o.dn, 'Q': 'Q = ' + n2(o.q) + ' л/с' } });
        });
    }

    /* --- лист ---------------------------------------------------------------- */

    /** Вводы в здание и всасывающая магистраль вдоль помещения. */
    function inlet(book, width, out) {
        var y = M.mainY;

        [0, 1].forEach(function (i) {
            var iy = i === 0 ? y : y - M.inletStep;
            out.push({ t: 'l', x1: 0, y1: iy, x2: M.inletRun, y2: iy, layer: 'ВК_В2' });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА', x: 1400, y: iy, layer: 'ВК_Арматура' });
            out.push({ t: 'ins', name: 'ВК_СЧЕТЧИК', x: 3000, y: iy, layer: 'ВК_Арматура' });
            out.push({ t: 'ins', name: 'ВК_КЛАПАН_ОБРАТНЫЙ', x: 4600, y: iy, layer: 'ВК_Арматура' });
            out.push({ t: 'ins', name: 'ВК_ЗАДВИЖКА_ЭЛ', x: 6200, y: iy, layer: 'ВК_Арматура' });
            out.push({ t: 'txt', x: 0, y: iy + 400, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Текст',
                s: 'ввод ' + (i + 1) });
        });

        out.push({ t: 'l', x1: M.inletRun, y1: y - M.inletStep, x2: M.inletRun, y2: y, layer: 'ВК_В2' });
        out.push({ t: 'l', x1: M.inletRun, y1: y, x2: width, y2: y, layer: 'ВК_В2' });
        out.push({ t: 'ins', name: 'ВК_МАРКА_СИСТЕМЫ', x: M.inletRun + 1200, y: y, layer: 'ВК_В2',
            attrs: { 'КОД': 'В2' } });
        out.push({ t: 'txt', x: 0, y: y + 1400, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Текст',
            s: 'Нгар = ' + n2(Tch.guaranteed(book).value) + ' м' });
    }

    /** Контур помещения насосной с подписью и отметкой пола. */
    function room(book, left, right, out) {
        out.push({ t: 'pl', closed: true, layer: 'ВК_Рамка',
            v: [left, M.roomY, right, M.roomY, right, M.roomTop, left, M.roomTop] });
        out.push({ t: 'txt', x: left + 400, y: M.roomTop + 400, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Текст',
            s: 'Насосная станция ВПВ и АПТ' });

        var elev = 0;
        book.systems.forEach(function (s) {
            if (!elev && s.vpv) elev = s.vpv.inlet.elev;
            if (!elev && s.floors) elev = s.floors.inlet.elev;
            if (!elev && s.project) elev = s.project.settings.inletElev;
        });

        out.push({ t: 'ins', name: 'ВК_ОТМЕТКА', x: left, y: M.roomY, layer: 'ВК_Отметки',
            attrs: { 'ОТМЕТКА': Fmt.num(elev, 3) } });
    }

    /** Условные обозначения систем под листом. */
    function legend(book, out) {
        var y = M.legendY - 2600;
        out.push({ t: 'txt', x: 0, y: y + 1200, h: Canon.TEXT.normal, align: 'left', layer: 'ВК_Легенда',
            s: 'Условные обозначения' });

        book.systems.forEach(function (s, i) {
            var ly = y - i * 800;
            out.push({ t: 'l', x1: 0, y1: ly, x2: 1600, y2: ly, layer: Canon.layerOf(s) });
            out.push({ t: 'txt', x: 2000, y: ly - 120, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Текст', s: s.code });
            out.push({ t: 'txt', x: 3800, y: ly - 120, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Легенда',
                s: s.title || '' });
        });
    }

    /**
     * Лист «Насосная станция» целиком: вводы, помещение с группами насосных,
     * гребёнка стояков, легенда и заголовок.
     */
    function station(book) {
        var data = Tch.systems(book);
        var owners = Tch.owners(data).filter(function (o) { return Tch.pumpNeed(o).H > 0; });
        var out = [];

        if (!owners.length) {
            return {
                ents: [{ t: 'txt', x: 0, y: 0, h: Canon.TEXT.normal, align: 'left', layer: 'ВК_Текст',
                    s: 'Насосные установки не требуются: гарантированного напора хватает.' }],
                width: 20000, height: 4000, owners: 0
            };
        }

        // Ширина листа — сумма групп: насосная ушла, лист стал уже.
        var widths = owners.map(function (owner) { return groupWidth(itemsOf(data, owner)); });
        var right = M.groupX;
        widths.forEach(function (w) { right += w + M.groupGap; });

        inlet(book, right, out);
        room(book, M.groupX - 1200, right - M.groupGap + 1200, out);

        var x = M.groupX;
        owners.forEach(function (owner, i) {
            group(book, data, owner, x, widths[i], out);
            x += widths[i] + M.groupGap;
        });

        legend(book, out);

        out.push({ t: 'txt', x: 0, y: M.labelY + 3400, h: Canon.TEXT.title, align: 'left', layer: 'ВК_Текст',
            s: 'Принципиальная схема противопожарного водоснабжения. Насосная станция' });
        out.push({ t: 'txt', x: 0, y: M.labelY + 2600, h: Canon.TEXT.small, align: 'left', layer: 'ВК_Легенда',
            s: (book.object.code || '') + (book.object.name ? ' · ' + book.object.name : '') });

        var box = DxfWrite.bounds(out);

        return {
            ents: out,
            box: box,
            width: box.x1 - box.x0,
            height: box.y1 - box.y0,
            owners: owners.length
        };
    }

    return {
        M: M,
        station: station,
        outlet: outlet
    };
})();
