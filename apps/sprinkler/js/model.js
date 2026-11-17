'use strict';

/*
    Модель проекта: узлы и участки на плане, исходные данные, расчётная зона,
    подложка.

    Координаты — метры, ось Y направлена вниз, как на экране и на картинке
    подложки: так план не приходится переворачивать при каждом переводе.

    Узел — точка сети. Ороситель — не отдельный объект, а признак узла (spr):
    в калькуляторе ороситель сидит прямо в узле рядка, и расход участка
    «1-2» — это расход оросителя 1. Так же признаками узла заданы ввод (src),
    узел управления (cu) и дополнительный расход, например пожарного крана (q).

    Участок знает свою роль: main — магистраль (питающий трубопровод), ray —
    луч. Роль не влияет на гидравлику, она нужна правке: луч — это то, что
    перекидывается через магистраль, отражается и копируется.

    Результаты расчёта в модели не хранятся: они пересчитываются из неё
    за миллисекунды при каждой правке.
*/

var Model = (function () {

    var EPS = 1e-9;

    function defaults() {
        return {
            group: '2',
            intensity: 0.12,
            area: 120,
            minutes: 60,
            maxSpacing: 4,

            maker: 'Спецавтоматика',
            sprinklerType: 'СВН-12',
            dictHead: 18,
            k: 0.47,
            spacing: 3.2,
            coverDia: 4,

            sprinklerElev: -0.2,
            inletElev: -3.6,

            cuKind: 'Прямоточный',
            cuDn: 150,
            cuXi: null,

            suction: 0,
            guaranteed: 26,
            pumpLoss: 3,
            localFactor: 1.2,
            systemKind: 'водозаполненная',
            coldRoom: false,

            /*
                План бывает двух видов: спринклерное пожаротушение (работают
                оросители) и внутреннее пожаротушение по плану — магистраль с
                пожарными кранами, обычно паркинга и обычно воздушная. Во
                втором случае расчётные точки — краны, а не оросители.
            */
            planKind: 'apt',

            /*
                Внутреннее пожаротушение считается как ВПВ: потери по длине по
                Дарси–Вейсбаху, λ по Шевелеву для неновых стальных труб, а
                расчётный диаметр меньше внутреннего на запас под отложения.
                Kт остаётся за АУП (СП 485 прил. Б), на план кранов он не идёт.
            */
            hydr: { formula: 'shevelev', nu: 1.31, reserve: 1 },

            pkJets: 1,
            pkFlow: 3.5,
            pkHead: 10,
            pkElev: null,

            // Ствол и рукав — по ним табл. 7.3 СП 10.13130 даёт расход и напор.
            pkDn: 65,
            pkNozzle: 19,
            pkHose: 20,
            pkCompact: 6,

            code: '',
            systemName: 'В24',
            objectText: 'объекта',
            tableTitle: 'Спринклерное пожаротушение',
            pumpText: '',

            pipeMain: { material: 'ГОСТ10704', od: 159, wall: 4 },
            pipeRay: { material: 'ГОСТ3262', od: 48, wall: 3 },

            num: {
                mainStyle: 'digits',
                mainStart: 1,
                mainPrefix: '',
                mainSuffix: '',
                branchStyle: 'letters',
                branchStart: 1,
                branchPrefix: '',
                branchSuffix: '',
                attach: 'own',
                direction: 'dict',
                sourceLabel: 'ввод',
                cuLabel: 'УУ'
            },

            labels: {
                nodes: true,
                pressure: true,
                flow: false,
                length: true,
                loss: true,
                pipe: false,
                circles: false,
                dims: true
            },

            /*
                Коридоры жилых домов выше 75 м. Расстановка там идёт не по
                сетке, а по квартирным дверям, и правила у неё свои: см.
                corridor.js. Диаметры — строкой «оросителей : Ду»; dn больше
                нуля задаёт один диаметр на весь коридор.
            */
            corridor: {
                doorReach: 0.5,
                minStep: 1.5,
                maxStep: 3.5,
                endReach: 0,
                diameters: '3:25|6:32|12:40|20:50|40:65',
                dn: 0
            },

            snapStep: 0.05,
            bindTail: true,

            tableMode: 'sp',
            collapseAnalogs: false
        };
    }

    function create() {
        return {
            format: 'sprinkler-web',
            version: 1,
            name: 'Без названия',
            settings: defaults(),
            nodes: [],
            segments: [],
            zone: null,

            /*
                Разметка коридора: ось (она же ось трубы) и квартирные двери.
                Хранится в проекте, а не в инструменте: поменяв шаг, ряд
                пересобирают по той же разметке, а не обводят коридор заново.
            */
            corridor: { axis: [], doors: [], notes: [] },
            underlay: null,
            dxf: null,
            nextId: 1
        };
    }

    /* --- доступ ----------------------------------------------------------- */

    function node(p, id) {
        for (var i = 0; i < p.nodes.length; i++) {
            if (p.nodes[i].id === id) return p.nodes[i];
        }
        return null;
    }

    function seg(p, id) {
        for (var i = 0; i < p.segments.length; i++) {
            if (p.segments[i].id === id) return p.segments[i];
        }
        return null;
    }

    function segmentsAt(p, id) {
        return p.segments.filter(function (s) { return s.a === id || s.b === id; });
    }

    function other(s, id) {
        return s.a === id ? s.b : s.a;
    }

    function source(p) {
        for (var i = 0; i < p.nodes.length; i++) {
            if (p.nodes[i].src) return p.nodes[i];
        }
        return null;
    }

    function between(p, a, b) {
        for (var i = 0; i < p.segments.length; i++) {
            var s = p.segments[i];
            if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return s;
        }
        return null;
    }

    /* --- создание --------------------------------------------------------- */

    function assign(target, props) {
        if (!props) return target;
        for (var key in props) {
            if (Object.prototype.hasOwnProperty.call(props, key)) target[key] = props[key];
        }
        return target;
    }

    function addNode(p, x, y, props) {
        var n = {
            id: p.nextId++,
            x: x,
            y: y,
            spr: false,
            src: false,
            cu: false,
            off: false,
            dict: false,
            q: 0,
            k: null,
            model: '',
            pk: null,
            label: '',
            cover: 0
        };
        assign(n, props);
        p.nodes.push(n);
        return n;
    }

    function pipeFor(p, role) {
        var t = role === 'main' ? p.settings.pipeMain : p.settings.pipeRay;
        return { material: t.material, od: t.od, wall: t.wall };
    }

    function addSegment(p, a, b, props) {
        if (a === b) return null;

        var existing = between(p, a, b);
        if (existing) return existing;

        var role = props && props.role ? props.role : 'ray';
        var s = assign({
            id: p.nextId++,
            a: a,
            b: b,
            role: role,
            len: null,
            kt: null,
            ring: false
        }, pipeFor(p, role));

        assign(s, props);
        p.segments.push(s);
        return s;
    }

    /* --- геометрия -------------------------------------------------------- */

    function geomLength(p, s) {
        var A = node(p, s.a);
        var B = node(p, s.b);
        return Math.sqrt((B.x - A.x) * (B.x - A.x) + (B.y - A.y) * (B.y - A.y));
    }

    /** Длина участка: введённая вручную, а если её нет — по плану. */
    function length(p, s) {
        return s.len > 0 ? s.len : geomLength(p, s);
    }

    /** Проекция точки на отрезок: доля t, точка и расстояние. */
    function projectOn(ax, ay, bx, by, x, y) {
        var dx = bx - ax;
        var dy = by - ay;
        var l2 = dx * dx + dy * dy;
        var t = l2 > EPS ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        if (t < 0) t = 0;
        if (t > 1) t = 1;

        var px = ax + dx * t;
        var py = ay + dy * t;

        return { t: t, x: px, y: py, d: Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)) };
    }

    function unit(x, y) {
        var l = Math.sqrt(x * x + y * y);
        return l > EPS ? { x: x / l, y: y / l } : { x: 1, y: 0 };
    }

    /* --- правка сети ------------------------------------------------------ */

    /**
     * Разбить участок точкой. Новый узел садится на проекцию точки. Введённая
     * вручную длина делится пропорционально: иначе обе половинки унаследовали
     * бы полную длину и потери удвоились бы молча.
     */
    function splitSegment(p, s, x, y, props) {
        var A = node(p, s.a);
        var B = node(p, s.b);
        var pr = projectOn(A.x, A.y, B.x, B.y, x, y);
        var t = Math.min(0.999, Math.max(0.001, pr.t));

        var n = addNode(p, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, props);
        var manual = s.len;
        var oldB = s.b;

        s.b = n.id;

        var tail = addSegment(p, n.id, oldB, {
            role: s.role,
            material: s.material,
            od: s.od,
            wall: s.wall,
            kt: s.kt,
            ring: s.ring
        });

        if (manual > 0) {
            s.len = manual * t;
            tail.len = manual - s.len;
        }

        return n;
    }

    function removeSegment(p, id) {
        p.segments = p.segments.filter(function (s) { return s.id !== id; });
    }

    function removeNode(p, id) {
        p.segments = p.segments.filter(function (s) { return s.a !== id && s.b !== id; });
        p.nodes = p.nodes.filter(function (n) { return n.id !== id; });
    }

    /** Узел, который ничего не значит сам по себе: не ороситель, не ввод, без подписи. */
    function isPlain(n) {
        return !n.spr && !n.src && !n.cu && !(n.q > 0) && !n.label && !n.dict && !n.pk;
    }

    /**
     * Прибраться в узле после удаления или переноса луча: висящий пустой узел
     * убрать, а пустой узел посреди прямой магистрали склеить обратно в один
     * участок. Иначе после десятка перекидок магистраль превращается в цепочку
     * огрызков по полметра, и таблица распухает.
     */
    function tidy(p, id) {
        var n = node(p, id);
        if (!n || !isPlain(n)) return;

        var list = segmentsAt(p, id);

        if (list.length === 0) {
            removeNode(p, id);
            return;
        }

        if (list.length !== 2) return;

        var s1 = list[0];
        var s2 = list[1];

        if (s1.role !== s2.role || s1.material !== s2.material || s1.od !== s2.od
            || s1.wall !== s2.wall || s1.ring !== s2.ring || s1.kt || s2.kt) {
            return;
        }

        var a = node(p, other(s1, id));
        var b = node(p, other(s2, id));

        var ux = n.x - a.x, uy = n.y - a.y;
        var vx = b.x - n.x, vy = b.y - n.y;
        var lu = Math.sqrt(ux * ux + uy * uy);
        var lv = Math.sqrt(vx * vx + vy * vy);

        if (lu < EPS || lv < EPS) return;
        if (Math.abs(ux * vy - uy * vx) > 1e-3 * lu * lv) return;
        if (ux * vx + uy * vy <= 0) return;

        var manual = s1.len > 0 || s2.len > 0 ? length(p, s1) + length(p, s2) : null;

        if (s1.a === id) s1.a = b.id; else s1.b = b.id;
        s1.len = manual;

        removeSegment(p, s2.id);
        removeNode(p, id);
    }

    /* --- лучи ------------------------------------------------------------- */

    function touchesMain(p, id) {
        var list = segmentsAt(p, id);
        for (var i = 0; i < list.length; i++) {
            if (list[i].role === 'main') return true;
        }
        return false;
    }

    /**
     * Луч, в который входит участок: связная группа участков-лучей. Обход
     * останавливается на узлах магистрали и на вводе — это узлы присоединения.
     * Дальше них не идём: иначе два луча, сидящие на одном тройнике по разные
     * стороны магистрали, склеились бы в один.
     */
    function branchOf(p, segId) {
        var start = seg(p, segId);
        if (!start || start.role === 'main') return null;

        var segs = {};
        var nodes = {};
        var attaches = [];
        var queue = [start];

        segs[start.id] = true;

        while (queue.length) {
            var s = queue.shift();
            var ends = [s.a, s.b];

            for (var e = 0; e < 2; e++) {
                var id = ends[e];
                if (nodes[id] || attaches.indexOf(id) >= 0) continue;

                var n = node(p, id);
                if (touchesMain(p, id) || n.src) {
                    attaches.push(id);
                    continue;
                }

                nodes[id] = true;

                var around = segmentsAt(p, id);
                for (var i = 0; i < around.length; i++) {
                    var t = around[i];
                    if (!segs[t.id] && t.role !== 'main') {
                        segs[t.id] = true;
                        queue.push(t);
                    }
                }
            }
        }

        return {
            segs: Object.keys(segs).map(Number),
            nodes: Object.keys(nodes).map(Number),
            attach: attaches.length ? attaches[0] : null,
            attaches: attaches
        };
    }

    /** Луч, которому принадлежит узел: по первому участку-лучу в нём. */
    function branchOfNode(p, id) {
        var list = segmentsAt(p, id);
        for (var i = 0; i < list.length; i++) {
            if (list[i].role !== 'main') return branchOf(p, list[i].id);
        }
        return null;
    }

    /**
     * Направление магистрали в узле присоединения. Нет магистрали (луч прямо
     * от ввода) — берётся перпендикуляр к самому лучу, и отражение
     * превращается в разворот на другую сторону.
     */
    function mainDirection(p, id, br) {
        var n = node(p, id);
        var list = segmentsAt(p, id);
        var i, o;

        for (i = 0; i < list.length; i++) {
            if (list[i].role === 'main') {
                o = node(p, other(list[i], id));
                return unit(o.x - n.x, o.y - n.y);
            }
        }

        for (i = 0; i < list.length; i++) {
            if (!br || br.segs.indexOf(list[i].id) >= 0) {
                o = node(p, other(list[i], id));
                var d = unit(o.x - n.x, o.y - n.y);
                return { x: -d.y, y: d.x };
            }
        }

        return { x: 1, y: 0 };
    }

    function reflect(ax, ay, u, x, y) {
        var vx = x - ax;
        var vy = y - ay;
        var d = vx * u.x + vy * u.y;
        return { x: ax + 2 * d * u.x - vx, y: ay + 2 * d * u.y - vy };
    }

    /** Перекинуть луч через магистраль: зеркально относительно её оси. */
    function mirrorBranch(p, br) {
        if (!br || br.attach === null) return false;

        var A = node(p, br.attach);
        var u = mainDirection(p, br.attach, br);

        br.nodes.forEach(function (id) {
            var n = node(p, id);
            var r = reflect(A.x, A.y, u, n.x, n.y);
            n.x = r.x;
            n.y = r.y;
        });

        return true;
    }

    /** Повернуть луч вокруг узла присоединения на угол в градусах. */
    function rotateBranch(p, br, degrees) {
        if (!br || br.attach === null) return false;

        var A = node(p, br.attach);
        var a = degrees * Math.PI / 180;
        var c = Math.cos(a);
        var s = Math.sin(a);

        br.nodes.forEach(function (id) {
            var n = node(p, id);
            var dx = n.x - A.x;
            var dy = n.y - A.y;
            n.x = A.x + dx * c - dy * s;
            n.y = A.y + dx * s + dy * c;
        });

        return true;
    }

    /**
     * Точка присоединения к магистрали возле указанной точки: узел магистрали
     * или место на её участке. tol — допуск в метрах.
     */
    function nearestMain(p, x, y, tol) {
        var best = null;
        var i;

        for (i = 0; i < p.nodes.length; i++) {
            var n = p.nodes[i];
            if (!touchesMain(p, n.id) && !n.src) continue;

            var d = Math.sqrt((n.x - x) * (n.x - x) + (n.y - y) * (n.y - y));
            if (d <= tol && (!best || d < best.d)) best = { node: n.id, x: n.x, y: n.y, d: d };
        }

        if (best) return best;

        for (i = 0; i < p.segments.length; i++) {
            var s = p.segments[i];
            if (s.role !== 'main') continue;

            var A = node(p, s.a);
            var B = node(p, s.b);
            var pr = projectOn(A.x, A.y, B.x, B.y, x, y);

            if (pr.d <= tol && (!best || pr.d < best.d)) {
                best = { seg: s.id, x: pr.x, y: pr.y, d: pr.d };
            }
        }

        return best;
    }

    /**
     * Копия луча в другой точке магистрали — «аналог». target — результат
     * nearestMain. mirror — положить копию на другую сторону магистрали.
     * Возвращает соответствие старых узлов новым либо null с причиной.
     */
    function cloneBranch(p, br, target, mirror) {
        if (!br || br.attach === null) return { error: 'У луча нет узла присоединения к магистрали.' };
        if (br.attaches.length > 1) return { error: 'Луч связывает два узла магистрали — копировать его как аналог нельзя.' };

        var A = node(p, br.attach);
        var T = target.node ? node(p, target.node) : splitSegment(p, seg(p, target.seg), target.x, target.y);
        var dx = T.x - A.x;
        var dy = T.y - A.y;
        var u = mirror ? mainDirection(p, T.id, null) : null;
        var map = {};

        map[br.attach] = T.id;

        br.nodes.forEach(function (id) {
            var n = node(p, id);
            var x = n.x + dx;
            var y = n.y + dy;

            if (u) {
                var r = reflect(T.x, T.y, u, x, y);
                x = r.x;
                y = r.y;
            }

            map[id] = addNode(p, x, y, {
                spr: n.spr, off: n.off, q: n.q, k: n.k, model: n.model,
                // Копия крана получает свой номер по порядку, а не имя оригинала.
                pk: n.pk ? { jets: n.pk.jets, flow: n.pk.flow, head: n.pk.head, elev: n.pk.elev, name: '' } : null
            }).id;
        });

        br.segs.forEach(function (id) {
            var s = seg(p, id);
            addSegment(p, map[s.a], map[s.b], {
                role: s.role,
                material: s.material,
                od: s.od,
                wall: s.wall,
                len: s.len,
                kt: s.kt,
                ring: s.ring
            });
        });

        return { map: map, attach: T.id };
    }

    /** Удалить луч целиком и прибрать узел, к которому он был присоединён. */
    function removeBranch(p, br) {
        br.segs.forEach(function (id) { removeSegment(p, id); });
        br.nodes.forEach(function (id) { removeNode(p, id); });
        br.attaches.forEach(function (id) { tidy(p, id); });
    }

    /** Перенести луч в другую точку магистрали. */
    function moveBranch(p, br, target, mirror) {
        if (target.node === br.attach) {
            if (mirror) mirrorBranch(p, br);
            return { attach: br.attach };
        }

        var result = cloneBranch(p, br, target, mirror);
        if (result.error) return result;

        removeBranch(p, br);
        return result;
    }

    /**
     * Размножить луч вдоль магистрали: count копий с шагом step. dir — +1 или
     * −1, по направлению магистрали. alternate — копии через одну на другую
     * сторону. Точка, не попавшая на магистраль, пропускается и считается.
     */
    function arrayBranch(p, br, count, step, dir, alternate) {
        var A = node(p, br.attach);
        var u = mainDirection(p, br.attach, br);
        var placed = 0;
        var skipped = 0;
        var ax = A.x;
        var ay = A.y;

        for (var i = 1; i <= count; i++) {
            var x = ax + u.x * step * i * dir;
            var y = ay + u.y * step * i * dir;
            var target = nearestMain(p, x, y, 0.05);

            if (!target) {
                skipped++;
                continue;
            }

            var result = cloneBranch(p, br, target, alternate && i % 2 === 1);
            if (result.error) return { error: result.error, placed: placed, skipped: skipped };
            placed++;
        }

        return { placed: placed, skipped: skipped };
    }

    /* --- расчётная зона --------------------------------------------------- */

    function pointInPolygon(poly, x, y) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y;
            var xj = poly[j].x, yj = poly[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    function polygonArea(poly) {
        var sum = 0;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
        }
        return Math.abs(sum) / 2;
    }

    function hasZone(p) {
        return !!(p.zone && p.zone.length >= 3);
    }

    function inZone(p, n) {
        return !hasZone(p) || pointInPolygon(p.zone, n.x, n.y);
    }

    /* --- пожарные краны -------------------------------------------------- */

    /**
     * Параметры крана с подстановкой значений по умолчанию из исходных данных.
     *
     * Напоры в сети отсчитываются от отметки оросителей: план плоский, и вся
     * разводка считается на этой высоте. Клапан ПК обычно ниже (1,35 м от пола),
     * там давление больше на разницу отметок, поэтому узлу крана нужно
     * need = Hпк − (отм. оросителей − отм. клапана).
     */
    /*
        Отметка, к которой приведён расчёт сети. У плана АУП это отметка
        оросителей, у плана внутреннего пожаротушения — своя геометрия: отметка
        клапана пожарного крана. Кран со своей отметкой приводится к ней же.
    */
    function planeElev(s) {
        if (s.planKind !== 'vpv') return s.sprinklerElev;
        return typeof s.pkElev === 'number' ? s.pkElev : s.sprinklerElev;
    }

    function hydrant(p, n, jets) {
        if (!n || !n.pk) return null;

        var s = p.settings;
        var k = n.pk;
        var table = tableOf(s);

        /*
            Сколько струй у этого крана. На плане внутреннего пожаротушения
            «число струй» исходных данных — расчётное число струй системы,
            а не каждого крана: сколько их достаётся крану, решает расчёт и
            передаёт сюда третьим аргументом.
        */
        if (jets === undefined || jets === null) jets = k.jets > 0 ? k.jets : s.pkJets;
        var flow = k.flow > 0 ? k.flow : s.pkFlow > 0 ? s.pkFlow : table.q;
        var head = k.head > 0 ? k.head : s.pkHead > 0 ? s.pkHead : table.p;
        var elev = typeof k.elev === 'number' ? k.elev
            : typeof s.pkElev === 'number' ? s.pkElev : s.sprinklerElev;

        return {
            jets: jets,
            flow: flow,
            head: head,
            elev: elev,
            Q: jets * flow,
            need: head - (planeElev(s) - elev)
        };
    }

    /** Обозначение крана: своё или ПК-1, ПК-2 … по порядку появления. */
    /*
        Табл. 7.3 СП 10.13130: расход струи и напор у клапана по DN, спрыску,
        рукаву и компактной струе. Своё число в исходных данных её перебивает,
        а если сочетания в таблице нет, остаются нули — и тогда расход с
        напором вписывают руками.
    */
    function tableOf(s) {
        if (typeof Vpv === 'undefined' || !Vpv.lookup) return { q: 0, p: 0, found: false };
        return Vpv.lookup(s.pkDn, s.pkCompact, s.pkNozzle, s.pkHose);
    }

    function hydrantName(p, n) {
        if (n.pk && n.pk.name) return n.pk.name;

        var index = 0;
        for (var i = 0; i < p.nodes.length; i++) {
            if (p.nodes[i].pk) index++;
            if (p.nodes[i] === n) break;
        }
        return 'ПК-' + index;
    }

    return {
        hydrant: hydrant,
        pkTable: tableOf,
        planeElev: planeElev,
        hydrantName: hydrantName,
        defaults: defaults,
        create: create,
        node: node,
        seg: seg,
        segmentsAt: segmentsAt,
        other: other,
        source: source,
        between: between,
        addNode: addNode,
        addSegment: addSegment,
        pipeFor: pipeFor,
        geomLength: geomLength,
        length: length,
        projectOn: projectOn,
        unit: unit,
        splitSegment: splitSegment,
        removeSegment: removeSegment,
        removeNode: removeNode,
        tidy: tidy,
        touchesMain: touchesMain,
        branchOf: branchOf,
        branchOfNode: branchOfNode,
        mainDirection: mainDirection,
        mirrorBranch: mirrorBranch,
        rotateBranch: rotateBranch,
        nearestMain: nearestMain,
        cloneBranch: cloneBranch,
        removeBranch: removeBranch,
        moveBranch: moveBranch,
        arrayBranch: arrayBranch,
        pointInPolygon: pointInPolygon,
        polygonArea: polygonArea,
        hasZone: hasZone,
        inZone: inZone
    };
})();
