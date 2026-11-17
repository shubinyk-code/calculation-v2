/*
    Расчётные точки диктующего пути.

    Путь воды от ввода до диктующего прибора разбивается на участки по порядку, на
    границах участков ставятся расчётные точки 1, 2, 3 … На схеме это нумерованные
    маркеры, в таблице напоров — строки «точка k → точка k+1» с расходом, трубой,
    потерями и напором в начале и в конце. По этой таблице видно, как собран
    потребный напор:

        Hтр = Hgeom + ΣHl,tot + Hпр,   Hp = Hтр − Hгар.

    Стояк на пути (звенья по этажам, один диаметр) сворачивается в один участок.
    Счётчик, насосная и ИТП — отдельные участки нулевой длины: до них и после них
    своя точка, чтобы напор «до» и «после» оборудования был виден на схеме.
*/

var HydRoute = (function () {
    'use strict';

    /* Положение конца трубы у узла nodeId — в координатах листа трубы. */
    function endAt(hyd, pipe, nodeId) {
        var pts = HydGraph.ptsOf(hyd, pipe);
        var p = pipe.a === nodeId ? pts[0] : pts[pts.length - 1];
        return { x: p.x, y: p.y };
    }

    function typeOf(s) {
        if (s.kind === 'input') return 'input';
        if (s.kind === 'pipe') return 'pipe';
        if (s.kind === 'riser') return 'riser';
        if (s.kind === 'fbranch') return 'fb';
        if (s.kind === 'outlet') return 'outlet';
        if (s.kind === 'itpdev') return 'itp';
        if (s.dev === 'meter') return 'meter';
        if (s.dev === 'pump') return 'pump';
        return 'pipe';
    }

    /*
        Построение. dict — { leaf, part } системы; root — узел ввода.
        Возвращает { sections:[…], points:[{ no, net, x, y, text, dyn, stat, z }], pipes:{ id: true } }.
    */
    function build(hyd, net, dict, root) {
        var survey = hyd.survey;
        var byId = net.byId;
        var path = dict.part.path;
        var fp = survey.floorPx;
        var secs = [];

        path.forEach(function (s) {
            var last = secs[secs.length - 1];
            if (s.kind === 'riser' && last && last.type === 'riser' && last.chain === s.chain) last.segs.push(s);
            else secs.push({ type: typeOf(s), chain: s.chain || null, segs: [s] });
        });

        var points = [];
        var pipes = {};
        var prevEnd = null;       // положение конца предыдущего участка и его лист
        var prevNet = 'c';

        secs.forEach(function (sec, i) {
            var first = sec.segs[0];
            var last = sec.segs[sec.segs.length - 1];
            var sheet = first.net;
            var start;
            var end;

            if (sec.type === 'input') {
                start = { x: root.x - 16, y: root.y };
                end = { x: root.x + 16, y: root.y };
                sheet = 'c';
            } else if (sec.type === 'pipe') {
                var pipe = hyd.canvas.pipes.filter(function (p) { return p.id === first.meta.pipe; })[0];
                var other = pipe.a === first.node ? pipe.b : pipe.a;
                start = endAt(hyd, pipe, other);
                end = endAt(hyd, pipe, first.node);
                pipes[first.net + '|' + pipe.id] = true;
            } else if (sec.type === 'riser') {
                var rn = HydModel.nodeById(hyd, first.meta.riser);
                var rp = HydModel.pos(rn, first.net);
                start = { x: rp.x, y: rp.y };
                end = { x: rp.x, y: rp.y - last.meta.floor * fp + fp / 2 };
            } else if (sec.type === 'fb') {
                start = prevEnd;
                end = { x: prevEnd.x + 14, y: prevEnd.y };
            } else if (sec.type === 'outlet') {
                start = prevEnd;
                end = { x: prevEnd.x + 64, y: prevEnd.y };
            } else {
                // счётчик, насос, ИТП: точка «до» — там, где кончилась труба
                start = prevEnd || { x: root.x, y: root.y };
                end = start;
                sheet = prevNet;
            }

            var hFr = 0;
            var L = 0;
            sec.segs.forEach(function (s) {
                hFr += s.res.size ? s.res.size.h : 0;
                L += s.L;
            });

            var isLine = sec.type !== 'meter' && sec.type !== 'pump' && sec.type !== 'itp';
            var local = isLine ? hFr * survey.kl : 0;
            var equip = 0;
            var gain = 0;
            var what = '';

            if (sec.type === 'input') { equip = root.hv; what = 'потери во вводе Hв'; }
            if (sec.type === 'meter') { equip = first.res.meter ? first.res.meter.h : 0; what = first.res.meter ? first.res.meter.mark + ' (с фильтром)' : 'счётчик'; }
            if (sec.type === 'pump') {
                equip = survey.hNs;
                gain = first.res.hd ? first.res.hd.outDyn - first.res.hd.inDyn + survey.hNs : 0;
                what = 'потери в обвязке Hнс; напор насоса Hp';
            }
            if (sec.type === 'itp') { equip = survey.hItp; what = 'потери в ИТП Hитп'; }
            if (sec.type === 'outlet' && first.res.meter) { equip = first.res.meter.h; what = first.res.meter.mark + ' (кв. счётчик с фильтром)'; }

            var reg = 0;
            if (sec.type === 'outlet' && dict.leaf.reg) { reg = survey.hReg; what += (what ? '; ' : '') + 'регулятор давления'; }

            var name;
            if (sec.type === 'input') name = 'Ввод ' + root.name;
            else if (sec.type === 'riser') name = first.name + ' (этажи 1–' + last.meta.floor + ')';
            else if (sec.type === 'fb') name = 'Этажная ветка к ' + first.name;
            else if (sec.type === 'outlet') name = 'Квартирная разводка до прибора (' + first.name + ')';
            else name = first.name;

            var sec2 = {
                no: i + 1, type: sec.type, name: name, net: sheet,
                q: first.res.q, size: first.res.size, L: L, hFr: hFr, local: local, equip: equip + reg, gain: gain, what: what,
                dynStart: first.res.hd.inDyn, dynEnd: last.res.hd.outDyn - reg,
                statStart: first.res.hd.inStat, statEnd: last.res.hd.outStat,
                zStart: first.parent ? byId[first.parent].res.elevEnd : root.elev, zEnd: last.res.elevEnd, segs: sec.segs
            };

            points.push({
                no: i + 1, net: sheet, x: start.x, y: start.y, text: sec2.name,
                dyn: sec2.dynStart, stat: sec2.statStart,
                z: first.parent ? byId[first.parent].res.elevEnd : root.elev
            });

            sec2.dz = sec2.zEnd - sec2.zStart;
            sec.out = sec2;
            prevEnd = end;
            prevNet = sec.type === 'meter' || sec.type === 'pump' || sec.type === 'itp' ? sheet : last.net;
            if (sec.type === 'itp') prevEnd = start;
        });

        var lastSec = secs[secs.length - 1].out;
        var lastSeg = lastSec.segs[lastSec.segs.length - 1];

        points.push({
            no: secs.length + 1, net: lastSeg.net, x: prevEnd.x + 4, y: prevEnd.y,
            text: 'Диктующий прибор: ' + dict.leaf.label, dyn: lastSec.dynEnd, stat: lastSec.statEnd, z: lastSec.zEnd
        });

        return { sections: secs.map(function (s) { return s.out; }), points: points, pipes: pipes };
    }

    return { build: build };
})();
