'use strict';

/*
    Холст схемы. Один класс на оба вида — трёхмерный и плоский принципиальный.

    Рисование, попадание мышью, подписи и раскраска у них одинаковы; различаются
    только две вещи: где лежит узел на экране и как определяется точка по щелчку.
    Разводить это по двум файлам значило бы держать две копии одного кода
    и чинить каждую ошибку дважды.

    Схема векторная: по линии надо попадать мышью, при увеличении она должна
    оставаться чёткой, а толщина линии несёт диаметр.
*/

function SchemeView(canvas, mode, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;                       // '3d' | 'flat'
    this.app = app;

    this.projection = new Projection();     // используется только в '3d'

    /* Плоская схема: своя простая двумерная камера. */
    this.flat = { scale: 14.0, panX: 0.0, panY: 0.0 };

    this.tool = 'select';
    this.hover = null;                      // {kind, index}
    this.draft = null;                      // черновик рисуемой трубы
    this.lockedAxis = -1;

    /* Плоскость построения в трёхмерном виде. */
    this.planeOffset = 0.0;
    this.planeLocked = false;

    this.gridStep = 0.5;                    // м
    this.showGrid = true;

    this.drag = null;
    this.fitted = false;

    this._install();
}

// --- положение узла на экране ------------------------------------------------

SchemeView.prototype.screenOf = function (nodeIndex) {
    var node = this.app.network.nodes[nodeIndex];
    if (!node) return null;

    if (this.mode === '3d')
        return this.projection.project(node.point3d);

    return {
        x: node.pointFlat.x * this.flat.scale + this.flat.panX + this.width() / 2.0,
        y: -node.pointFlat.y * this.flat.scale + this.flat.panY + this.height() / 2.0
    };
};

SchemeView.prototype.screenOfPoint = function (point) {
    if (this.mode === '3d')
        return this.projection.project(point);

    return {
        x: point.x * this.flat.scale + this.flat.panX + this.width() / 2.0,
        y: -point.y * this.flat.scale + this.flat.panY + this.height() / 2.0
    };
};

/** Точка модели по точке экрана — для черчения и перетаскивания. */
SchemeView.prototype.modelAt = function (sx, sy) {
    if (this.mode === 'flat') {
        return {
            x: (sx - this.flat.panX - this.width() / 2.0) / this.flat.scale,
            y: -(sy - this.flat.panY - this.height() / 2.0) / this.flat.scale
        };
    }

    var normal = this.planeNormal();
    var base = new Pt3(normal.x * this.planeOffset, normal.y * this.planeOffset,
                       normal.z * this.planeOffset);

    return this.projection.toPlane(sx, sy, base, normal);
};

SchemeView.prototype.planeNormal = function () {
    if (this.planeLocked) return new Pt3(0, 0, 1);
    return this.projection.bestPlaneNormal();
};

SchemeView.prototype.width = function () { return this.canvas.clientWidth || 800; };
SchemeView.prototype.height = function () { return this.canvas.clientHeight || 600; };

// --- виды --------------------------------------------------------------------

SchemeView.prototype.setPreset = function (preset) {
    if (this.mode !== '3d') return;
    this.projection.azimuth = preset.azimuth;
    this.projection.elevation = preset.elevation;
    this.draw();
};

