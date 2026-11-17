'use strict';

/*
    Свободная аксонометрия: поворот вокруг вертикали, наклон, масштаб и панорама.
    Порт HotWaterCirculation/src/Projection.cs, дополненный обратной задачей —
    без неё мышью ничего не начертишь.

    Схема рисуется вектором, а не растром: по линии участка надо попадать мышью,
    при увеличении она должна оставаться чёткой, а толщина линии несёт диаметр.

    Экранные оси:
        R = (−sinA, cosA, 0)                  вправо
        U = (−cosA·sinE, −sinA·sinE, cosE)    вверх
        F = R × U = (cosA·cosE, sinA·cosE, sinE)

    F — ось глубины: смещение вдоль неё на экране не видно вовсе (R·F = U·F = 0).
    Именно поэтому по одному щелчку трёхмерная точка не определяется, и черчение
    идёт по плоскости построения либо по оси от уже указанной точки.
*/

function Projection() {
    /** Поворот вокруг вертикальной оси, радианы. */
    this.azimuth = -Math.PI / 4.0;

    /** Наклон камеры, радианы. Ноль — вид строго сбоку. */
    this.elevation = Math.PI / 6.0;

    /** Пикселей на метр. */
    this.scale = 20.0;

    /** Смещение картинки, пиксели. */
    this.panX = 0.0;
    this.panY = 0.0;

    /** Точка модели, которая остаётся в центре экрана. */
    this.center = new Pt3(0, 0, 0);

    /** Размер холста, пиксели. */
    this.width = 800;
    this.height = 600;
}

Projection.MinElevation = -Math.PI / 2.0 + 0.02;
Projection.MaxElevation = Math.PI / 2.0 - 0.02;

/** Экранные оси текущего вида. */
Projection.prototype.basis = function () {
    var cosA = Math.cos(this.azimuth), sinA = Math.sin(this.azimuth);
    var cosE = Math.cos(this.elevation), sinE = Math.sin(this.elevation);

    return {
        right: new Pt3(-sinA, cosA, 0),
        up: new Pt3(-cosA * sinE, -sinA * sinE, cosE),
        forward: new Pt3(cosA * cosE, sinA * cosE, sinE)
    };
};

Projection.prototype.project = function (point) {
    var dx = point.x - this.center.x;
    var dy = point.y - this.center.y;
    var dz = point.z - this.center.z;

    var cosA = Math.cos(this.azimuth), sinA = Math.sin(this.azimuth);
    var cosE = Math.cos(this.elevation), sinE = Math.sin(this.elevation);

    var right = -dx * sinA + dy * cosA;
    var up = -(dx * cosA + dy * sinA) * sinE + dz * cosE;

    return {
        x: right * this.scale + this.panX + this.width / 2.0,
        y: -up * this.scale + this.panY + this.height / 2.0
    };
};

/** Глубина точки вдоль оси взгляда — по ней сортируется отрисовка. */
Projection.prototype.depth = function (point) {
    var f = this.basis().forward;
    return point.x * f.x + point.y * f.y + point.z * f.z;
};

/**
 * Луч из точки экрана: начало на плоскости, проходящей через центр вида,
 * направление — ось глубины.
 */
Projection.prototype.ray = function (sx, sy) {
    var b = this.basis();

    var right = (sx - this.panX - this.width / 2.0) / this.scale;
    var up = -(sy - this.panY - this.height / 2.0) / this.scale;

    var origin = new Pt3(
        this.center.x + right * b.right.x + up * b.up.x,
        this.center.y + right * b.right.y + up * b.up.y,
        this.center.z + right * b.right.z + up * b.up.z);

    return { origin: origin, dir: b.forward };
};

/**
 * Точка экрана на плоскости построения. null означает, что плоскость видна
 * с ребра: в таком виде указать по ней точку нельзя, и врать об этом не надо.
 */
Projection.prototype.toPlane = function (sx, sy, planePoint, planeNormal) {
    var ray = this.ray(sx, sy);

    var denominator = planeNormal.x * ray.dir.x
        + planeNormal.y * ray.dir.y
        + planeNormal.z * ray.dir.z;

    if (Math.abs(denominator) < 1e-6)
        return null;

    var numerator = planeNormal.x * (planePoint.x - ray.origin.x)
        + planeNormal.y * (planePoint.y - ray.origin.y)
        + planeNormal.z * (planePoint.z - ray.origin.z);

    var t = numerator / denominator;

    return new Pt3(
        ray.origin.x + ray.dir.x * t,
        ray.origin.y + ray.dir.y * t,
        ray.origin.z + ray.dir.z * t);
};

/**
 * Плоскость построения, наиболее развёрнутая к камере. В виде сверху это
 * горизонталь, в виде спереди — вертикаль: по плоскости, видной с ребра,
 * мышью не попасть.
 */
Projection.prototype.bestPlaneNormal = function () {
    var f = this.basis().forward;
    var ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);

    if (az >= ax && az >= ay) return new Pt3(0, 0, 1);
    if (ax >= ay) return new Pt3(1, 0, 0);
    return new Pt3(0, 1, 0);
};

