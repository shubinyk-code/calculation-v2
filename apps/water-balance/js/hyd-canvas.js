/*
    Холст схемы: рисование и правка мышью.

    Схему рисует сам инженер: ставит ввод, водомерные узлы, насосные установки,
    ИТП, встроенные помещения и блоки стояков, соединяет их ломаными трубами.
    Диаметры, расходы, скорости и потери на трубах — результат расчёта
    (HydCalc.run), они пересчитываются после каждой правки.

    У каждого объекта есть порты — точки подключения (кружки по краям). Трубы
    «цепляются» к портам: курсор притягивается к ближайшему порту или к трубе
    (там сам появится тройник), ортогональная трасса прокладывается по выходу
    порта. Тянуть трубу можно и сразу из порта.

    Холст не знает ни о модели, ни о расчёте больше, чем ему передаёт интерфейс:
    api = { hyd(), result(), changed(), select(sel), openFloors(typeId, colId), say(text), tool() }.
    Состояние рисунка (лист, инструмент, выделение, масштаб) живёт в state и в
    проект не попадает; в проект идут только узлы, трубы и вершины.
*/

var HydCanvas = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var svg, view, api, state;
    var drag = null;
    var space = false;
    var winBound = false;
    var suppressClick = false;
    var arrive = {};      // участок, приходящий в узел: net|nodeId → участок
    var dim = { nodes: {}, pipes: {} };    // при выбранной зоне — всё, что к ней не относится
    var routeNow = null;     // маршрут выбранной системы (расчётные точки)

    var SNAP_PX = 16;       // радиус притяжения к порту, px экрана
    var PIPE_PX = 10;       // радиус притяжения к трубе, px экрана

    var TOOLS = [
        ['select', 'Выбор', 'Выбрать, перетащить объект, потянуть вершину трубы. Тяните трубу прямо из кружка-порта'],
        ['pan', 'Рука', 'Тянуть схему мышью (то же — средняя кнопка или Пробел с тягой, Shift + колесо — по горизонтали)'],
        ['pipe', 'Труба', 'Клик по порту или трубе — начало; клики по пустому месту — изгибы; клик по порту — конец'],
        ['input', 'Ввод', 'Ввод водопровода (лист ХВС)'],
        ['meter', 'Счётчик', 'Водомерный узел: клик по трубе — вставить в разрыв'],
        ['pump', 'Насосная', 'Насосная установка: клик по трубе — вставить в разрыв (лист ХВС)'],
        ['itp', 'ИТП', 'ИТП: клик рядом с трубой — присоединится сам'],
        ['tee', 'Узел', 'Узел ветвления'],
        ['buildin', 'Встроенное', 'Встроенное помещение: клик рядом с трубой — присоединится сам'],
        ['riser', 'Стояк', 'Блок стояка: клик рядом с трубой — встанет над ней и присоединится сам'],
        ['delete', 'Удалить', 'Удалить объект или трубу']
    ];

    function toolbar(st) {
        var cur = (st || state).tool;
        return TOOLS.map(function (t) {
            return '<button type="button" data-tool="' + t[0] + '" title="' + esc(t[2]) + '"' + (cur === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>';
        }).join('');
    }

    function init(host, st, a) {
        state = st;
        api = a;
        host.innerHTML = '<svg class="cv" xmlns="http://www.w3.org/2000/svg" tabindex="0"><defs>'
            + '<pattern id="cvGrid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" class="cv-gridline"/></pattern>'
            + '<pattern id="cvHatchC" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="3" class="hatch c"/></pattern>'
            + '<pattern id="cvHatchH" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="3" class="hatch h"/></pattern>'
            + '</defs><g id="cvView"><rect class="cv-bg" x="-5000" y="-5000" width="12000" height="12000" fill="url(#cvGrid)"/>'
            + '<g id="cvPipes"></g><g id="cvNodes"></g><g id="cvPreview"></g></g></svg>';

        svg = host.querySelector('svg');
        view = svg.querySelector('#cvView');
        state.hover = null;

        svg.addEventListener('mousedown', onDown);
        svg.addEventListener('click', onClick);
        svg.addEventListener('dblclick', onDbl);
        svg.addEventListener('wheel', onWheel, { passive: false });
        svg.addEventListener('mousemove', onHover);
        svg.addEventListener('contextmenu', function (e) {
            if (state.drawing) { e.preventDefault(); cancelDrawing(); }
        });

        if (!winBound) {
            winBound = true;
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('keydown', onKey);
            window.addEventListener('keyup', function (e) { if (e.code === 'Space') space = false; });
        }

        applyView();
    }

    function applyView() {
        view.setAttribute('transform', 'translate(' + state.view.x + ',' + state.view.y + ') scale(' + state.view.k + ')');
    }

    function world(e) {
        var r = svg.getBoundingClientRect();
        return { x: (e.clientX - r.left - state.view.x) / state.view.k, y: (e.clientY - r.top - state.view.y) / state.view.k };
    }

    function snap(p) {
        if (!state.snap) return { x: Math.round(p.x), y: Math.round(p.y) };
        return { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 };
    }

    function hyd() { return api.hyd(); }

    /* Вписать схему в окно. */
    function fit() {
        var h = hyd();
        var xs = [];
        var ys = [];

        h.canvas.nodes.forEach(function (n) {
            if (!HydGraph.onSheet(n, state.net) || dim.nodes[n.id]) return;
            var p = HydModel.pos(n, state.net);
            xs.push(p.x);
            ys.push(p.y);
            if (n.kind === 'riser') {
                ys.push(p.y - n.floorTo * h.survey.floorPx - 30);
                xs.push(p.x + 220);
            }
        });

        var r = svg.getBoundingClientRect();
        if (!xs.length || !r.width) return;

        var x0 = Math.min.apply(null, xs) - 80;
        var x1 = Math.max.apply(null, xs) + 100;
        var y0 = Math.min.apply(null, ys) - 50;
        var y1 = Math.max.apply(null, ys) + 90;
        var k = Math.min(r.width / (x1 - x0), r.height / (y1 - y0), 1.5);

        state.view = { k: k, x: -x0 * k + (r.width - (x1 - x0) * k) / 2, y: -y0 * k + (r.height - (y1 - y0) * k) / 2 };
        applyView();
    }

    /* --- отрисовка ----------------------------------------------------------- */

    function render(result) {
        var h = hyd();
        var net = state.net;
        var pipes = [];
        var nodes = [];
        var byId = result && result.net ? result.net.byId : {};
        arrive = {};
        if (result && result.net) result.net.segs.forEach(function (s) { if (s.kind === 'pipe') arrive[s.net + '|' + s.node] = s; });

        dim = { nodes: {}, pipes: {} };
        routeNow = null;
        if (state.points && result && result.systems) {
            var ps = result.systems.filter(function (s) { return s.id === (state.points === 'auto' ? (result.systems[0] && result.systems[0].id) : state.points); })[0];
            if (ps && ps.route) routeNow = ps.route;
        }
        if (state.zone && result && result.net) {
            result.net.segs.forEach(function (s) {
                if (s.net !== net || !s.sys || s.sys === state.zone) return;
                if (s.kind === 'pipe') { dim.pipes[s.meta.pipe] = true; dim.nodes[s.node] = true; }
                else if (s.node && s.cls === 'device') dim.nodes[s.node] = true;
            });
        }

        // какие порты уже заняты трубами
        var used = {};
        h.canvas.pipes.forEach(function (p) {
            if (p.sheet !== net) return;
            var pts = HydGraph.ptsOf(h, p);
            used[p.a + '|' + pts[0].id] = true;
            used[p.b + '|' + pts[pts.length - 1].id] = true;
            pipes.push(drawPipe(h, p, byId, pts, result));
        });

        h.canvas.nodes.forEach(function (n) {
            if (HydGraph.onSheet(n, net)) nodes.push(drawNode(h, n, result, byId, used));
        });

        svg.querySelector('#cvPipes').innerHTML = pipes.join('');
        if (routeNow) nodes.push(drawPoints(routeNow));
        svg.querySelector('#cvNodes').innerHTML = nodes.join('');
        applyView();
        drawPreview();
        svg.setAttribute('data-cursor', state.tool);
    }

    /*
        Копия SVG листа net — как нарисован на экране, но без выделения, курсора и черновика трубы.
        Нужна выгрузке «как на экране» в PDF; после снимка холст перерисовывается как был.
    */
    function snapshot(net, result) {
        var keep = { net: state.net, selected: state.selected, multi: state.multi, drawing: state.drawing, hover: state.hover };
        state.net = net;
        state.selected = null;
        state.multi = [];
        state.drawing = null;
        state.hover = null;

        var copy;
        try {
            render(result);
            copy = svg.cloneNode(true);
        } finally {
            state.net = keep.net;
            state.selected = keep.selected;
            state.multi = keep.multi;
            state.drawing = keep.drawing;
            state.hover = keep.hover;
            render(result);
        }

        return copy;
    }

    function isSel(type, id) { return state.selected && state.selected.type === type && state.selected.id === id; }

    function lineOf(s) {
        var z = s && s.res && s.res.size;
        if (!z) return null;
        return [z.label + '  q=' + num(s.res.q, 3), 'V=' + num(z.v, 2) + '  i=' + num(z.iMm, 2) + '  L=' + num(s.L, 1) + ' м'];
    }

    function drawPipe(h, p, byId, pts, result) {
        var d = pts.map(function (q) { return q.x + ',' + q.y; }).join(' ');
        var s = byId[p.sheet + '|' + p.id];
        var sel = isSel('pipe', p.id);
        var issue = result && result.net && result.net.pipeIssue ? result.net.pipeIssue[p.sheet + '|' + p.id] : '';
        var cls = 'cv-pipe ' + (p.sheet === 'c' ? 'cold' : 'hot') + (sel ? ' sel' : '') + (issue ? ' issue' : '') + (s && s.res && s.res.size && !s.res.size.ok ? ' bad' : '');
        var out = ['<g class="cv-p' + (dim.pipes[p.id] ? ' cv-dim' : '') + '" data-p="' + esc(p.id) + '">',
            '<polyline class="cv-hit" points="' + d + '"/>',
            (routeNow && routeNow.pipes[p.sheet + '|' + p.id] ? '<polyline class="cv-routeline" points="' + d + '"/>' : ''),
            '<polyline class="' + cls + '" points="' + d + '"/>'];

        var text = lineOf(s);

        if (text) {
            // подпись на самом длинном звене
            var best = 0;
            var bl = -1;
            for (var i = 0; i + 1 < pts.length; i++) {
                var l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
                if (l > bl) { bl = l; best = i; }
            }

            var a = pts[best];
            var b = pts[best + 1];
            var mx = (a.x + b.x) / 2;
            var my = (a.y + b.y) / 2;
            var vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);

            if (bl > 24) {
                var hl = headLine(s.res.hd);

                if (vertical) {
                    out.push('<text class="cv-t" x="' + (mx + 6) + '" y="' + (my - 2) + '">' + esc(text[0]) + '</text>');
                    out.push('<text class="cv-t" x="' + (mx + 6) + '" y="' + (my + 9) + '">' + esc(text[1]) + '</text>');
                    if (hl) out.push('<text class="cv-head" x="' + (mx + 6) + '" y="' + (my + 20) + '">' + esc(hl) + '</text>');
                } else {
                    out.push('<text class="cv-t" x="' + mx + '" y="' + (my - 14) + '" text-anchor="middle">' + esc(text[0]) + '</text>');
                    out.push('<text class="cv-t" x="' + mx + '" y="' + (my - 4) + '" text-anchor="middle">' + esc(text[1]) + '</text>');
                    if (hl) out.push('<text class="cv-head" x="' + mx + '" y="' + (my + 12) + '" text-anchor="middle">' + esc(hl) + '</text>');
                }
            }
        } else if (s && s.groups && !s.groups.length) {
            out.push('<text class="cv-t dim" x="' + ((pts[0].x + pts[pts.length - 1].x) / 2) + '" y="' + ((pts[0].y + pts[pts.length - 1].y) / 2 - 6) + '" text-anchor="middle">нет нагрузки</text>');
        } else if (!s) {
            out.push('<text class="cv-t bad" x="' + ((pts[0].x + pts[pts.length - 1].x) / 2) + '" y="' + ((pts[0].y + pts[pts.length - 1].y) / 2 - 6) + '" text-anchor="middle">' + ({ ring: HydGraph.parallelOf(hyd(), p) ? 'дублирует соседнюю трубу — удалите одну' : 'замыкает кольцо — не считается', 'itp-cold': 'ИТП не подключена к вводу на листе ХВС — ГВС не считается', skipped: 'труба пропущена расчётом — см. замечания' }[issue] || 'не подключена к вводу') + '</text>');
        }

        if (sel) {
            p.pts.forEach(function (q, i) {
                out.push('<circle class="cv-vertex" data-vh="' + esc(p.id) + ':' + i + '" cx="' + q.x + '" cy="' + q.y + '" r="5"/>');
            });
        }

        out.push('</g>');
        return out.join('');
    }

    /* Расчётные точки диктующего пути: нумерованные маркеры рядом с точками подключения. */
    function drawPoints(route) {
        var o = ['<g class="cv-points">'];

        route.points.forEach(function (p) {
            if (p.net !== state.net) return;
            var x = p.x - 11;
            var y = p.y - 12;
            o.push('<g class="cv-pt"><line x1="' + p.x + '" y1="' + p.y + '" x2="' + x + '" y2="' + y + '"/><circle cx="' + x + '" cy="' + y + '" r="8"/>'
                + '<text x="' + x + '" y="' + (y + 3.2) + '" text-anchor="middle">' + p.no + '</text></g>');
        });

        o.push('</g>');
        return o.join('');
    }

    function range(first, last) {
        if (first === last) return first;
        var tail = String(last).split(/\s+/).pop();
        return first + '–' + tail;
    }

    /* Порты узла: кружки по краям, поверх всего. */
    function drawPorts(n, used) {
        if (n.kind === 'tee') return '';
        return HydGraph.portDefs(n).map(function (q) {
            return '<g class="cv-port' + (used[n.id + '|' + q[0]] ? ' used' : '') + '" data-port="' + esc(n.id + '|' + q[0]) + '">'
                + '<circle class="cv-porthit" cx="' + q[1] + '" cy="' + q[2] + '" r="2"/>'
                + '<circle class="cv-portdot" cx="' + q[1] + '" cy="' + q[2] + '" r="4"/></g>';
        }).join('');
    }

    /* Задвижка — «бабочка» (условное обозначение запорной арматуры). */
    function valve(x, y) {
        return '<path class="cv-valve" d="M' + (x - 6) + ' ' + (y - 5) + ' L' + (x + 6) + ' ' + (y + 5) + ' L' + (x + 6) + ' ' + (y - 5) + ' L' + (x - 6) + ' ' + (y + 5) + ' Z"/>';
    }

    /* Обратный клапан: треугольник с планкой по ходу воды (слева направо). */
    function check(x, y) {
        return '<path class="cv-valve" d="M' + (x - 6) + ' ' + (y - 5) + ' L' + (x + 5) + ' ' + y + ' L' + (x - 6) + ' ' + (y + 5) + ' Z"/>'
            + '<line class="cv-valve" x1="' + (x + 5) + '" y1="' + (y - 6) + '" x2="' + (x + 5) + '" y2="' + (y + 6) + '"/>';
    }

    function gauge(x, y) {
        return '<line class="cv-valve" x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (y + 8) + '"/>'
            + '<circle class="cv-gauge" cx="' + x + '" cy="' + (y - 1) + '" r="6"/><text class="cv-gt" x="' + x + '" y="' + (y + 1.5) + '" text-anchor="middle">М</text>';
    }

    /* Строка напора участка или узла по режиму «Напоры на этажах» (динамический, статический, скрыть). */
    function headLine(hd, one) {
        if (!hd || state.showHead === 'off') return null;
        var stat = state.showHead === 'stat';
        var a = stat ? hd.inStat : hd.inDyn;
        var b = stat ? hd.outStat : hd.outDyn;
        var pre = stat ? 'Hст ' : 'H ';
        if (one) return pre + num(b, 1) + ' м';
        return pre + num(a, 1) + ' → ' + num(b, 1) + ' м';
    }

    /*
        Водомерный узел: условный знак счётчика — прямоугольник, перечёркнутый по диагонали,
        одна половина заштрихована в цвет системы. Всегда вдоль трубы (rot 0 или 90),
        два присоединения на концах. Подпись: марка, потери и напор до и после.
    */
    function meterSymbol(n, byId) {
        var net = state.net;
        var dev = byId[net + '|dev:' + n.id];
        var hatch = net === 'h' ? 'cvHatchH' : 'cvHatchC';
        var cls = net === 'h' ? 'hot' : 'cold';
        var vertical = n.rot === 90;
        var o = [vertical ? '<rect class="cv-hit-n" x="-18" y="-32" width="36" height="64"/>' : '<rect class="cv-hit-n" x="-32" y="-18" width="64" height="36"/>'];

        o.push('<g transform="rotate(' + (vertical ? 90 : 0) + ')">'
            + '<line class="cv-pipe thin ' + cls + '" x1="-22" x2="-13" y1="0" y2="0"/><line class="cv-pipe thin ' + cls + '" x1="13" x2="22" y1="0" y2="0"/>'
            + '<rect class="hatch-bg" x="-13" y="-7" width="26" height="14"/><polygon points="13,-7 13,7 -13,7" fill="url(#' + hatch + ')"/>'
            + '<rect class="cv-meterbox" x="-13" y="-7" width="26" height="14"/>'
            + '<line class="cv-meterbox" x1="-13" y1="7" x2="13" y2="-7"/></g>');

        var lines = [];

        if (dev && dev.res && dev.res.meter) {
            lines.push([dev.res.meter.mark + (dev.res.meter.manual ? ' *' : ''), '']);
            lines.push(['h=' + num(dev.res.meter.h, 2) + ' м', 'dim']);
            var hl = headLine(dev.res.hd);
            if (hl) lines.push([hl, 'head']);
        } else {
            lines.push([({ main: 'водомерный узел на вводе', section: 'водомерный узел', builtin: 'узел учёта' }[n.role]), 'dim']);
        }

        lines.forEach(function (l, i) {
            var c = l[1] === 'head' ? 'cv-head' : 'cv-t' + (l[1] ? ' ' + l[1] : '');
            if (vertical) o.push('<text class="' + c + '" x="20" y="' + (-4 + i * 11) + '">' + esc(l[0]) + '</text>');
            else o.push('<text class="' + c + '" y="' + (24 + i * 11) + '" text-anchor="middle">' + esc(l[0]) + '</text>');
        });

        return o.join('');
    }

    /*
        Насосная установка с обвязкой: входной и напорный коллекторы, на каждом насосе
        задвижки и обратный клапан, манометры на коллекторах. Рабочие насосы сверху,
        резервные — ниже, пунктиром. Условное обозначение, без анимации.
    */
    function pumpStation(n, result) {
        var cnt = HydGraph.pumpCount(n);
        var work = Math.max(1, n.work || 1);
        var H = HydGraph.pumpHeight(n);
        var top = -(cnt - 1) * 18;
        var sys = result && result.systems ? result.systems.filter(function (s) { return s.id === n.id; })[0] : null;
        var o = ['<rect class="cv-hit-n" x="-82" y="' + (-H / 2 - 8) + '" width="164" height="' + (H + 16) + '"/>',
            '<rect class="cv-frame" x="-64" y="' + (-H / 2) + '" width="128" height="' + H + '" rx="5"/>',
            '<line class="cv-pipe cold" x1="-75" x2="-52" y1="0" y2="0"/><line class="cv-pipe cold" x1="52" x2="75" y1="0" y2="0"/>',
            '<line class="cv-coll" x1="-52" x2="-52" y1="' + top + '" y2="' + (-top) + '"/>',
            '<line class="cv-coll" x1="52" x2="52" y1="' + top + '" y2="' + (-top) + '"/>'];

        for (var i = 0; i < cnt; i++) {
            var y = top + i * 36;
            var res = i >= work;
            o.push('<g class="' + (res ? 'cv-reserve' : '') + '">'
                + '<line class="cv-pipe thin cold" x1="-52" x2="52" y1="' + y + '" y2="' + y + '"/>'
                + valve(-40, y) + '<circle class="cv-pump" cx="-9" cy="' + y + '" r="12"/>'
                + '<path class="cv-pumpmark" d="M' + (-14) + ' ' + (y - 6) + ' L' + (-3) + ' ' + y + ' L' + (-14) + ' ' + (y + 6) + ' Z"/>'
                + check(22, y) + valve(38, y) + (res ? '<text class="cv-gt" x="-44" y="' + (y - 8) + '">рез.</text>' : '') + '</g>');
        }

        o.push(gauge(-52, top - 16));
        o.push(gauge(52, top - 16));

        var pdev = result && result.net ? result.net.byId['c|dev:' + n.id] : null;
        var phi = pdev && pdev.res.hd ? headLine({ inDyn: pdev.res.hd.inDyn, outDyn: pdev.res.hd.inDyn, inStat: pdev.res.hd.inStat, outStat: pdev.res.hd.inStat }, true) : null;
        var pho = pdev && pdev.res.hd ? headLine({ inDyn: pdev.res.hd.outDyn, outDyn: pdev.res.hd.outDyn, inStat: pdev.res.hd.outStat, outStat: pdev.res.hd.outStat }, true) : null;
        if (phi) o.push('<text class="cv-head" x="-67" y="14" text-anchor="end">до насоса: ' + esc(phi) + '</text>');
        if (pho) o.push('<text class="cv-head" x="67" y="14">после: ' + esc(pho) + '</text>');
        o.push('<text class="cv-t b" y="' + (-H / 2 - 16) + '" text-anchor="middle">' + esc(n.name) + '</text>');

        var kit = work + ' раб.' + (cnt - work ? ' + ' + (cnt - work) + ' рез.' : '');

        if (sys && sys.pump) {
            o.push('<text class="cv-t" y="' + (H / 2 + 20) + '" text-anchor="middle">Q=' + num(sys.pump.q, 2) + ' л/с  H=' + num(sys.pump.hp, 1) + ' м</text>');
            o.push('<text class="cv-t dim" y="' + (H / 2 + 31) + '" text-anchor="middle">' + kit + ', каждый ' + num(sys.pump.q / work, 2) + ' л/с</text>');
            var sel = hyd().pumpSel ? hyd().pumpSel[n.id] : null;
            if (sel && sel.name) {
                o.push('<text class="cv-t b" y="' + (H / 2 + 43) + '" text-anchor="middle">' + esc(sel.name) + '</text>');
                if (sel.Qf !== null && sel.Hf !== null) o.push('<text class="cv-t dim" y="' + (H / 2 + 54) + '" text-anchor="middle">Qф=' + num(sel.Qf, 2) + ' л/с  Hф=' + num(sel.Hf, 1) + ' м</text>');
            }
        } else {
            o.push('<text class="cv-t dim" y="' + (H / 2 + 20) + '" text-anchor="middle">нет нагрузки · ' + kit + '</text>');
        }

        return o.join('');
    }

    function drawNode(h, n, result, byId, used) {
        var net = state.net;
        var p = HydModel.pos(n, net);
        var sel = isSel('node', n.id) || (state.multi && state.multi.indexOf(n.id) >= 0);
        var cls = 'cv-n ' + n.kind + (sel ? ' sel' : '') + (dim.nodes[n.id] ? ' cv-dim' : '');
        var g = ['<g class="' + cls + '" data-n="' + esc(n.id) + '" transform="translate(' + p.x + ',' + p.y + ')">'];

        if (n.kind === 'tee') {
            g.push('<circle class="cv-hit-n" r="11"/><circle class="cv-tee" r="4.5"/>');
            g.push('<g class="cv-port" data-port="' + esc(n.id) + '|c"><circle class="cv-porthit" r="2"/></g>');
        } else if (n.kind === 'input') {
            var inSeg = byId['c|in'];
            g.push('<circle class="cv-hit-n" r="20"/><circle class="cv-shape" r="11"/><text class="cv-ico" y="4" text-anchor="middle">В</text>');
            g.push('<text class="cv-t b" y="-22" text-anchor="middle">' + esc(n.name) + '</text>');
            g.push('<text class="cv-t dim" y="30" text-anchor="middle">Hгар=' + num(n.Hgar, 1) + ' м' + (inSeg && inSeg.res && inSeg.res.size ? '  ' + esc(inSeg.res.size.label) : '') + '</text>');
            if (inSeg && inSeg.res && inSeg.res.size) g.push('<text class="cv-t dim" y="41" text-anchor="middle">q=' + num(inSeg.res.q, 3) + '  V=' + num(inSeg.res.size.v, 2) + '</text>');
            if (inSeg && inSeg.res && headLine(inSeg.res.hd, true)) g.push('<text class="cv-head" y="52" text-anchor="middle">после ввода: ' + esc(headLine(inSeg.res.hd, true)) + '</text>');
        } else if (n.kind === 'meter') {
            g.push(meterSymbol(n, byId));
        } else if (n.kind === 'pump') {
            g.push(pumpStation(n, result));
        } else if (n.kind === 'itp') {
            g.push('<rect class="cv-hit-n" x="-36" y="-22" width="72" height="44"/><rect class="cv-shape itp" x="-30" y="-16" width="60" height="32" rx="5"/><text class="cv-ico" y="5" text-anchor="middle">' + esc(n.name || 'ИТП') + '</text>');
            if (n.itpNo > 0) g.push('<text class="cv-t dim" y="-26" text-anchor="middle">ИТП №' + n.itpNo + '</text>');
            var dev2 = byId['h|dev:' + n.id];
            if (dev2 && dev2.res) g.push('<text class="cv-t dim" y="32" text-anchor="middle">ГВС q=' + num(dev2.res.q, 3) + ' л/с</text>');
            var feed = arrive['c|' + n.id];
            var hc = feed && feed.res.hd ? headLine({ inDyn: feed.res.hd.outDyn, outDyn: feed.res.hd.outDyn, inStat: feed.res.hd.outStat, outStat: feed.res.hd.outStat }, true) : null;
            var hh = dev2 && dev2.res.hd ? headLine({ inDyn: dev2.res.hd.outDyn, outDyn: dev2.res.hd.outDyn, inStat: dev2.res.hd.outStat, outStat: dev2.res.hd.outStat }, true) : null;
            if (hc) g.push('<text class="cv-head" y="43" text-anchor="middle">на входе ИТП: ' + esc(hc) + '</text>');
            if (hh) g.push('<text class="cv-head" y="54" text-anchor="middle">на выходе в ГВС: ' + esc(hh) + '</text>');
        } else if (n.kind === 'buildin') {
            g.push('<rect class="cv-hit-n" x="-68" y="-20" width="136" height="40"/><rect class="cv-shape build" x="-62" y="-14" width="124" height="28" rx="5"/>');
            g.push('<text class="cv-t b" y="-1" text-anchor="middle">' + esc(n.name) + '</text>');
            g.push('<text class="cv-t dim" y="10" text-anchor="middle">' + n.U + ' чел.' + (n.hasHot ? '' : ', без ГВС') + '</text>');
            var ba = arrive[net + '|' + n.id];
            var bh = ba && ba.res.hd ? headLine({ inDyn: ba.res.hd.outDyn, outDyn: ba.res.hd.outDyn, inStat: ba.res.hd.outStat, outStat: ba.res.hd.outStat }, true) : null;
            if (bh) g.push('<text class="cv-head" y="30" text-anchor="middle">' + esc(bh) + '</text>');
        } else if (n.kind === 'riser') {
            g.push(drawRiser(h, n, result, byId));
        }

        g.push(drawPorts(n, used));
        g.push('</g>');
        return g.join('');
    }

    /* Блок стояка: подставка с портами, вертикаль этажей, боксы коллекторных узлов, размер. */
    function drawRiser(h, n, result, byId) {
        var net = state.net;
        var fp = h.survey.floorPx;
        var top = n.floorTo;
        var H = top * fp;
        var entry = result && result.ex ? result.ex.risers.filter(function (r) { return r.node.id === n.id; })[0] : null;
        var mark = entry ? (net === 'c' ? entry.markC : entry.markH) : n.id;
        var first = byId[net + '|' + n.id + '|R|1'];
        var o = [];

        o.push('<rect class="cv-hit-n" x="-32" y="' + (-H - 4) + '" width="64" height="' + (H + 26) + '"/>');
        o.push('<rect class="cv-plate' + (net === 'h' ? ' hot' : '') + '" x="-26" y="0" width="52" height="18" rx="4"/>');
        o.push('<text class="cv-plate-t" y="12.5" text-anchor="middle">' + esc(mark) + '</text>');
        var ra = arrive[net + '|' + n.id];
        var rh = ra && ra.res.hd ? headLine({ inDyn: ra.res.hd.outDyn, outDyn: ra.res.hd.outDyn, inStat: ra.res.hd.outStat, outStat: ra.res.hd.outStat }, true) : null;
        if (rh) o.push('<text class="cv-head" y="31" text-anchor="middle">у основания: ' + esc(rh) + '</text>');

        // этажи: у транзитных ниже floorFrom линия светлее
        var lvl = HydModel.levels(h, n);

        for (var f = 1; f <= top; f++) {
            var y = -f * fp + fp / 2;
            var transit = f < n.floorFrom;
            o.push('<line class="cv-floor' + (transit ? ' transit' : '') + '" x1="-10" x2="10" y1="' + (-f * fp) + '" y2="' + (-f * fp) + '"/>');
            if (fp >= 14 || f % 5 === 0 || f === 1 || f === top) {
                o.push('<text class="cv-fl" x="-14" y="' + (y + 3) + '" text-anchor="end"><title>Этаж ' + f + ': пол ' + num(lvl[f], 3) + ' м, высота ' + num(lvl[f + 1] - lvl[f], 2) + ' м</title>' + f + '</text>');
            }
        }

        o.push('<line class="cv-pipe ' + (net === 'c' ? 'cold' : 'hot') + ' riser' + (first && first.res && first.res.size && !first.res.size.ok ? ' bad' : '') + '" x1="0" x2="0" y1="0" y2="' + (-H) + '"/>');
        o.push('<text class="cv-t b" x="0" y="' + (-H - 12) + '" text-anchor="middle">' + esc(mark) + (n.name ? ' · ' + esc(n.name) : '') + '</text>');

        if (first && first.res && first.res.size) {
            var z = first.res.size;
            var ym = -Math.min(H, 60) / 2 - 6;
            o.push('<text class="cv-t" x="-36" y="' + ym + '" text-anchor="end">' + esc(z.label) + '</text>');
            o.push('<text class="cv-t" x="-36" y="' + (ym + 10) + '" text-anchor="end">q=' + num(first.res.q, 3) + '</text>');
            o.push('<text class="cv-t" x="-36" y="' + (ym + 20) + '" text-anchor="end">V=' + num(z.v, 2) + ' i=' + num(z.iMm, 2) + '</text>');
        }

        // боксы коллекторных узлов
        if (entry) {
            entry.floors.forEach(function (fl) {
                fl.collectors.forEach(function (c, j) {
                    var bx = 14 + j * 62;
                    var by = -fl.f * fp + 1;
                    var outs = c.outlets;
                    var label = outs.length ? range(outs[0].label, outs[outs.length - 1].label) : c.col.name;
                    var selFl = state.selected && state.selected.type === 'floor' && state.selected.riser === n.id
                        && state.selected.floor === fl.f && state.selected.collector === c.col.id;

                    o.push('<g class="cv-fb' + (selFl ? ' sel' : '') + '" data-fl="' + esc(n.id + '|' + fl.f + '|' + c.col.id) + '">'
                        + '<title>' + esc(mark + ', этаж ' + fl.f + ', ' + c.col.name + ' — щёлкните, чтобы изменить') + '</title>'
                        + '<line class="cv-pipe thin ' + (net === 'c' ? 'cold' : 'hot') + '" x1="' + (j ? bx - 6 : 0) + '" x2="' + bx + '" y1="' + (by + (fp - 3) / 2) + '" y2="' + (by + (fp - 3) / 2) + '"/>'
                        + '<rect class="cv-box' + (net === 'h' ? ' hot' : '') + '" x="' + bx + '" y="' + by + '" width="56" height="' + (fp - 3) + '" rx="3"/>'
                        + '<text class="cv-c" x="' + (bx + 28) + '" y="' + (by + (fp - 3) / 2 + 3) + '" text-anchor="middle">' + esc(label) + '</text></g>');
                });

                o.push(floorHead(h, n, fl, byId, fp));
            });
        }

        return o.join('');
    }

    /*
        Напор у коллекторных узлов этажа справа от боксов: при расчётном расходе (динамический)
        или без расхода (статический) — по настройке «Напоры на этажах». Красный — ниже
        свободного напора Hпр, оранжевый — выше предела статики (нужен регулятор).
    */
    function floorHead(h, n, fl, byId, fp) {
        var mode = state.showHead;
        if (mode === 'off' || !fl.collectors.length) return '';

        var dyn = null;
        var stat = null;

        fl.collectors.forEach(function (c) {
            var s = byId[state.net + '|' + c.id + '|fb'];
            if (!s || !s.res || !s.res.press) return;
            if (dyn === null || s.res.press.dyn < dyn) dyn = s.res.press.dyn;
            if (stat === null || s.res.press.stat > stat) stat = s.res.press.stat;
        });

        if (dyn === null) return '';

        var v = mode === 'stat' ? stat : dyn;
        var cls = mode === 'stat' ? (v > h.survey.staticLimit ? 'high' : '') : (v < h.survey.hPr ? 'low' : (stat > h.survey.staticLimit ? 'high' : ''));
        var x = 14 + fl.collectors.length * 62 + 2;
        var y = -fl.f * fp + (fp - 3) / 2 + 4;

        return '<g><title>' + esc('этаж ' + fl.f + ': напор у коллектора ' + num(dyn, 1) + ' м при расчётном расходе, статический ' + num(stat, 1) + ' м') + '</title>'
            + '<text class="cv-head ' + cls + '" x="' + x + '" y="' + y + '">' + (mode === 'stat' ? 'Hст ' : 'H ') + num(v, 1) + ' м</text></g>';
    }

    /* Предпросмотр: тянущаяся труба и кольцо притяжения под курсором. */
    function drawPreview() {
        var el = svg.querySelector('#cvPreview');
        var out = [];
        var k = state.view.k;
        var d = state.drawing;
        var hv = state.hover;

        var m = state.marquee;
        if (m) out.push('<rect class="cv-marquee' + (m.x1 < m.x0 ? ' cross' : '') + '" x="' + Math.min(m.x0, m.x1) + '" y="' + Math.min(m.y0, m.y1) + '" width="' + Math.abs(m.x1 - m.x0) + '" height="' + Math.abs(m.y1 - m.y0) + '"/>');

        if (d) {
            var path = previewPath(d, hv);
            if (path) out.push('<polyline class="cv-preview" points="' + path.map(function (q) { return q.x + ',' + q.y; }).join(' ') + '"/>');
        }

        if (hv && (state.tool === 'pipe' || state.drawing || hv.fromPort)) {
            if (hv.kind === 'port') out.push('<circle class="cv-snap" cx="' + hv.pt.x + '" cy="' + hv.pt.y + '" r="' + (9 / k) + '" style="stroke-width:' + (2.5 / k) + 'px"/>');
            else if (hv.kind === 'free' && state.tool === 'pipe' && !state.drawing) out.push('<circle class="cv-snap free" cx="' + hv.pt.x + '" cy="' + hv.pt.y + '" r="' + (6 / k) + '" style="stroke-width:' + (1.5 / k) + 'px"/>');
            else if (hv.kind === 'full') out.push('<circle class="cv-snap bad" cx="' + hv.pt.x + '" cy="' + hv.pt.y + '" r="' + (9 / k) + '" style="stroke-width:' + (2.5 / k) + 'px"/>');
            else if (hv.kind === 'pipe') out.push('<rect class="cv-snap pipe" x="' + (hv.pt.x - 5 / k) + '" y="' + (hv.pt.y - 5 / k) + '" width="' + (10 / k) + '" height="' + (10 / k) + '" transform="rotate(45 ' + hv.pt.x + ' ' + hv.pt.y + ')" style="stroke-width:' + (2.5 / k) + 'px"/>');
        }

        el.innerHTML = out.join('');
    }

    /* --- привязка -------------------------------------------------------------- */

    function busyMessage(node) {
        if (node.kind === 'itp') return 'К ИТП на листе ХВС подводится одна труба (подача). Горячую сеть рисуйте на листе ГВС.';
        return (node.kind === 'riser' ? 'К стояку' : 'К встроенному помещению') + ' подводится одна труба — он тупиковый. Удалите прежнюю трубу или тяните от тройника.';
    }

    /*
        Цель притяжения под курсором: порт, труба (появится тройник) или пустое место.
        Порты и трубы ищутся в радиусе, заданном в пикселях экрана.
    */
    function target(w) {
        var h = hyd();
        var k = state.view.k;
        var open = function (n) { return !HydGraph.full(h, n, state.net); };
        var port = HydGraph.nearestPort(h, state.net, w, SNAP_PX / k, open);

        if (port) return { kind: 'port', node: port.node, port: port.port, pt: { x: port.port.x, y: port.port.y } };

        // порт рядом есть, но объект уже занят: тупик принимает одну трубу
        var busy = HydGraph.nearestPort(h, state.net, w, SNAP_PX / k);
        if (busy) return { kind: 'full', node: busy.node, pt: { x: busy.port.x, y: busy.port.y } };

        var pipe = HydGraph.nearestPipe(h, state.net, w, PIPE_PX / k);

        if (pipe) {
            var pt = { x: Math.round(pipe.hit.pt.x), y: Math.round(pipe.hit.pt.y) };
            return { kind: 'pipe', pipe: pipe.pipe, hit: pipe.hit, pt: pt };
        }

        return { kind: 'free', pt: snap(w) };
    }

    function constrain(from, p, dir) {
        if (!state.ortho) return p;
        if (dir && (dir.dx || dir.dy)) return dir.dx !== 0 ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
        return Math.abs(p.x - from.x) >= Math.abs(p.y - from.y) ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
    }

    function startPoint(d) {
        var a = HydModel.nodeById(hyd(), d.a);
        return HydGraph.endPort(a, d.pa, state.net, d.pts.length ? d.pts[0] : (state.hover ? state.hover.pt : HydModel.pos(a, state.net)));
    }

    function lastPoint(d) {
        if (d.pts.length) return d.pts[d.pts.length - 1];
        return startPoint(d);
    }

    /* Выход из последней точки: из порта по его направлению, из изгиба — вдоль последнего звена. */
    function lastDir(d) {
        if (!d.pts.length) {
            var sp = startPoint(d);
            return { dx: sp.dx || 0, dy: sp.dy || 0 };
        }

        var prev = d.pts.length > 1 ? d.pts[d.pts.length - 2] : startPoint(d);
        var last = d.pts[d.pts.length - 1];
        var dx = last.x - prev.x;
        var dy = last.y - prev.y;
        return Math.abs(dx) >= Math.abs(dy) ? { dx: Math.sign(dx), dy: 0 } : { dx: 0, dy: Math.sign(dy) };
    }

    /* Ломаная предпросмотра и итога: начало, изгибы, автоизлом, конец. */
    function previewPath(d, t) {
        var start = startPoint(d);
        var pts = [{ x: start.x, y: start.y }].concat(d.pts);
        if (!t) return pts;

        var end = t.pt;
        var last = lastPoint(d);

        if (t.kind === 'free') {
            end = constrain(last, t.pt, lastDir(d));
        } else if (state.ortho) {
            var arrive = t.kind === 'port' ? t.port : null;
            Array.prototype.push.apply(pts, HydGraph.route(last, lastDir(d), t.pt, arrive));
        }

        pts.push(end);
        return pts;
    }

    /* --- события ------------------------------------------------------------- */

    function onWheel(e) {
        e.preventDefault();

        if (e.shiftKey) {
            // Shift + колесо — сдвиг по горизонтали
            state.view.x -= e.deltaY;
            applyView();
            return;
        }

        var r = svg.getBoundingClientRect();
        var px = e.clientX - r.left;
        var py = e.clientY - r.top;
        var k0 = state.view.k;
        var k1 = Math.max(0.15, Math.min(3, k0 * Math.pow(1.0015, -e.deltaY)));
        state.view.x = px - (px - state.view.x) * (k1 / k0);
        state.view.y = py - (py - state.view.y) * (k1 / k0);
        state.view.k = k1;
        applyView();
        drawPreview();
    }

    /* --- выделение рамкой и группа ------------------------------------------- */

    function setPos(n, x, y) {
        if (state.net === 'h' && n.sheet === 'both') { n.hx = x; n.hy = y; }
        else { n.x = x; n.y = y; }
    }

    /* Габарит объекта в координатах текущего листа. */
    function nodeBox(h, n) {
        var p = HydModel.pos(n, state.net);
        var a;

        if (n.kind === 'tee') a = [-6, -6, 6, 6];
        else if (n.kind === 'input') a = [-18, -18, 18, 18];
        else if (n.kind === 'meter') a = n.rot === 90 ? [-16, -30, 16, 30] : [-30, -16, 30, 16];
        else if (n.kind === 'pump') { var H = HydGraph.pumpHeight(n); a = [-80, -H / 2 - 8, 80, H / 2 + 8]; }
        else if (n.kind === 'itp') a = [-36, -20, 36, 20];
        else if (n.kind === 'buildin') a = [-68, -20, 68, 20];
        else a = [-32, -n.floorTo * h.survey.floorPx - 14, 32, 20];

        return { x0: p.x + a[0], y0: p.y + a[1], x1: p.x + a[2], y1: p.y + a[3] };
    }

    /* Идентификаторы выбранных объектов (одиночный выбор или рамка). */
    function selectedIds() {
        if (state.multi && state.multi.length) return state.multi.slice();
        return state.selected && state.selected.type === 'node' ? [state.selected.id] : [];
    }

    function select(sel) {
        state.multi = sel && sel.type === 'multi' ? sel.ids.slice() : [];
        api.select(sel);
    }

    function setSelection(ids) {
        if (!ids.length) select(null);
        else if (ids.length === 1) select({ type: 'node', id: ids[0] });
        else select({ type: 'multi', ids: ids });
    }

    /* Рамка слева направо берёт объекты целиком, справа налево — всё, что она задела. */
    function marqueeIds(m) {
        var h = hyd();
        var x0 = Math.min(m.x0, m.x1);
        var x1 = Math.max(m.x0, m.x1);
        var y0 = Math.min(m.y0, m.y1);
        var y1 = Math.max(m.y0, m.y1);
        var crossing = m.x1 < m.x0;
        var ids = [];

        h.canvas.nodes.forEach(function (n) {
            if (!HydGraph.onSheet(n, state.net) || dim.nodes[n.id]) return;
            var b = nodeBox(h, n);
            var inside = b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1;
            var touch = b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
            if (crossing ? touch : inside) ids.push(n.id);
        });

        return ids;
    }

    function onDown(e) {
        svg.focus();

        if (e.button === 1 || (e.button === 0 && (space || state.tool === 'pan'))) {
            drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return;

        // порт: щелчок начинает трубу, протяжка — тянет её до другого порта
        var pe = e.target.closest('[data-port]');

        // у узла-тройника порт занимает всё тело: в режиме «Выбор» его можно выбрать, двигать и
        // удалить; трубу из него тянет инструмент «Труба»
        var peNode = pe ? HydModel.nodeById(hyd(), pe.getAttribute('data-port').split('|')[0]) : null;
        var teeSelect = !!(peNode && peNode.kind === 'tee' && state.tool === 'select');

        if (pe && !teeSelect && !state.drawing && (state.tool === 'select' || state.tool === 'pipe')) {
            var ids = pe.getAttribute('data-port').split('|');
            var own = HydModel.nodeById(hyd(), ids[0]);
            if (own && HydGraph.full(hyd(), own, state.net)) { api.say(busyMessage(own)); e.preventDefault(); return; }
            drag = { type: 'port', node: ids[0], port: ids[1], sx: e.clientX, sy: e.clientY, moved: false };
            e.preventDefault();
            return;
        }

        if (state.tool !== 'select') return;

        var vh = e.target.closest('[data-vh]');
        if (vh) {
            var parts = vh.getAttribute('data-vh').split(':');
            drag = { type: 'vertex', pipe: parts[0], idx: +parts[1], moved: false };
            e.preventDefault();
            return;
        }

        var fl = e.target.closest('[data-fl]');
        if (fl) return;

        var nd = e.target.closest('[data-n]');
        var w = world(e);

        if (nd) {
            var id = nd.getAttribute('data-n');
            var node = HydModel.nodeById(hyd(), id);
            var p = HydModel.pos(node, state.net);

            // Shift — добавить объект в выделение или убрать из него
            if (e.shiftKey) {
                var cur = selectedIds();
                var at = cur.indexOf(id);
                if (at >= 0) cur.splice(at, 1); else cur.push(id);
                setSelection(cur);
                e.preventDefault();
                return;
            }

            var group = selectedIds();

            if (group.length > 1 && group.indexOf(id) >= 0) {
                // тянем всю выбранную группу: трубы между выбранными сохраняют форму
                var set = {};
                group.forEach(function (g) { set[g] = true; });

                drag = {
                    type: 'group', start: w, moved: false, anchor: id, ids: group, dx: w.x - p.x, dy: w.y - p.y,
                    orig: group.map(function (g) {
                        var n = HydModel.nodeById(hyd(), g);
                        var q = HydModel.pos(n, state.net);
                        return { n: n, x: q.x, y: q.y };
                    }),
                    pipes: hyd().canvas.pipes.filter(function (pp) { return pp.sheet === state.net && set[pp.a] && set[pp.b]; }).map(function (pp) {
                        return { pipe: pp, pts: pp.pts.map(function (q) { return { x: q.x, y: q.y }; }) };
                    })
                };
                e.preventDefault();
                return;
            }

            drag = { type: 'node', id: id, dx: w.x - p.x, dy: w.y - p.y, moved: false, down: e };
            e.preventDefault();
            return;
        }

        var pp2 = e.target.closest('[data-p]');
        if (pp2) return;

        // пустое место: рамка выделения
        drag = { type: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, moved: false };
        e.preventDefault();
    }

    function onMove(e) {
        if (!drag) return;

        if (drag.type === 'pan') {
            var dx = e.clientX - drag.sx;
            var dy = e.clientY - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            state.view.x = drag.vx + dx;
            state.view.y = drag.vy + dy;
            applyView();
            return;
        }

        var w = world(e);

        if (drag.type === 'marquee') {
            if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
            drag.x1 = w.x;
            drag.y1 = w.y;
            if (drag.moved) { state.marquee = drag; drawPreview(); }
        } else if (drag.type === 'port') {
            if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) {
                drag.moved = true;
                state.drawing = { a: drag.node, pa: drag.port, pts: [], tee: false, fromPort: true };
            }
            if (drag.moved) {
                state.hover = target(w);
                state.hover.fromPort = true;
                drawPreview();
            }
        } else if (drag.type === 'node') {
            var node = HydModel.nodeById(hyd(), drag.id);
            if (!node) return;
            var q = snap({ x: w.x - drag.dx, y: w.y - drag.dy });
            var cur = HydModel.pos(node, state.net);
            if (q.x === cur.x && q.y === cur.y) return;
            drag.moved = true;
            setPos(node, q.x, q.y);
            render(api.result());
        } else if (drag.type === 'group') {
            var anchor = drag.orig.filter(function (o) { return o.n.id === drag.anchor; })[0];
            var t = snap({ x: w.x - drag.dx, y: w.y - drag.dy });
            var mx = t.x - anchor.x;
            var my = t.y - anchor.y;
            if (!drag.moved && !mx && !my) return;
            drag.moved = true;

            drag.orig.forEach(function (o) { setPos(o.n, o.x + mx, o.y + my); });
            drag.pipes.forEach(function (s) {
                s.pipe.pts = s.pts.map(function (q2) { return { x: q2.x + mx, y: q2.y + my }; });
            });
            render(api.result());
        } else if (drag.type === 'vertex') {
            var pipe = hyd().canvas.pipes.filter(function (p) { return p.id === drag.pipe; })[0];
            if (!pipe || !pipe.pts[drag.idx]) return;
            pipe.pts[drag.idx] = snap(w);
            drag.moved = true;
            render(api.result());
        }
    }

    function onUp(e) {
        if (!drag) return;
        var d = drag;
        drag = null;

        if (d.type === 'pan') {
            return;
        }

        if (d.type === 'marquee') {
            state.marquee = null;
            drawPreview();

            if (!d.moved) { select(null); return; }

            var ids = marqueeIds(d);
            if (d.shift) selectedIds().forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
            setSelection(ids);
            return;
        }

        if (d.type === 'port') {
            suppressClick = true;
            setTimeout(function () { suppressClick = false; }, 0);

            var node = HydModel.nodeById(hyd(), d.node);
            if (!node) return;

            if (!d.moved) {
                // обычный щелчок по порту: переходим в режим трубы и ведём её кликами
                state.tool = 'pipe';
                state.drawing = { a: d.node, pa: d.port, pts: [], tee: false };
                state.hover = null;
                api.tool();
                drawPreview();
                return;
            }

            var w = world(e);
            var t = target(w);
            var drawing = state.drawing;
            state.drawing = null;
            state.hover = null;

            if (t.kind === 'full') api.say(busyMessage(t.node));

            if (drawing && (t.kind === 'port' || t.kind === 'pipe') && !(t.kind === 'port' && t.node.id === d.node && t.port.id === d.port)) {
                finish(drawing, t);
            } else if (drawing && t.kind === 'free') {
                // отпустили в пустом месте: там встаёт узел, и труба продолжается дальше
                state.tool = 'pipe';
                api.tool();
                state.drawing = drawing;
                extendChain(drawing, w);
            } else {
                drawPreview();
            }
            return;
        }

        if (d.type === 'node') {
            state.selected = { type: 'node', id: d.id };
            state.multi = [];
            if (d.moved) api.changed();
            else api.select({ type: 'node', id: d.id });
        } else if (d.type === 'group') {
            if (d.moved) api.changed();
        } else if (d.type === 'vertex') {
            if (d.moved) api.changed();
        }
    }

    function onHover(e) {
        if (drag) return;
        var t = state.tool;

        if (t === 'pipe' || state.drawing) {
            state.hover = target(world(e));
            drawPreview();
        } else if (state.hover) {
            state.hover = null;
            drawPreview();
        }
    }

    function onKey(e) {
        if (e.code === 'Space' && document.activeElement === svg) { space = true; e.preventDefault(); }
        if (!svg || !svg.isConnected) return;
        var typing = /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '');

        if (e.key === 'Escape') {
            if (state.drawing) { cancelDrawing(); return; }
            state.tool = 'select';
            select(null);
            api.tool();
        } else if ((e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') && !typing && state.selected && state.selected.type === 'node' && document.getElementById('cvHost')) {
            rotate(state.selected.id);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.selected && document.getElementById('cvHost')) {
            remove(state.selected);
        }
    }

    function cancelDrawing() {
        var d = state.drawing;
        state.drawing = null;
        state.hover = null;

        if (d && d.tee) {
            var h = hyd();
            if (HydGraph.degree(h, d.a) === 0) {
                HydGraph.removeNode(h, d.a);
                api.changed();
                return;
            }
        }

        if (svg) drawPreview();
    }

    /* Повернуть счётчик на 90°: трубы, пришедшие в него, заново выбирают порты. */
    function rotate(id) {
        var h = hyd();
        var n = HydModel.nodeById(h, id);
        if (!n || n.kind !== 'meter') return;
        n.rot = n.rot === 90 ? 0 : 90;
        h.canvas.pipes.forEach(function (p) {
            if (p.a === id) delete p.pa;
            if (p.b === id) delete p.pb;
        });
        api.changed();
    }

    function remove(sel) {
        var h = hyd();
        if (!sel) return;

        if (sel.type === 'node') HydGraph.removeNode(h, sel.id);
        else if (sel.type === 'multi') sel.ids.forEach(function (id) { if (HydModel.nodeById(h, id)) HydGraph.removeNode(h, id); });
        else if (sel.type === 'pipe') HydGraph.removePipe(h, sel.id);
        else return;

        state.selected = null;
        state.multi = [];
        api.changed();
    }

    function onDbl(e) {
        // двойной щелчок по трубе — добавить вершину
        var pp = e.target.closest('[data-p]');
        if (!pp || state.tool !== 'select') return;
        var h = hyd();
        var pipe = h.canvas.pipes.filter(function (p) { return p.id === pp.getAttribute('data-p'); })[0];
        if (!pipe) return;
        var pts = HydGraph.ptsOf(h, pipe);
        var hit = HydGraph.nearestOnPoly(pts, world(e));
        pipe.pts.splice(hit.i, 0, snap(hit.pt));
        state.selected = { type: 'pipe', id: pipe.id };
        api.changed();
    }

    function onClick(e) {
        if (suppressClick) { suppressClick = false; return; }

        var tool = state.tool;
        var h = hyd();
        var w = world(e);
        var net = state.net;

        // боксы коллекторов
        var fl = e.target.closest('[data-fl]');

        if (fl && (tool === 'select' || tool === 'delete')) {
            var p = fl.getAttribute('data-fl').split('|');
            select({ type: 'floor', riser: p[0], floor: +p[1], collector: p[2] });
            return;
        }

        var nodeEl = e.target.closest('[data-n]');
        var pipeEl = e.target.closest('[data-p]');

        if (tool === 'select') {
            if (pipeEl && !nodeEl) select({ type: 'pipe', id: pipeEl.getAttribute('data-p') });
            return;
        }

        if (tool === 'delete') {
            if (nodeEl) remove({ type: 'node', id: nodeEl.getAttribute('data-n') });
            else if (pipeEl) remove({ type: 'pipe', id: pipeEl.getAttribute('data-p') });
            return;
        }

        if (tool === 'pipe') { pipeClick(w); return; }

        place(tool, w, net);
    }

    /* --- постановка объектов --------------------------------------------------- */

    /* Роль нового счётчика: на ХВС до насоса — ввод, иначе — секция. */
    function defaultRole(h, pipe) {
        if (pipe.sheet === 'h') return 'section';
        var inputs = h.canvas.nodes.filter(function (n) { return n.kind === 'input'; });
        var has = h.canvas.nodes.some(function (n) { return n.kind === 'meter' && n.role === 'main'; });
        return inputs.length && !has ? 'main' : 'section';
    }

    var HOOK = { riser: { dy: -60, port: 'b' }, buildin: { dy: 70, port: 't' }, itp: { dy: 80, port: 't' } };

    function place(tool, w, net) {
        var h = hyd();

        if ((tool === 'input' || tool === 'pump') && net === 'h') {
            api.say('Ввод и насосные ставятся на листе ХВС.');
            return;
        }

        var t = target(w);
        var node;

        if ((tool === 'meter' || tool === 'pump') && t.kind === 'pipe') {
            // в разрыв трубы
            node = HydModel.newNode(h, tool, t.pt.x, t.pt.y, t.pipe.sheet);
            if (tool === 'meter') {
                node.role = defaultRole(h, t.pipe);
                // счётчик встаёт вдоль трубы: по направлению звена, в которое врезан
                var seg = HydGraph.ptsOf(h, t.pipe);
                var a = seg[t.hit.i];
                var b = seg[t.hit.i + 1];
                node.rot = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 90 : 0;
            }
            h.canvas.nodes.push(node);
            HydGraph.splitPipe(h, t.pipe, t.hit, node);
        } else if (HOOK[tool] && t.kind === 'pipe') {
            // объект встаёт рядом с трубой и присоединяется через тройник
            var tee = HydModel.newNode(h, 'tee', t.pt.x, t.pt.y, net);
            h.canvas.nodes.push(tee);
            HydGraph.splitPipe(h, t.pipe, t.hit, tee);
            node = HydModel.newNode(h, tool, t.pt.x, t.pt.y + HOOK[tool].dy, net);
            if (node.sheet === 'both') { node.hx = node.x; node.hy = node.y; }
            h.canvas.nodes.push(node);
            HydGraph.addPipe(h, tee.id, node.id, net, [], 'c', HOOK[tool].port);
        } else {
            var pt = t.kind === 'free' ? t.pt : snap(w);
            node = HydModel.newNode(h, tool, pt.x, pt.y, net);
            if (tool === 'meter') node.role = net === 'h' ? 'section' : 'main';
            h.canvas.nodes.push(node);
        }

        state.selected = { type: 'node', id: node.id };
        state.tool = 'select';
        state.hover = null;
        api.tool();
        api.changed();
    }

    /* --- прокладка трубы -------------------------------------------------------- */

    /* Конец трубы — порт или труба (тройник появится в точке врезки). */
    function endNode(t) {
        var h = hyd();

        if (t.kind === 'port') return { id: t.node.id, port: t.port.id };

        var tee = HydModel.newNode(h, 'tee', t.pt.x, t.pt.y, state.net);
        h.canvas.nodes.push(tee);
        HydGraph.splitPipe(h, t.pipe, t.hit, tee);
        return { id: tee.id, port: 'c', dir: null };
    }

    function finish(d, t) {
        var h = hyd();
        var path = previewPath(d, t);
        var end = endNode(t);

        // путь рассчитан до врезки; береме внутренние точки
        var inner = path.slice(1, path.length - 1);

        if (end.id === d.a && !inner.length) { state.drawing = null; drawPreview(); return; }

        // между этими двумя объектами труба уже есть: вторая стала бы кольцом и не считалась
        var twin = h.canvas.pipes.filter(function (q) {
            return q.sheet === state.net && ((q.a === d.a && q.b === end.id) || (q.a === end.id && q.b === d.a));
        })[0];
        if (twin) {
            state.drawing = null;
            state.hover = null;
            drawPreview();
            api.say('Эти объекты уже соединены трубой ' + twin.id + ' — вторая труба между ними не нужна. Чтобы изменить трассу, потяните вершины или удалите старую.');
            return;
        }

        HydGraph.addPipe(h, d.a, end.id, state.net, inner.map(function (q) { return { x: q.x, y: q.y }; }), d.pa, end.port);
        state.drawing = null;
        state.hover = null;
        state.selected = { type: 'node', id: end.id };
        api.changed();
    }

    /*
        Каждый щелчок по пустому месту в режиме трубы ставит узел, соединяет его с
        предыдущим трубой и продолжает трассу от него — в любую сторону. Закончить:
        щелчок по порту или трубе (труба подключается), по текущему узлу, Esc или
        правая кнопка (узел остаётся тупиком).
    */
    function extendChain(d, w) {
        var h = hyd();
        var from = lastPoint(d);
        var pt = constrain(from, snap(w), lastDir(d));

        if (pt.x === from.x && pt.y === from.y) return;

        var tee = HydModel.newNode(h, 'tee', pt.x, pt.y, state.net);
        h.canvas.nodes.push(tee);
        HydGraph.addPipe(h, d.a, tee.id, state.net, [], d.pa, 'c');
        state.drawing = { a: tee.id, pa: 'c', pts: [], tee: false };
        state.hover = null;
        api.changed();
    }

    function pipeClick(w) {
        var h = hyd();
        var net = state.net;
        var d = state.drawing;
        var t = target(w);

        if (t.kind === 'full') { api.say(busyMessage(t.node)); return; }

        if (!d) {
            var a;

            if (t.kind === 'port') {
                if (t.node.sheet !== 'both' && t.node.sheet !== net) return;
                a = { id: t.node.id, port: t.port.id, tee: false };
            } else if (t.kind === 'pipe') {
                var tee = HydModel.newNode(h, 'tee', t.pt.x, t.pt.y, net);
                h.canvas.nodes.push(tee);
                HydGraph.splitPipe(h, t.pipe, t.hit, tee);
                a = { id: tee.id, port: 'c', tee: true };
            } else {
                // пустое место: здесь встанет первый узел трассы
                var nt = HydModel.newNode(h, 'tee', t.pt.x, t.pt.y, net);
                h.canvas.nodes.push(nt);
                a = { id: nt.id, port: 'c', tee: true };
            }

            state.drawing = { a: a.id, pa: a.port, pts: [], tee: a.tee };
            state.hover = null;
            if (a.tee) api.changed();
            else drawPreview();
            return;
        }

        // щелчок по текущему узлу — закончить трассу
        if (t.kind === 'port' && t.node.id === d.a && t.port.id === d.pa) {
            state.drawing = null;
            state.hover = null;
            drawPreview();
            return;
        }

        if (t.kind === 'free') { extendChain(d, w); return; }
        if (t.kind === 'port' && t.node.sheet !== 'both' && t.node.sheet !== net) return;

        finish(d, t);
    }

    return {
        init: init,
        render: render,
        fit: fit,
        toolbar: toolbar,
        TOOLS: TOOLS,
        cancelDrawing: cancelDrawing,
        remove: remove,
        rotate: rotate,
        applyView: applyView,
        snapshot: snapshot
    };
})();