SchemeView.prototype.fit = function () {
    var network = this.app.network;
    var i;

    if (this.mode === '3d') {
        var points = [];
        for (i = 0; i < network.nodes.length; i++)
            points.push(network.nodes[i].point3d);

        // Ломаные тоже входят в габарит: участок с отводом выходит за прямую
        // между своими концами, и без этого его угол оказался бы за краем окна.
        for (i = 0; i < network.segments.length; i++) {
            var way = network.segments[i].polyline;
            for (var k = 0; k < way.length; k++)
                points.push(way[k]);
        }

        this.projection.fit(points, this.width(), this.height());
        this.fitted = true;
        this.draw();
        return;
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var any = false;

    for (i = 0; i < network.nodes.length; i++) {
        var p = network.nodes[i].pointFlat;
        if (!network.nodes[i].flatPlaced) continue;
        any = true;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    if (!any) {
        this.flat = { scale: 14.0, panX: 0.0, panY: 0.0 };
        this.draw();
        return;
    }

    var spanX = Math.max(maxX - minX, 1e-6);
    var spanY = Math.max(maxY - minY, 1e-6);
    var margin = 60.0;

    this.flat.scale = Math.max(0.5, Math.min(
        (this.width() - margin * 2) / spanX,
        (this.height() - margin * 2) / spanY));

    this.flat.panX = -(minX + maxX) * 0.5 * this.flat.scale;
    this.flat.panY = (minY + maxY) * 0.5 * this.flat.scale;

    this.fitted = true;
    this.draw();
};

// --- отрисовка ---------------------------------------------------------------

SchemeView.prototype.draw = function () {
    var ctx = this.ctx;
    var dpr = window.devicePixelRatio || 1;
    var w = this.width();
    var h = this.height();

    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
    }

    this.projection.width = w;
    this.projection.height = h;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = Theme.background;
    ctx.fillRect(0, 0, w, h);

    if (this.showGrid) this.drawGrid();

    var network = this.app.network;
    var order = this.drawOrder();
    var i;

    // Сначала все линии, потом узлы, потом подписи: подписи должны лежать
    // поверх всего, иначе на плотной схеме их не прочесть.
    for (i = 0; i < order.length; i++)
        this.drawSegment(network.segments[order[i]]);

    for (i = 0; i < network.nodes.length; i++)
        this.drawNode(i);

    for (i = 0; i < order.length; i++)
        this.drawSegmentLabels(network.segments[order[i]]);

    if (LabelOptions.nodeNumbers || LabelOptions.temperatures) {
        for (i = 0; i < network.nodes.length; i++)
            this.drawNodeLabel(i);
    }

    this.drawDraft();
    this.drawOverlay();
};

/** Порядок отрисовки: дальние линии первыми, чтобы ближние легли поверх. */
SchemeView.prototype.drawOrder = function () {
    var network = this.app.network;
    var order = [];
    var i;

    for (i = 0; i < network.segments.length; i++) {
        if (!this.app.accepts(network.segments[i])) continue;
        if (this.mode === 'flat' && !network.segments[i].isCirculating) continue;
        order.push(i);
    }

    if (this.mode !== '3d') return order;

    var self = this;
    var depth = {};
    for (i = 0; i < order.length; i++) {
        var s = network.segments[order[i]];
        depth[order[i]] = 0.5 * (self.projection.depth(network.nodes[s.nodeA].point3d)
            + self.projection.depth(network.nodes[s.nodeB].point3d));
    }

    order.sort(function (a, b) { return depth[b] - depth[a]; });
    return order;
};

SchemeView.prototype.drawGrid = function () {
    var ctx = this.ctx;
    var w = this.width();
    var h = this.height();

    if (this.mode === 'flat') {
        var step = this.flat.scale * 2.0;
        if (step < 8) return;

        ctx.strokeStyle = Theme.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();

        var ox = (this.flat.panX + w / 2.0) % step;
        var oy = (this.flat.panY + h / 2.0) % step;

        for (var x = ox; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (var y = oy; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
        return;
    }

    // Трёхмерный вид: сетка лежит на плоскости построения, а не на экране —
    // иначе она врёт о том, куда встанет точка.
    var normal = this.planeNormal();
    var stepPixels = this.gridStep * this.projection.scale;
    if (stepPixels < 6) return;

    var axes = normal.z > 0.5 ? [new Pt3(1, 0, 0), new Pt3(0, 1, 0)]
        : (normal.x > 0.5 ? [new Pt3(0, 1, 0), new Pt3(0, 0, 1)]
                          : [new Pt3(1, 0, 0), new Pt3(0, 0, 1)]);

    var centre = this.modelAt(w / 2, h / 2);
    if (!centre) return;

    var lines = Math.min(80, Math.ceil(Math.max(w, h) / stepPixels) + 2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.strokeStyle = Theme.grid;

    for (var a = 0; a < 2; a++) {
        var along = axes[a];
        var across = axes[1 - a];

        for (var k = -lines; k <= lines; k++) {
            var base = new Pt3(
                snap(centre.x, this.gridStep) + across.x * k * this.gridStep,
                snap(centre.y, this.gridStep) + across.y * k * this.gridStep,
                snap(centre.z, this.gridStep) + across.z * k * this.gridStep);

            var span = lines * this.gridStep;
            var p1 = this.projection.project(new Pt3(
                base.x - along.x * span, base.y - along.y * span, base.z - along.z * span));
            var p2 = this.projection.project(new Pt3(
                base.x + along.x * span, base.y + along.y * span, base.z + along.z * span));

            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
        }
    }
    ctx.stroke();
};

/**
 * Ход участка на экране.
 *
 * Участок — это свёрнутая цепочка «труба — отвод — труба» между двумя узлами,
 * и идёт она не по прямой. Прямая от начала к концу соврала бы: угол трубы
 * превратился бы в диагональ, которой в модели нет. Поэтому на трёхмерной схеме
 * рисуется настоящая ломаная, если она известна.
 *
 * На плоской принципиальной схеме ломаная не нужна и вредна: там раскладка
 * по смыслу, а не по месту, и настоящий ход трубы к ней отношения не имеет.
 */
SchemeView.prototype.wayOf = function (segment) {
    var a = this.screenOf(segment.nodeA);
    var b = this.screenOf(segment.nodeB);
    if (!a || !b) return null;

    if (this.mode !== '3d' || !segment.polyline || segment.polyline.length < 3)
        return [a, b];

    var points = [];
    for (var i = 0; i < segment.polyline.length; i++)
        points.push(this.projection.project(segment.polyline[i]));

    // Ломаная приходит из модели своим порядком: она может начинаться у любого
    // из двух узлов. Разворачиваем так, чтобы начало совпало с узлом A —
    // иначе стрелка направления показала бы не туда.
    if (distance(points[0], a) > distance(points[points.length - 1], a))
        points.reverse();

    return points;
};

SchemeView.prototype.drawSegment = function (segment) {
    var way = this.wayOf(segment);
    if (!way) return;

    var a = way[0];
    var b = way[way.length - 1];

    var ctx = this.ctx;
    var selected = this.app.isSelected('segment', segment.index);
    var hovered = this.hover && this.hover.kind === 'segment' && this.hover.index === segment.index;
    var highlighted = this.app.isHighlighted(segment);

    ctx.lineCap = 'round';

    if (highlighted) {
        ctx.strokeStyle = Theme.highlight;
        ctx.lineWidth = segmentWidth(segment, true) + 4;
        ctx.globalAlpha = 0.5;
        trace(ctx, way);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = selected ? Theme.selection
        : segmentColour(segment, this.app.colourMode, this.app.network);
    ctx.lineWidth = segmentWidth(segment, selected || hovered);
    ctx.lineJoin = 'round';

    ctx.setLineDash(segment.isVirtualLink ? [7, 5] : []);
    trace(ctx, way);
    ctx.stroke();
    ctx.setLineDash([]);

    // Стрелка и клапан ставятся на середину настоящего хода трубы,
    // а не на середину прямой между концами: на участке с отводом это разные места.
    var middle = midOfWay(way);

    if (LabelOptions.arrows && segment.flowDirection !== 0)
        this.drawArrow(middle.before, middle.after, segment.flowDirection > 0);

    if (segment.valve)
        this.drawValve(middle.before, middle.after, segment);
};

SchemeView.prototype.drawArrow = function (a, b, forward) {
    var ctx = this.ctx;
    var from = forward ? a : b;
    var to = forward ? b : a;

    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 22) return;

    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var ux = dx / len, uy = dy / len;
    var size = 6;

    ctx.fillStyle = Theme.textDim;
    ctx.beginPath();
    ctx.moveTo(mx + ux * size, my + uy * size);
    ctx.lineTo(mx - ux * size * 0.6 - uy * size * 0.55, my - uy * size * 0.6 + ux * size * 0.55);
    ctx.lineTo(mx - ux * size * 0.6 + uy * size * 0.55, my - uy * size * 0.6 - ux * size * 0.55);
    ctx.closePath();
    ctx.fill();
};

SchemeView.prototype.drawValve = function (a, b, segment) {
    var ctx = this.ctx;
    var x = a.x + (b.x - a.x) * 0.72;
    var y = a.y + (b.y - a.y) * 0.72;
    var r = 6;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = segment.valve.inUse ? Theme.valve : '#FFFFFF';
    ctx.strokeStyle = Theme.valve;
    ctx.lineWidth = 1.8;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    if (segment.valve.inUse && segment.valve.position > 0) {
        this.label(x + 10, y - 10,
            ValveCatalog.formatPosition(segment.valve.model, segment.valve.position),
            Theme.valve, 'left');
    }
};

SchemeView.prototype.drawNode = function (index) {
    var p = this.screenOf(index);
    if (!p) return;

    var network = this.app.network;
    var node = network.nodes[index];
    var ctx = this.ctx;

    if (this.mode === 'flat' && !node.flatPlaced) return;
    if (node.segments.length === 0 && !network.isSource(index)) return;

    var selected = this.app.isSelected('node', index);
    var hovered = this.hover && this.hover.kind === 'node' && this.hover.index === index;

    if (network.isSource(index)) {
        // ИТП — квадрат: его надо отличать от обычного узла с одного взгляда.
        ctx.fillStyle = Theme.source;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(p.x - 7, p.y - 7, 14, 14);
        ctx.fill();
        ctx.stroke();

        // Выход и вход подписываются по-разному: пока они не собраны в пару,
        // кольца не замкнутся, и видеть, что именно помечено, важнее всего.
        var roles = rolesAtNode(network, index);
        var caption = 'ИТП';
        if (roles.supply && !roles.circulation) caption = 'ИТП · выход Т3';
        else if (roles.circulation && !roles.supply) caption = 'ИТП · вход Т4';

        this.label(p.x, p.y - 14, caption, Theme.source, 'center');
        return;
    }

    // Обычный проходной узел не рисуется: точек стало бы больше, чем труб.
    if (node.segments.length === 2 && !selected && !hovered)
        return;

    var cold = node.temperature > 0
        && node.temperature < this.app.settings.requiredTemperature - 0.05;

    /*
        Незаконченный конец трубы выделяется отдельно. Именно он — самая частая
        причина «кольца не найдено»: конец Т3 и конец Т4 нарисованы в сантиметре
        друг от друга, на глаз стояк выглядит замкнутым, а перемычки нет.
        Обычной точкой такое место не отличить от прохода трубы.
    */
    var openEnd = node.segments.length === 1;

    ctx.fillStyle = selected ? Theme.selection : (cold ? Theme.cold : '#FFFFFF');
    ctx.strokeStyle = openEnd ? Theme.noCirculation : (cold ? Theme.cold : Theme.textDim);
    ctx.lineWidth = openEnd ? 2.2 : 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hovered || selected ? 5.5 : (openEnd ? 5 : 4), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
};

SchemeView.prototype.drawNodeLabel = function (index) {
    var network = this.app.network;
    var node = network.nodes[index];
    if (node.number === 0) return;
    if (this.mode === 'flat' && !node.flatPlaced) return;

    var p = this.screenOf(index);
    if (!p) return;

    var parts = [];
    if (LabelOptions.nodeNumbers) parts.push(String(node.number));
    if (LabelOptions.temperatures && node.temperature > 0)
        parts.push(Fmt.fixed(node.temperature, 1) + '°');

    if (parts.length === 0) return;

    var cold = node.temperature > 0
        && node.temperature < this.app.settings.requiredTemperature - 0.05;

    this.label(p.x + 9, p.y - 8, parts.join('  '), cold ? Theme.cold : Theme.text, 'left');
};

SchemeView.prototype.drawSegmentLabels = function (segment) {
    if (!LabelOptions.anyOn()) return;

    // Подпись ставится на самом длинном звене трубы, а не посреди прямой
    // между её концами: у участка с отводом это разные места, и подпись
    // оказалась бы в стороне от того, что подписывает.
    var way = this.wayOf(segment);
    if (!way) return;

    var leg = midOfWay(way);
    var a = leg.before;
    var b = leg.after;

    var len = distance(a, b);
    if (len < 26) return;

    var lines = [];

    if (LabelOptions.segmentNumbers && segment.number > 0)
        lines.push('№' + segment.number);

    var head = [];
    if (LabelOptions.diameters && segment.nominalDiameterMm > 0)
        head.push('Ду' + Fmt.fixed(segment.nominalDiameterMm, 0));
    if (LabelOptions.lengths && segment.length > 0)
        head.push(Fmt.length(segment.length) + ' м');
    if (head.length > 0) lines.push(head.join('  '));

    var flow = [];
    if (LabelOptions.flows && segment.flow > 0)
        flow.push(Fmt.flowLs(segment.flow) + ' л/с');
    if (LabelOptions.velocities && segment.velocity > 0)
        flow.push(Fmt.velocity(segment.velocity) + ' м/с');
    if (flow.length > 0) lines.push(flow.join('  '));

    if (LabelOptions.temperatures && segment.isCirculating && segment.temperatureOut > 0)
        lines.push(Fmt.fixed(segment.temperatureIn, 1) + '→' + Fmt.fixed(segment.temperatureOut, 1) + ' °C');

    if (LabelOptions.ringNumbers && segment.isRingClosure && segment.ringIndices.length > 0) {
        var numbers = [];
        for (var i = 0; i < segment.ringIndices.length; i++)
            numbers.push(this.app.network.rings[segment.ringIndices[i]].number);
        lines.push('кольцо ' + numbers.join(', '));
    }

    if (lines.length === 0) return;

    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;

    for (var k = 0; k < lines.length; k++)
        this.label(mx + 8, my + 4 + k * 13, lines[k], Theme.text, 'left');
};

/** Подпись с подложкой: без неё текст на линии не читается. */
SchemeView.prototype.label = function (x, y, text, colour, align) {
    var ctx = this.ctx;
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';

    ctx.lineWidth = 3.5;
    ctx.strokeStyle = Theme.labelHalo;
    ctx.strokeText(text, x, y);

    ctx.fillStyle = colour || Theme.text;
    ctx.fillText(text, x, y);
};

SchemeView.prototype.drawDraft = function () {
    if (!this.draft || !this.draft.current) return;

    var ctx = this.ctx;
    var a = this.screenOfPoint(this.draft.from);
    var b = this.screenOfPoint(this.draft.current);

    ctx.strokeStyle = this.draft.role === PipeRole.Return ? Theme.circulation
        : (this.draft.kind === 'link' ? Theme.ringClosure : Theme.supply);
    ctx.lineWidth = 2.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    var length = this.draft.length();
    this.label((a.x + b.x) / 2 + 10, (a.y + b.y) / 2 - 10,
        Fmt.length(length) + ' м' + (this.draft.axisName ? '  ' + this.draft.axisName : ''),
        Theme.selection, 'left');
};

/** Подсказка в углу: какой вид, какая плоскость, какой инструмент. */
SchemeView.prototype.drawOverlay = function () {
    var ctx = this.ctx;
    var lines = [];

    if (this.mode === '3d') {
        var normal = this.planeNormal();
        var plane = normal.z > 0.5 ? 'Z = ' + Fmt.length(this.planeOffset)
            : (normal.x > 0.5 ? 'X = ' + Fmt.length(this.planeOffset)
                              : 'Y = ' + Fmt.length(this.planeOffset));
        lines.push('плоскость построения: ' + plane);
        lines.push('шаг сетки: ' + Fmt.num(this.gridStep) + ' м');
    } else {
        lines.push('принципиальная схема, не масштабная');
        lines.push('длина участка задаётся числом');
    }

    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = Theme.textDim;

    for (var i = 0; i < lines.length; i++)
        ctx.fillText(lines[i], 10, this.height() - 34 + i * 15);
};

// --- попадание мышью ---------------------------------------------------------

SchemeView.prototype.pick = function (sx, sy) {
    var network = this.app.network;
    var i, p;

    // Узлы имеют приоритет: попасть в точку труднее, чем в линию.
    var bestNode = -1;
    var bestNodeDistance = 10;

    for (i = 0; i < network.nodes.length; i++) {
        if (this.mode === 'flat' && !network.nodes[i].flatPlaced) continue;
        if (network.nodes[i].segments.length === 0 && !network.isSource(i)) continue;

        p = this.screenOf(i);
        if (!p) continue;

        var d = Math.sqrt((p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy));
        if (d < bestNodeDistance) { bestNodeDistance = d; bestNode = i; }
    }

    if (bestNode >= 0) return { kind: 'node', index: bestNode };

    var bestSegment = -1;
    var bestSegmentDistance = 8;

    for (i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];
        if (!this.app.accepts(segment)) continue;
        if (this.mode === 'flat' && !segment.isCirculating) continue;

        // Мерить надо по настоящему ходу трубы, а не по прямой между концами:
        // иначе у участка с отводом мышь ловила бы пустое место посреди схемы
        // и не ловила бы саму трубу.
        var way = this.wayOf(segment);
        if (!way) continue;

        var nearest = Infinity;
        for (var k = 1; k < way.length; k++) {
            var leg = Projection.distanceToSegment(sx, sy,
                way[k - 1].x, way[k - 1].y, way[k].x, way[k].y);
            if (leg < nearest) nearest = leg;
        }

        if (nearest < bestSegmentDistance) { bestSegmentDistance = nearest; bestSegment = i; }
    }

    if (bestSegment >= 0) return { kind: 'segment', index: bestSegment };
    return null;
};

/** Узел под курсором — привязка при черчении. */
SchemeView.prototype.snapNode = function (sx, sy) {
    var network = this.app.network;
    var best = -1;
    var bestDistance = 13;

    for (var i = 0; i < network.nodes.length; i++) {
        if (this.mode === 'flat' && !network.nodes[i].flatPlaced) continue;

        var p = this.screenOf(i);
        if (!p) continue;

        var d = Math.sqrt((p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy));
        if (d < bestDistance) { bestDistance = d; best = i; }
    }

    return best;
};

/**
 * Привязка к самой трубе, а не только к её концам.
 *
 * Подводку тянут до магистрали и упираются в неё посередине. Узла там нет,
 * и без привязки линия просто заканчивается рядом: на глаз она в магистраль
 * упёрлась, а в графе это два несвязанных куска, и кольцо через них
 * не замыкается. Поэтому конец приклеивается к оси трубы, а при постановке
 * магистраль разрезается — на её месте появляется узел.
 *
 * candidate — точка, уже посчитанная привязкой к осям. Если она задана,
 * на трубе берётся ближайшая к ней точка: линия остаётся на своей оси,
 * а конец садится ровно на пересечение с магистралью.
 */
SchemeView.prototype.snapSegment = function (sx, sy, candidate, skipNode) {
    if (this.mode !== '3d') return null;

    var network = this.app.network;
    var best = null;
    var bestDistance = 12;

    for (var i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];

        if (!this.app.accepts(segment)) continue;
        if (segment.isVirtualLink) continue;                 // перемычки не режем
        if (skipNode !== undefined
            && (segment.nodeA === skipNode || segment.nodeB === skipNode)) continue;

        var way = this.wayOf(segment);
        if (!way) continue;

        var nearest = Infinity;
        for (var k = 1; k < way.length; k++) {
            var leg = Projection.distanceToSegment(sx, sy,
                way[k - 1].x, way[k - 1].y, way[k].x, way[k].y);
            if (leg < nearest) nearest = leg;
        }

        if (nearest >= bestDistance) continue;

        // Точка на оси трубы. Без candidate — та, что под курсором;
        // с candidate — ближайшая к уже привязанной по оси точке.
        var reference = candidate || this.modelAt(sx, sy);
        if (!reference) continue;

        var found = NetworkEdit.pointOnSegment(network, segment, reference);
        if (found.fraction <= 1e-4 || found.fraction >= 1.0 - 1e-4) continue;

        // Точка на трубе не должна оказаться далеко от того места, куда
        // человек ведёт линию: иначе конец прыгнет через полсхемы.
        var flat = this.projection.project(found.point);
        var jump = Math.sqrt((flat.x - sx) * (flat.x - sx) + (flat.y - sy) * (flat.y - sy));
        if (jump > 14) continue;

        bestDistance = nearest;
        best = { segment: i, point: found.point };
    }

    return best;
};

// --- черчение ----------------------------------------------------------------

/**
 * Точка второго щелчка. В трёхмерном виде она привязана к осям X, Y и Z:
 * по плоскому экрану в трёх измерениях иначе не попасть. Alt снимает привязку
 * и ставит точку свободно на плоскости построения.
 */
SchemeView.prototype.draftPoint = function (sx, sy, event) {
    var snapped = this.snapNode(sx, sy);
    if (snapped >= 0) {
        return {
            node: snapped,
            point: this.mode === '3d'
                ? this.app.network.nodes[snapped].point3d.clone()
                : { x: this.app.network.nodes[snapped].pointFlat.x,
                    y: this.app.network.nodes[snapped].pointFlat.y },
            axisName: 'узел'
        };
    }

    var raw = this.modelAt(sx, sy);
    if (!raw) return null;

    if (this.mode === 'flat') {
        return {
            node: -1,
            point: { x: snap(raw.x, 1.0), y: snap(raw.y, 1.0) },
            axisName: ''
        };
    }

    if (!this.draft || (event && event.altKey)) {
        // Первая точка тоже может лечь на магистраль: ветку часто начинают
        // прямо от неё, а не тянут к ней.
        var onPipe = this.snapSegment(sx, sy, null);
        if (onPipe) {
            return {
                node: -1, onSegment: onPipe.segment, point: onPipe.point,
                axisName: 'на трубе'
            };
        }

        return {
            node: -1,
            point: new Pt3(snap(raw.x, this.gridStep), snap(raw.y, this.gridStep),
                           snap(raw.z, this.gridStep)),
            axisName: ''
        };
    }

    // Из трёх осей берётся та, чья линия ближе к курсору на экране.
    var axes = [
        { dir: new Pt3(1, 0, 0), name: 'X' },
        { dir: new Pt3(0, 1, 0), name: 'Y' },
        { dir: new Pt3(0, 0, 1), name: 'Z' }
    ];

    var start = this.draft.from;
    var best = null;
    var bestDistance = Infinity;

    for (var i = 0; i < axes.length; i++) {
        if (this.lockedAxis >= 0 && i !== this.lockedAxis) continue;

        var candidate = this.projection.pointOnAxis(start, axes[i].dir, sx, sy);
        if (!candidate) continue;

        var flat = this.projection.project(candidate);
        var d = Math.sqrt((flat.x - sx) * (flat.x - sx) + (flat.y - sy) * (flat.y - sy));

        if (d < bestDistance) {
            bestDistance = d;
            best = { point: candidate, name: axes[i].name, axis: i };
        }
    }

    if (!best) return null;

    var step = this.gridStep;
    var along = new Pt3(
        best.axis === 0 ? snap(best.point.x - start.x, step) + start.x : start.x,
        best.axis === 1 ? snap(best.point.y - start.y, step) + start.y : start.y,
        best.axis === 2 ? snap(best.point.z - start.z, step) + start.z : start.z);

    /*
        Линия дотянулась до трубы — конец садится ровно на её ось, а не рядом.
        Ось черчения при этом сохраняется: на трубе берётся точка, ближайшая
        к уже привязанной. Именно так ветка, идущая перпендикулярно магистрали,
        попадает в неё точно, а не «почти».
    */
    var reached = this.snapSegment(sx, sy, along, this.draft.fromNode);
    if (reached) {
        return {
            node: -1, onSegment: reached.segment, point: reached.point,
            axisName: 'узел на трубе', axis: best.axis
        };
    }

    return { node: -1, point: along, axisName: 'ось ' + best.name, axis: best.axis };
};

SchemeView.prototype.beginDraft = function (kind, role, startPoint, startNode, startSegment) {
    var self = this;

    this.draft = {
        kind: kind,
        role: role,
        from: startPoint,
        fromNode: startNode,

        /* Участок, на который легла первая точка: его разрежут при постановке. */
        fromSegment: startSegment === undefined ? -1 : startSegment,
        current: null,
        currentNode: -1,
        axisName: '',
        length: function () {
            if (!self.draft.current) return 0;
            if (self.mode === 'flat') return self.app.template.defaultLength;
            return self.draft.from.distanceTo(self.draft.current);
        }
    };
};

SchemeView.prototype.cancelDraft = function () {
    this.draft = null;
    this.lockedAxis = -1;
    this.draw();
};

// --- события -----------------------------------------------------------------

SchemeView.prototype._install = function () {
    var self = this;
    var canvas = this.canvas;

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('mousedown', function (e) {
        canvas.focus();
        var p = self.local(e);

        if (e.button !== 0) {
            // Правая и средняя — панорама, и черчение при этом обрывается.
            if (self.draft) self.cancelDraft();
            self.drag = { kind: 'pan', x: p.x, y: p.y };
            return;
        }

        if (self.tool === 'select') {
            var hit = self.pick(p.x, p.y);
            self.app.select(hit);

            if (hit && hit.kind === 'node')
                self.drag = { kind: 'node', index: hit.index, x: p.x, y: p.y };
            else if (!hit)
                self.drag = { kind: 'orbit', x: p.x, y: p.y };

            self.draw();
            return;
        }

        self.handleToolClick(p, e);
    });

    canvas.addEventListener('mousemove', function (e) {
        var p = self.local(e);

        if (self.drag) {
            var dx = p.x - self.drag.x;
            var dy = p.y - self.drag.y;
            self.drag.x = p.x;
            self.drag.y = p.y;

            if (self.drag.kind === 'pan') {
                if (self.mode === '3d') { self.projection.panX += dx; self.projection.panY += dy; }
                else { self.flat.panX += dx; self.flat.panY += dy; }
            } else if (self.drag.kind === 'orbit' && self.mode === '3d') {
                self.projection.rotate(-dx * 0.008, dy * 0.008);
            } else if (self.drag.kind === 'orbit') {
                self.flat.panX += dx; self.flat.panY += dy;
            } else if (self.drag.kind === 'node') {
                self.moveNode(self.drag.index, p, e);
            }

            self.draw();
            return;
        }

        if (self.draft) {
            var target = self.draftPoint(p.x, p.y, e);
            if (target) {
                self.draft.current = target.point;
                self.draft.currentNode = target.node;
                self.draft.axisName = target.axisName;
            }
            self.draw();
            return;
        }

        var hit = self.pick(p.x, p.y);
        var changed = (hit ? hit.kind + hit.index : '') !==
            (self.hover ? self.hover.kind + self.hover.index : '');

        self.hover = hit;
        canvas.style.cursor = self.tool === 'select'
            ? (hit ? 'pointer' : 'default')
            : 'crosshair';

        if (changed) self.draw();
    });

    window.addEventListener('mouseup', function () {
        if (!self.drag) return;

        var kind = self.drag.kind;
        self.drag = null;

        // Пересчёт нужен только после переноса узла. Панорама и орбита сеть
        // не трогают — гонять по ним весь расчёт значит тормозить вращение
        // на ровном месте и плодить пустые шаги отмены.
        if (kind === 'node')
            self.app.afterEdit('перенос узла');
    });

    canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        var p = self.local(e);
        var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;

        if (self.mode === '3d') {
            self.projection.zoom(factor, p.x, p.y);
        } else {
            var before = self.flat.scale;
            self.flat.scale = Math.max(0.5, Math.min(400, self.flat.scale * factor));
            var ratio = self.flat.scale / before;
            var cx = self.flat.panX + self.width() / 2;
            var cy = self.flat.panY + self.height() / 2;
            self.flat.panX += (p.x - cx) * (1 - ratio);
            self.flat.panY += (p.y - cy) * (1 - ratio);
        }

        self.draw();
    }, { passive: false });

    canvas.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { self.cancelDraft(); return; }

        if (e.key === 'Shift' && self.draft && self.lockedAxis < 0) {
            // Shift фиксирует ось, по которой сейчас идёт линия.
            var target = self.draftPoint(self.lastX || 0, self.lastY || 0, e);
            if (target && target.axis !== undefined) self.lockedAxis = target.axis;
            return;
        }

        if (self.mode === '3d') {
            for (var i = 0; i < ViewPresets.length; i++) {
                if (e.key === ViewPresets[i].key) { self.setPreset(ViewPresets[i]); return; }
            }
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            self.app.deleteSelection();
        }
    });

    canvas.addEventListener('mousemove', function (e) {
        var p = self.local(e);
        self.lastX = p.x;
        self.lastY = p.y;
    });
};

