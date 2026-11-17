/*
    Выгрузка расчётной схемы в PDF «как на экране».

    Берётся та самая картинка, что инженер рисует на холсте вкладки «Гидравлика»:
    SVG листа ХВС или ГВС со всеми подписями участков (диаметр, расход, скорость,
    удельные потери, длина), узлами, стояками и напорами этажей. Каждый элемент
    переносится в PDF векторно со своими цветом, толщиной и штрихом — как их видит
    браузер (getComputedStyle), поэтому внешний вид совпадает с экраном. Тема экрана
    не важна: снимок читается в светлой палитре, как для печати.

    Не переносятся вспомогательные элементы редактора: сетка, области захвата мыши,
    порты-кружки, черновик трубы, выделение.

    Страница — лист по размеру схемы: единица экрана (1 px схемы) = 0,25 … 0,4 мм
    бумаги, подпись 10 px получается 2,5 … 4 мм; лист не больше 2400 × 1700 мм.
*/

var HydPdfView = (function () {
    'use strict';

    var SCALES = [0.4, 0.33, 0.28, 0.25, 0.22, 0.2, 0.17, 0.15];     // мм бумаги на единицу схемы
    var MAX_LONG = 2400;
    var MAX_SHORT = 1700;
    var MARGIN = 20;
    var PAD = 14;                    // запас вокруг схемы, единиц схемы

    /* Светлая палитра приложения: снимок не должен зависеть от тёмной темы. */
    var LIGHT = {
        '--ink': '#1d2733', '--muted': '#5d6b79', '--line': '#d9e0e7', '--bg': '#f3f5f8', '--panel': '#ffffff', '--panel2': '#f7f9fb',
        '--accent': '#0f8a7e', '--accent-hover': '#0c6f65', '--accent-soft': '#e3f4f2', '--water': '#2f7dd1',
        '--warn': '#b86400', '--warn-soft': '#fff4e5', '--bad': '#c62f2f', '--bad-soft': '#fdeeee',
        '--good': '#1f7a4d', '--good-soft': '#e8f6ee', '--est': '#6b5aa8', '--grid': '#e9edf2', '--axis': '#b9c3cd'
    };

    var NAMES = { c: 'ХВС (В1)', h: 'ГВС (Т3)' };

    function lightHost() {
        var div = document.createElement('div');
        var css = ['position:fixed', 'left:-30000px', 'top:0', 'width:4000px', 'height:4000px', 'color-scheme:light', 'pointer-events:none'];
        Object.keys(LIGHT).forEach(function (k) { css.push(k + ':' + LIGHT[k]); });
        div.style.cssText = css.join(';');
        document.body.appendChild(div);
        return div;
    }

    /* «rgb(1, 2, 3)» / «rgba(1, 2, 3, .5)» → { color, alpha } или null (нет цвета). */
    function parseColor(text) {
        var t = String(text || '').trim();
        if (!t || t === 'none' || t === 'transparent') return null;
        var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(t);
        if (!m) return null;
        var a = 1;
        if (m[4] !== undefined) a = /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        if (a <= 0) return null;
        return { color: 'rgb(' + m[1] + ',' + m[2] + ',' + m[3] + ')', alpha: a };
    }

    function px(v, fallback) {
        var n = parseFloat(v);
        return isFinite(n) ? n : fallback;
    }

    function dashes(text) {
        if (!text || text === 'none') return null;
        var list = String(text).split(/[\s,]+/).map(parseFloat).filter(function (n) { return isFinite(n); });
        if (!list.length) return null;
        if (list.length % 2) list = list.concat(list);
        return list.some(function (n) { return n > 0; }) ? list : null;
    }

    function skipped(el) {
        var cl = el.classList;
        if (!cl) return false;
        return cl.contains('cv-bg') || cl.contains('cv-hit') || cl.contains('cv-hit-n') || cl.contains('cv-porthit')
            || cl.contains('cv-port') || cl.contains('cv-vertex') || cl.contains('cv-snap') || cl.contains('cv-preview')
            || el.id === 'cvPreview';
    }

    /* --- контуры --------------------------------------------------------------- */

    function roundRect(pg, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        var k = r * 0.5522847498;
        pg.moveTo(x + r, y).lineTo(x + w - r, y).curveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        pg.lineTo(x + w, y + h - r).curveTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        pg.lineTo(x + r, y + h).curveTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        pg.lineTo(x, y + r).curveTo(x, y + r - k, x + r - k, y, x + r, y).close();
    }

    /* Атрибут d пути: M L H V Z (строчные — относительные), C, S не нужны схеме. Возвращает false, если команда незнакома. */
    function tracePath(pg, d) {
        var tokens = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
        var i = 0;
        var cx = 0, cy = 0, sx = 0, sy = 0;
        var cmd = '';

        function next() { return parseFloat(tokens[i++]); }
        function isNum() { return i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]); }

        while (i < tokens.length) {
            if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
            var rel = cmd === cmd.toLowerCase();
            var up = cmd.toUpperCase();

            if (up === 'Z') { pg.close(); cx = sx; cy = sy; continue; }

            if (up === 'M') {
                var mx = next(), my = next();
                cx = rel ? cx + mx : mx; cy = rel ? cy + my : my;
                sx = cx; sy = cy;
                pg.moveTo(cx, cy);
                cmd = rel ? 'l' : 'L';
            } else if (up === 'L') {
                while (isNum()) { var lx = next(), ly = next(); cx = rel ? cx + lx : lx; cy = rel ? cy + ly : ly; pg.lineTo(cx, cy); }
            } else if (up === 'H') {
                while (isNum()) { var hx = next(); cx = rel ? cx + hx : hx; pg.lineTo(cx, cy); }
            } else if (up === 'V') {
                while (isNum()) { var vy = next(); cy = rel ? cy + vy : vy; pg.lineTo(cx, cy); }
            } else if (up === 'C') {
                while (isNum()) {
                    var a = [next(), next(), next(), next(), next(), next()];
                    if (rel) a = [cx + a[0], cy + a[1], cx + a[2], cy + a[3], cx + a[4], cy + a[5]];
                    pg.curveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
                    cx = a[4]; cy = a[5];
                }
            } else {
                return false;
            }
        }
        return true;
    }

    /* Контур фигуры в текущих координатах; false — рисовать нечего. */
    function trace(pg, el, tag) {
        function len(name) { return px(el.getAttribute(name), 0); }

        if (tag === 'rect') {
            var w = len('width'), h = len('height');
            if (!(w > 0 && h > 0)) return false;
            var rx = len('rx');
            if (rx > 0) roundRect(pg, len('x'), len('y'), w, h, rx);
            else pg.rect(len('x'), len('y'), w, h);
            return true;
        }
        if (tag === 'circle') {
            var r = px(getComputedStyle(el).r, NaN);
            if (!isFinite(r)) r = len('r');
            if (!(r > 0)) return false;
            pg.circle(len('cx'), len('cy'), r);
            return true;
        }
        if (tag === 'ellipse') {
            // эллипс — окружность, растянутая матрицей
            var ex = len('rx'), ey = len('ry');
            if (!(ex > 0 && ey > 0)) return false;
            pg.save().cm(ex, 0, 0, ey, len('cx'), len('cy'));
            pg.circle(0, 0, 1);
            pg.restore();
            return true;
        }
        if (tag === 'line') {
            pg.moveTo(len('x1'), len('y1')).lineTo(len('x2'), len('y2'));
            return true;
        }
        if (tag === 'polyline' || tag === 'polygon') {
            var nums = (el.getAttribute('points') || '').split(/[\s,]+/).filter(function (s) { return s !== ''; }).map(parseFloat);
            if (nums.length < 4) return false;
            for (var i = 0; i + 1 < nums.length; i += 2) {
                if (i) pg.lineTo(nums[i], nums[i + 1]); else pg.moveTo(nums[i], nums[i + 1]);
            }
            if (tag === 'polygon') pg.close();
            return true;
        }
        if (tag === 'path') return tracePath(pg, el.getAttribute('d') || '');
        return false;
    }

    /* --- обход ------------------------------------------------------------------ */

    /* Цвет штриховки по ссылке fill="url(#…)" — линия узора, бледнее. */
    function patternFill(root, fill) {
        var m = /url\(["']?#([^"')]+)["']?\)/.exec(fill || '');
        if (!m) return null;
        var pat = root.querySelector('[id="' + m[1] + '"]');
        var line = pat && pat.querySelector('line');
        var c = line ? parseColor(getComputedStyle(line).stroke) : null;
        return c ? { color: c.color, alpha: 0.45 } : null;
    }

    function drawText(pg, el, cs, env) {
        var s = '';
        el.childNodes.forEach(function (n) { if (n.nodeType === 3) s += n.nodeValue; });
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) return;

        var fill = parseColor(cs.fill);
        if (!fill) return;

        var size = px(cs.fontSize, 10);
        var bold = parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold';
        var family = cs.fontFamily || 'Arial, sans-serif';
        var width = pg.textWidth(s, size, family, bold);
        var anchor = cs.textAnchor;
        var x = px(el.getAttribute('x'), 0) + px(el.getAttribute('dx'), 0);
        var y = px(el.getAttribute('y'), 0) + px(el.getAttribute('dy'), 0);
        if (anchor === 'middle') x -= width / 2;
        else if (anchor === 'end') x -= width;

        pg.save();
        pg.alpha(env.alpha * fill.alpha);
        pg.text(s, [1, 0, 0, -1, x, y], size, fill.color, family, bold);     // ось y схемы направлена вниз
        pg.restore();
    }

    function paintShape(pg, el, tag, cs, env, root) {
        var fillText = cs.fill;
        var fill = tag === 'line' ? null : parseColor(fillText);
        if (!fill && /^url\(/.test(fillText)) fill = patternFill(root, fillText);
        var stroke = parseColor(cs.stroke);
        var sw = px(cs.strokeWidth, 1);
        var fa = px(cs.fillOpacity, 1);
        var sa = px(cs.strokeOpacity, 1);

        if (fill && tag !== 'line') {
            pg.save();
            pg.alpha(env.alpha * fill.alpha * fa);
            pg.fillColor(fill.color);
            if (trace(pg, el, tag)) pg.fill(); else pg.end();
            pg.restore();
        }

        if (stroke && sw > 0) {
            pg.save();
            pg.alpha(env.alpha * stroke.alpha * sa);
            pg.strokeColor(stroke.color).lineWidth(sw);
            pg.cap(cs.strokeLinecap === 'round' ? 1 : (cs.strokeLinecap === 'square' ? 2 : 0));
            pg.join(cs.strokeLinejoin === 'round' ? 1 : (cs.strokeLinejoin === 'bevel' ? 2 : 0));
            var dash = dashes(cs.strokeDasharray);
            if (dash) pg.dash(dash, 0);
            if (trace(pg, el, tag)) pg.stroke(); else pg.end();
            pg.restore();
        }
    }

    function visit(pg, el, env, root) {
        if (el.nodeType !== 1) return;
        var tag = el.localName;
        if (tag === 'defs' || tag === 'title' || tag === 'pattern' || tag === 'style' || skipped(el)) return;

        var cs = getComputedStyle(el);
        if (cs.display === 'none') return;
        if (cs.visibility === 'hidden') return;

        var opacity = px(cs.opacity, 1);
        var matrix = el.transform && el.transform.baseVal && el.transform.baseVal.numberOfItems ? el.transform.baseVal.consolidate() : null;
        var inner = { alpha: env.alpha * opacity };

        pg.save();
        if (matrix) pg.cm(matrix.matrix.a, matrix.matrix.b, matrix.matrix.c, matrix.matrix.d, matrix.matrix.e, matrix.matrix.f);

        if (tag === 'g' || tag === 'svg') {
            for (var i = 0; i < el.childNodes.length; i++) visit(pg, el.childNodes[i], inner, root);
        } else if (tag === 'text') {
            drawText(pg, el, cs, inner);
        } else {
            paintShape(pg, el, tag, cs, inner, root);
        }

        pg.restore();
    }

    /* --- страница ---------------------------------------------------------------- */

    function title(hyd, net) {
        return (hyd.survey.objectName || 'Схема ВК') + ' — расчётная схема ' + NAMES[net];
    }

    function addPage(pdf, svgCopy, hyd, net) {
        var host = lightHost();
        try {
            host.appendChild(svgCopy);
            svgCopy.setAttribute('width', 4000);
            svgCopy.setAttribute('height', 4000);

            var view = svgCopy.querySelector('#cvView');
            view.removeAttribute('transform');
            var bg = view.querySelector('.cv-bg');
            if (bg) bg.parentNode.removeChild(bg);

            // границы — по видимым элементам, без областей захвата мыши
            ['.cv-hit', '.cv-hit-n', '.cv-porthit', '.cv-port', '#cvPreview'].forEach(function (sel) {
                [].slice.call(view.querySelectorAll(sel)).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
            });

            var b = view.getBBox();
            if (!(b.width > 0 && b.height > 0)) return false;

            var bx = b.x - PAD;
            var by = b.y - PAD;
            var bw = b.width + 2 * PAD;
            var bh = b.height + 2 * PAD;

            var s = SCALES[SCALES.length - 1];
            for (var i = 0; i < SCALES.length; i++) {
                var pw = bw * SCALES[i] + 2 * MARGIN;
                var ph = bh * SCALES[i] + 2 * MARGIN;
                if (Math.max(pw, ph) <= MAX_LONG && Math.min(pw, ph) <= MAX_SHORT) { s = SCALES[i]; break; }
            }

            var pageW = Math.max(297, Math.ceil(bw * s + 2 * MARGIN));
            var pageH = Math.max(210, Math.ceil(bh * s + 2 * MARGIN));
            var pg = pdf.page(pageW, pageH);

            // схема: ось y вниз, начало — левый верхний угол охвата
            pg.save();
            pg.cm(s, 0, 0, -s, MARGIN - bx * s, pageH - MARGIN + by * s);
            pg.cap(1).join(1);
            visit(pg, view, { alpha: 1 }, svgCopy);
            pg.restore();

            // рамка, название листа
            pg.strokeColor('#101010').lineWidth(0.5).rect(5, 5, pageW - 10, pageH - 10).stroke();
            var cap = title(hyd, net);
            pg.text(cap, [1, 0, 0, 1, 10, pageH - 11], 4, '#101010', 'Arial, sans-serif', true);
            return true;
        } finally {
            document.body.removeChild(host);
        }
    }

    /*
        Снимки листов ХВС и ГВС → Promise<байты PDF>.
        snapshot(net) — функция, возвращающая копию SVG листа (HydCanvas.snapshot).
    */
    function build(hyd, snapshot) {
        var pdf = PdfVec.create((hyd.survey.objectName || 'Схема ВК') + ' — расчётные схемы В1 и Т3');
        var any = false;

        ['c', 'h'].forEach(function (net) {
            var has = hyd.canvas.nodes.some(function (n) { return HydGraph.onSheet(n, net); });
            if (!has) return;
            if (addPage(pdf, snapshot(net), hyd, net)) any = true;
        });

        if (!any) return Promise.reject(new Error('на схеме нечего выгружать'));
        return pdf.bytes();
    }

    function save(hyd, snapshot) {
        return build(hyd, snapshot).then(function (bytes) {
            Zip.save(bytes, HydPdf.fileName(hyd, 'расчётная схема как на экране'), 'application/pdf');
        });
    }

    return { build: build, save: save };
})();
