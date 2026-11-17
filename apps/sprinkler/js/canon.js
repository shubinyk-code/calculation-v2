'use strict';

/*
    Канон оформления: системы и их цвета, слои, библиотека условных знаков.

    Один источник правды для экрана, для схемы и для выгрузки в AutoCAD. Цвет
    системы можно поменять в окне «Системы…» — он хранится в книге, а здесь
    лежат значения по умолчанию, чтобы новая система сразу получила свой цвет,
    не совпадающий с соседними.

    Единицы и масштаб. Чертим, как принято в рабочих файлах: координаты —
    миллиметры натуры, лист печатается 1:100. Поэтому текст 2,5 мм на бумаге —
    это 250 единиц, а условный знак рисуется в клетке 800×800 и вставляется с
    коэффициентом 0,5 (на бумаге 4 мм). Та же пара чисел у блоков, выгруженных
    из Revit, — свои блоки подменяются по имени без возни с масштабом.

    Геометрия знаков описана простыми примитивами: отрезок, полилиния, дуга,
    окружность, закраска и подпись-атрибут. Из этого описания рисуется и
    предпросмотр на холсте, и DXF — рисовать одно и то же дважды нельзя.
*/

var Canon = (function () {

    var SCALE = 100;            // лист 1:100
    var BLOCK_SCALE = 0.5;      // коэффициент вставки условного знака
    var BOX = 800;              // клетка знака, мм натуры

    /** Высоты текста: на бумаге 2,5 / 3,5 / 5 мм. */
    var TEXT = { small: 250, normal: 350, title: 500 };

    /*
        Цвета систем. Разведены по смыслу: ВПВ — тёплые (красный ряд), АПТ —
        холодные (синий ряд), противопожарный водопровод — зелёный, системы
        перспективного строительства — серые. Внутри ряда цвета идут по
        порядку систем, чтобы две соседние не оказались одинаковыми: на листе
        у Восточной как раз так и вышло — В24, В2.3 и В2 были тремя зелёными.
    */
    var PALETTE = {
        apt: ['#006EDD', '#00A0A0', '#2E00B8', '#0097E0', '#5B4BC4', '#00787D'],
        floors: ['#006EDD', '#00A0A0', '#2E00B8', '#0097E0', '#5B4BC4', '#00787D'],
        vpv: ['#E00000', '#93278F', '#E06000', '#B03060', '#C21A1A', '#8E2DBE']
    };

    var WATER = '#0F8A20';      // В2 — противопожарный водопровод
    var FUTURE = '#808080';     // перспективное строительство

    /* --- системы ------------------------------------------------------------ */

    /** Цвет системы: свой, если задан, иначе канонный по ряду и порядку. */
    function colorOf(book, sys) {
        return (sys && sys.color) || defaultColor(book, sys);
    }

    /** Порядковый номер системы среди систем своего ряда (ВПВ или АПТ). */
    function indexOf(book, sys) {
        var n = 0;
        var found = -1;

        ((book && book.systems) || []).forEach(function (s) {
            var same = (s.kind === 'vpv') === (sys && sys.kind === 'vpv');
            if (!same) return;
            if (s === sys) found = n;
            n++;
        });

        return found;
    }

    /** Канонный цвет без учёта того, что вписано в книге, — для кнопки «вернуть». */
    function defaultColor(book, sys) {
        var list = PALETTE[sys && sys.kind === 'vpv' ? 'vpv' : 'apt'];
        var index = indexOf(book, sys);
        return list[(index >= 0 ? index : 0) % list.length];
    }

    /** Слой системы: ВК_ и обозначение как есть — ВК_В21, ВК_В2.1. */
    function layerOf(sys) {
        return 'ВК_' + String((sys && sys.code) || 'В2').replace(/\s+/g, '');
    }

    /* --- слои --------------------------------------------------------------- */

    /*
        Служебные слои. Вес линии — в сотых миллиметра, как в DXF: трубы 0,35,
        оборудование 0,25, подписи и выноски 0,18, оси и рамки 0,09.
    */
    var LAYERS = [
        { name: 'ВК_В2', color: WATER, weight: 35, title: 'противопожарный водопровод' },
        { name: 'ВК_Оборудование', color: '#1B2A38', weight: 25, title: 'насосы, баки, рамки узлов' },
        { name: 'ВК_Арматура', color: '#1B2A38', weight: 25, title: 'запорная арматура и приборы' },
        { name: 'ВК_Текст', color: '#1B2A38', weight: 18, title: 'подписи' },
        { name: 'ВК_Выноски', color: '#1B2A38', weight: 18, title: 'выноски и полки' },
        { name: 'ВК_Отметки', color: '#1B2A38', weight: 18, title: 'отметки уровней' },
        { name: 'ВК_Оси', color: '#808080', weight: 9, title: 'сетка этажей и оси', linetype: 'DASHED' },
        { name: 'ВК_Рамка', color: '#808080', weight: 9, title: 'контуры здания и помещений' },
        { name: 'ВК_Легенда', color: '#1B2A38', weight: 18, title: 'условные обозначения и экспликация' }
    ];

    /** Полный список слоёв листа: служебные плюс по слою на каждую систему. */
    function layers(book) {
        var out = [];
        var seen = {};

        ((book && book.systems) || []).forEach(function (s) {
            var name = layerOf(s);
            if (seen[name]) return;
            seen[name] = true;
            out.push({ name: name, color: colorOf(book, s), weight: 35, title: s.code + ' — ' + (s.title || '') });
        });

        LAYERS.forEach(function (l) {
            if (seen[l.name]) return;
            seen[l.name] = true;
            out.push(l);
        });

        return out;
    }

    /* --- библиотека условных знаков ----------------------------------------- */

    /*
        Знаки рисуются в клетке 800×800 с началом координат на оси трубы:
        вставка попадает ровно в точку присоединения, и знак не надо двигать.
        Геометрия лежит на слое 0 цветом «по блоку» — тогда вставка на слой
        системы красит знак в цвет системы, и отдельных блоков на каждый цвет
        не нужно.

        Атрибуты — то, что подставляется из расчёта: диаметр, марка, расход,
        напор. Их не придётся перебивать руками, а в AutoCAD они остаются
        редактируемыми.
    */

    function line(x1, y1, x2, y2) { return { t: 'l', x1: x1, y1: y1, x2: x2, y2: y2 }; }
    function poly(v, closed) { return { t: 'pl', v: v, closed: !!closed }; }
    function circle(x, y, r) { return { t: 'c', x: x, y: y, r: r }; }
    function arc(x, y, r, a0, a1) { return { t: 'a', x: x, y: y, r: r, a0: a0, a1: a1 }; }
    function solid(v) { return { t: 's', v: v }; }

    function attr(tag, dflt, x, y, h, align) {
        return { tag: tag, value: dflt || '', x: x, y: y, h: h || TEXT.small, align: align || 'center' };
    }

    /** Две сходящиеся «галочки» — основа запорной арматуры. */
    function bowtie() {
        return [
            poly([-200, -170, -200, 170, 0, 0], true),
            poly([200, -170, 200, 170, 0, 0], true)
        ];
    }

    var BLOCKS = [
        {
            name: 'ВК_ЗАДВИЖКА', title: 'запорная арматура',
            ents: bowtie(),
            attrs: [attr('ДУ', '', 0, 240, TEXT.small)]
        },
        {
            name: 'ВК_ЗАДВИЖКА_ЭЛ', title: 'запорная арматура с электроприводом',
            ents: bowtie().concat([
                line(0, 0, 0, 230),
                poly([-170, 230, 170, 230, 170, 380, -170, 380], true),
                line(-170, 230, 170, 380),
                line(-170, 380, 170, 230)
            ]),
            attrs: [attr('ДУ', '', 0, 440, TEXT.small)]
        },
        {
            name: 'ВК_ЗАДВИЖКА_КОНТРОЛЬ', title: 'запорная арматура с контролем положения',
            ents: bowtie().concat([
                line(0, 0, 0, 230),
                circle(0, 320, 90),
                line(-64, 256, 64, 384),
                line(-64, 384, 64, 256)
            ]),
            attrs: [attr('ДУ', '', 0, 460, TEXT.small)]
        },
        {
            name: 'ВК_КЛАПАН_ОБРАТНЫЙ', title: 'клапан обратный',
            ents: [
                poly([-220, -170, -220, 170, 60, 0], true),
                line(120, -200, 120, 200)
            ],
            attrs: [attr('ДУ', '', 0, 260, TEXT.small)]
        },
        {
            name: 'ВК_КРАН_ШАРОВОЙ', title: 'кран шаровой',
            ents: bowtie().concat([circle(0, 0, 110)]),
            attrs: [attr('ДУ', '', 0, 240, TEXT.small)]
        },
        {
            name: 'ВК_КРАН_СЛИВНОЙ', title: 'кран шаровой сливной',
            ents: bowtie().concat([
                circle(0, 0, 110),
                line(0, -170, 0, -330),
                line(-120, -330, 120, -330)
            ]),
            attrs: [attr('ДУ', '', 0, 240, TEXT.small)]
        },
        {
            name: 'ВК_РЕГУЛЯТОР_ДАВЛЕНИЯ', title: 'регулятор давления',
            ents: bowtie().concat([
                line(0, 0, 0, 230),
                poly([-180, 230, 180, 230, 180, 390, -180, 390], true),
                arc(0, 230, 120, 0, 180)
            ]),
            attrs: [attr('НАСТРОЙКА', '', 0, 450, TEXT.small)]
        },
        {
            name: 'ВК_ФИЛЬТР', title: 'фильтр',
            ents: [
                poly([-260, -170, 260, -170, 260, 170, -260, 170], true),
                line(-260, 170, 260, -170),
                line(-120, 170, 140, -170),
                line(-260, 60, 60, -170)
            ],
            attrs: [attr('ДУ', '', 0, 260, TEXT.small)]
        },
        {
            name: 'ВК_СЧЕТЧИК', title: 'счётчик воды',
            ents: [
                circle(0, 0, 200),
                line(-200, 0, 200, 0),
                line(-90, 0, -90, 110),
                line(0, 0, 0, 110),
                line(90, 0, 90, 110)
            ],
            attrs: [attr('МАРКА', '', 0, 290, TEXT.small)]
        },
        {
            name: 'ВК_УЗЕЛ_УПРАВЛЕНИЯ', title: 'узел управления',
            ents: [
                poly([-300, -300, 300, -300, 300, 300, -300, 300], true),
                line(-300, -300, 300, 300),
                line(-170, 150, 170, 150),
                line(170, 150, 60, 230),
                line(170, 150, 60, 70)
            ],
            attrs: [attr('МАРКА', '', 0, 400, TEXT.small), attr('ДУ', '', 0, -440, TEXT.small)]
        },
        {
            name: 'ВК_СИГНАЛИЗАТОР_ПОТОКА', title: 'сигнализатор потока жидкости',
            ents: [
                poly([-300, -200, 300, -200, 300, 200, -300, 200], true),
                line(-300, -200, 300, 200),
                line(-140, 90, 180, 90),
                line(180, 90, 80, 160),
                line(180, 90, 80, 20)
            ],
            attrs: []
        },
        {
            name: 'ВК_СИГНАЛИЗАТОР_ДАВЛЕНИЯ', title: 'сигнализатор давления (СДУ)',
            ents: [
                circle(0, 230, 160),
                line(0, 0, 0, 70),
                line(-120, 230, 120, 230),
                line(0, 110, 0, 350)
            ],
            attrs: []
        },
        {
            name: 'ВК_МАНОМЕТР', title: 'манометр',
            ents: [
                circle(0, 260, 150),
                line(0, 0, 0, 110),
                line(-80, 110, 80, 110),
                line(0, 260, 110, 350)
            ],
            attrs: []
        },
        {
            name: 'ВК_ОРОСИТЕЛЬ_ВНИЗ', title: 'ороситель спринклерный розеткой вниз',
            ents: [
                line(-300, 150, 300, 150),
                line(0, 150, 0, 300),
                solid([-250, 150, 250, 150, 0, -250])
            ],
            attrs: []
        },
        {
            name: 'ВК_ОРОСИТЕЛЬ_ВВЕРХ', title: 'ороситель спринклерный розеткой вверх',
            ents: [
                line(-300, -150, 300, -150),
                line(0, -150, 0, -300),
                solid([-250, -150, 250, -150, 0, 250])
            ],
            attrs: []
        },
        {
            name: 'ВК_ОРОСИТЕЛЬ_ГОР', title: 'ороситель спринклерный горизонтальный',
            ents: [
                line(-150, -300, -150, 300),
                line(-150, 0, -300, 0),
                solid([-150, -250, -150, 250, 250, 0])
            ],
            attrs: []
        },
        {
            name: 'ВК_ПК', title: 'пожарный кран Ду 50',
            ents: [
                circle(0, 230, 170),
                solid([-120, 230, 0, 350, 120, 230, 0, 110]),
                line(0, 0, 0, 60)
            ],
            attrs: [attr('МАРКА', '', 420, 230, TEXT.small, 'left')]
        },
        {
            name: 'ВК_НАСОС', title: 'насосная установка',
            ents: [
                circle(0, 0, 320),
                solid([-120, -170, -120, 170, 240, 0]),
                line(-320, 0, -520, 0),
                line(0, 320, 0, 520)
            ],
            attrs: [
                attr('МАРКА', '', 0, 620, TEXT.normal),
                attr('Q', '', 0, -420, TEXT.small),
                attr('H', '', 0, -680, TEXT.small)
            ]
        },
        {
            name: 'ВК_ЖОКЕЙ', title: 'жокей-насос',
            ents: [
                circle(0, 0, 220),
                solid([-80, -120, -80, 120, 170, 0]),
                line(-220, 0, -400, 0),
                line(0, 220, 0, 400)
            ],
            attrs: [
                attr('МАРКА', '', 0, 500, TEXT.normal),
                attr('Q', '', 0, -320, TEXT.small),
                attr('H', '', 0, -580, TEXT.small)
            ]
        },
        {
            name: 'ВК_БАК_МЕМБРАННЫЙ', title: 'мембранный бак',
            ents: [
                poly([-220, -300, 220, -300, 220, 240, -220, 240], true),
                arc(0, 240, 220, 0, 180),
                line(-220, 0, 220, 0),
                line(0, -300, 0, -460)
            ],
            attrs: [attr('V', '', 0, 560, TEXT.small)]
        },
        {
            name: 'ВК_ДИАФРАГМА', title: 'диафрагма (дроссельная шайба)',
            ents: [
                line(0, 300, 0, 90),
                line(0, -300, 0, -90),
                line(-90, 300, 90, 300),
                line(-90, -300, 90, -300)
            ],
            attrs: [attr('D', '', 0, 420, TEXT.small)]
        },
        {
            name: 'ВК_ГЦ80', title: 'патрубок для пожарных машин (ГЦ-80)',
            ents: [
                line(0, 0, 300, 0),
                line(300, -200, 300, 200),
                line(360, -200, 360, 200),
                circle(470, 0, 110)
            ],
            attrs: [attr('МАРКА', '', 0, 320, TEXT.small, 'left')]
        },
        {
            name: 'ВК_ОБРЫВ', title: 'обрыв трубопровода',
            ents: [
                arc(-80, 0, 180, -60, 60),
                arc(80, 0, 180, 120, 240)
            ],
            attrs: []
        },
        {
            name: 'ВК_ОТМЕТКА', title: 'отметка уровня',
            ents: [
                line(0, 0, -160, 160),
                line(0, 0, 160, 160),
                line(-160, 160, 160, 160),
                line(160, 160, 900, 160)
            ],
            attrs: [attr('ОТМЕТКА', '', 520, 230, TEXT.small, 'center')]
        },
        {
            name: 'ВК_ВЫНОСКА', title: 'выноска: диаметр и расход',
            ents: [line(0, 0, 900, 0)],
            attrs: [
                attr('ДУ', '', 450, 110, TEXT.small),
                attr('Q', '', 450, -280, TEXT.small)
            ]
        },
        {
            name: 'ВК_МАРКА_СИСТЕМЫ', title: 'марка системы на трубе',
            ents: [line(-400, 0, -150, 0), line(150, 0, 400, 0)],
            attrs: [attr('КОД', '', 0, -110, TEXT.small)]
        }
    ];

    function block(name) {
        for (var i = 0; i < BLOCKS.length; i++) {
            if (BLOCKS[i].name === name) return BLOCKS[i];
        }
        return null;
    }

    /** Габарит знака по его геометрии — нужен предпросмотру и раскладке листа. */
    function bounds(b) {
        var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

        function add(x, y) {
            box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
            box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
        }

        (b.ents || []).forEach(function (e) {
            if (e.t === 'l') { add(e.x1, e.y1); add(e.x2, e.y2); }
            else if (e.t === 'pl' || e.t === 's') {
                for (var i = 0; i < e.v.length; i += 2) add(e.v[i], e.v[i + 1]);
            } else if (e.t === 'c' || e.t === 'a') { add(e.x - e.r, e.y - e.r); add(e.x + e.r, e.y + e.r); }
        });

        if (!isFinite(box.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
        return box;
    }

    /* --- лист-шаблон -------------------------------------------------------- */

    /*
        Шаблон для AutoCAD: все слои, текстовый стиль и вся библиотека знаков,
        разложенная по клеткам с подписями, плюс легенда систем с их цветами.
        Такой файл открывают один раз, смотрят, что получилось, и вставляют в
        свой чертёж — дальше знаки подменяются по именам блоков.
    */
    function templateEntities(book) {
        var out = [];
        var cols = 4;
        var cw = 4800;          // клетка 48×28 мм на бумаге при 1:100
        var ch = 2800;
        var top = 0;

        out.push({ t: 'txt', x: 0, y: 2200, h: TEXT.title, s: 'Канон условных знаков АУПТ и ВПВ', layer: 'ВК_Легенда', align: 'left' });
        out.push({ t: 'txt', x: 0, y: 1500, h: TEXT.small, layer: 'ВК_Легенда', align: 'left',
            s: 'Знак рисуется в клетке ' + BOX + ' мм и вставляется с масштабом ' + String(BLOCK_SCALE).replace('.', ',')
                + '; лист 1:' + SCALE + '. Геометрия блока — на слое 0 цветом «по блоку».' });

        BLOCKS.forEach(function (b, i) {
            var cx = (i % cols) * cw;
            var cy = top - Math.floor(i / cols) * ch;

            out.push({ t: 'pl', v: [cx - cw / 2 + 100, cy - ch / 2 + 100, cx + cw / 2 - 100, cy - ch / 2 + 100,
                cx + cw / 2 - 100, cy + ch / 2 - 100, cx - cw / 2 + 100, cy + ch / 2 - 100], closed: true, layer: 'ВК_Оси' });

            // Знак — в своём рабочем масштабе: сразу видно, как он читается на листе.
            out.push({ t: 'ins', name: b.name, x: cx, y: cy + 400, layer: 'ВК_Арматура', attrs: demo(b) });
            out.push({ t: 'txt', x: cx, y: cy - ch / 2 + 700, h: TEXT.small, s: b.name, layer: 'ВК_Текст' });
            out.push({ t: 'txt', x: cx, y: cy - ch / 2 + 320, h: 200, s: b.title, layer: 'ВК_Легенда' });
        });

        // Легенда систем: отрезок цветом системы, обозначение и наименование.
        var y = top - Math.ceil(BLOCKS.length / cols) * ch - 2000;
        out.push({ t: 'txt', x: 0, y: y, h: TEXT.normal, s: 'Системы и цвета', layer: 'ВК_Легенда', align: 'left' });

        ((book && book.systems) || []).forEach(function (s, i) {
            var ly = y - 900 - i * 700;
            var layer = layerOf(s);
            out.push({ t: 'l', x1: 0, y1: ly, x2: 1600, y2: ly, layer: layer });
            out.push({ t: 'txt', x: 1900, y: ly - 120, h: TEXT.small, s: s.code, layer: 'ВК_Текст', align: 'left' });
            out.push({ t: 'txt', x: 3600, y: ly - 120, h: TEXT.small, s: s.title || '', layer: 'ВК_Легенда', align: 'left' });
        });

        return out;
    }

    /** Показательные значения атрибутов — чтобы в шаблоне было видно, что куда. */
    function demo(b) {
        var values = {};
        (b.attrs || []).forEach(function (a) {
            values[a.tag] = a.tag === 'ДУ' ? 'Ду100'
                : a.tag === 'МАРКА' ? 'марка'
                    : a.tag === 'Q' ? 'Q=00,00 л/с'
                        : a.tag === 'H' ? 'H=00,00 м'
                            : a.tag === 'V' ? 'V=000 л'
                                : a.tag === 'D' ? 'd=00 мм'
                                    : a.tag === 'ОТМЕТКА' ? '0,000'
                                        : a.tag === 'КОД' ? 'В21'
                                            : a.tag === 'НАСТРОЙКА' ? '00 м'
                                                : a.tag;
        });
        return values;
    }

    return {
        SCALE: SCALE,
        BLOCK_SCALE: BLOCK_SCALE,
        BOX: BOX,
        TEXT: TEXT,
        PALETTE: PALETTE,
        WATER: WATER,
        FUTURE: FUTURE,
        SERVICE_LAYERS: LAYERS,
        BLOCKS: BLOCKS,
        colorOf: colorOf,
        defaultColor: defaultColor,
        layerOf: layerOf,
        layers: layers,
        block: block,
        bounds: bounds,
        templateEntities: templateEntities
    };
})();