SchemeView.prototype.local = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

SchemeView.prototype.moveNode = function (index, p, e) {
    var node = this.app.network.nodes[index];

    if (this.mode === 'flat') {
        var flat = this.modelAt(p.x, p.y);
        node.pointFlat.x = flat.x;
        node.pointFlat.y = flat.y;
        node.flatPlaced = true;
        return;
    }

    var point = this.modelAt(p.x, p.y);
    if (!point) return;

    // Длина участков НЕ меняется вслед за узлом: это отдельное поле, и правит
    // его человек. Иначе случайный сдвиг мышью молча переписал бы расчёт.
    node.point3d = new Pt3(snap(point.x, this.gridStep), snap(point.y, this.gridStep),
                           snap(point.z, this.gridStep));
};

SchemeView.prototype.handleToolClick = function (p, e) {
    var app = this.app;
    var network = app.network;

    if (this.tool === 'itp') {
        var node = this.snapNode(p.x, p.y);
        if (node >= 0) { NetworkEdit.toggleSource(network, node); app.afterEdit('пометку ИТП'); }
        return;
    }

    if (this.tool === 'valve') {
        var hit = this.pick(p.x, p.y);
        if (hit && hit.kind === 'segment') { NetworkEdit.toggleValve(network, hit.index); app.afterEdit('балансировочный клапан'); }
        return;
    }

    if (this.tool === 'erase') {
        var target = this.pick(p.x, p.y);
        if (!target) return;
        if (target.kind === 'segment') NetworkEdit.removeSegment(network, target.index);
        else NetworkEdit.removeNode(network, target.index);
        app.select(null);
        app.afterEdit('удаление');
        return;
    }

    // Трубы и перемычки.
    var kind = this.tool === 'link' ? 'link' : 'pipe';
    var role = this.tool === 'pipeT4' ? PipeRole.Return : PipeRole.Supply;

    var target2 = this.draftPoint(p.x, p.y, e);
    if (!target2) return;

    if (!this.draft) {
        this.beginDraft(kind, role, target2.point, target2.node,
            target2.onSegment === undefined ? -1 : target2.onSegment);
        this.draw();
        return;
    }

    this.commitDraft(target2);
};

