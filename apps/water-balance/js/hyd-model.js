/*
    Модель вкладки «Гидравлика»: то, что вводит инженер.

    Схема рисуется на холсте. Холст — это узлы (ввод, водомерный узел, насосная
    установка, ИТП, тройник, встроенное помещение, БЛОК СТОЯКА) и трубы между
    ними — ломаные линии. Стояк — блок, который «расписан» заранее: с какого по
    какой этаж, какой типовой этаж на каких этажах. Типовой этаж (коллекторы и
    выходы-квартиры) хранится отдельно и годится любому числу стояков.

    Два листа: 'c' — холодная вода, 'h' — горячая. Узлы-«двойники» (ИТП, стояк,
    встроенное помещение) живут на обоих листах как один объект, у второго листа
    своя позиция (hx, hy). Остальные узлы принадлежат одному листу.

    Хранится только ввод; расчёт не хранится. Идентификаторы выходов
    детерминированные («N4/F5/C2/O3»): ручные правки диаметров и длин по участкам
    (hyd.pipes, hyd.lengths) переживают пересчёт.
*/

var HydModel = (function () {
    'use strict';

    var LIVING = 'Жилые дома с ваннами от 1500 мм, оборудованными душами';
    var OFFICE = 'Административные здания';

    function number(value, fallback) {
        var parsed = parseFloat(value);
        return isFinite(parsed) ? parsed : fallback;
    }

    function whole(value, fallback) {
        return Math.max(0, Math.round(number(value, fallback)));
    }

    function text(value, fallback) {
        return value === null || value === undefined ? fallback : String(value);
    }

    function oneOf(value, list, fallback) {
        return list.indexOf(value) >= 0 ? value : fallback;
    }

    /* Следующий свободный идентификатор вида «T3» среди элементов списка. */
    function nextId(prefix, list) {
        var max = 0;
        for (var i = 0; i < list.length; i++) {
            var m = new RegExp('^' + prefix + '(\\d+)$').exec(list[i].id);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        }
        return prefix + (max + 1);
    }

    /* --- заготовки ---------------------------------------------------------- */

    function newOutlet(id, rooms) {
        return {
            id: id,
            label: 'кв. {n}',
            count: 1,
            rooms: rooms === undefined ? 2 : rooms,
            people: 0,                 // 0 — по числу комнат (таблица survey.people)
            fixtures: HydData.APARTMENT_SETS[0].fixtures.map(function (f) { return { id: f[0], count: f[1] }; }),
            lenM: 12,                  // горизонтальный ход от коллектора до дальнего прибора
            fixtureElev: 1.2,          // отметка дальнего прибора над полом этажа
            meter: true
        };
    }

    function newCollector(id, type) {
        var ceiling = type === 'ceiling';
        return {
            id: id,
            name: 'Узел ' + id.replace('C', ''),
            type: ceiling ? 'ceiling' : 'floor',
            branchLen: 6,              // от стояка до коллектора
            elev: ceiling ? 2.4 : 0.3  // отметка оси коллектора над полом
        };
    }

    function defaultTypes() {
        return [{
            id: 'T1', name: 'Типовой этаж',
            collectors: [Object.assign(newCollector('C1', 'floor'), {
                outlets: [newOutlet('O1', 1), newOutlet('O2', 2), newOutlet('O3', 2), newOutlet('O4', 3)]
            })]
        }];
    }

    function defaultSurvey() {
        var survey = HydData.defaultSurvey();
        survey.people = HydData.defaultPeople();
        survey.regulators = 'auto';    // auto | all | none
        survey.apartmentMeter = true;
        survey.meter = { limitVane: 5, limitTurbine: 2.5, cls: 1, method: 'sp', pulse: true, aptQn: 1.5 };   // подбор счётчиков (как в WaterMeterWeb)
        survey.scale = 0.1;            // метров трубы на пиксель холста
        survey.floorPx = 16;           // высота этажа в блоке стояка на холсте, px
        delete survey.inputs;
        return survey;
    }

    /* Узел холста с умолчаниями по виду. */
    function newNode(hyd, kind, x, y, sheet) {
        var nodes = hyd.canvas.nodes;
        var max = 0;
        nodes.forEach(function (n) {
            var m = /^N(\d+)$/.exec(n.id);
            if (m) max = Math.max(max, +m[1]);
        });

        var both = kind === 'itp' || kind === 'riser' || kind === 'buildin';
        var node = {
            id: 'N' + (max + 1), kind: kind,
            sheet: both ? 'both' : (sheet === 'h' ? 'h' : 'c'),
            x: x, y: y, hx: x, hy: y
        };

        var s = hyd.survey;

        if (kind === 'input') {
            Object.assign(node, { name: 'Ввод ' + (countKind(nodes, 'input') + 1), Hgar: 24, hv: 0.5, elev: s.pumpElev, length: 12, material: 'pe100s17', od: 160, wall: 9.5 });
        } else if (kind === 'meter') {
            Object.assign(node, { role: 'main', rot: 0, place: '', systemName: '', note: '', kindFilter: '', method: '', qOver: 0, chosen: null });
        } else if (kind === 'pump') {
            Object.assign(node, { name: (countKind(nodes, 'pump') + 1) + ' зона', elev: s.pumpElev, work: 1, reserve: 1 });
        } else if (kind === 'itp') {
            node.name = 'ИТП';
            node.itpNo = 0;     // номер ИТП для отдельного задания; 0 — общая ИТП
        } else if (kind === 'buildin') {
            Object.assign(node, { name: 'Встроенные помещения', norm: OFFICE, U: 20, N: 0, Nh: 0, hasHot: true, elev: 0.3 });
        } else if (kind === 'riser') {
            Object.assign(node, {
                name: '', norm: LIVING, baseElev: s.pumpElev, floorFrom: 1, floorTo: 9, floorH: 0, firstNumber: 0,
                level1: null, heights: {}, elevs: {},
                ranges: [{ from: 1, to: 9, typeId: hyd.floorTypes.length ? hyd.floorTypes[0].id : '' }], exceptions: []
            });
        }

        return node;
    }

    function countKind(nodes, kind) {
        var n = 0;
        nodes.forEach(function (x) { if (x.kind === kind) n++; });
        return n;
    }

    /*
        Данные для записки ИОС2: то, что нельзя посчитать (источник по ТУ, пожарные расходы,
        категории, место ИТП …). Пустое поле в записке остаётся жёлтой пометкой.
    */
    function defaultNote() {
        return {
            supplyFrom: '', fireExt: null, hasFire: true, fireHead: null, fireConn: '',
            catHp: '', catFire: '', itpPlace: '', hotScheme: '', irrigation: false, yearDays: 365,
            supplierMail: '', engineer: ''
        };
    }

    /*
        Задание в ИТП: поля бланка и допущения расчёта, которых нет в схеме. Допущения взяты из
        выпущенного бланка: циркуляция = 25 % секундного расхода Т3, потери в циркуляционных
        стояках 10 м (жильё) и 5 м (встройка), холодная вода зимой 5 °C.
    */
    function defaultItp() {
        return {
            cipher: '', stage: 'П', revision: '00', author: '', issuedBy: '', acceptedBy: '', date: '',
            tHot: 65, tCirc: 55, tCold: 5, circFactor: 0.25, circLossRes: 10, circLossBuilt: 5, vCirc: 0.7, notes: ''
        };
    }

    /*
        Задание от ВК для ЭЛ и СС: шапка бланка, правки автоматических строк (auto[key] — помещение,
        примечание, диспетчеризация, протокол, мощность …) и строки, добавленные вручную.
    */
    function defaultElss() {
        return { cipher: '', stage: 'П', revision: 'Р00', date: '', author: '', issuedBy: '', acceptedBy: '', desc: '', auto: {}, rows: [] };
    }

    function normalizeElss(data) {
        var base = defaultElss();
        if (!data || typeof data !== 'object') return base;
        var opt = function (v) { return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v; };

        ['cipher', 'revision', 'date', 'author', 'issuedBy', 'acceptedBy', 'desc'].forEach(function (k) { base[k] = text(data[k], base[k]); });
        base.stage = oneOf(data.stage, ['ЭП', 'П', 'Р', 'ТД'], 'П');

        if (data.auto && typeof data.auto === 'object') {
            Object.keys(data.auto).forEach(function (k) {
                var o = data.auto[k];
                if (!o || typeof o !== 'object') return;
                base.auto[k] = {
                    room: text(o.room, ''), note: text(o.note, ''), name: text(o.name, ''), dispatch: oneOf(o.dispatch, ['Да', 'Нет'], ''),
                    protocol: text(o.protocol, ''), kw: opt(o.kw), volt: opt(o.volt), skip: !!o.skip
                };
            });
        }

        (Array.isArray(data.rows) ? data.rows : []).forEach(function (r) {
            if (!r || typeof r !== 'object') return;
            base.rows.push({
                cat: text(r.cat, ''), name: text(r.name, ''), desc: text(r.desc, ''),
                work: whole(r.work, 1), reserve: whole(r.reserve, 0), kw: opt(r.kw), volt: opt(r.volt),
                dispatch: oneOf(r.dispatch, ['Да', 'Нет'], 'Нет'), protocol: text(r.protocol, ''), room: text(r.room, ''), note: text(r.note, ''),
                skip: !!r.skip, act: r.act && typeof r.act === 'object' ? { size: text(r.act.size, ''), time: text(r.act.time, '') } : null
            });
        });

        return base;
    }

    function normalizeItp(data) {
        var base = defaultItp();
        if (!data || typeof data !== 'object') return base;
        var pos = function (v, d) { var x = parseFloat(v); return isFinite(x) && x >= 0 ? x : d; };

        ['cipher', 'author', 'issuedBy', 'acceptedBy', 'notes'].forEach(function (k) { base[k] = text(data[k], ''); });
        base.stage = oneOf(data.stage, ['ЭП', 'П', 'Р', 'ТД'], 'П');
        base.revision = text(data.revision, '00');
        base.date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : '';
        ['tHot', 'tCirc', 'tCold', 'circFactor', 'circLossRes', 'circLossBuilt', 'vCirc'].forEach(function (k) { base[k] = pos(data[k], base[k]); });
        return base;
    }

    function normalizeNote(data) {
        var base = defaultNote();
        if (!data || typeof data !== 'object') return base;
        var opt = function (v) { return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v; };

        base.supplyFrom = text(data.supplyFrom, '');
        base.fireExt = opt(data.fireExt);
        base.hasFire = data.hasFire !== false;
        base.fireHead = opt(data.fireHead);
        base.fireConn = text(data.fireConn, '');
        base.catHp = oneOf(data.catHp, ['', 'I', 'II', 'III'], '');
        base.catFire = oneOf(data.catFire, ['', 'I', 'II', 'III'], '');
        base.itpPlace = text(data.itpPlace, '');
        base.hotScheme = oneOf(data.hotScheme, ['', 'закрытая', 'открытая'], '');
        base.irrigation = !!data.irrigation;
        base.yearDays = number(data.yearDays, 365) > 0 ? number(data.yearDays, 365) : 365;
        base.supplierMail = text(data.supplierMail, '');
        base.engineer = text(data.engineer, '');
        return base;
    }

    function blank() {
        var hyd = {
            survey: defaultSurvey(),
            method: 'people',
            floorTypes: defaultTypes(),
            canvas: { nodes: [], pipes: [] },
            pipes: {},
            lengths: {},
            pumpSel: {},
            note: defaultNote(),
            itp: defaultItp(),
            elss: defaultElss()
        };

        HydGraph.starter(hyd, { sections: 1, risers: 2, floors: 9 });
        return hyd;
    }

    /* --- чтение ------------------------------------------------------------- */

    function normalize(data) {
        if (!data || typeof data !== 'object' || !data.canvas || !Array.isArray(data.canvas.nodes)) {
            var fresh = blank();
            // типы этажей из старой версии сохраняются, если они там были
            if (data && Array.isArray(data.floorTypes) && data.floorTypes.length) {
                fresh.floorTypes = normalizeTypes(data.floorTypes);
                HydGraph.retype(fresh);
            }
            if (data && data.method === 'fixtures') fresh.method = 'fixtures';
            return fresh;
        }

        var out = {
            survey: normalizeSurvey(data.survey, defaultSurvey()),
            method: data.method === 'fixtures' ? 'fixtures' : 'people',
            floorTypes: normalizeTypes(Array.isArray(data.floorTypes) && data.floorTypes.length ? data.floorTypes : defaultTypes()),
            canvas: { nodes: [], pipes: [] },
            pipes: {},
            lengths: {},
            pumpSel: {},
            note: normalizeNote(data.note),
            itp: normalizeItp(data.itp),
            elss: normalizeElss(data.elss)
        };

        var typeIds = {};
        out.floorTypes.forEach(function (t) { typeIds[t.id] = true; });
        var ids = {};

        data.canvas.nodes.forEach(function (n, i) {
            if (!n || typeof n !== 'object') return;
            var kind = oneOf(n.kind, ['input', 'meter', 'pump', 'itp', 'tee', 'buildin', 'riser'], '');
            if (!kind) return;

            var id = text(n.id, 'N' + (i + 1));
            if (ids[id]) return;
            ids[id] = true;

            var x = number(n.x, 0);
            var y = number(n.y, 0);
            var node = newNode({ survey: out.survey, canvas: { nodes: [] }, floorTypes: out.floorTypes }, kind, x, y, n.sheet);
            node.id = id;
            node.sheet = node.sheet === 'both' ? 'both' : (n.sheet === 'h' ? 'h' : 'c');
            node.hx = number(n.hx, x);
            node.hy = number(n.hy, y);

            if (kind === 'input') {
                node.name = text(n.name, node.name);
                node.Hgar = Math.max(0, number(n.Hgar, node.Hgar));
                node.hv = Math.max(0, number(n.hv, node.hv));
                node.elev = number(n.elev, node.elev);
                node.length = Math.max(0, number(n.length, node.length));
                var mat = HydData.MATERIALS.some(function (m) { return m.key === n.material; }) ? n.material : node.material;
                var size = HydData.find(mat, number(n.od, node.od), number(n.wall, node.wall)) || HydData.find('pe100s17', 160, 9.5);
                node.material = size.material;
                node.od = size.od;
                node.wall = size.wall;
            } else if (kind === 'meter') {
                node.role = oneOf(n.role, ['main', 'section', 'builtin'], 'main');
                node.rot = n.rot === 90 ? 90 : 0;
                node.place = text(n.place, '');
                node.systemName = text(n.systemName, '');
                node.note = text(n.note, '');
                node.kindFilter = oneOf(n.kindFilter, ['', 'vane', 'turbine'], '');
                node.method = oneOf(n.method, ['', 'sp', 'passport'], '');
                node.qOver = Math.max(0, number(n.qOver, 0));
                node.chosen = n.chosen && n.chosen.dn > 0 && (n.chosen.kind === 'vane' || n.chosen.kind === 'turbine')
                    ? { dn: whole(n.chosen.dn, 15), kind: n.chosen.kind, variant: text(n.chosen.variant, '') } : null;
            } else if (kind === 'pump') {
                node.name = text(n.name, node.name);
                node.elev = number(n.elev, node.elev);
                node.work = Math.max(1, whole(n.work, 1));
                node.reserve = whole(n.reserve, 1);
            } else if (kind === 'itp') {
                node.name = text(n.name, node.name);
                node.itpNo = whole(n.itpNo, 0);
            } else if (kind === 'buildin') {
                node.name = text(n.name, node.name);
                node.norm = text(n.norm, OFFICE);
                node.U = whole(n.U, 0);
                node.N = whole(n.N, 0);
                node.Nh = whole(n.Nh, 0);
                node.hasHot = n.hasHot !== false;
                node.elev = number(n.elev, node.elev);
            } else if (kind === 'riser') {
                node.name = text(n.name, '');
                node.norm = text(n.norm, LIVING);
                node.baseElev = number(n.baseElev, node.baseElev);
                node.floorFrom = Math.max(1, whole(n.floorFrom, 1));
                node.floorTo = Math.max(node.floorFrom, whole(n.floorTo, 9));
                node.floorH = Math.max(0, number(n.floorH, 0));

                // отметки этажей этого стояка: пол 1 этажа (null — из опросника), высоты и отметки отдельных этажей
                node.level1 = n.level1 !== null && n.level1 !== undefined && n.level1 !== '' && isFinite(+n.level1) ? +n.level1 : null;
                node.heights = {};
                node.elevs = {};
                Object.keys(n.heights && typeof n.heights === 'object' ? n.heights : {}).forEach(function (k) {
                    var f = whole(k, 0);
                    var v = parseFloat(n.heights[k]);
                    if (f >= 1 && isFinite(v) && v > 0) node.heights[f] = v;
                });
                Object.keys(n.elevs && typeof n.elevs === 'object' ? n.elevs : {}).forEach(function (k) {
                    var f = whole(k, 0);
                    var v = parseFloat(n.elevs[k]);
                    if (f >= 2 && isFinite(v)) node.elevs[f] = v;
                });
                node.firstNumber = whole(n.firstNumber, 0);
                node.ranges = [];

                (Array.isArray(n.ranges) ? n.ranges : []).forEach(function (r) {
                    var from = Math.max(1, whole(r.from, 1));
                    var to = Math.max(from, whole(r.to, from));
                    node.ranges.push({ from: from, to: to, typeId: typeIds[r.typeId] ? r.typeId : '' });
                });

                node.exceptions = [];

                (Array.isArray(n.exceptions) ? n.exceptions : []).forEach(function (e) {
                    node.exceptions.push({ floor: Math.max(1, whole(e.floor, 1)), typeId: typeIds[e.typeId] ? e.typeId : '' });
                });
            }

            out.canvas.nodes.push(node);
        });

        var pipeIds = {};

        (Array.isArray(data.canvas.pipes) ? data.canvas.pipes : []).forEach(function (p, i) {
            if (!p || !ids[p.a] || !ids[p.b] || p.a === p.b) return;
            var id = text(p.id, 'P' + (i + 1));
            if (pipeIds[id]) return;
            pipeIds[id] = true;

            var pts = [];
            (Array.isArray(p.pts) ? p.pts : []).forEach(function (q) {
                if (q && isFinite(q.x) && isFinite(q.y)) pts.push({ x: +q.x, y: +q.y });
            });

            var pipe = { id: id, a: p.a, b: p.b, sheet: p.sheet === 'h' ? 'h' : 'c', pts: pts };
            if (typeof p.pa === 'string' && p.pa) pipe.pa = p.pa;
            if (typeof p.pb === 'string' && p.pb) pipe.pb = p.pb;
            out.canvas.pipes.push(pipe);
        });

        if (data.lengths && typeof data.lengths === 'object') {
            Object.keys(data.lengths).forEach(function (k) {
                var L = number(data.lengths[k], -1);
                if (L >= 0) out.lengths[k] = L;
            });
        }

        // две трубы между одной парой объектов: вторая никогда не считается
        var seenPair = {};
        out.canvas.pipes = out.canvas.pipes.filter(function (p) {
            var key = p.sheet + '|' + (p.a < p.b ? p.a + '|' + p.b : p.b + '|' + p.a);
            if (seenPair[key]) return false;
            seenPair[key] = true;
            return true;
        });

        // тройники без единой трубы — следы удаления в старых проектах
        var wired = {};
        out.canvas.pipes.forEach(function (p) { wired[p.a] = true; wired[p.b] = true; });
        out.canvas.nodes = out.canvas.nodes.filter(function (n) { return n.kind !== 'tee' || wired[n.id]; });

        if (data.pumpSel && typeof data.pumpSel === 'object') {
            var pumpIds = {};
            out.canvas.nodes.forEach(function (n) { if (n.kind === 'pump') pumpIds[n.id] = true; });
            Object.keys(data.pumpSel).forEach(function (k) {
                var q = data.pumpSel[k];
                if (!pumpIds[k] || !q || typeof q !== 'object') return;
                var opt = function (v) { return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v; };
                out.pumpSel[k] = {
                    name: String(q.name || ''), purpose: String(q.purpose || ''), power: opt(q.power), count: String(q.count || ''),
                    Qf: opt(q.Qf), Hf: opt(q.Hf), sheet: String(q.sheet || ''), P2: opt(q.P2), npsh: opt(q.npsh),
                    control: String(q.control || ''), pumpType: String(q.pumpType || ''), dutyQ: opt(q.dutyQ), dutyH: opt(q.dutyH), loadedAt: String(q.loadedAt || ''),
                    data: typeof q.data === 'string' ? q.data : '', source: q.source === 'sheet' ? 'sheet' : 'manual'
                };
            });
        }

        if (data.pipes && typeof data.pipes === 'object') {
            Object.keys(data.pipes).forEach(function (k) {
                var p = data.pipes[k];
                if (p && p.material && HydData.find(p.material, number(p.od, 0), number(p.wall, undefined))) {
                    out.pipes[k] = { material: p.material, od: number(p.od, 0), wall: number(p.wall, 0) };
                }
            });
        }

        return out;
    }

    function normalizeTypes(types) {
        var out = [];

        types.forEach(function (t, ti) {
            var type = { id: text(t.id, 'T' + (ti + 1)), name: text(t.name, 'Этаж ' + (ti + 1)), collectors: [] };

            (Array.isArray(t.collectors) ? t.collectors : []).forEach(function (c, ci) {
                var col = newCollector(text(c.id, 'C' + (ci + 1)), c.type);
                col.name = text(c.name, col.name);
                col.branchLen = Math.max(0, number(c.branchLen, col.branchLen));
                col.elev = number(c.elev, col.elev);
                col.outlets = [];

                (Array.isArray(c.outlets) ? c.outlets : []).forEach(function (o, oi) {
                    var item = newOutlet(text(o.id, 'O' + (oi + 1)), whole(o.rooms, 2));
                    item.label = text(o.label, item.label);
                    item.count = Math.max(1, whole(o.count, 1));
                    item.people = whole(o.people, 0);
                    item.lenM = Math.max(0, number(o.lenM, item.lenM));
                    item.fixtureElev = number(o.fixtureElev, item.fixtureElev);
                    item.meter = o.meter !== false;
                    item.fixtures = [];

                    (Array.isArray(o.fixtures) ? o.fixtures : []).forEach(function (f) {
                        if (!f || !f.id) return;
                        var n = whole(f.count, 0);
                        if (n > 0) item.fixtures.push({ id: String(f.id), count: n });
                    });

                    col.outlets.push(item);
                });

                type.collectors.push(col);
            });

            out.push(type);
        });

        return out;
    }

    function normalizeSurvey(data, base) {
        data = data && typeof data === 'object' ? data : {};
        var s = {};
        var key;

        for (key in base) if (base.hasOwnProperty(key)) s[key] = base[key];

        s.objectName = text(data.objectName, base.objectName);
        s.height = Math.max(0, number(data.height, base.height));
        s.groundElev = number(data.groundElev, base.groundElev);
        s.parking = oneOf(data.parking, ['none', 'underground', 'above'], base.parking);
        s.pumpElev = number(data.pumpElev, base.pumpElev);
        s.floorHeight = Math.max(2, number(data.floorHeight, base.floorHeight));
        s.noiseDb = number(data.noiseDb, base.noiseDb);
        s.kl = Math.max(0, number(data.kl, base.kl));
        s.hPr = Math.max(0, number(data.hPr, base.hPr));
        s.hNs = Math.max(0, number(data.hNs, base.hNs));
        s.hItp = Math.max(0, number(data.hItp, base.hItp));
        s.hReg = Math.max(0, number(data.hReg, base.hReg));
        s.hFilter = Math.max(0, number(data.hFilter, base.hFilter));
        s.staticLimit = Math.max(1, number(data.staticLimit, base.staticLimit));
        s.zoneLimit = Math.max(1, number(data.zoneLimit, base.zoneLimit));
        s.regulators = oneOf(data.regulators, ['auto', 'all', 'none'], 'auto');
        s.apartmentMeter = data.apartmentMeter !== false;
        var dm = data.meter && typeof data.meter === 'object' ? data.meter : {};
        s.meter = {
            limitVane: Math.max(0.1, number(dm.limitVane, 5)),
            limitTurbine: Math.max(0.1, number(dm.limitTurbine, 2.5)),
            cls: Math.max(0, Math.min(2, whole(dm.cls, 1))),
            // старые проекты хранили выбор в survey.meterMethod (поле опросника писало туда, а расчёт читал meter.method)
            method: (dm.method === 'passport' || data.meterMethod === 'passport') ? 'passport' : 'sp',
            pulse: dm.pulse !== false,
            // квартирный счётчик: 0 — подбирать по расходу, иначе Ду 15 с этим Qn (по умолчанию 1,5)
            aptQn: dm.aptQn === undefined ? 1.5 : ([0, 0.6, 1, 1.5].indexOf(number(dm.aptQn, 1.5)) >= 0 ? number(dm.aptQn, 1.5) : 1.5)
        };
        s.q0cEqualsQ0h = data.q0cEqualsQ0h !== false;
        s.scale = Math.max(0.005, number(data.scale, base.scale));
        s.floorPx = Math.max(10, number(data.floorPx, base.floorPx));

        s.nu = {
            cold: Math.max(0.1, number(data.nu && data.nu.cold, base.nu.cold)),
            hot: Math.max(0.1, number(data.nu && data.nu.hot, base.nu.hot))
        };

        s.vmax = {};
        ['mains', 'risers', 'apartment', 'input'].forEach(function (k) {
            s.vmax[k] = Math.max(0.1, number(data.vmax && data.vmax[k], base.vmax[k]));
        });

        s.materials = {};
        ['mains', 'risers', 'apartment'].forEach(function (k) {
            var m = data.materials && data.materials[k];
            s.materials[k] = HydData.MATERIALS.some(function (x) { return x.key === m; }) ? m : base.materials[k];
        });

        s.people = {};
        for (key in base.people) {
            if (base.people.hasOwnProperty(key)) s.people[key] = whole(data.people && data.people[key], base.people[key]);
        }

        return s;
    }

    /* --- развёртка стояков ---------------------------------------------------- */

    function typeById(hyd, id) {
        for (var i = 0; i < hyd.floorTypes.length; i++) if (hyd.floorTypes[i].id === id) return hyd.floorTypes[i];
        return null;
    }

    /* Тип этажа стояка: исключение, иначе последний из перекрывающихся диапазонов. */
    function typeOfFloor(riser, f) {
        var i;
        for (i = riser.exceptions.length - 1; i >= 0; i--) {
            if (riser.exceptions[i].floor === f) return riser.exceptions[i].typeId;
        }

        var id = '';
        for (i = 0; i < riser.ranges.length; i++) {
            if (f >= riser.ranges[i].from && f <= riser.ranges[i].to) id = riser.ranges[i].typeId;
        }
        return id;
    }

    function floorH(hyd, riser) {
        return riser.floorH > 0 ? riser.floorH : hyd.survey.floorHeight;
    }

    /*
        Отметки пола этажей стояка: levels[f]. Этаж 1 — level1 (или отметка из опросника); выше —
        предыдущая отметка плюс высота этажа (своя из heights, иначе типовая), а если для этажа
        задана отметка в elevs — она главнее. Возвращается массив с индексами 1…floorTo+1 (последний
        нужен для высоты верхнего этажа).
    */
    function levels(hyd, riser) {
        var top = Math.max(1, riser.floorTo) + 1;
        var lv = [null];
        var heights = riser.heights || {};
        var elevs = riser.elevs || {};
        var typical = floorH(hyd, riser);

        for (var f = 1; f <= top; f++) {
            if (f === 1) lv.push(riser.level1 !== null && riser.level1 !== undefined ? riser.level1 : hyd.survey.groundElev);
            else if (elevs[f] !== undefined) lv.push(elevs[f]);
            else lv.push(lv[f - 1] + (heights[f - 1] > 0 ? heights[f - 1] : typical));
        }

        return lv;
    }

    function floorElev(hyd, riser, f) {
        var lv = levels(hyd, riser);
        if (f >= 1 && f < lv.length) return lv[f];
        return lv[lv.length - 1] + (f - lv.length + 1) * floorH(hyd, riser);
    }

    /* Высота этажа f — расстояние от его пола до пола следующего. */
    function floorHeightOf(hyd, riser, f) {
        var lv = levels(hyd, riser);
        return f + 1 < lv.length ? lv[f + 1] - lv[f] : floorH(hyd, riser);
    }

    function outletPeople(survey, o) {
        if (o.people > 0) return o.people;
        var r = survey.people[Math.min(5, o.rooms)];
        return r > 0 ? r : 1;
    }

    function countFixtures(o, hotOnly) {
        var n = 0;
        for (var i = 0; i < o.fixtures.length; i++) {
            if (hotOnly && !HydData.fixture(o.fixtures[i].id).hot) continue;
            n += o.fixtures[i].count;
        }
        return n;
    }

    function labelOf(rule, n, f, k) {
        return String(rule || 'кв. {n}')
            .replace(/\{n\}/g, n).replace(/\{f\}/g, f).replace(/\{k\}/g, k);
    }

    function risers(hyd) {
        return hyd.canvas.nodes.filter(function (n) { return n.kind === 'riser'; });
    }

    /*
        Развёртка всех блоков стояков в порядке узлов на холсте. Возвращает
        { risers:[{ node, index, markC, markH, top, floors:[{ f, elev, typeId,
            collectors:[{ id, col, outlets:[item] }] }] }], outlets:[item], people }.
        item: { id, label, outlet, people, N, Nh, riser, f, col, collectorId }.
        Подписи «кв. {n}» идут сквозной нумерацией по стоякам; firstNumber > 0
        начинает счёт заново с этого номера.
    */
    function expand(hyd) {
        var survey = hyd.survey;
        var result = { risers: [], outlets: [], people: 0 };
        var n = 1;

        risers(hyd).forEach(function (node, index) {
            var entry = {
                node: node, index: index + 1, markC: 'В1.' + (index + 1), markH: 'Т3.' + (index + 1),
                top: node.floorTo, floors: []
            };

            if (node.firstNumber > 0) n = node.firstNumber;

            for (var f = node.floorFrom; f <= node.floorTo; f++) {
                var typeId = typeOfFloor(node, f);
                var type = typeId ? typeById(hyd, typeId) : null;
                var floor = { f: f, elev: floorElev(hyd, node, f), typeId: typeId, collectors: [] };
                var k = 0;

                if (type) {
                    type.collectors.forEach(function (col) {
                        var cid = node.id + '/F' + f + '/' + col.id;
                        var c = { id: cid, col: col, outlets: [] };

                        col.outlets.forEach(function (o) {
                            for (var r = 1; r <= o.count; r++) {
                                k++;
                                var people = outletPeople(survey, o);
                                var item = {
                                    id: cid + '/' + o.id + (r > 1 ? '#' + r : ''),
                                    label: labelOf(o.label, n, f, k), outlet: o,
                                    people: people, N: countFixtures(o, false), Nh: countFixtures(o, true),
                                    riser: node, f: f, col: col, collectorId: cid
                                };
                                n++;
                                c.outlets.push(item);
                                result.outlets.push(item);
                                result.people += people;
                            }
                        });

                        floor.collectors.push(c);
                    });
                }

                entry.floors.push(floor);
            }

            result.risers.push(entry);
        });

        return result;
    }

    /* Сколько выходов и людей у стояка — для подсказок в инспекторе. */
    function riserTotals(hyd, node) {
        var ex = expand(hyd);
        var out = { outlets: 0, people: 0 };

        ex.risers.forEach(function (r) {
            if (r.node.id !== node.id) return;
            r.floors.forEach(function (fl) {
                fl.collectors.forEach(function (c) {
                    c.outlets.forEach(function (it) { out.outlets++; out.people += it.people; });
                });
            });
        });

        return out;
    }

    /* Положение узла на листе. */
    function pos(node, sheet) {
        return sheet === 'h' && node.sheet === 'both' ? { x: node.hx, y: node.hy } : { x: node.x, y: node.y };
    }

    function nodeById(hyd, id) {
        var nodes = hyd.canvas.nodes;
        for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i];
        return null;
    }

    return {
        LIVING: LIVING,
        OFFICE: OFFICE,
        nextId: nextId,
        blank: blank,
        defaultNote: defaultNote,
        defaultItp: defaultItp,
        defaultElss: defaultElss,
        normalize: normalize,
        newNode: newNode,
        newOutlet: newOutlet,
        newCollector: newCollector,
        defaultTypes: defaultTypes,
        typeById: typeById,
        typeOfFloor: typeOfFloor,
        floorH: floorH,
        floorElev: floorElev,
        levels: levels,
        floorHeightOf: floorHeightOf,
        outletPeople: outletPeople,
        countFixtures: countFixtures,
        expand: expand,
        riserTotals: riserTotals,
        risers: risers,
        pos: pos,
        nodeById: nodeById
    };
})();