/**
 * Ближайшая к курсору точка на луче, выходящем из start вдоль оси axis.
 * Так черчение привязывается к осям X, Y и Z: по плоскому экрану в трёх
 * измерениях иначе не попасть.
 */
Projection.prototype.pointOnAxis = function (start, axis, sx, sy) {
    var ray = this.ray(sx, sy);

    // Кратчайшее расстояние между двумя прямыми в пространстве.
    var w0 = new Pt3(start.x - ray.origin.x, start.y - ray.origin.y, start.z - ray.origin.z);

    var a = dot(axis, axis);
    var b = dot(axis, ray.dir);
    var c = dot(ray.dir, ray.dir);
    var d = dot(axis, w0);
    var e = dot(ray.dir, w0);

    var denominator = a * c - b * b;
    if (Math.abs(denominator) < 1e-9)
        return null;                       // ось смотрит точно в камеру

    var t = (b * e - c * d) / denominator;

    return new Pt3(start.x + axis.x * t, start.y + axis.y * t, start.z + axis.z * t);
};

Projection.prototype.rotate = function (deltaAzimuth, deltaElevation) {
    this.azimuth += deltaAzimuth;
    this.elevation += deltaElevation;

    if (this.elevation < Projection.MinElevation) this.elevation = Projection.MinElevation;
    if (this.elevation > Projection.MaxElevation) this.elevation = Projection.MaxElevation;
};

/** Приближение к точке под курсором, а не к центру экрана. */
Projection.prototype.zoom = function (factor, anchorX, anchorY) {
    var before = this.scale;
    this.scale *= factor;

    if (this.scale < 0.05) this.scale = 0.05;
    if (this.scale > 5000.0) this.scale = 5000.0;

    var ratio = this.scale / before;

    var centreX = this.panX + this.width / 2.0;
    var centreY = this.panY + this.height / 2.0;

    this.panX += (anchorX - centreX) * (1.0 - ratio);
    this.panY += (anchorY - centreY) * (1.0 - ratio);
};

/** Подгонка масштаба и центра под габарит сети. */
Projection.prototype.fit = function (points, width, height) {
    this.width = width;
    this.height = height;
    this.panX = 0.0;
    this.panY = 0.0;

    if (!points || points.length === 0) {
        this.center = new Pt3(0, 0, 0);
        this.scale = 20.0;
        return;
    }

    var minX = Infinity, minY = Infinity, minZ = Infinity;
    var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    var i;

    for (i = 0; i < points.length; i++) {
        var p = points[i];
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.z > maxZ) maxZ = p.z;
    }

    this.center = new Pt3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);

    // Масштаб подбирается по уже спроецированным точкам: габарит модели
    // и габарит картинки — разные вещи, аксонометрия их не сохраняет.
    this.scale = 1.0;
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

    for (i = 0; i < points.length; i++) {
        var flat = this.project(points[i]);
        if (flat.x < left) left = flat.x;
        if (flat.y < top) top = flat.y;
        if (flat.x > right) right = flat.x;
        if (flat.y > bottom) bottom = flat.y;
    }

    var spanX = right - left;
    var spanY = bottom - top;
    var margin = 50.0;

    var scaleX = spanX > 1e-6 ? (width - margin * 2.0) / spanX : 20.0;
    var scaleY = spanY > 1e-6 ? (height - margin * 2.0) / spanY : 20.0;

    this.scale = Math.max(0.05, Math.min(scaleX, scaleY));
};

/** Расстояние от точки до отрезка на экране, пиксели. Нужно для попадания мышью. */
Projection.distanceToSegment = function (px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var lengthSquared = dx * dx + dy * dy;

    if (lengthSquared < 1e-9)
        return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));

    var t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;

    var qx = ax + t * dx;
    var qy = ay + t * dy;
    return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
};

function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

/*
    Предустановленные виды — как в трёхмерных программах. Цифра на клавиатуре
    ставит вид, не трогая ни масштаба, ни центра: смотреть на ту же сеть с другой
    стороны, а не искать её заново.
*/
var ViewPresets = [
    { key: '1', name: 'Спереди',      azimuth: -Math.PI / 2,       elevation: 0 },
    { key: '2', name: 'Сверху',       azimuth: -Math.PI / 2,       elevation: Projection.MaxElevation },
    { key: '3', name: 'Слева',        azimuth: Math.PI,            elevation: 0 },
    { key: '4', name: 'Справа',       azimuth: 0,                  elevation: 0 },
    { key: '5', name: 'Сзади',        azimuth: Math.PI / 2,        elevation: 0 },
    { key: '6', name: 'Снизу',        azimuth: -Math.PI / 2,       elevation: Projection.MinElevation },
    { key: '7', name: 'Изометрия ЮЗ', azimuth: -3 * Math.PI / 4,   elevation: Math.PI / 6 },
    { key: '8', name: 'Изометрия ЮВ', azimuth: -Math.PI / 4,       elevation: Math.PI / 6 },
    { key: '9', name: 'Изометрия СВ', azimuth: Math.PI / 4,        elevation: Math.PI / 6 },
    { key: '0', name: 'Изометрия СЗ', azimuth: 3 * Math.PI / 4,    elevation: Math.PI / 6 }
];