SchemeView.prototype.commitDraft = function (target) {
    var app = this.app;
    var network = app.network;

    /*
        Конец, легший на трубу, разрезает её: в этом месте появляется узел,
        и ветка оказывается присоединённой. Без разреза линии пересекались бы
        только на картинке, а в графе остались бы два несвязанных куска.

        Разрез не меняет номеров прежних участков — исходный правится на месте,
        вторая половина добавляется в конец, — поэтому резать начало и конец
        можно подряд, не пересчитывая номера.
    */
    var a = this.draft.fromSegment >= 0
        ? NetworkEdit.splitSegment(network, this.draft.fromSegment, this.draft.from)
        : (this.draft.fromNode >= 0 ? this.draft.fromNode : this.nodeFor(this.draft.from));

    var b = target.onSegment !== undefined && target.onSegment >= 0
        ? NetworkEdit.splitSegment(network, target.onSegment, target.point)
        : (target.node >= 0 ? target.node : this.nodeFor(target.point));

    if (a === b || a < 0 || b < 0) { this.cancelDraft(); return; }

    var created;
    if (this.draft.kind === 'link') {
        created = NetworkEdit.addRingClosure(network, a, b, app.template.zoneKey);
    } else {
        var template = {
            role: this.draft.role,
            zoneKey: app.template.zoneKey,
            systemName: this.draft.role === PipeRole.Return
                ? app.template.returnName : app.template.supplyName,
            material: app.template.material,
            nominalMm: app.template.nominalMm,
            insulationName: app.template.insulationName,
            insulationMm: app.template.insulationMm,
            defaultLength: app.template.defaultLength,
            lengthFromGeometry: this.mode === '3d'
        };
        created = NetworkEdit.addPipe(network, a, b, template);
    }

    // Черчение продолжается от только что поставленной точки — как в любом
    // чертёжном редакторе: цепочку труб рисуют подряд, а не по одной.
    this.beginDraft(this.draft.kind, this.draft.role,
        this.mode === '3d' ? network.nodes[b].point3d.clone()
                           : { x: network.nodes[b].pointFlat.x, y: network.nodes[b].pointFlat.y },
        b);

    this.lockedAxis = -1;

    if (created) app.select({ kind: 'segment', index: created.index });
    app.afterEdit(this.draft && this.draft.kind === 'link' ? 'перемычку' : 'трубу');
};

