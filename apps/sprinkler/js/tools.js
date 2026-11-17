'use strict';

/*
    Инструменты черчения и правки.

    Всё, что меняет сеть, заканчивается App.afterEdit(подпись): пересчёт,
    шаг отмены, автосохранение и перерисовка в одном месте. Отдельных
    обратных операций для отмены здесь нет и быть не должно.

    Длина набирается с клавиатуры прямо во время черчения: «3,2» и Enter
    ставят точку ровно в 3,2 м по направлению курсора. Пустой Enter
    повторяет последнюю длину — так ставится ряд оросителей с шагом.
*/

var Tools = (function () {

    var HINTS = {
        select: 'Щелчок по размеру или длине — ввести новое значение. Ороситель тянется вдоль или поперёк трубы, луч — вдоль магистрали или вдоль себя; Alt — свободно, Ctrl — без цепочки. F — отразить, C — копия, G — перенести, Del — удалить.',
        main: 'Магистраль: щелчок — точка; наберите длину и Enter — точно. Щелчок по существующей сети завершает. Alt — без привязок, Esc — закончить.',
        ray: 'Луч: начните на магистрали, дальше каждый щелчок ставит ороситель. Наберите шаг «3,2» и Enter, затем Enter ещё раз — следующий ороситель с тем же шагом. Esc — закончить.',
        sprinkler: 'Ороситель: щелчок по пустому месту — отдельный ороситель, по трубе — ороситель в трубе, по узлу — включить или снять.',
        source: 'Ввод: щелчок по узлу, трубе или пустому месту. Ввод в проекте один.',
        cu: 'Узел управления: щелчок по узлу или трубе магистрали.',
        pk: 'Пожарный кран: щелчок по трубе или узлу ставит кран в сеть, по пустому месту — отдельно (затем проведите к нему трубу). Щелчок по крану — убрать. Струи, расход и давление — в свойствах слева.',
        zone: 'Расчётная зона: обведите контур щелчками. Enter, двойной или правый щелчок — замкнуть. Считаются только оросители внутри.',
        corridor: 'Коридор: щелчками ведите ось по коридору — последняя точка на стояке. Enter — перейти к дверям; дальше щелчок по каждой квартирной двери, остальные двери не отмечайте. Enter ещё раз — расставить оросители и собрать трубу. Esc — снять разметку.',
        measure: 'Рулетка: два щелчка — расстояние.',
        calibrate: 'Масштаб подложки: щёлкните по концам известного размера, затем введите его длину в метрах.',
        underlay: 'Подложка: перетащите картинку мышью.',
        dxf: 'Чертёж DXF: перетащите мышью. Масштаб задан при вставке — его меняют повторной вставкой файла.',
        erase: 'Удалить: щелчок по узлу или трубе. Ороситель в середине луча удаляется со сшивкой трубы.'
    };

    var canvas = null;
    var tool = 'select';
    var mouse = { px: 0, py: 0, x: 0, y: 0, inside: false };

    var chain = null;       // { last, role }
    var typed = '';
    var lastTyped = null;
    var snap = null;
    var drag = null;
    var hover = null;
    var zonePts = [];
    var measurePts = [];
    var calibPts = [];
    var place = null;       // { mode, br, flip, dragging, target, mirror, u }
    var altKey = false;

    /* --- общее ----------------------------------------------------------- */

    function project() { return App.project; }

    function isField(el) {
        return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
    }

    function updateMouse(e) {
        var r = canvas.getBoundingClientRect();
        mouse.px = e.clientX - r.left;
        mouse.py = e.clientY - r.top;
        var w = View.toWorld(mouse.px, mouse.py);
        mouse.x = w.x;
        mouse.y = w.y;
        altKey = e.altKey;
    }

    function hint() {
        return HINTS[tool] || '';
    }

    function set(name) {
        cancelTransient();

        // На плане внутреннего пожаротушения оросителей, узла управления и
        // расчётной зоны нет — такие инструменты не включаются и с клавиатуры.
        if (App.project && App.project.settings.planKind === 'vpv'
            && ['ray', 'sprinkler', 'cu', 'zone', 'corridor'].indexOf(name) >= 0) {
            name = 'select';
        }

        tool = name;
        canvas.style.cursor = name === 'select' ? 'default' : name === 'underlay' || name === 'dxf' ? 'move' : 'crosshair';
        App.status(hint());
        Panels.updateTools();
        View.render();
    }

    function current() { return tool; }

    function cancelTransient() {
        endChain();
        zonePts = [];
        measurePts = [];
        calibPts = [];
        place = null;
        typed = '';
    }

    /* --- привязки -------------------------------------------------------- */

    function snapAt(px, py, exclude) {
        var p = project();
        var w = View.toWorld(px, py);
        var res = { x: w.x, y: w.y, node: null, seg: null, kind: 'free', len: null };

        if (altKey) return res;

        var h = View.hit(px, py, { exclude: exclude });
        var from = chain ? Model.node(p, chain.last) : null;

        if (h && h.type === 'node') {
            var n = Model.node(p, h.id);
            res.x = n.x;
            res.y = n.y;
            res.node = n.id;
            res.kind = 'node';
            return res;
        }

        if (h && h.type === 'seg') {
            var s = Model.seg(p, h.id);
            var A = Model.node(p, s.a);
            var B = Model.node(p, s.b);
            var pr = Model.projectOn(A.x, A.y, B.x, B.y, w.x, w.y);

            // Основание перпендикуляра из предыдущей точки — самая частая цель.
            if (from) {
                var foot = Model.projectOn(A.x, A.y, B.x, B.y, from.x, from.y);
                var dd = Math.sqrt((foot.x - pr.x) * (foot.x - pr.x) + (foot.y - pr.y) * (foot.y - pr.y));
                if (foot.t > 0.001 && foot.t < 0.999 && dd * View.scale() < 14) pr = foot;
            }

            res.x = pr.x;
            res.y = pr.y;
            res.seg = s.id;
            res.kind = 'seg';
            return res;
        }

        if (from) {
            var dx = w.x - from.x;
            var dy = w.y - from.y;
            var len = Math.sqrt(dx * dx + dy * dy);

            if (len > 1e-6) {
                var angle = Math.atan2(dy, dx);
                var step = Math.PI / 4;
                var snapped = Math.round(angle / step) * step;
                var ortho = Math.abs(angle - snapped) < 7 * Math.PI / 180;
                if (ortho) angle = snapped;

                var rounded = Math.max(0.05, Math.round(len / 0.05) * 0.05);
                res.x = from.x + Math.cos(angle) * rounded;
                res.y = from.y + Math.sin(angle) * rounded;
                res.len = rounded;

                // Выравнивание по оросителям соседних лучей — только вдоль осей.
                if (ortho && Math.abs(Math.sin(angle)) < 1e-9) res.x = alignTo(res.x, 'x', from);
                if (ortho && Math.abs(Math.cos(angle)) < 1e-9) res.y = alignTo(res.y, 'y', from);
                if (res.x !== from.x + Math.cos(angle) * rounded || res.y !== from.y + Math.sin(angle) * rounded) {
                    res.len = Math.sqrt((res.x - from.x) * (res.x - from.x) + (res.y - from.y) * (res.y - from.y));
                    res.kind = 'aligned';
                }
            }
        }

        return res;
    }

    function alignTo(value, axis, from) {
        var tol = 6 / View.scale();
        var best = value;
        var bestD = tol;

        project().nodes.forEach(function (n) {
            if (!n.spr || n.id === (chain && chain.last)) return;
            var d = Math.abs(n[axis] - value);
            if (d < bestD && Math.abs(n[axis] - from[axis]) > 1e-6) {
                bestD = d;
                best = n[axis];
            }
        });

        return best;
    }

    /* --- черчение магистрали и лучей ------------------------------------ */

    function degreeOf(id) {
        return Model.segmentsAt(project(), id).length;
    }

    function chainClick(sn) {
        var p = project();
        var role = tool === 'main' ? 'main' : 'ray';
        var nodeId;
        var connected = false;

        if (sn.node) {
            nodeId = sn.node;
            connected = degreeOf(nodeId) > 0;
        } else if (sn.seg) {
            nodeId = Model.splitSegment(p, Model.seg(p, sn.seg), sn.x, sn.y).id;
            connected = true;
        } else {
            nodeId = Model.addNode(p, sn.x, sn.y, { spr: role === 'ray' }).id;
        }

        if (!chain) {
            chain = { last: nodeId, role: role };
            App.afterEdit(role === 'main' ? 'начало магистрали' : 'начало луча');
            return;
        }

        if (nodeId === chain.last) return;

        Model.addSegment(p, chain.last, nodeId, { role: role });
        chain.last = nodeId;

        if (connected) endChain();

        App.afterEdit(role === 'main' ? 'участок магистрали' : 'участок луча');
    }

    function applyTyped() {
        if (!chain) return;

        var p = project();
        var len = Fmt.parse(typed);
        if (!(len > 0)) len = lastTyped;
        typed = '';
        if (!(len > 0)) return;

        lastTyped = len;

        var from = Model.node(p, chain.last);
        var sn = snapAt(mouse.px, mouse.py, chain.last);
        var dx = sn.x - from.x;
        var dy = sn.y - from.y;
        var l = Math.sqrt(dx * dx + dy * dy);

        if (l < 1e-6) {
            // Курсор на самой точке — продолжить направление последнего участка.
            var list = Model.segmentsAt(p, from.id);
            if (!list.length) return;
            var prev = Model.node(p, Model.other(list[list.length - 1], from.id));
            dx = from.x - prev.x;
            dy = from.y - prev.y;
            l = Math.sqrt(dx * dx + dy * dy);
            if (l < 1e-6) return;
        }

        chainClick({ x: from.x + dx / l * len, y: from.y + dy / l * len, node: null, seg: null });
    }

    function endChain() {
        if (!chain) return;
        var last = chain.last;
        chain = null;
        typed = '';
        var p = project();
        if (Model.node(p, last) && degreeOf(last) === 0 && !Model.node(p, last).spr) {
            Model.removeNode(p, last);
            App.afterEdit('черчение');
        }
    }

    /* --- точечные инструменты -------------------------------------------- */

    function sprinklerClick() {
        var p = project();
        var h = View.hit(mouse.px, mouse.py);

        if (h && h.type === 'node') {
            var n = Model.node(p, h.id);
            n.spr = !n.spr;
            App.afterEdit(n.spr ? 'ороситель' : 'снят ороситель');
            return;
        }

        if (h && h.type === 'seg') {
            Model.splitSegment(p, Model.seg(p, h.id), mouse.x, mouse.y, { spr: true });
            App.afterEdit('ороситель в трубе');
            return;
        }

        Model.addNode(p, mouse.x, mouse.y, { spr: true });
        App.afterEdit('ороситель');
    }

    function sourceClick() {
        var p = project();
        var h = View.hit(mouse.px, mouse.py);
        var target;

        if (h && h.type === 'node') target = Model.node(p, h.id);
        else if (h && h.type === 'seg') target = Model.splitSegment(p, Model.seg(p, h.id), mouse.x, mouse.y);
        else target = Model.addNode(p, mouse.x, mouse.y);

        p.nodes.forEach(function (n) {
            if (n !== target && n.src) {
                n.src = false;
                Model.tidy(p, n.id);
            }
        });
        target.src = true;
        App.afterEdit('ввод');
    }

    function cuClick() {
        var p = project();
        var h = View.hit(mouse.px, mouse.py);

        if (h && h.type === 'node') {
            var n = Model.node(p, h.id);
            n.cu = !n.cu;
            if (!n.cu) Model.tidy(p, n.id);
            App.afterEdit('узел управления');
        } else if (h && h.type === 'seg') {
            Model.splitSegment(p, Model.seg(p, h.id), mouse.x, mouse.y, { cu: true });
            App.afterEdit('узел управления');
        } else {
            App.status('Узел управления ставится на узел или трубу.', 'warn');
        }
    }

    function newHydrant() {
        return { jets: null, flow: null, head: null, elev: null, name: '', use: null };
    }

    function pkClick() {
        var p = project();
        var h = View.hit(mouse.px, mouse.py);
        var target;

        if (h && h.type === 'node') {
            target = Model.node(p, h.id);
            if (target.pk) {
                target.pk = null;
                Model.tidy(p, target.id);
                App.afterEdit('снят пожарный кран');
                return;
            }
            target.pk = newHydrant();
        } else if (h && h.type === 'seg') {
            target = Model.splitSegment(p, Model.seg(p, h.id), mouse.x, mouse.y, { pk: newHydrant() });
        } else {
            target = Model.addNode(p, mouse.x, mouse.y, { pk: newHydrant() });
        }

        App.afterEdit('пожарный кран');
        App.select({ type: 'node', id: target.id });
    }

    /** Удалить узел; у узла с двумя трубами трубы сшиваются в одну. */
    function eraseNode(id) {
        var p = project();
        var list = Model.segmentsAt(p, id);

        if (list.length === 2) {
            var a = Model.other(list[0], id);
            var b = Model.other(list[1], id);
            var manual = list[0].len > 0 || list[1].len > 0
                ? Model.length(p, list[0]) + Model.length(p, list[1]) : null;
            var props = {
                role: list[0].role, material: list[0].material, od: list[0].od, wall: list[0].wall,
                kt: list[0].kt, ring: list[0].ring, len: manual
            };
            Model.removeNode(p, id);
            if (a !== b) Model.addSegment(p, a, b, props);
        } else {
            var ends = list.map(function (s) { return Model.other(s, id); });
            Model.removeNode(p, id);
            ends.forEach(function (e) { Model.tidy(p, e); });
        }
    }

    function eraseSeg(id) {
        var p = project();
        var s = Model.seg(p, id);
        if (!s) return;
        Model.removeSegment(p, id);
        Model.tidy(p, s.a);
        Model.tidy(p, s.b);
    }

    function eraseClick() {
        var h = View.hit(mouse.px, mouse.py);
        if (!h) return;
        if (h.type === 'node') eraseNode(h.id);
        else eraseSeg(h.id);
        App.afterEdit('удаление');
    }

    function zoneClick(close) {
        var pt = zonePoint();

        if (!close) {
            if (zonePts.length >= 3) {
                var first = zonePts[0];
                var d = Math.sqrt(Math.pow(View.sx(first.x) - mouse.px, 2) + Math.pow(View.sy(first.y) - mouse.py, 2));
                if (d < 10) close = true;
            }
            if (!close) {
                var lastPt = zonePts[zonePts.length - 1];
                if (!lastPt || Math.abs(lastPt.x - pt.x) + Math.abs(lastPt.y - pt.y) > 1e-6) zonePts.push(pt);
                View.render();
                return;
            }
        }

        if (zonePts.length >= 3) {
            project().zone = zonePts.slice();
            zonePts = [];
            App.afterEdit('расчётная зона');
        }
    }

    function zonePoint() {
        var h = altKey ? null : View.hit(mouse.px, mouse.py);
        if (h && h.type === 'node') {
            var n = Model.node(project(), h.id);
            return { x: n.x, y: n.y };
        }

        var pt = { x: mouse.x, y: mouse.y };
        var last = zonePts[zonePts.length - 1];
        if (last && !altKey) {
            var tol = 8 / View.scale();
            if (Math.abs(pt.x - last.x) < tol) pt.x = last.x;
            if (Math.abs(pt.y - last.y) < tol) pt.y = last.y;
        }
        return pt;
    }

    /* --- коридор ---------------------------------------------------------- */

    /*
        Коридор размечается в два приёма: сначала ось, потом квартирные двери.

        ПОЧЕМУ ДВА, А НЕ ОДИН. Ось и двери — разные вещи: ось задаёт, где
        пойдёт труба, двери — где обязаны стоять оросители. Смешать их в одну
        череду щелчков нельзя: по щелчку не угадать, поставил проектировщик
        поворот коридора или отметил дверь.

        Разметка живёт в проекте, а не в инструменте: поменяв наибольший шаг,
        ряд пересобирают по той же разметке — обводить коридор заново незачем.
    */
    var corridorPhase = 'axis';

    function corridorState() {
        var p = project();
        if (!p.corridor) p.corridor = { axis: [], doors: [], notes: [] };
        if (!Array.isArray(p.corridor.axis)) p.corridor.axis = [];
        if (!Array.isArray(p.corridor.doors)) p.corridor.doors = [];
        if (!Array.isArray(p.corridor.notes)) p.corridor.notes = [];
        return p.corridor;
    }

    function corridorClick() {
        var c = corridorState();
        var pt = snapFree();

        if (corridorPhase === 'axis') {
            var last = c.axis[c.axis.length - 1];
            if (last && Math.abs(last.x - pt.x) + Math.abs(last.y - pt.y) < 1e-6) return;

            c.axis.push(pt);
            App.afterEdit('ось коридора');
            return;
        }

        if (c.axis.length < 2) {
            App.status('Сначала проведите ось коридора, потом отмечайте двери.', 'warn');
            return;
        }

        c.doors.push(pt);
        App.afterEdit('квартирная дверь');
    }

    /** Переключить приём: ось → двери → расстановка. */
    function corridorNext() {
        var c = corridorState();

        if (corridorPhase === 'axis') {
            if (c.axis.length < 2) {
                App.status('Ось коридора — это хотя бы две точки.', 'warn');
                return;
            }

            corridorPhase = 'doors';
            App.status('Ось задана. Отмечайте квартирные двери; Enter — расставить.');
            Panels.refresh();
            View.render();
            return;
        }

        corridorPlace();
    }

    function corridorPhaseIs() { return corridorPhase; }

    function corridorSetPhase(name) {
        corridorPhase = name === 'doors' ? 'doors' : 'axis';
        App.status(hint());
        Panels.refresh();
        View.render();
    }

    function corridorClear() {
        var c = corridorState();
        c.axis = [];
        c.doors = [];
        c.notes = [];
        corridorPhase = 'axis';
        App.afterEdit('разметка коридора снята');
    }

    function corridorPlace() {
        var p = project();
        var c = corridorState();

        if (c.axis.length < 2) {
            App.status('Ось коридора — это хотя бы две точки.', 'warn');
            return;
        }

        var s = p.settings.corridor || {};
        var res = Corridor.build(p, c.axis, c.doors, s, { dn: s.dn > 0 ? s.dn : 0 });

        c.notes = res.notes || [];
        corridorPhase = 'axis';

        App.afterEdit('расстановка в коридоре');

        var made = res.added ? res.added.nodes : 0;
        App.status('Коридор ' + Fmt.num(res.length, 2) + ' м: оросителей '
            + res.spots.length + ', узлов ' + made
            + (c.notes.length ? '. Замечаний: ' + c.notes.length : '.'),
            c.notes.length ? 'warn' : 'ok');
    }

    function calibrateClick() {
        var p = project();
        if (!p.underlay || !p.underlay.src) {
            App.status('Сначала загрузите подложку.', 'warn');
            return;
        }

        calibPts.push({ x: mouse.x, y: mouse.y });
        View.render();
        if (calibPts.length < 2) return;

        var a = calibPts[0];
        var b = calibPts[1];
        var measured = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        calibPts = [];

        if (measured < 1e-9) return;

        var answer = window.prompt('Длина между точками, м (сейчас ' + Fmt.num(measured, 3) + ')', '');
        var real = Fmt.parse(answer);

        if (!(real > 0)) {
            View.render();
            return;
        }

        var f = real / measured;
        var u = p.underlay;
        u.x = a.x + (u.x - a.x) * f;
        u.y = a.y + (u.y - a.y) * f;
        u.scale *= f;

        App.afterEdit('масштаб подложки');
        set('select');
        App.status('Масштаб подложки задан: ' + Fmt.num(real, 3) + ' м.', 'done');
    }

    /* --- лучи: выбор, перенос, копия --------------------------------------- */

    function selectedBranch() {
        var sel = App.selection;
        var p = project();
        if (!sel) return null;
        if (sel.type === 'branch') return Model.branchOf(p, sel.seg);
        if (sel.type === 'seg') return Model.branchOf(p, sel.id);
        if (sel.type === 'node') return Model.branchOfNode(p, sel.id);
        return null;
    }

    function needBranch() {
        var br = selectedBranch();
        if (!br) {
            App.status('Выберите луч: щелчок по его трубе или оросителю.', 'warn');
            return null;
        }
        if (br.attach === null) {
            App.status('Луч не присоединён к магистрали — не от чего отражать и куда переносить.', 'warn');
            return null;
        }
        return br;
    }

    function selectBranchBySeg(segId) {
        var br = Model.branchOf(project(), segId);
        if (br) App.select({ type: 'branch', seg: segId, branch: br });
    }

    function mirror() {
        var br = needBranch();
        if (!br) return;
        Model.mirrorBranch(project(), br);
        App.afterEdit('отражение луча');
    }

    function rotate(deg) {
        var br = needBranch();
        if (!br) return;
        Model.rotateBranch(project(), br, deg);
        App.afterEdit('поворот луча');
    }

    function removeBranch() {
        var br = selectedBranch();
        if (!br) return;
        Model.removeBranch(project(), br);
        App.selection = null;
        App.afterEdit('удаление луча');
    }

    function startPlace(mode, br, dragging) {
        if (!br) br = needBranch();
        if (!br) return;
        if (br.attaches.length > 1) {
            App.status('Луч связывает два узла магистрали — переносить его как аналог нельзя.', 'warn');
            return;
        }

        endChain();
        place = { mode: mode, br: br, flip: false, dragging: !!dragging, target: null, mirror: false, u: null };
        updatePlace();
        App.status(mode === 'copy'
            ? 'Копия луча: щелчок по магистрали ставит аналог, сторона — по курсору. F или пробел — другая сторона, Esc — хватит.'
            : 'Перенос луча: щелчок по магистрали. F или пробел — другая сторона, Esc — отмена.');
        View.render();
    }

    function branchCentroid(br) {
        var p = project();
        var cx = 0, cy = 0;
        br.nodes.forEach(function (id) {
            var n = Model.node(p, id);
            cx += n.x;
            cy += n.y;
        });
        return { x: cx / br.nodes.length, y: cy / br.nodes.length };
    }

    function updatePlace() {
        if (!place) return;

        var p = project();
        var t = Model.nearestMain(p, mouse.x, mouse.y, 30 / View.scale());
        place.target = t;
        if (!t) return;

        var u;
        if (t.node) {
            u = Model.mainDirection(p, t.node, t.node === place.br.attach ? place.br : null);
        } else {
            var s = Model.seg(p, t.seg);
            var A = Model.node(p, s.a), B = Model.node(p, s.b);
            u = Model.unit(B.x - A.x, B.y - A.y);
        }
        place.u = u;

        var attach = Model.node(p, place.br.attach);
        var c = branchCentroid(place.br);
        var cx = c.x + (t.x - attach.x) - t.x;
        var cy = c.y + (t.y - attach.y) - t.y;
        var sideBranch = u.x * cy - u.y * cx;
        var sideCursor = u.x * (mouse.y - t.y) - u.y * (mouse.x - t.x);

        place.mirror = Math.abs(sideCursor) > 1e-9 && Math.abs(sideBranch) > 1e-9 && (sideBranch > 0) !== (sideCursor > 0);
        if (place.flip) place.mirror = !place.mirror;
    }

    function commitPlace() {
        if (!place) return;

        var p = project();
        var t = place.target;

        if (!t) {
            if (place.dragging) place = null;
            View.render();
            return;
        }

        var mode = place.mode;
        var br = place.br;
        var result = mode === 'move'
            ? Model.moveBranch(p, br, t, place.mirror)
            : Model.cloneBranch(p, br, t, place.mirror);

        if (result.error) {
            App.status(result.error, 'warn');
            place = null;
            View.render();
            return;
        }

        if (mode === 'copy' && !place.dragging) {
            App.afterEdit('копия луча');
            // Исходный луч тот же — можно ставить следующую копию.
            place.br = Model.branchOf(p, br.segs[0]) || br;
            updatePlace();
            View.render();
            return;
        }

        place = null;
        App.afterEdit(mode === 'move' ? 'перенос луча' : 'копия луча');

        var firstNode = result.map ? result.map[br.nodes[0]] : br.nodes[0];
        var list = Model.segmentsAt(p, firstNode).filter(function (s) { return s.role !== 'main'; });
        if (list.length) selectBranchBySeg(list[0].id);
        App.status(hint());
    }

    function arrayCopies(opts) {
        var br = needBranch();
        if (!br) return;

        var result = Model.arrayBranch(project(), br, opts.count, opts.step, opts.dir, opts.alternate);
        if (result.error) {
            App.status(result.error, 'warn');
            return;
        }

        App.afterEdit('копии луча');
        App.status('Поставлено копий: ' + result.placed
            + (result.skipped ? ', не попали на магистраль: ' + result.skipped : '') + '.',
            result.skipped ? 'warn' : 'done');
    }

    /* --- события --------------------------------------------------------- */

    function init() {
        canvas = document.getElementById('plan');

        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointerleave', function () {
            mouse.inside = false;
            if (App.hoverSeg !== null) App.hoverSeg = null;
            View.render();
        });
        canvas.addEventListener('wheel', wheel, { passive: false });
        canvas.addEventListener('dblclick', dblclick);
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        document.addEventListener('keydown', key);
    }

    function down(e) {
        updateMouse(e);
        mouse.inside = true;
        canvas.focus();

        if (e.button === 1 || e.button === 2) {
            drag = { type: 'pan', px: mouse.px, py: mouse.py, moved: false, button: e.button };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return;

        if (place) {
            updatePlace();
            commitPlace();
            return;
        }

        switch (tool) {
            case 'main':
            case 'ray':
                chainClick(snapAt(mouse.px, mouse.py));
                snap = snapAt(mouse.px, mouse.py, chain ? chain.last : undefined);
                break;
            case 'sprinkler': sprinklerClick(); break;
            case 'source': sourceClick(); break;
            case 'cu': cuClick(); break;
            case 'pk': pkClick(); break;
            case 'erase': eraseClick(); break;
            case 'zone': zoneClick(false); break;
            case 'corridor': corridorClick(); break;
            case 'measure':
                if (measurePts.length >= 2) measurePts = [];
                measurePts.push(snapFree());
                View.render();
                break;
            case 'calibrate': calibrateClick(); break;
            case 'underlay':
                if (project().underlay) {
                    drag = { type: 'underlay', px: mouse.px, py: mouse.py, moved: false };
                    canvas.setPointerCapture(e.pointerId);
                }
                break;
            case 'dxf':
                if (project().dxf) {
                    drag = { type: 'dxf', px: mouse.px, py: mouse.py, moved: false };
                    canvas.setPointerCapture(e.pointerId);
                }
                break;
            default:
                selectDown(e);
        }
    }

    function snapFree() {
        var h = altKey ? null : View.hit(mouse.px, mouse.py);
        if (h && h.type === 'node') {
            var n = Model.node(project(), h.id);
            return { x: n.x, y: n.y };
        }
        return { x: mouse.x, y: mouse.y };
    }

    /* --- ввод длины прямо на плане ------------------------------------------ */

    var editor = null;

    function closeEditor() {
        if (!editor) return;
        var el = editor.input;
        editor = null;
        if (el.parentNode) el.parentNode.removeChild(el);
    }

    function openEditor(spot) {
        closeEditor();

        var p = project();
        var s = Model.seg(p, spot.segId);
        if (!s) return;

        var dep = Binding.depths(p);
        var moving = dep[s.a] > dep[s.b] ? s.a : s.b;

        App.select({ type: 'seg', id: s.id });

        /*
            У участка две длины: нарисованная и вписанная для расчёта. Правим
            ту, что показана: если длина вписана — её, иначе двигаем чертёж.
            Ctrl+Enter меняет способ на другой.
        */
        var manual = s.len > 0;

        var input = document.createElement('input');
        input.className = 'dim-editor';
        input.value = Fmt.trim(manual ? s.len : Model.geomLength(p, s), 3);
        input.title = manual
            ? 'Длина для расчёта. Enter — применить, Ctrl+Enter — подвинуть чертёж по этой длине, Esc — отмена'
            : 'Длина по чертежу. Enter — подвинуть чертёж, Ctrl+Enter — вписать длину только для расчёта, Esc — отмена';
        input.style.left = (spot.cx - 42) + 'px';
        input.style.top = (spot.cy - 26) + 'px';
        canvas.parentNode.appendChild(input);

        editor = { input: input, segId: s.id, moving: moving, manual: manual };

        input.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') {
                var value = Fmt.parse(input.value);
                var target = editor;
                var geometry = e.ctrlKey || e.metaKey ? target.manual : !target.manual;
                closeEditor();
                if (!target || value === null) return;

                if (!geometry) {
                    var seg = Model.seg(project(), target.segId);
                    if (!seg || !(value > 0)) return;
                    seg.len = value;
                    App.afterEdit('длина для расчёта ' + Fmt.trim(value, 3) + ' м');
                    App.status('Длина для расчёта ' + Fmt.trim(value, 3) + ' м — чертёж не сдвинут (на плане со звёздочкой). '
                        + 'Ctrl+Enter в том же поле подвинул бы чертёж.', 'done');
                    return;
                }

                var res = Binding.moveEnd(project(), target.segId, target.moving, value, project().settings.bindTail);
                if (res.error) {
                    App.status(res.error + ' Можно вписать длину только для расчёта: Ctrl+Enter в поле размера.', 'warn');
                    return;
                }
                App.afterEdit('размер ' + Fmt.trim(value, 3) + ' м');
                // moveEnd снимает вписанную длину: иначе расчёт остался бы на
                // старом числе, а план показывал новое.
                if (target.manual) {
                    App.status('Чертёж подвинут на ' + Fmt.trim(value, 3) + ' м; длина для расчёта снята — считаем по чертежу.', 'done');
                }
            } else if (e.key === 'Escape') {
                closeEditor();
            }
        });
        input.addEventListener('blur', function () { setTimeout(closeEditor, 0); });

        input.focus();
        input.select();
    }

    /* --- ортогональное перетаскивание --------------------------------------- */

    function stepOf() {
        var s = project().settings.snapStep;
        return s > 0 ? s : 0.05;
    }

    function roundStep(v) {
        var step = stepOf();
        return Math.round(v / step) * step;
    }

    function remember(ids) {
        var p = project();
        var origins = {};
        ids.forEach(function (id) {
            var n = Model.node(p, id);
            origins[id] = { x: n.x, y: n.y };
        });
        return origins;
    }

    function restore(origins, dx, dy) {
        var p = project();
        Object.keys(origins).forEach(function (id) {
            var n = Model.node(p, Number(id));
            n.x = origins[id].x + dx;
            n.y = origins[id].y + dy;
        });
    }

    /** Цепочка по умолчанию из настроек, Ctrl её переключает. */
    function tailWanted(e) {
        return !!project().settings.bindTail !== !!(e && e.ctrlKey);
    }

    function startNodeDrag(id, e) {
        var p = project();
        var n = Model.node(p, id);
        var ids = tailWanted(e) ? Binding.tailOf(p, id) : Binding.hanging(p, id);

        // gx, gy — где схватили: сдвиг считается от точки захвата, а не от
        // центра узла, иначе узел дёргается на величину промаха мимо центра.
        return {
            type: 'node', id: id, px: mouse.px, py: mouse.py, moved: false,
            sx: n.x, sy: n.y, gx: mouse.x, gy: mouse.y,
            axis: Binding.axisOf(p, id), ids: ids, origins: remember(ids), guide: null
        };
    }

    function startRayDrag(br, start) {
        var p = project();
        var A = Model.node(p, br.attach);
        var F = Model.node(p, Binding.firstNode(p, br));
        var uMain = Binding.mainAxis(p, br.attach);
        var uRay = Model.unit(F.x - A.x, F.y - A.y);
        var idsMain = Binding.hanging(p, br.attach);
        var all = idsMain.concat(br.nodes.filter(function (id) { return idsMain.indexOf(id) < 0; }));
        var first = Math.sqrt((F.x - A.x) * (F.x - A.x) + (F.y - A.y) * (F.y - A.y));

        return {
            type: 'ray', br: br, moved: true, sx: start.x, sy: start.y,
            ax: A.x, ay: A.y, fx: F.x, fy: F.y,
            uMain: uMain, uRay: uRay, idsMain: idsMain, idsRay: br.nodes,
            origins: remember(all),
            limits: uMain ? Binding.mainLimits(p, br.attach, uMain) : null,
            minRay: 0.1 - first,
            guide: null
        };
    }

    function dragNode(d) {
        var p = project();
        var dx, dy;

        if (altKey) {
            var sn = snapAt(mouse.px, mouse.py, d.id);
            var tx = sn.x, ty = sn.y;
            if (sn.node) {
                var target = Model.node(p, sn.node);
                tx = target.x;
                ty = target.y;
            } else if (sn.seg) {
                tx = mouse.x;
                ty = mouse.y;
            }
            dx = tx - d.sx;
            dy = ty - d.sy;
            d.guide = null;
        } else {
            var mx = mouse.x - d.gx, my = mouse.y - d.gy;
            var a = mx * d.axis.u.x + my * d.axis.u.y;
            var b = mx * d.axis.v.x + my * d.axis.v.y;
            var dir = Math.abs(a) >= Math.abs(b) ? d.axis.u : d.axis.v;
            var value = roundStep(Math.abs(a) >= Math.abs(b) ? a : b);
            dx = dir.x * value;
            dy = dir.y * value;
            d.guide = { x: d.sx, y: d.sy, dir: dir, value: value };
        }

        restore(d.origins, 0, 0);
        if (Binding.check(p, d.ids, dx, dy)) return;   // сквозь соседа не пускаем
        restore(d.origins, dx, dy);
    }

    function dragRay(d) {
        var p = project();
        var mx = mouse.x - d.sx, my = mouse.y - d.sy;
        var a = d.uMain ? mx * d.uMain.x + my * d.uMain.y : 0;
        var b = mx * d.uRay.x + my * d.uRay.y;

        restore(d.origins, 0, 0);

        if (d.uMain && Math.abs(a) >= Math.abs(b)) {
            a = Math.max(d.limits.min, Math.min(d.limits.max, roundStep(a)));
            restore(pick(d.origins, d.idsMain), d.uMain.x * a, d.uMain.y * a);
            d.guide = { x: d.ax, y: d.ay, dir: d.uMain, value: a };
        } else {
            b = Math.max(d.minRay, roundStep(b));
            restore(pick(d.origins, d.idsRay), d.uRay.x * b, d.uRay.y * b);
            d.guide = { x: d.fx, y: d.fy, dir: d.uRay, value: b };
        }

        if (!p) return;
    }

    function pick(origins, ids) {
        var out = {};
        ids.forEach(function (id) { out[id] = origins[id]; });
        return out;
    }

    function selectDown(e) {
        var spot = View.hotspot(mouse.px, mouse.py);
        if (spot) {
            openEditor(spot);
            return;
        }

        var h = View.hit(mouse.px, mouse.py);

        if (h && h.type === 'node') {
            App.select({ type: 'node', id: h.id });
            drag = startNodeDrag(h.id, e);
        } else if (h && h.type === 'seg') {
            var sel = App.selection;
            var already = sel && sel.type === 'branch' && sel.branch && sel.branch.segs.indexOf(h.id) >= 0;
            if (!already) App.select({ type: 'seg', id: h.id });
            drag = { type: 'segdrag', id: h.id, px: mouse.px, py: mouse.py, moved: false };
        } else {
            drag = { type: 'pan', px: mouse.px, py: mouse.py, moved: false, button: 0, empty: true };
        }

        canvas.setPointerCapture(e.pointerId);
    }

    function move(e) {
        var lastPx = mouse.px;
        var lastPy = mouse.py;
        updateMouse(e);
        mouse.inside = true;

        if (drag) {
            var dist = Math.abs(mouse.px - drag.px) + Math.abs(mouse.py - drag.py);

            if (drag.type === 'pan') {
                if (dist > 3) drag.moved = true;
                if (drag.moved) View.panBy(mouse.px - lastPx, mouse.py - lastPy);
                return;
            }

            if (drag.type === 'node') {
                if (dist > 3) drag.moved = true;
                if (drag.moved) {
                    dragNode(drag);
                    App.recompute();
                    View.render();
                }
                return;
            }

            if (drag.type === 'ray') {
                dragRay(drag);
                App.recompute();
                View.render();
                return;
            }

            if (drag.type === 'segdrag') {
                if (dist > 6) {
                    var s = Model.seg(project(), drag.id);
                    var grab = View.toWorld(drag.px, drag.py);
                    drag = null;
                    if (s && s.role !== 'main') {
                        var br = Model.branchOf(project(), s.id);
                        if (br && br.attach !== null && br.attaches.length === 1) {
                            // Alt — прежний перенос с прыжками по магистрали и сменой стороны.
                            if (altKey) startPlace('move', br, true);
                            else if (Binding.firstNode(project(), br) !== null) {
                                drag = startRayDrag(br, grab);
                                dragRay(drag);
                                App.recompute();
                                View.render();
                            }
                        }
                    }
                }
                return;
            }

            if (drag.type === 'underlay' || drag.type === 'dxf') {
                drag.moved = true;
                var u = drag.type === 'dxf' ? project().dxf : project().underlay;
                u.x += (mouse.px - lastPx) / View.scale();
                u.y += (mouse.py - lastPy) / View.scale();
                View.render();
                return;
            }
        }

        if (place) {
            updatePlace();
            View.render();
            return;
        }

        if (tool === 'main' || tool === 'ray') {
            snap = snapAt(mouse.px, mouse.py, chain ? chain.last : undefined);
            View.render();
            return;
        }

        if (tool === 'select' || tool === 'erase' || tool === 'sprinkler' || tool === 'cu' || tool === 'source' || tool === 'pk') {
            var h = View.hit(mouse.px, mouse.py);
            var id = h && h.type === 'seg' ? h.id : null;
            var changed = JSON.stringify(h) !== JSON.stringify(hover);
            hover = h;
            App.hoverSeg = id;
            if (tool === 'select') canvas.style.cursor = View.hotspot(mouse.px, mouse.py) ? 'text' : h ? 'pointer' : 'default';
            if (changed) View.render();
            return;
        }

        View.render();
    }

    function up(e) {
        updateMouse(e);

        if (place && place.dragging) {
            updatePlace();
            commitPlace();
            drag = null;
            return;
        }

        if (!drag) return;

        var d = drag;
        drag = null;

        if (d.type === 'pan' && !d.moved) {
            if (d.button === 2) rightClick();
            else if (d.empty) App.select(null);
        }

        if (d.type === 'node' && d.moved) App.afterEdit('перемещение узла');
        if (d.type === 'ray') App.afterEdit('сдвиг луча');
        if (d.type === 'node' || d.type === 'ray') View.render();
        if (d.type === 'underlay' && d.moved) App.afterEdit('сдвиг подложки');
        if (d.type === 'dxf' && d.moved) App.afterEdit('сдвиг чертежа');
    }

    function rightClick() {
        if (place) {
            place = null;
            App.status(hint());
        } else if (chain) {
            endChain();
        } else if (tool === 'zone' && zonePts.length >= 3) {
            zoneClick(true);
        } else if (tool !== 'select') {
            set('select');
        }
        View.render();
    }

    function dblclick() {
        if (tool === 'main' || tool === 'ray') {
            endChain();
            View.render();
            return;
        }

        if (tool === 'zone') {
            zoneClick(true);
            return;
        }

        if (tool === 'select') {
            var h = View.hit(mouse.px, mouse.py);
            if (h && h.type === 'seg') selectBranchBySeg(h.id);
            if (h && h.type === 'node') {
                var br = Model.branchOfNode(project(), h.id);
                if (br) selectBranchBySeg(br.segs[0]);
            }
        }
    }

    function wheel(e) {
        e.preventDefault();
        closeEditor();
        updateMouse(e);
        View.zoomAt(mouse.px, mouse.py, Math.exp(-e.deltaY * 0.0015));
        var w = View.toWorld(mouse.px, mouse.py);
        mouse.x = w.x;
        mouse.y = w.y;
        if (place) updatePlace();
        if (chain) snap = snapAt(mouse.px, mouse.py, chain.last);
    }

    function deleteSelection() {
        var sel = App.selection;
        if (!sel) return;

        if (sel.type === 'node') eraseNode(sel.id);
        else if (sel.type === 'seg') eraseSeg(sel.id);
        else if (sel.type === 'branch') {
            var br = Model.branchOf(project(), sel.seg);
            if (br) Model.removeBranch(project(), br);
        }

        App.selection = null;
        App.afterEdit('удаление');
    }

    /*
        Физическая клавиша. e.code есть не всегда: его не дают часть
        удалённых рабочих столов и автоматизация браузера. Тогда клавиша
        восстанавливается по символу — и в латинской, и в русской раскладке,
        иначе на русской «M» превращается в «ь» и сочетания молча не работают.
    */
    var RU_KEYS = 'йцукенгшщзфывапролдячсмить';
    var EN_KEYS = 'qwertyuiopasdfghjklzxcvbnm';

    function codeOf(e) {
        if (e.code) return e.code;

        var k = e.key || '';
        if (k === ' ') return 'Space';
        if (k.length !== 1) return k;

        var lower = k.toLowerCase();
        var at = RU_KEYS.indexOf(lower);
        if (at >= 0) lower = EN_KEYS.charAt(at);
        if (lower >= 'a' && lower <= 'z') return 'Key' + lower.toUpperCase();
        return k;
    }

    function key(e) {
        if (isField(document.activeElement)) return;

        var code = codeOf(e);

        if (e.ctrlKey || e.metaKey) {
            if (code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); App.undo(); }
            else if (code === 'KeyY' || (code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); App.redo(); }
            else if (code === 'KeyS') { e.preventDefault(); App.save(); }
            return;
        }

        // Клавиши черчения — только на плане АПТ.
        if (App.mode !== 'apt') return;

        altKey = e.altKey;

        if (chain && /^[0-9.,]$/.test(e.key)) {
            typed += e.key;
            View.render();
            e.preventDefault();
            return;
        }

        switch (code) {
            case 'Escape':
                if (place) { place = null; App.status(hint()); }
                else if (chain) endChain();
                else if (zonePts.length || measurePts.length || calibPts.length) { zonePts = []; measurePts = []; calibPts = []; }
                else if (tool === 'corridor' && (corridorState().axis.length || corridorState().doors.length)) corridorClear();
                else if (tool !== 'select') set('select');
                else App.select(null);
                View.render();
                break;
            case 'Enter':
            case 'NumpadEnter':
                if (chain) applyTyped();
                else if (tool === 'zone') zoneClick(true);
                else if (tool === 'corridor') corridorNext();
                break;
            case 'Backspace':
                if (chain && typed) {
                    typed = typed.slice(0, -1);
                    View.render();
                    e.preventDefault();
                }
                break;
            case 'Delete':
                deleteSelection();
                break;
            case 'Space':
            case 'KeyF':
                e.preventDefault();
                if (place) {
                    place.flip = !place.flip;
                    updatePlace();
                    View.render();
                } else if (e.code === 'KeyF') {
                    mirror();
                }
                break;
            case 'KeyC': startPlace('copy'); break;
            case 'KeyG': startPlace('move'); break;
            case 'KeyV': set('select'); break;
            case 'KeyM': set('main'); break;
            case 'KeyL': set('ray'); break;
            case 'KeyO': set('sprinkler'); break;
            case 'KeyI': set('source'); break;
            case 'KeyU': set('cu'); break;
            case 'KeyK': set('pk'); break;
            case 'KeyZ': set('zone'); break;
            case 'KeyD': set('corridor'); break;
            case 'KeyR': set('measure'); break;
            case 'KeyE': set('erase'); break;
            case 'KeyH':
            case 'Home':
                View.fit();
                break;
        }
    }

    /* --- наложение ------------------------------------------------------- */

    function marker(ctx, x, y, kind) {
        ctx.strokeStyle = '#E8892B';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        if (kind === 'node') {
            ctx.rect(x - 6, y - 6, 12, 12);
        } else if (kind === 'seg') {
            ctx.moveTo(x - 6, y + 5); ctx.lineTo(x, y - 6); ctx.lineTo(x + 6, y + 5); ctx.closePath();
        } else {
            ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
            ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
        }
        ctx.stroke();
    }

    function rubber(ctx, a, b, dashed) {
        ctx.beginPath();
        ctx.moveTo(View.sx(a.x), View.sy(a.y));
        ctx.lineTo(View.sx(b.x), View.sy(b.y));
        ctx.strokeStyle = '#E8892B';
        ctx.lineWidth = 1.6;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function lengthLabel(ctx, a, b, extra) {
        var len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        View.text(Fmt.num(len, 2) + ' м' + (extra || ''), View.sx(b.x) + 12, View.sy(b.y) - 10, {
            font: 'bold 12px "Segoe UI", Arial, sans-serif', color: '#B35F10'
        });
    }

    function drawOverlay(ctx) {
        var p = project();

        // Ось, по которой сейчас идёт перетаскивание, и величина сдвига.
        if (drag && drag.guide) {
            var g = drag.guide;
            var gx = View.sx(g.x), gy = View.sy(g.y);
            ctx.beginPath();
            ctx.moveTo(gx - g.dir.x * 4000, gy - g.dir.y * 4000);
            ctx.lineTo(gx + g.dir.x * 4000, gy + g.dir.y * 4000);
            ctx.strokeStyle = 'rgba(232, 137, 43, 0.65)';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            View.text((g.value >= 0 ? '+' : '') + Fmt.num(g.value, 2) + ' м', mouse.px + 14, mouse.py - 12, {
                font: 'bold 12px "Segoe UI", Arial, sans-serif', color: '#B35F10'
            });
        }

        if (place && place.target) {
            var t = place.target;
            var attach = Model.node(p, place.br.attach);
            var dx = t.x - attach.x;
            var dy = t.y - attach.y;
            var pos = {};

            pos[place.br.attach] = { x: t.x, y: t.y };
            place.br.nodes.forEach(function (id) {
                var n = Model.node(p, id);
                var x = n.x + dx;
                var y = n.y + dy;
                if (place.mirror) {
                    var vx = x - t.x, vy = y - t.y;
                    var d = vx * place.u.x + vy * place.u.y;
                    x = t.x + 2 * d * place.u.x - vx;
                    y = t.y + 2 * d * place.u.y - vy;
                }
                pos[id] = { x: x, y: y };
            });

            place.br.segs.forEach(function (id) {
                var s = Model.seg(p, id);
                if (pos[s.a] && pos[s.b]) rubber(ctx, pos[s.a], pos[s.b], true);
            });
            place.br.nodes.forEach(function (id) {
                if (!Model.node(p, id).spr) return;
                ctx.beginPath();
                ctx.arc(View.sx(pos[id].x), View.sy(pos[id].y), 5, 0, Math.PI * 2);
                ctx.strokeStyle = '#E8892B';
                ctx.lineWidth = 1.6;
                ctx.stroke();
            });
            marker(ctx, View.sx(t.x), View.sy(t.y), t.node ? 'node' : 'seg');
        }

        if ((tool === 'main' || tool === 'ray') && mouse.inside && snap) {
            var pt = { x: snap.x, y: snap.y };

            if (chain) {
                var from = Model.node(p, chain.last);
                rubber(ctx, from, pt, false);
                lengthLabel(ctx, from, pt, typed ? '   ввод: ' + typed + '▏' : '');
                if (tool === 'ray' && !snap.node && !snap.seg) {
                    ctx.beginPath();
                    ctx.arc(View.sx(pt.x), View.sy(pt.y), 5, 0, Math.PI * 2);
                    ctx.strokeStyle = '#17916B';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }

            marker(ctx, View.sx(pt.x), View.sy(pt.y), snap.kind === 'aligned' ? 'free' : snap.kind);

            // Расстояния до соседних узлов на трубе, куда сейчас попадёт точка.
            if (snap.seg) {
                var s = Model.seg(p, snap.seg);
                var A = Model.node(p, s.a), B = Model.node(p, s.b);
                View.text(Fmt.num(dist(A, pt), 2) + ' | ' + Fmt.num(dist(pt, B), 2) + ' м',
                    View.sx(pt.x) + 12, View.sy(pt.y) + 18, { color: '#B35F10', font: '11px "Segoe UI", Arial, sans-serif' });
            }
        }

        if (tool === 'zone' && zonePts.length) {
            var zp = mouse.inside ? zonePoint() : null;
            for (var i = 0; i + 1 < zonePts.length; i++) rubber(ctx, zonePts[i], zonePts[i + 1], false);
            if (zp) {
                rubber(ctx, zonePts[zonePts.length - 1], zp, true);
                lengthLabel(ctx, zonePts[zonePts.length - 1], zp);
            }
        }

        if (tool === 'measure' && measurePts.length) {
            var end = measurePts.length === 2 ? measurePts[1] : (mouse.inside ? snapFree() : measurePts[0]);
            rubber(ctx, measurePts[0], end, measurePts.length < 2);
            lengthLabel(ctx, measurePts[0], end);
        }

        if (tool === 'calibrate' && calibPts.length) {
            var ce = mouse.inside ? { x: mouse.x, y: mouse.y } : calibPts[0];
            rubber(ctx, calibPts[0], ce, true);
            lengthLabel(ctx, calibPts[0], ce);
        }
    }

    function dist(a, b) {
        return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    }

    return {
        HINTS: HINTS,
        init: init,
        set: set,
        current: current,
        hint: hint,
        drawOverlay: drawOverlay,
        selectedBranch: selectedBranch,
        selectBranchBySeg: selectBranchBySeg,
        mirror: mirror,
        rotate: rotate,
        copy: function () { startPlace('copy'); },
        move: function () { startPlace('move'); },
        array: arrayCopies,
        removeBranch: removeBranch,
        eraseNode: eraseNode,
        eraseSeg: eraseSeg,

        corridorPhase: corridorPhaseIs,
        corridorSetPhase: corridorSetPhase,
        corridorPlace: corridorPlace,
        corridorClear: corridorClear,

        cancel: cancelTransient
    };
})();
