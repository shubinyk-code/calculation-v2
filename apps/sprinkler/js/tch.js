'use strict';

/*
    Текстовая часть тома ПБ3: исходные данные записки и сборка её текста.

    Числа в записку не переписываются руками: расходы, напоры и параметры
    берутся из систем книги — АПТ считает Solver и Calc, ВПВ считает Vpv.
    Форма слева задаёт только то, чего в расчёте нет: шифр, ввод, состав
    оборудования, фамилии, высоту здания.

    Две ветки текста, как в записках бюро:
        выше 75 м — СТУ, СП 477.1325800 и СП 253.1325800, гидростатика 90 м;
        до 75 м   — СП 10.13130 и СП 485.1311500 без высотных норм.

    Жокей-насос: давление включения равно напору насоса, выключения — на 5 м
    больше (запас задаётся в форме).
*/

var Tch = (function () {

    function create() {
        return {
            volume: 'ПБ3',
            stage: 'П',
            engineer: '',

            basis: 'архитектурно-строительных чертежей\nтехнического задания на проектирование, утверждённого заказчиком',
            stu: false,
            extraNorms: '',

            inletText: 'один двухтрубный ввод диаметром 225х13,4 мм из труб ПЭ100 SDR17, запитанный от кольцевого водопровода (согласно ТУ)',
            guaranteed: 39,
            inletValves: 'Ду200',
            stationPlace: 'на первом подземном этаже',
            waterSource: 'наружные внутриквартальные сети водопровода',

            buildingKind: 'многоэтажный жилой дом',
            zonesText: '1 зона (подвал — 15 этаж)\n2 зона (16 этаж — тех. этаж)',
            parking: 'неотапливаемый',
            onePlace: true,

            valveHeight: '1,20±0,15',
            pkTime: 1,
            hydroLimit: 90,

            appendixStart: 1,
            jockeyDelta: 5,
            jockeyMembrane: 40,
            supplierMail: 'konstantin.yarkov@wilo.ru',
            stampRight: 40,
            stampTop: 7,
            airPressure: 0.4,

            pumps: [],
            template: null,
            units: [],
            extraText: ''
        };
    }

    function isObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function normalize(data) {
        var t = create();

        Object.keys(data || {}).forEach(function (key) {
            if (data[key] !== undefined && !isObject(data[key]) && !Array.isArray(data[key])) t[key] = data[key];
        });

        t.pumps = Array.isArray(data && data.pumps) ? data.pumps.map(function (p) {
            return {
                id: p.id || '', role: p.role === 'jockey' ? 'jockey' : 'main', name: p.name || '', zone: p.zone || '', power: p.power || '',
                count: p.count || '1 раб., 1 рез.', Qf: p.Qf === undefined ? '' : p.Qf, Hf: p.Hf === undefined ? '' : p.Hf,
                // Из каталожного листа: чем заполнено и что в нём было задано.
                sheet: p.sheet || '', file: p.file && p.file.data ? { name: p.file.name || p.sheet || '', data: p.file.data } : null,
                dutyQ: p.dutyQ === undefined ? null : p.dutyQ, dutyH: p.dutyH === undefined ? null : p.dutyH,
                P2: p.P2 === undefined ? null : p.P2, npsh: p.npsh === undefined ? null : p.npsh,
                control: p.control || '', pumpType: p.pumpType || '', loadedAt: p.loadedAt || ''
            };
        }) : [];

        // Листы, загруженные до разделения ролей, лежат как «основная установка».
        // Жокей узнаётся по марке («CO 1 …/J-ET»): переводим его в свою роль.
        // «J-ET» бывает только у жокеев: у основных установок «SK-FFS-J2-R-CS».
        t.pumps.forEach(function (p) {
            if (p.role === 'main' && /J-ET/i.test(p.name || '')) p.role = 'jockey';
        });

        // На систему одна строка каждой роли; при повторе остаётся последняя.
        var seen = {};
        t.pumps = t.pumps.reverse().filter(function (p) {
            var key = p.id + '|' + p.role;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        }).reverse();

        t.template = data && data.template && data.template.name
            ? { name: data.template.name, data: data.template.data || '' }
            : null;

        t.units = Array.isArray(data && data.units) ? data.units.map(function (u) {
            return {
                id: u.id || '', part: u.part || '', kind: u.kind || '', cu: u.cu || '',
                pump: u.pump || '', jockey: u.jockey || '', exhauster: u.exhauster || '', note: u.note || ''
            };
        }) : [];

        return t;
    }

    /**
        Строка формы для системы. У системы может быть два листа: основная
        насосная установка и жокей-насос, поэтому строка ищется и по роли.
    */
    function rowFor(list, id, role) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id !== id) continue;
            if (role === undefined || (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    /* --- числа из систем ---------------------------------------------------- */

    /**
        Посчитать все системы книги. АПТ по этажам идёт в тот же список, что и
        АПТ по плану: для таблиц записки это тоже автоматическое пожаротушение,
        а параметры оросителей берутся из плана диктующего этажа.
    */
    function systems(book) {
        var apt = [];
        var vpv = [];
        var all = [];

        book.systems.forEach(function (s) {
            var item;
            if (s.kind === 'apt' || s.kind === 'vpvplan') {
                var net = Solver.solve(s.project);
                var calc = Calc.build(s.project, net);
                var byPlan = s.kind === 'vpvplan';
                item = {
                    sys: s, kind: byPlan ? 'vpvplan' : 'apt', set: s.project.settings,
                    net: net, calc: calc, head: calc.head
                };
                // Внутреннее пожаротушение по плану — это ВПВ: и в таблицах,
                // и в тексте записки оно идёт вместе со стояками ВПВ.
                (byPlan ? vpv : apt).push(item);
            } else if (s.kind === 'floors') {
                var res = Floors.solve(s.floors, book);
                var plan = res.ok ? res.dict.plan : s.floors.plans[0];
                item = { sys: s, kind: 'floors', f: s.floors, res: res, set: plan ? plan.project.settings : Model.defaults() };
                apt.push(item);
            } else {
                item = { sys: s, kind: 'vpv', v: s.vpv, res: Vpv.solve(s.vpv, book) };
                vpv.push(item);
            }
            all.push(item);
        });

        return { apt: apt, vpv: vpv, all: all, book: book };
    }

    /**
        Кто в таблице 4 и таблице жокеев: насосные установки книги, а системы
        вне насосных — каждая своей строкой, как раньше.
    */
    function owners(data) {
        var book = data.book;
        var list = [];
        var inStation = {};

        (book && book.stations ? book.stations : []).forEach(function (st) {
            if (!st.systems.length) return;
            st.systems.forEach(function (id) { inStation[id] = true; });
            var need = Stations.need(book, st);
            var kinds = [];
            need.parts.forEach(function (p) { if (kinds.indexOf(p.sys.kind) < 0) kinds.push(p.sys.kind); });
            list.push({
                sys: { id: st.id, code: st.name, title: st.zone || '', compartment: '' },
                kind: 'station', station: st, need: need, kinds: kinds
            });
        });

        data.all.forEach(function (item) {
            if (!inStation[item.sys.id]) list.push(item);
        });
        return list;
    }
    /**
     * Номера приложений для ссылок в тексте: расчёт системы по её id. Счёт
     * ведёт Appendix — там же каталожные листы насосов и жокеев.
     */
    function appendices(book, t, data) {
        var map = {};
        Appendix.list(book, data).forEach(function (e) {
            if (e.kind === 'calc' && map[e.sys] === undefined) map[e.sys] = e.no;
        });
        return map;
    }

    /*
        Гарантированный напор один на ввод, а задаётся он в исходных данных
        каждой системы — по нему и считается. Записка и схема берут его
        отсюда, а не отдельным полем: иначе в томе окажутся два разных числа.
    */
    function guaranteed(book) {
        var values = [];

        ((book && book.systems) || []).forEach(function (s) {
            var g = s.vpv ? s.vpv.inlet.guaranteed
                : s.floors ? s.floors.inlet.guaranteed
                    : s.project ? s.project.settings.guaranteed : null;
            if (typeof g === 'number' && values.indexOf(g) < 0) values.push(g);
        });

        values.sort(function (a, b) { return a - b; });
        return { value: values.length ? values[0] : 0, values: values };
    }

    /*
        Предел гидростатики ВПВ тоже задаётся в расчёте каждой системы, а не
        отдельным полем: записка берёт его оттуда, иначе в тексте окажется
        «не превышает 90 м», когда в расчёте стоит 60.
    */
    function hydroLimit(book) {
        var values = [];

        ((book && book.systems) || []).forEach(function (s) {
            if (!s.vpv) return;
            var h = s.vpv.limits.hydro;
            if (typeof h === 'number' && values.indexOf(h) < 0) values.push(h);
        });

        values.sort(function (a, b) { return a - b; });
        return { value: values.length ? values[values.length - 1] : 90, values: values };
    }

    /*
        Число рядом с пределом: обычно целое, но если округление уткнулось ровно
        в предел, а на деле он нарушен, берётся десятичная — иначе вышло бы
        «30 с вместо 30 с».
    */
    function atLimit(value, limit) {
        var text = Fmt.num(value, 0);
        return text === Fmt.num(limit, 0) && Math.abs(value - limit) > 1e-9 ? Fmt.num(value, 1) : text;
    }

    /**
     * Расхождения в исходных данных, которые видно только по всей книге.
     * data — готовый systems(book), если он уже посчитан.
     */
    function dataWarnings(book, data) {
        var out = [];
        var g = guaranteed(book);
        var t = (book && book.text) || {};
        var h = hydroLimit(book);

        if (g.values.length > 1) {
            out.push('Гарантированный напор у систем разный: '
                + g.values.map(function (v) { return Fmt.num(v, 2); }).join(', ')
                + ' м. На вводе он один — поправьте исходные данные.');
        }

        if (h.values.length > 1) {
            out.push('Предел гидростатики ВПВ у систем разный: '
                + h.values.map(function (v) { return Fmt.num(v, 0); }).join(', ')
                + ' м. В записку пойдёт больший — ' + Fmt.num(h.value, 0) + ' м.');
        }

        // Предел не нормативный, а СТУ не отмечены: обосновать его будет нечем.
        if (!t.stu && h.values.length && Math.abs(h.value - 90) > 0.5) {
            out.push('Предел гидростатики ' + Fmt.num(h.value, 0) + ' м отличается от 0,9 МПа '
                + '(п. 6.2.20 СП 10.13130.2020), а СТУ не отмечены — в записке он обоснован заданием.');
        }

        /*
            Воздушное внутреннее пожаротушение по плану: пока сеть не уложилась
            в п. 8.4, записка об этом пишет прямо — замечание предупреждает, что
            текст выйдет с этой строкой.
        */
        (data || systems(book)).vpv.forEach(function (x) {
            if (x.kind !== 'vpvplan' || !x.calc.ok || !x.calc.air || !x.calc.air.on) return;

            var a = x.calc.air;
            var bigV = a.volume > a.limit + 1e-9;
            var bad = [];
            if (bigV) bad.push('объём ' + atLimit(a.volume * 1000, a.limit * 1000) + ' л больше 1 м³');
            if (a.fill > 30 + 1e-9) bad.push('вода идёт в диктующий ПК ' + atLimit(a.fill, 30) + ' с вместо 30 с');

            if (bad.length) {
                // В записку идёт только объём, поэтому о тексте — лишь когда он не прошёл.
                out.push('Система ' + x.sys.code + ': ' + bad.join(', ')
                    + ' (п. 8.4 СП 10.13130.2020). Разделите сеть на тупиковые ветки'
                    + (bigV ? ' — пока записка пишет, что пункт не выполняется.' : '.'));
            }
        });

        return out;
    }

    function partName(item, t) {
        var sys = item.sys;
        if (sys.compartment) return sys.compartment;
        if (item.kind === 'vpv' && item.v.purpose) return item.v.purpose + (item.v.zone ? ', ' + item.v.zone : '');
        return sys.title || t.buildingKind;
    }

    function mpa(m) {
        return Fmt.trim(m / 100, 3);
    }

    /** Требуемые напор и расход насосной установки для системы. */
    function pumpNeed(item) {
        if (item.kind === 'station') {
            var st = item.need;
            // Зона — только если она задана: иначе имя насосной повторилось бы дважды.
            return { Q: st.Q, H: st.H, guar: st.guar, zone: item.station.zone || '', after: st.after };
        }
        if (item.kind === 'floors') {
            var fr = item.res;
            var floorNeed = {
                Q: fr.ok ? fr.dict.Qr : 0,
                H: fr.ok ? fr.pumpHead : 0,
                guar: item.f.inlet.guaranteed,
                zone: item.f.zone || ''
            };
            floorNeed.after = floorNeed.H + (floorNeed.guar > 0 ? floorNeed.guar : 0);
            return floorNeed;
        }

        var need = item.kind === 'apt' || item.kind === 'vpvplan'
            ? {
                Q: item.net.Qtotal,
                H: Math.max(0, item.head ? item.head.HpumpReq : 0),
                guar: item.set.guaranteed,
                zone: item.sys.title || ''
            }
            : {
                Q: item.res.ok ? item.res.dict.Q : 0,
                H: item.res.ok ? item.res.pumpHead : 0,
                guar: item.v.inlet.guaranteed,
                zone: item.v.zone || ''
            };

        // Напор после насосной установки: требуемый напор насоса плюс подпор
        // из наружной сети — с ним система стоит в дежурном режиме.
        need.after = need.H + (need.guar > 0 ? need.guar : 0);
        return need;
    }

    /** Таблица 1: требуемые параметры автоматического пожаротушения. */
    function aptTable(data, t) {
        return data.apt.map(function (a) {
            var s = a.set;
            return [
                partName(a, t),
                s.group,
                Fmt.trim(s.intensity, 3),
                Fmt.trim(s.area, 1),
                Fmt.trim(s.minutes, 0),
                Fmt.trim(s.k, 2),
                mpa(s.dictHead),
                t.stu ? 'СП 485.1311500.2020 табл. 6.1, СТУ' : 'СП 485.1311500.2020 табл. 6.1'
            ];
        });
    }

    /** Таблица 2: требуемые параметры внутреннего пожаротушения. */
    function vpvTable(data, t) {
        return data.vpv.map(function (x) {
            // Внутреннее пожаротушение по плану: ствол и рукав — из исходных
            // данных плана, давление у клапана — у диктующего крана расчёта.
            if (x.kind === 'vpvplan') {
                var s = x.set;
                var dict = x.calc.ok && x.calc.head.dictKind === 'pk' ? x.calc.head : null;
                var hyd = Model.pkTable(s);
                return [
                    partName(x, t),
                    Fmt.trim(s.pkJets, 0) + ' × ' + Fmt.trim(s.pkFlow > 0 ? s.pkFlow : hyd.q, 2) + ' л/с',
                    Fmt.trim(s.pkCompact, 0),
                    Fmt.trim(s.pkNozzle, 0),
                    Fmt.trim(s.pkDn, 0),
                    Fmt.trim(s.pkHose, 0),
                    dict ? mpa(dict.pkHead) : mpa(s.pkHead > 0 ? s.pkHead : hyd.p),
                    t.stu ? 'СТУ' : 'СП 10.13130.2020 табл. 7.3'
                ];
            }

            var pk = x.v.pk;
            var res = x.res;
            return [
                partName(x, t),
                res.ok ? res.jetsText : '—',
                Fmt.trim(pk.compact, 0),
                Fmt.trim(pk.nozzle, 0),
                Fmt.trim(pk.dn, 0),
                Fmt.trim(pk.hose, 0),
                res.ok ? mpa(res.P1) : '—',
                t.stu ? 'СТУ' : 'СП 10.13130.2020 табл. 7.3'
            ];
        });
    }

    /** Таблица 3: сводная таблица требуемых расходов. */
    function flowTable(data, t, nums) {
        return data.all.map(function (item) {
            var need = pumpNeed(item);
            return [
                item.sys.code,
                item.sys.compartment || '—',
                Fmt.num(need.Q, 2),
                'см. приложение ' + nums[item.sys.id]
            ];
        });
    }

    function numOr(v) {
        return v === '' || v === null || v === undefined ? '—' : Fmt.num(Number(v), 2);
    }

    /**
        Таблица 4: насосное оборудование. Сначала основные установки — по одной
        на систему, с требуемыми подачей и напором из расчёта. Следом жокей-насосы
        и прочие листы: у них требуемая точка своя, из каталожного листа.
    */
    function pumpTable(data, t) {
        var rows = [];
        var codes = {};

        owners(data).forEach(function (item) {
            var need = pumpNeed(item);
            var row = rowFor(t.pumps, item.sys.id, 'main') || {};
            codes[item.sys.id] = item.sys.code;

            rows.push([
                row.name || '—',
                row.zone || need.zone || item.sys.code,
                row.power || '—',
                row.count || '1 раб., 1 рез.',
                Fmt.num(need.Q, 2),
                Fmt.num(need.H, 2),
                numOr(row.Qf),
                numOr(row.Hf)
            ]);
        });

        t.pumps.forEach(function (row) {
            if ((row.role || 'main') === 'main') return;
            rows.push([
                row.name || '—',
                row.zone || codes[row.id] || '',
                row.power || '—',
                row.count || '1 раб.',
                numOr(row.dutyQ),
                numOr(row.dutyH),
                numOr(row.Qf),
                numOr(row.Hf)
            ]);
        });

        return rows;
    }

    /** Таблица 5: сводная таблица оборудования АПТ. */
    function unitTable(data, t) {
        return data.apt.map(function (a) {
            var s = a.set;
            var row = rowFor(t.units, a.sys.id) || {};
            var air = s.systemKind === 'воздухозаполненная' || s.coldRoom;
            var need = pumpNeed(a);

            return [
                row.part || partName(a, t),
                row.kind || (air ? 'воздухозаполненная' : 'водозаполненная'),
                row.cu || (a.kind === 'floors' ? a.f.inlet.cuKind + ' ' + a.f.inlet.cuDn : s.cuKind + ' ' + s.cuDn),
                row.pump || (need.H > 0 ? '+' : '—'),
                row.jockey || (need.H > 0 && Appendix.jockeyOn(a) ? '+' : '—'),
                row.exhauster || (air ? '+' : '—'),
                row.note || ''
            ];
        });
    }

    /**
        Таблица 6: жокей-насосы. Жокей держит в дежурном режиме давление выше
        рабочего: напор после насосной установки (требуемый напор насоса плюс
        подпор из наружной сети) и запас. Выключение — ещё на запас выше.
    */
    function jockeyTable(data, t) {
        var delta = t.jockeyDelta > 0 ? t.jockeyDelta : 5;

        return owners(data).map(function (item) {
            var need = pumpNeed(item);
            // Жокей есть не у каждой насосной — это галочка в окне «Насосы…».
            if (!(need.H > 0) || !Appendix.jockeyOn(item)) return null;

            var on = need.after + delta;

            return [
                'Жокей-насос ' + item.sys.code + (need.zone ? ', ' + need.zone : ''),
                Fmt.num(on, 2),
                Fmt.num(on, 2),
                Fmt.num(on + delta, 2)
            ];
        }).filter(Boolean);
    }

    /** Перечень норм: высота здания решает, войдут ли высотные своды правил. */
    function norms(book, t) {
        var list = [];
        (t.basis || '').split('\n').forEach(function (line) {
            if (line.trim()) list.push(line.trim().replace(/[;.]$/, ''));
        });

        if (t.stu) list.push('СТУ');

        list.push('СП 485.1311500.2020 «Системы противопожарной защиты. Установки пожаротушения автоматические. Нормы и правила проектирования»');
        list.push('СП 486.1311500.2020 изм. 1 «Системы противопожарной защиты. Перечень зданий, сооружений, помещений и оборудования, подлежащих защите автоматическими установками пожаротушения и системами пожарной сигнализации. Нормы и правила проектирования»');
        list.push('СП 10.13130.2020 изм. 1 «Системы противопожарной защиты. Внутренний противопожарный водопровод»');
        list.push('СП 30.13330.2020 «Внутренний водопровод и канализация зданий»');

        // Паркинг в проекте — своды правил по стоянкам автомобилей.
        if (parking(book, t)) {
            list.push('СП 551.1311500.2026 «Системы противопожарной защиты. Стоянки автомобилей. Требования пожарной безопасности»');
            list.push('СП 113.13330.2023 «Стоянки автомобилей»');
        }

        if (tall(book)) {
            list.push('СП 550.1311500.2026 «Здания высотные. Требования пожарной безопасности»');
            list.push('СП 477.1325800.2020 изм. 1 «Здания и комплексы высотные»');
            list.push('СП 253.1325800.2016 изм. 3 «Инженерные системы высотных зданий»');
        }

        (t.extraNorms || '').split('\n').forEach(function (line) {
            if (line.trim()) list.push(line.trim().replace(/[;.]$/, ''));
        });

        list.push('Федеральный закон от 22 июля 2008 г. № 123-ФЗ с изм. «Технический регламент о требованиях пожарной безопасности»');
        return list;
    }

    function tall(book) {
        return book.object.height > 75;
    }

    /*
        Паркинг в проекте узнаём по самим системам: обозначение, наименование,
        часть здания, зона, объект в исходных данных и группа помещений по
        табл. 6.1. Отдельной галочки нет нарочно — её забывают поставить, а
        слово «паркинг» в системе стоит всегда.
    */
    function parking(book, t) {
        var re = /паркинг|стоянк|гараж|автостоян/i;
        var found = false;

        function look(text) {
            if (text && re.test(String(text))) found = true;
        }

        look(t && t.buildingKind);

        ((book && book.systems) || []).forEach(function (s) {
            look(s.code + ' ' + s.title + ' ' + s.compartment);
            if (s.vpv) look(s.vpv.zone + ' ' + s.vpv.purpose);
            if (s.floors) {
                look(s.floors.zone + ' ' + s.floors.purpose);
                s.floors.plans.forEach(function (p) { look(planText(p.project.settings)); });
            }
            if (s.project) look(planText(s.project.settings));
        });

        return found;
    }

    /*
        Группу помещений по табл. 6.1 здесь не смотрим: в группе 2 вместе с
        гаражами лежат производства, и обычный цех получил бы нормы по
        стоянкам. Берём только то, что пишут руками про сам объект.
    */
    function planText(set) {
        return set.objectText + ' ' + set.tableTitle;
    }

    return {
        create: create,
        normalize: normalize,
        systems: systems,
        owners: owners,
        appendices: appendices,
        partName: partName,
        pumpNeed: pumpNeed,
        guaranteed: guaranteed,
        hydroLimit: hydroLimit,
        dataWarnings: dataWarnings,
        aptTable: aptTable,
        vpvTable: vpvTable,
        flowTable: flowTable,
        pumpTable: pumpTable,
        unitTable: unitTable,
        jockeyTable: jockeyTable,
        norms: norms,
        parking: parking,
        tall: tall
    };
})();