SchemeView.prototype.nodeFor = function (point) {
    var network = this.app.network;

    if (this.mode === '3d')
        return NetworkEdit.ensureNode(network, point);

    // В плоской схеме узел создаётся своими координатами, а трёхмерное
    // положение получает черновое: схемы независимы, но узел один.
    for (var i = 0; i < network.nodes.length; i++) {
        var flat = network.nodes[i].pointFlat;
        if (network.nodes[i].flatPlaced
            && Math.abs(flat.x - point.x) < 0.4 && Math.abs(flat.y - point.y) < 0.4)
            return i;
    }

    var node = network.addNode(new Pt3(point.x, 0, point.y));
    node.pointFlat = { x: point.x, y: point.y };
    node.flatPlaced = true;
    return node.index;
};

function snap(value, step) {
    if (!step || step <= 0) return value;
    return Math.round(value / step) * step;
}

/** Какие роли трубопроводов сходятся в узле — для подписи ИТП. */
function rolesAtNode(network, node) {
    var result = { supply: false, circulation: false };
    var list = network.nodes[node].segments;

    for (var i = 0; i < list.length; i++) {
        var segment = network.segments[list[i]];
        if (!segment || segment.isVirtualLink) continue;

        if (segment.role === PipeRole.Supply) result.supply = true;
        else if (segment.role === PipeRole.Return) result.circulation = true;
    }

    return result;
}

/** Проложить путь по ломаной в текущем контуре. */
function trace(ctx, way) {
    ctx.beginPath();
    ctx.moveTo(way[0].x, way[0].y);
    for (var i = 1; i < way.length; i++)
        ctx.lineTo(way[i].x, way[i].y);
}

/**
 * Самое длинное звено ломаной. На нём и рисуются стрелка, клапан и подписи:
 * на середине прямой между концами они у участка с отводом оказались бы
 * в стороне от трубы, а короткое звено не вместило бы даже стрелку.
 */
function midOfWay(way) {
    var best = 0;
    var bestLength = -1;

    for (var i = 1; i < way.length; i++) {
        var length = distance(way[i - 1], way[i]);
        if (length > bestLength) {
            bestLength = length;
            best = i;
        }
    }

    return { before: way[best - 1], after: way[best] };
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
}
