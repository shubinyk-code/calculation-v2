'use strict';

/*
    Панели: свойства выбранного слева, вкладки справа.

    Панели перерисовываются целиком после каждой правки — так они не могут
    разойтись с моделью. Чтобы при этом не терялся курсор, фокус
    восстанавливается по ключу поля (data-key), а сама правка применяется
    на следующем такте: к этому моменту Tab уже перевёл фокус на соседнюю
    ячейку, и именно она получает его обратно после перерисовки.
*/

var Panels = (function () {

    var TABS = [
        { key: 'inputs', name: 'Исходные данные' },
        { key: 'calc', name: 'Расчёт' },
        { key: 'binding', name: 'Привязка' },
        { key: 'riser', name: 'Стояк', plan: true },
        { key: 'corridor', name: 'Коридор' },
        { key: 'output', name: 'Вывод' },
        { key: 'numbering', name: 'Нумерация и подписи' },
        { key: 'pipes', name: 'Трубы' }
    ];

    var TEXT_SETTINGS = [
        'group', 'maker', 'sprinklerType', 'systemKind', 'code', 'systemName',
        'objectText', 'tableTitle', 'pumpText', 'cuKind', 'tableMode', 'hydr.formula',
        'num.mainStyle', 'num.mainPrefix', 'num.mainSuffix', 'num.branchStyle', 'num.branchPrefix',
        'num.branchSuffix', 'num.attach', 'num.direction', 'num.sourceLabel', 'num.cuLabel',
        'corridor.diameters'
    ];

    var tab = 'calc';
    var arr = { count: 3, step: 3.2, dir: 1, alternate: false };

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }
    function n2(v) { return Fmt.num(v, 2); }

    function valueText(v) {
        if (v === null || v === undefined || v === '') return '';
        if (typeof v !== 'number') return String(v);
        if (v !== 0 && Math.abs(v) < 0.001) return String(v).replace('.', ',');
        return Fmt.trim(v, 6);
    }

    function sizeText(od, wall) {
        return String(od).replace('.', ',') + '×' + String(wall).replace('.', ',');
    }

    /* --- поля ------------------------------------------------------------- */

    /*
        Номер приложения не вписывают: его раздаёт Appendix одним счётом на всю
        книгу — сначала каталожные листы насосов, потом расчёты.
    */
    function appendixLine(key) {
        var no = Appendix.of(App.book, key);
        return '<p class="hint">Приложение <b>' + (no || '—') + '</b> — номер раздаётся сам, подряд по книге: '
            + 'каталожные листы насосных установок и жокеев, затем расчёты. Первый номер и перечень — '
            + 'во вкладке «Текстовая часть».</p>';
    }

    function numField(label, key, value, unit, placeholder) {
        return '<label class="field"><span>' + esc(label) + (unit ? ', ' + esc(unit) : '') + '</span>'
            + '<input type="text" inputmode="decimal" data-key="' + key + '" value="' + esc(valueText(value)) + '"'
            + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></label>';
    }

    function textField(label, key, value) {
        return '<label class="field"><span>' + esc(label) + '</span>'
            + '<input type="text" data-key="' + key + '" value="' + esc(value) + '"></label>';
    }

    function selectField(label, key, value, options) {
        var html = '<label class="field"><span>' + esc(label) + '</span><select data-key="' + key + '">';
        options.forEach(function (o) {
            html += '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        });
        return html + '</select></label>';
    }

    function checkField(label, key, checked) {
        return '<label class="check"><input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + '> '
            + esc(label) + '</label>';
    }

    function section(title, body) {
        return '<fieldset class="section"><legend>' + esc(title) + '</legend>' + body + '</fieldset>';
    }

    function materialSelect(key, material, cls) {
        var html = '<select class="' + (cls || '') + '" data-key="' + key + '">';
        var found = false;
        Catalog.MATERIALS.forEach(function (m) {
            var on = m.key === material;
            if (on) found = true;
            html += '<option value="' + esc(m.key) + '"' + (on ? ' selected' : '') + '>' + esc(m.key) + '</option>';
        });
        if (!found) html += '<option selected>' + esc(material) + '</option>';
        return html + '</select>';
    }

    function sizeSelect(key, material, od, wall, compact, cls) {
        var html = '<select class="' + (cls || '') + '" data-key="' + key + '">';
        var found = false;
        Catalog.sizes(material).forEach(function (r) {
            var on = Math.abs(r.od - od) < 0.01 && Math.abs(r.wall - wall) < 0.01;
            if (on) found = true;
            html += '<option value="' + r.od + '|' + r.wall + '"' + (on ? ' selected' : '') + '>'
                + esc(compact ? 'Ду' + r.dn + '  ' + sizeText(r.od, r.wall) : Catalog.sizeLabel(r)) + '</option>';
        });
        if (!found) {
            html += '<option value="' + od + '|' + wall + '" selected>' + esc(sizeText(od, wall) + ' — нет в таблице') + '</option>';
        }
        return html + '</select>';
    }

    function pipeFields(label, key, pipe) {
        return '<div class="pair"><label class="field"><span>' + esc(label) + ': материал</span>'
            + materialSelect(key + '.material', pipe.material) + '</label>'
            + '<label class="field"><span>размер</span>' + sizeSelect(key + '.size', pipe.material, pipe.od, pipe.wall, false) + '</label></div>';
    }

    function pickSize(material, od, wall, oldMaterial) {
        var old = Catalog.find(oldMaterial, od, wall);
        var list = Catalog.sizes(material);
        if (!list.length) return { od: od, wall: wall };

        var best = null;
        list.forEach(function (r) {
            if (old && r.dn === old.dn && !best) best = r;
        });
        if (!best) {
            best = list[0];
            list.forEach(function (r) {
                if (Math.abs(r.od - od) < Math.abs(best.od - od)) best = r;
            });
        }
        return { od: best.od, wall: best.wall };
    }

    function rerender(container, html) {
        var active = document.activeElement;
        var key = active && container.contains(active) && active.dataset ? active.dataset.key : null;
        var scroll = container.scrollTop;

        container.innerHTML = html;
        container.scrollTop = scroll;

        if (key) {
            var el = container.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
            if (el) el.focus({ preventScroll: true });
        }
    }

    /* --- правка по ключу -------------------------------------------------- */

    function applySetting(path, value) {
        var s = App.project.settings;
        var parts = path.split('.');

        if (parts[0] === 'pipeMain' || parts[0] === 'pipeRay') {
            var pipe = s[parts[0]];
            if (parts[1] === 'material') {
                var size = pickSize(value, pipe.od, pipe.wall, pipe.material);
                pipe.material = value;
                pipe.od = size.od;
                pipe.wall = size.wall;
            } else {
                var ow = String(value).split('|');
                pipe.od = Number(ow[0]);
                pipe.wall = Number(ow[1]);
            }
            return;
        }

        var target = parts.length === 2 ? s[parts[0]] : s;
        var key = parts.length === 2 ? parts[1] : parts[0];

        if (typeof value === 'boolean') {
            target[key] = value;
            return;
        }

        if (TEXT_SETTINGS.indexOf(path) >= 0) {
            target[key] = value;
        } else if (path === 'pkElev') {
            var elev = Fmt.parse(value);
            // На плане кранов это расчётная отметка: пустой она не бывает.
            if (elev === null && s.planKind === 'vpv') return;
            s.pkElev = elev;
        } else if (path === 'pkFlow' || path === 'pkHead') {
            // Пусто — значит «по табл. 7.3»: ноль как раз и означает «из таблицы».
            var pk = Fmt.parse(value);
            s[key] = pk > 0 ? pk : 0;
        } else if (path === 'cuXi') {
            var xi = Fmt.parse(value);
            s.cuXi = xi > 0 ? xi : null;
        } else if (path === 'cuDn') {
            s.cuDn = Number(value);
            s.cuXi = null;
        } else {
            var v = Fmt.parse(value);
            if (v === null) return;
            target[key] = v;
        }

        if (path === 'group') {
            var g = Catalog.group(value);
            if (g) {
                if (g.intensity > 0) s.intensity = g.intensity;
                s.area = g.area;
                s.minutes = g.minutes;
                s.maxSpacing = g.maxSpacing;
            }
        }

        if (path === 'cuKind') {
            var sizes = Catalog.cuSizes(value);
            if (sizes.indexOf(s.cuDn) < 0 && sizes.length) s.cuDn = sizes[sizes.length - 1];
            s.cuXi = null;
        }

        // Смена производителя: марка, которой у него нет, заменяется на
        // ближайшую по k — чтобы расход не прыгнул молча в разы.
        if (path === 'maker') {
            var maker = Sprinklers.maker(value);
            if (maker && !Sprinklers.find(value, s.sprinklerType)) {
                var near = Sprinklers.closest(maker, s.k);
                s.sprinklerType = near.model;
                s.k = near.k;
            }
        }

        if (path === 'sprinklerType') {
            var item = Sprinklers.find(s.maker, value);
            if (item) s.k = item.k;
        }

        if (path === 'pkJets') s.pkJets = Math.max(1, Math.round(s.pkJets));

        // Запас к диаметру и вязкость: отрицательных и нулевых не бывает.
        if (path === 'hydr.reserve') s.hydr.reserve = Math.max(0, s.hydr.reserve);
        if (path === 'hydr.nu' && !(s.hydr.nu > 0)) s.hydr.nu = 1.31;

        // Воздухозаполненной установке нужен воздушный узел управления.
        if (path === 'systemKind') {
            if (value === 'воздухозаполненная') {
                var airSizes = Catalog.cuSizes('Воздушный');
                s.cuKind = 'Воздушный';
                if (airSizes.indexOf(s.cuDn) < 0) s.cuDn = airSizes[airSizes.length - 1];
            } else {
                if (s.cuKind === 'Воздушный') s.cuKind = 'Прямоточный';
                // Признак холодного помещения относится к воздухозаполненной
                // сети: иначе он тихо остаётся и подменяет тип в записке.
                s.coldRoom = false;
            }
            s.cuXi = null;
        }
    }

    function applySegment(seg, field, value) {
        if (field === 'material') {
            var size = pickSize(value, seg.od, seg.wall, seg.material);
            seg.material = value;
            seg.od = size.od;
            seg.wall = size.wall;
        } else if (field === 'size') {
            var ow = String(value).split('|');
            seg.od = Number(ow[0]);
            seg.wall = Number(ow[1]);
        } else if (field === 'len') {
            var len = Fmt.parse(value);
            seg.len = len > 0 ? len : null;
        } else if (field === 'kt') {
            var kt = Fmt.parse(value);
            seg.kt = kt > 0 ? kt : null;
        } else if (field === 'ring') {
            seg.ring = !!value;
        } else if (field === 'role') {
            seg.role = value === 'main' ? 'main' : 'ray';
        }
    }

    function applyNode(node, field, value) {
        var p = App.project;

        if (field === 'label') node.label = String(value).trim();
        else if (field === 'spr') node.spr = !!value;
        else if (field === 'off') node.off = !!value;
        else if (field === 'cu') node.cu = !!value;
        else if (field === 'model') {
            var item = Sprinklers.findKey(value);
            node.model = value;
            node.k = item ? item.k : null;
        }
        else if (field === 'k') {
            var k = Fmt.parse(value);
            node.k = k > 0 ? k : null;
        } else if (field === 'q') {
            var q = Fmt.parse(value);
            node.q = q > 0 ? q : 0;
        } else if (field === 'cover') {
            var d = Fmt.parse(value);
            node.cover = d > 0 ? d : 0;
        } else if (field === 'dict') {
            p.nodes.forEach(function (n) { n.dict = false; });
            node.dict = !!value;
        }
    }

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;

        var value = el.type === 'checkbox' ? el.checked : el.value;
        var parts = key.split(':');

        if (parts[0] === 'arr') {
            if (parts[1] === 'alternate') arr.alternate = !!value;
            else {
                var v = Fmt.parse(value);
                if (v !== null) arr[parts[1]] = parts[1] === 'count' ? Math.max(1, Math.round(v)) : v;
            }
            return;
        }

        // Правка — на следующем такте, см. комментарий в начале файла.
        setTimeout(function () {
            var p = App.project;

            if (parts[0] === 'set') {
                applySetting(parts[1], value);
                App.afterEdit('исходные данные');
            } else if (parts[0] === 'seg') {
                var seg = Model.seg(p, Number(parts[1]));
                if (!seg) return;
                applySegment(seg, parts[2], value);
                App.afterEdit('участок ' + (App.calc.segNames[seg.id] || ''));
            } else if (parts[0] === 'node') {
                var node = Model.node(p, Number(parts[1]));
                if (!node) return;
                applyNode(node, parts[2], value);
                App.afterEdit('узел');
            } else if (parts[0] === 'bind') {
                applyBinding(parts, value);
            } else if (parts[0] === 'pk') {
                var hn = Model.node(p, Number(parts[1]));
                if (!hn || !hn.pk) return;
                var v = Fmt.parse(value);
                if (parts[2] === 'name') hn.pk.name = String(value).trim();
                else if (parts[2] === 'elev') hn.pk.elev = v;
                // «авто» — выбор за расчётом, «в расчёте»/«не в расчёте» — за человеком.
                else if (parts[2] === 'use') hn.pk.use = value === 'on' ? true : value === 'off' ? false : null;
                else if (parts[2] === 'jets') hn.pk.jets = v > 0 ? Math.round(v) : null;
                else hn.pk[parts[2]] = v > 0 ? v : null;
                App.afterEdit('пожарный кран');
            } else if (parts[0] === 'branch') {
                var br = Tools.selectedBranch();
                if (!br) return;
                br.segs.forEach(function (id) { applySegment(Model.seg(p, id), parts[1], value); });
                App.afterEdit('трубы луча');
            } else if (parts[0] === 'branchnode') {
                var brn = Tools.selectedBranch();
                if (!brn) return;
                brn.nodes.forEach(function (id) {
                    var nd = Model.node(p, id);
                    if (nd && nd.spr) applyNode(nd, parts[1], value);
                });
                App.afterEdit('зоны орошения луча');
            }
        }, 0);
    }

    function onClick(e) {
        var button = e.target.closest('[data-action]');
        if (button) {
            action(button.dataset.action);
            return;
        }

        if (e.target.closest('input, select, label')) return;

        var pkRow = e.target.closest('tr[data-node]');
        if (pkRow) {
            var nodeId = Number(pkRow.dataset.node);
            var pkNode = Model.node(App.project, nodeId);
            App.select({ type: 'node', id: nodeId });
            if (pkNode) View.reveal(pkNode.x, pkNode.y);
            return;
        }

        var row = e.target.closest('tr[data-seg]');
        if (row) {
            var p = App.project;
            var id = Number(row.dataset.seg);
            var seg = Model.seg(p, id);
            App.select({ type: 'seg', id: id });
            if (seg) {
                var A = Model.node(p, seg.a), B = Model.node(p, seg.b);
                View.reveal((A.x + B.x) / 2, (A.y + B.y) / 2);
            }
            return;
        }

        var group = e.target.closest('tr[data-group-seg]');
        if (group) Tools.selectBranchBySeg(Number(group.dataset.groupSeg));
    }

    function action(name) {
        var p = App.project;
        var sel = App.selection;

        if (name === 'riser-open') {
            App.activate(App.plan.sys);
            return;
        }

        switch (name) {
            case 'corridor-draw': Tools.set('corridor'); Tools.corridorSetPhase('axis'); break;
            case 'corridor-doors': Tools.set('corridor'); Tools.corridorSetPhase('doors'); break;
            case 'corridor-place': Tools.corridorPlace(); break;
            case 'corridor-clear': Tools.corridorClear(); break;
            case 'mirror': Tools.mirror(); break;
            case 'rotate': Tools.rotate(180); break;
            case 'copy': Tools.copy(); break;
            case 'move': Tools.move(); break;
            case 'array': Tools.array(arr); break;
            case 'delete-branch': Tools.removeBranch(); break;
            case 'select-branch': {
                var br = Tools.selectedBranch();
                if (br) Tools.selectBranchBySeg(br.segs[0]);
                break;
            }
            case 'delete-node':
                if (sel && sel.type === 'node') {
                    Tools.eraseNode(sel.id);
                    App.selection = null;
                    App.afterEdit('удаление узла');
                }
                break;
            case 'delete-seg':
                if (sel && sel.type === 'seg') {
                    Tools.eraseSeg(sel.id);
                    App.selection = null;
                    App.afterEdit('удаление участка');
                }
                break;
            case 'set-source':
                if (sel && sel.type === 'node') {
                    p.nodes.forEach(function (n) { n.src = n.id === sel.id; });
                    App.afterEdit('ввод');
                }
                break;
            case 'copy-tsv': Report.copy(App); break;
            case 'xlsx': Report.saveXlsx(App); break;
            case 'print': Report.print(App); break;
            case 'png': View.savePng(p.name); break;
            case 'labels-reset':
                p.nodes.forEach(function (n) { n.label = ''; });
                App.afterEdit('сброс подписей');
                break;
            case 'zone-clear':
                p.zone = null;
                App.afterEdit('удаление зоны');
                break;
            case 'tool-zone': Tools.set('zone'); break;
            case 'open-binding':
                tab = 'binding';
                try { localStorage.setItem('sprinkler-web:tab', tab); } catch (err) { /* без памяти вкладки */ }
                renderTabs();
                renderTab();
                break;
            case 'pk-add':
                if (sel && sel.type === 'node') {
                    Model.node(p, sel.id).pk = { jets: null, flow: null, head: null, elev: null, name: '', use: null };
                    App.afterEdit('пожарный кран');
                }
                break;
            case 'pk-remove':
                if (sel && sel.type === 'node') {
                    Model.node(p, sel.id).pk = null;
                    App.afterEdit('снят пожарный кран');
                }
                break;
            case 'k-reset': {
                var item = Sprinklers.find(p.settings.maker, p.settings.sprinklerType);
                if (item) {
                    p.settings.k = item.k;
                    App.afterEdit('паспортный k');
                }
                break;
            }
        }
    }

    /* --- свойства выбранного ------------------------------------------------ */

    function row(name, value) {
        return '<div class="row"><span>' + esc(name) + '</span><span>' + value + '</span></div>';
    }

    function hydrantFields(n, p, net) {
        var s = p.settings;
        var info = net.N[n.id];
        // На плане внутреннего пожаротушения струи крану раздал расчёт.
        var byPlan = s.planKind === 'vpv';
        var given = byPlan ? (info ? info.pkJets : 0) : undefined;
        var h = Model.hydrant(p, n, given);
        var id = n.id;

        /*
            Расчётные краны можно назначать руками: «авто» оставляет выбор
            расчёту, «в расчёте» ставит кран в расчётный случай, «не в расчёте»
            убирает его совсем. Назначенные струи идут в счёт расчётных.
        */
        var useField = byPlan
            ? selectField('В расчётном случае', 'pk:' + id + ':use',
                n.pk.use === true ? 'on' : n.pk.use === false ? 'off' : 'auto',
                [['auto', 'авто — выбирает расчёт'], ['on', 'в расчёте'], ['off', 'не в расчёте']])
            : '';

        var html = '<div class="array"><div class="array-title">' + esc(Model.hydrantName(p, n)) + '</div>'
            + textField('Обозначение (пусто — по порядку)', 'pk:' + id + ':name', n.pk.name)
            + useField
            + '<div class="pair">' + numField(byPlan ? 'Число струй (пусто — раздаёт расчёт)' : 'Число струй',
                'pk:' + id + ':jets', n.pk.jets, '', byPlan ? String(given || 0) : String(s.pkJets))
            + numField('Расход струи', 'pk:' + id + ':flow', n.pk.flow, 'л/с', Fmt.trim(s.pkFlow, 2)) + '</div>'
            + '<div class="pair">' + numField('Давление у клапана', 'pk:' + id + ':head', n.pk.head, 'м', Fmt.trim(s.pkHead, 2))
            + numField('Отметка клапана', 'pk:' + id + ':elev', n.pk.elev, 'м', Fmt.trim(h.elev, 2)) + '</div>'
            + '<div class="inspector">' + (byPlan && !(h.jets > 0)
                ? row('Расход крана', n.pk.use === false
                    ? 'исключён из расчётного случая — идёт в объём сети'
                    : 'в расчётном случае закрыт — идёт в объём сети')
                : row('Расход крана', h.jets + ' × ' + Fmt.trim(h.flow, 2) + ' = <b>' + n2(h.Q) + '</b> л/с'
                    + (byPlan && (n.pk.use === true || n.pk.jets > 0) ? ' <span class="badge">назначен</span>' : '')));

        if (net.ok && info && info.reach && !(byPlan && !(h.jets > 0))) {
            var valve = info.H + (Model.planeElev(s) - h.elev);
            html += row('Давление у клапана', '<span class="' + (valve < h.head - 1e-6 ? 'bad' : '') + '">' + n2(valve)
                + '</span> м, нужно ' + n2(h.head));
            if (net.dict === n.id) html += row('Диктующая точка', '<b class="bad">да</b>');
        }

        return html + '</div><button data-action="pk-remove" class="danger">Убрать пожарный кран</button></div>';
    }

    function branchActions() {
        return '<h4>Луч</h4><div class="actions">'
            + '<button data-action="mirror">Отразить через магистраль <kbd>F</kbd></button>'
            + '<button data-action="rotate">Повернуть на 180°</button>'
            + '<button data-action="copy">Копия-аналог по щелчку <kbd>C</kbd></button>'
            + '<button data-action="move">Перенести <kbd>G</kbd></button>'
            + '<button data-action="delete-branch" class="danger">Удалить луч</button>'
            + '</div>'
            + '<div class="array"><div class="array-title">Размножить вдоль магистрали</div>'
            + '<div class="pair">' + numField('копий', 'arr:count', arr.count) + numField('шаг', 'arr:step', arr.step, 'м') + '</div>'
            + selectField('направление', 'arr:dir', arr.dir, [['1', 'по направлению магистрали'], ['-1', 'в обратную сторону']])
            + checkField('через одну на другую сторону', 'arr:alternate', arr.alternate)
            + '<button data-action="array">Размножить</button></div>';
    }

    function groupOfSeg(segId) {
        var calc = App.calc;
        if (!calc || !calc.ok) return null;
        for (var i = 0; i < calc.rows.length; i++) {
            if (calc.rows[i].type === 'seg' && calc.rows[i].segId === segId) return calc.rows[i].group;
        }
        return null;
    }

    function renderInspector() {
        var p = App.project;
        var net = App.net;
        var calc = App.calc;
        var sel = App.selection;
        var html = '';
        // На плане внутреннего пожаротушения счёт идёт по кранам.
        var byPlanSel = p.settings.planKind === 'vpv';

        if (!sel) {
            var spr = p.nodes.filter(function (n) { return n.spr; }).length;
            var working = calc && calc.ok ? calc.checks.working : 0;
            html = '<p class="hint">Ничего не выбрано. Щёлкните по узлу или трубе; двойной щелчок по лучу выделяет его целиком.</p>'
                + (byPlanSel
                    ? row('Пожарных кранов на плане', String(p.nodes.filter(function (n) { return n.pk; }).length))
                    : row('Оросителей на плане', String(spr)) + row('Работают в расчёте', String(working)))
                + row('Участков', String(p.segments.length))
                + (Model.hasZone(p)
                    ? row('Расчётная зона', Fmt.num(Model.polygonArea(p.zone), 1) + ' м²') + '<div class="actions"><button data-action="zone-clear">Удалить зону</button></div>'
                    // Зона отбирает работающие оросители — на плане кранов она не нужна.
                    : byPlanSel ? '' : '<div class="actions"><button data-action="tool-zone">Обвести расчётную зону</button></div>');
            rerender($('inspector'), html);
            return;
        }

        if (sel.type === 'node') {
            var n = Model.node(p, sel.id);
            var info = net.N[n.id];
            var labels = calc && calc.ok ? calc.nodeLabels[n.id] : null;

            html += '<h4>' + (n.src ? 'Ввод' : n.spr ? 'Ороситель' : n.pk ? 'Пожарный кран' : 'Узел') + (labels ? ' ' + esc(labels.join(' / ')) : '') + '</h4>';

            if (info && info.reach && net.ok) {
                html += row('Напор H', n2(info.H) + ' м');
                if (info.working) html += row('Расход оросителя q', n2(info.qOwn) + ' л/с');
                if (info.Qsub > 0 && !info.working) html += row('Расход через узел', n2(info.Qsub) + ' л/с');
                if (net.dict === n.id) html += row('Диктующий', '<b class="bad">да</b>');
            } else if (info && !info.reach) {
                html += '<p class="note">Узел не соединён с вводом.</p>';
            }

            html += textField('Своя подпись (пусто — по нумерации)', 'node:' + n.id + ':label', n.label);
            // На плане внутреннего пожаротушения оросителей не бывает.
            if (!byPlanSel || n.spr) html += checkField('Ороситель', 'node:' + n.id + ':spr', n.spr);

            if (n.spr) {
                html += '<label class="field"><span>Марка этого оросителя</span>' + nodeModelSelect(n, p.settings) + '</label>';
                html += checkField('Закрыт — не работает в расчёте', 'node:' + n.id + ':off', n.off);
                html += numField('k этого оросителя (пусто — из исходных)', 'node:' + n.id + ':k', n.k, '', Fmt.trim(p.settings.k, 3));
                html += numField('Диаметр зоны орошения (пусто — из исходных)', 'node:' + n.id + ':cover',
                    n.cover > 0 ? n.cover : null, 'м', Fmt.trim(p.settings.coverDia, 2));
                html += checkField('Назначить диктующим вручную', 'node:' + n.id + ':dict', n.dict);
            }

            html += n.pk
                ? hydrantFields(n, p, net)
                : '<div class="actions"><button data-action="pk-add">Поставить сюда пожарный кран <kbd>K</kbd></button></div>';
            html += numField('Другой постоянный расход (завеса и т.п.)', 'node:' + n.id + ':q', n.q > 0 ? n.q : null, 'л/с');
            html += checkField('Узел управления', 'node:' + n.id + ':cu', n.cu);

            html += '<div class="actions">'
                + (n.src ? '' : '<button data-action="set-source">Сделать вводом</button>')
                + '<button data-action="delete-node" class="danger">Удалить узел <kbd>Del</kbd></button></div>';

            if (Model.branchOfNode(p, n.id)) {
                html += '<div class="actions"><button data-action="select-branch">Выделить весь луч</button></div>' + branchActions();
            }
        }

        if (sel.type === 'seg') {
            var s = Model.seg(p, sel.id);
            var si = net.S[s.id];
            var name = calc && calc.ok ? calc.segNames[s.id] : null;

            html += '<h4>' + (s.role === 'main' ? 'Магистраль' : 'Луч') + (name ? ' · участок ' + esc(name) : '') + '</h4>';
            html += row('Длина по плану', n2(Model.geomLength(p, s)) + ' м');

            if (si && si.active) {
                html += row('Расход Q', n2(si.Q) + ' л/с');
                html += row('Скорость V', '<span class="' + (si.V > Solver.MAX_VELOCITY ? 'bad' : '') + '">' + n2(si.V) + ' м/с</span>');
                html += row('Потери ΔH', Fmt.num(si.dH, 3) + ' м');
            }
            if (si) {
                html += row('Kт', Fmt.kt(si.kt) + (si.ktSource === 'formula' ? ' <span class="dim">по формуле</span>' : si.ktSource === 'manual' ? ' <span class="dim">вручную</span>' : ''));
            }

            html += selectField('Роль', 'seg:' + s.id + ':role', s.role, [['main', 'магистраль (питающий)'], ['ray', 'луч']]);
            html += '<label class="field"><span>Материал</span>' + materialSelect('seg:' + s.id + ':material', s.material) + '</label>';
            html += '<label class="field"><span>Размер</span>' + sizeSelect('seg:' + s.id + ':size', s.material, s.od, s.wall, false) + '</label>';
            html += numField('Длина для расчёта (пусто — по плану)', 'seg:' + s.id + ':len', s.len, 'м', Fmt.num(Model.geomLength(p, s), 2));
            html += numField('Kт вручную (пусто — из таблицы)', 'seg:' + s.id + ':kt', s.kt, '', si ? Fmt.kt(si.kt) : '');
            html += checkField('Полукольцо: 50 % расхода (СП Б.1.2.16.1)', 'seg:' + s.id + ':ring', s.ring);
            html += '<div class="actions"><button data-action="delete-seg" class="danger">Удалить участок <kbd>Del</kbd></button></div>';

            if (s.role !== 'main') {
                html += '<div class="actions"><button data-action="select-branch">Выделить весь луч</button></div>' + branchActions();
            }
        }

        if (sel.type === 'branch' && sel.branch) {
            var br = sel.branch;
            var first = Model.seg(p, br.segs[0]);
            var g = groupOfSeg(br.segs[0]);
            var total = 0;
            br.segs.forEach(function (id) { total += Model.length(p, Model.seg(p, id)); });
            var sprinklers = br.nodes.filter(function (id) { return Model.node(p, id).spr; }).length;

            html += '<h4>Луч' + (g && g.kind === 'branch' ? ' ' + esc(g.name) : '') + '</h4>';
            html += row('Оросителей', String(sprinklers));
            html += row('Участков', String(br.segs.length));
            html += row('Длина', n2(total) + ' м');
            if (g && g.analogOf) html += row('Аналог луча', esc(g.analogOf.name));

            html += '<label class="field"><span>Материал всего луча</span>' + materialSelect('branch:material', first.material) + '</label>';
            html += '<label class="field"><span>Размер всего луча</span>' + sizeSelect('branch:size', first.material, first.od, first.wall, false) + '</label>';
            html += numField('Диаметр зоны орошения всем оросителям луча (пусто — из исходных)', 'branchnode:cover',
                null, 'м', Fmt.trim(p.settings.coverDia, 2));
            html += branchActions();
        }

        html = '<div class="actions"><button data-action="open-binding">Привязка: размеры и сдвиг →</button></div>' + html;
        rerender($('inspector'), html);
    }

    /* --- вкладка «Привязка» --------------------------------------------------- */

    function nodeName(id) {
        var p = App.project;
        var n = Model.node(p, id);
        if (!n) return 'узел';

        var labels = App.calc && App.calc.ok ? App.calc.nodeLabels[id] : null;
        var kind = n.src ? 'ввод' : n.pk ? Model.hydrantName(p, n) : n.cu ? 'УУ' : n.spr ? 'ороситель' : 'узел';
        var own = (labels || []).filter(function (l) { return l !== kind; });
        return own.length ? kind + ' ' + own.join(' / ') : kind;
    }

    function lengthInput(segId, movingId) {
        var L = Model.geomLength(App.project, Model.seg(App.project, segId));
        return '<input class="cell bind" data-key="bind:len:' + segId + ':' + movingId + '" value="' + esc(Fmt.trim(L, 3)) + '">';
    }

    function bindNode(id) {
        var p = App.project;
        var n = Model.node(p, id);
        var dep = Binding.depths(p);
        var tail = p.settings.bindTail;
        var axis = Binding.axisOf(p, id);

        var rows = Model.segmentsAt(p, id).map(function (s) {
            var o = Model.other(s, id);
            var chain = tail && dep[o] < dep[id];
            return '<tr><td>' + esc(nodeName(o)) + (s.role === 'main' ? ' <span class="dim">по магистрали</span>' : '')
                + '</td><td>' + lengthInput(s.id, id) + '</td><td class="dim">'
                + (chain ? 'сдвинется с дальними' : 'сдвинется только он') + '</td></tr>';
        }).join('');

        var html = '<h4 class="bind-title">' + esc(nodeName(id)) + '</h4>';

        if (rows) {
            html += '<table class="grid bind-table"><thead><tr><th>Расстояние до</th><th>м</th><th></th></tr></thead><tbody>'
                + rows + '</tbody></table>';
        }

        html += '<div class="pair">'
            + numField('Сдвинуть вдоль трубы' + (axis.from !== null ? ' (+ дальше от ' + nodeName(axis.from) + ')' : ' (+ вправо)'), 'bind:shiftU:' + id, null, 'м')
            + numField('Сдвинуть поперёк трубы', 'bind:shiftV:' + id, null, 'м') + '</div>'
            + '<div class="pair">' + numField('X', 'bind:x:' + id, Math.round(n.x * 1000) / 1000, 'м')
            + numField('Y', 'bind:y:' + id, Math.round(n.y * 1000) / 1000, 'м') + '</div>';

        return section('Узел', html);
    }

    function bindBranch(br) {
        if (!br || br.attach === null) return '';

        var p = App.project;
        var first = br.segs[0];
        var order = Binding.rayOrder(p, br);
        var axis = Binding.mainAxis(p, br.attach);

        var rows = order.map(function (o, i) {
            return '<tr><td>' + (i === 0 ? 'от магистрали до ' : '') + esc(nodeName(i === 0 ? o.outer : o.inner))
                + (i === 0 ? '' : ' → ' + esc(nodeName(o.outer))) + '</td><td>' + lengthInput(o.segId, o.outer) + '</td></tr>';
        }).join('');

        var mains = Model.segmentsAt(p, br.attach).filter(function (s) { return s.role === 'main'; }).map(function (s) {
            return '<tr><td>до ' + esc(nodeName(Model.other(s, br.attach))) + '</td><td>' + lengthInput(s.id, br.attach) + '</td></tr>';
        }).join('');

        var html = '';

        if (mains) {
            html += '<table class="grid bind-table"><thead><tr><th>Положение на магистрали — расстояние</th><th>м</th></tr></thead><tbody>'
                + mains + '</tbody></table>';
        }

        html += '<table class="grid bind-table"><thead><tr><th>Участки луча по порядку</th><th>м</th></tr></thead><tbody>'
            + rows + '</tbody></table>'
            + numField('Задать шаг всем оросителям луча (кроме участка от магистрали)', 'bind:raystep:' + first, null, 'м', Fmt.trim(p.settings.spacing, 2))
            + '<div class="pair">'
            + numField('Сдвинуть луч вдоль магистрали' + (axis ? ' (+ к ' + nodeName(axis.towards) + ')' : ''), 'bind:brMain:' + first, null, 'м')
            + numField('Сдвинуть луч вдоль себя (+ от магистрали)', 'bind:brRay:' + first, null, 'м') + '</div>';

        return section('Луч', html);
    }

    function renderBinding() {
        var p = App.project;
        var s = p.settings;
        var sel = App.selection;

        var html = section('Как двигать',
            checkField('Цепочкой: дальние оросители и лучи сдвигаются вместе, их размеры сохраняются', 'set:bindTail', s.bindTail)
            + '<div class="pair">' + numField('Шаг при перетаскивании', 'set:snapStep', s.snapStep, 'м')
            + '<div>' + checkField('Размерные цепочки вдоль магистрали', 'set:labels.dims', s.labels.dims) + '</div></div>'
            + '<p class="hint">На плане по любому размеру и длине участка можно щёлкнуть и вписать новое значение. '
            + 'Ороситель перетаскивается вдоль или поперёк своей трубы, луч за трубу — вдоль магистрали или вдоль себя. '
            + '<kbd>Alt</kbd> — свободно, <kbd>Ctrl</kbd> — переключить цепочку, <kbd>Alt</kbd> на луче — перенос через узлы магистрали.</p>');

        if (!sel) {
            return html + '<div class="empty">Выберите на плане ороситель, узел, участок или луч — здесь появятся его размеры.</div>';
        }

        if (sel.type === 'node') {
            html += bindNode(sel.id);
            html += bindBranch(Model.branchOfNode(p, sel.id));
        } else if (sel.type === 'seg') {
            var seg = Model.seg(p, sel.id);
            var dep = Binding.depths(p);
            var far = dep[seg.a] > dep[seg.b] ? seg.a : seg.b;
            html += section('Участок ' + (App.calc && App.calc.segNames[seg.id] ? App.calc.segNames[seg.id] : ''),
                '<table class="grid bind-table"><tbody><tr><td>Длина по плану — двигается ' + esc(nodeName(far))
                + '</td><td>' + lengthInput(seg.id, far) + '</td></tr></tbody></table>'
                + (seg.len > 0 ? '<p class="note-warn">Для расчёта введена своя длина ' + Fmt.trim(seg.len, 3)
                    + ' м — после привязки будет использоваться длина по плану.</p>' : ''));
            if (seg.role !== 'main') html += bindBranch(Model.branchOf(p, seg.id));
        } else if (sel.type === 'branch') {
            html += bindBranch(sel.branch);
        }

        return html;
    }

    function applyBinding(parts, value) {
        var p = App.project;
        var s = p.settings;
        var v = Fmt.parse(value);
        var id = Number(parts[2]);
        var res = null;

        if (v === null) return;

        switch (parts[1]) {
            case 'len':
                res = Binding.moveEnd(p, id, Number(parts[3]), v, s.bindTail);
                break;
            case 'shiftU':
            case 'shiftV': {
                var axis = Binding.axisOf(p, id);
                var dir = parts[1] === 'shiftU' ? axis.u : axis.v;
                res = Binding.shift(p, id, dir.x * v, dir.y * v, s.bindTail && parts[1] === 'shiftU');
                break;
            }
            case 'x':
            case 'y': {
                var n = Model.node(p, id);
                res = Binding.shift(p, id, parts[1] === 'x' ? v - n.x : 0, parts[1] === 'y' ? v - n.y : 0, false);
                break;
            }
            case 'raystep':
                res = Binding.setRayStep(p, Model.branchOf(p, id), v);
                break;
            case 'brMain':
            case 'brRay':
                res = Binding.moveBranchAlong(p, Model.branchOf(p, id), parts[1] === 'brMain' ? 'main' : 'ray', v);
                break;
        }

        if (res && res.error) {
            App.status(res.error, 'warn');
            App.refresh();
            return;
        }

        App.afterEdit('привязка');
    }

    /* --- вкладка «Исходные данные» ------------------------------------------ */

    function checksHtml() {
        var calc = App.calc;
        var s = App.project.settings;
        var qi = s.intensity * s.spacing * s.spacing;
        var q = s.k * Math.sqrt(s.dictHead);
        var f = q > 0 ? qi / q : 0;

        // На плане внутреннего пожаротушения проверять нечего по оросителям:
        // расход даёт кран, а сверять его не с чем — он и есть норматив.
        if (s.planKind === 'vpv') return pkChecksHtml();

        var html = '<div class="cards">'
            + card('qi = I·L²', Fmt.num(qi, 3) + ' л/с', Fmt.trim(s.intensity, 3) + ' · ' + Fmt.trim(s.spacing, 2) + '²')
            + card('q = k·√H', Fmt.num(q, 3) + ' л/с', Fmt.trim(s.k, 3) + ' · √' + Fmt.trim(s.dictHead, 2))
            + card('f = qi / q', Fmt.num(f, 3), f <= 0.85 ? 'не более 0,85 — да' : 'больше 0,85!', f <= 0.85 ? 'ok' : 'bad')
            + card('Норм. расход I·S', Fmt.num(s.intensity * s.area, 2) + ' л/с', Fmt.trim(s.intensity, 3) + ' · ' + Fmt.trim(s.area, 1));

        if (calc && calc.ok) {
            var c = calc.checks;
            html += card('Работают оросителей', String(c.working), c.zoneArea > 0 ? 'зона ' + Fmt.num(c.zoneArea, 1) + ' м²' : 'зона не задана — работают все');
            html += card('Расчётный расход', Fmt.num(App.net.Qtotal, 2) + ' л/с',
                App.net.Qtotal >= s.intensity * s.area ? 'не меньше нормативного' : 'меньше нормативного!',
                App.net.Qtotal >= s.intensity * s.area ? 'ok' : 'bad');
        }

        return html + '</div>';
    }

    /** Карточки плана внутреннего пожаротушения: краны, расход, диктующий. */
    function pkChecksHtml() {
        var p = App.project;
        var s = p.settings;
        var calc = App.calc;
        var table = Model.pkTable(s);
        var flow = s.pkFlow > 0 ? s.pkFlow : table.q;
        var pk = p.nodes.filter(function (n) { return n.pk; }).length;

        var working = calc && calc.ok
            ? calc.hydrants.filter(function (k) { return k.working; }).length : 0;

        var html = '<div class="cards">'
            + card('Пожарных кранов', String(pk), pk
                ? (calc && calc.ok ? 'в расчётном случае работают ' + working : 'на плане')
                : 'поставьте краны инструментом K')
            + card('Расчётные струи', Fmt.num(s.pkJets * flow, 2) + ' л/с',
                Fmt.trim(s.pkJets, 0) + ' × ' + Fmt.trim(flow, 2) + ' л/с');

        if (calc && calc.ok) {
            html += card('Расчётный расход', Fmt.num(App.net.Qtotal, 2) + ' л/с',
                'у самых невыгодных кранов');
            html += card('Диктующий', calc.head.dictName || '—',
                calc.head.dictKind === 'pk' ? 'давление у клапана ' + Fmt.num(calc.head.pkHead, 2) + ' м' : '');
        }

        return html + '</div>';
    }

    function card(title, value, note, cls) {
        return '<div class="card ' + (cls || '') + '"><div class="card-title">' + esc(title) + '</div><div class="card-value">'
            + esc(value) + '</div><div class="card-note">' + esc(note || '') + '</div></div>';
    }

    /* --- оросители из справочника --------------------------------------------- */

    var OTHER_MAKER = 'Другой';

    /** Марки производителя по группам назначения; в подписи k и положение. */
    function modelSelect(key, makerName, model) {
        var maker = Sprinklers.maker(makerName);
        var html = '<select data-key="' + key + '">';
        var found = false;

        Sprinklers.groupsOf(maker).forEach(function (g) {
            html += '<optgroup label="' + esc(g.name) + '">';
            g.items.forEach(function (it) {
                var on = it.model === model;
                if (on) found = true;
                html += '<option value="' + esc(it.model) + '"' + (on ? ' selected' : '') + '>' + esc(Sprinklers.label(it)) + '</option>';
            });
            html += '</optgroup>';
        });

        if (!found) {
            html += '<option value="' + esc(model) + '" selected>' + esc((model || '—') + ' — нет в справочнике') + '</option>';
        }

        return html + '</select>';
    }

    function sprinklerFields(s) {
        var known = Sprinklers.maker(s.maker);
        var makers = Sprinklers.MAKERS.map(function (m) { return [m.name, m.name]; });

        if (!known && s.maker && s.maker !== OTHER_MAKER) makers.push([s.maker, s.maker + ' — из проекта']);
        makers.push([OTHER_MAKER, 'Другой — марка и k вручную']);

        var html = '<div class="pair">' + selectField('Производитель', 'set:maker', known || s.maker ? s.maker : OTHER_MAKER, makers);
        html += known
            ? '<label class="field"><span>Марка оросителя</span>' + modelSelect('set:sprinklerType', s.maker, s.sprinklerType) + '</label>'
            : textField('Марка оросителя', 'set:sprinklerType', s.sprinklerType);
        html += '</div>';

        var item = Sprinklers.find(s.maker, s.sprinklerType);
        if (item) {
            html += '<p class="hint">' + esc(Sprinklers.describe(item)) + '</p>';
            if (Math.abs(item.k - s.k) > 1e-9) {
                html += '<p class="note-warn">k = ' + Fmt.trim(s.k, 3) + ' отличается от паспортного ' + Fmt.trim(item.k, 3)
                    + ' <button class="mini" data-action="k-reset">вернуть паспортный</button></p>';
            }
        }

        return html;
    }

    /** Марка отдельного оросителя: пусто — как в исходных данных. */
    function nodeModelSelect(n, s) {
        var html = '<select data-key="node:' + n.id + ':model"><option value="">как в исходных данных — '
            + esc(s.sprinklerType) + ', k ' + esc(Fmt.trim(s.k, 3)) + '</option>';
        var found = !n.model;

        Sprinklers.MAKERS.forEach(function (m) {
            html += '<optgroup label="' + esc(m.name) + '">';
            m.items.forEach(function (it) {
                var value = m.name + '|' + it.model;
                var on = n.model === value;
                if (on) found = true;
                html += '<option value="' + esc(value) + '"' + (on ? ' selected' : '') + '>' + esc(Sprinklers.label(it)) + '</option>';
            });
            html += '</optgroup>';
        });

        if (!found) html += '<option value="' + esc(n.model) + '" selected>' + esc(n.model.replace('|', ' ') + ' — нет в справочнике') + '</option>';
        return html + '</select>';
    }

    function renderInputs() {
        var s = App.project.settings;
        var groups = Catalog.GROUPS.map(function (g) { return [g.key, g.name]; });
        var kinds = Catalog.cuKinds().map(function (k) { return [k, k]; });
        var sizes = Catalog.cuSizes(s.cuKind).map(function (d) { return [String(d), 'Ду' + d]; });

        // В плане этажа отметки, узел управления и насосная берутся со схемы стояка.
        var planNote = App.plan
            ? '<p class="note-warn">Это план этажа: «Ввод» на нём — врезка в стояк. Отметки оросителей и ввода, '
                + 'узел управления, насосная и гарантированный напор задаются на схеме стояка — здесь они в расчёт не идут. '
                + 'Тип установки (водо- или воздухозаполненная) тоже ставится на стояке — сразу всем планам. '
                + 'Сквозной расчёт до ввода — на вкладке «Стояк».</p>'
            : '';

        var html = planNote + checksHtml() + '<div class="form">';

        var air = s.systemKind === 'воздухозаполненная';
        var byPlan = s.planKind === 'vpv';      // внутреннее пожаротушение по плану
        var system = selectField('Тип системы (СП 485 п. 6.2.1 / СП 10 гл. 8)', 'set:systemKind', s.systemKind,
            [['водозаполненная', 'водозаполненная'], ['воздухозаполненная', 'воздухозаполненная']]);

        /*
            Внутреннее пожаротушение по плану: оросителей нет, расчётные точки
            — пожарные краны. Разделы про ороситель и группу помещений здесь
            только мешают, зато нужен объём сети: воздушная система подаёт
            воду в диктующий кран не дольше 30 с (п. 8.4 СП 10.13130).
        */
        if (byPlan) {
            if (air && App.calc && App.calc.air && App.calc.air.on) {
                var a = App.calc.air;
                system += '<div class="inspector">'
                    + row('Объём незаполненных водой трубопроводов', Fmt.num(a.volume * 1000, 0) + ' л'
                        + (a.volume > 1 ? ' <span class="bad">— больше 1 м³</span>' : ''))
                    + row('Вода в диктующий ПК придёт за', a.fill > 0
                        ? Fmt.num(a.fill, 0) + ' с' + (a.fill > 30 ? ' <span class="bad">— больше 30 с</span>' : '')
                        : '—')
                    + '</div>';
            }
            system += '<p class="hint">Это план внутреннего пожаротушения: расчёт ведётся по пожарным кранам, '
                + 'оросители в работу не идут. У воздушной системы объём незаполненных водой трубопроводов — '
                + 'не больше 1 м³, вода в диктующий кран — не дольше 30 с (п. 8.4 СП 10.13130.2020).</p>';

            html += section('Система', system);
            html += pkSection(s, true);
            // Своя геометрия: расчёт приведён к отметке клапана ПК, не к оросителям.
            html += section('Отметки',
                '<div class="pair">' + numField('Отметка клапана ПК', 'set:pkElev', Model.planeElev(s), 'м')
                + numField('Глубина заложения ввода относительно 0,000', 'set:inletElev', s.inletElev, 'м') + '</div>'
                + '<p class="hint">К этой отметке приведён весь расчёт: от неё считается Нгеом, и к ней приводятся '
                + 'краны, у которых в «Выбранном» задана своя отметка клапана.</p>');
            html += section('Напоры',
                '<div class="pair">' + numField('Гарантированный напор на вводе', 'set:guaranteed', s.guaranteed, 'м')
                + numField('Потери в насосной установке', 'set:pumpLoss', s.pumpLoss, 'м') + '</div>'
                + '<div class="pair">' + numField('Потери во всасывающих трубопроводах', 'set:suction', s.suction, 'м')
                + numField('Коэффициент местных сопротивлений', 'set:localFactor', s.localFactor, '') + '</div>');
            html += section('Трубы для новых участков',
                pipeFields('Магистраль', 'set:pipeMain', s.pipeMain) + pipeFields('Подводки к ПК', 'set:pipeRay', s.pipeRay));
            html += hydrSection(s);
            html += documentSection(s);
            return html + '</div>';
        }

        if (air) {
            system += checkField('Температура в помещении ниже 5 °C — оросители только вверх или горизонтально (п. 6.2.19)', 'set:coldRoom', s.coldRoom);
            if (App.calc && App.calc.air && App.calc.air.on) {
                system += '<div class="inspector">' + row('Объём воздухозаполненных трубопроводов',
                    Fmt.num(App.calc.air.volume * 1000, 0) + ' л' + (App.calc.air.hasCu ? '' : ' — вся сеть, УУ не поставлен')) + '</div>';
            }
            system += '<p class="hint">Время от срабатывания диктующего оросителя до подачи воды — не более 180 с (п. 6.2.4). '
                + 'Узел управления — воздушный; краны на воздухозаполненной части — с учётом СП 10.13130 (п. 6.7.1.45).</p>';
        }

        html += section('Система', system);

        html += section('Помещение — СП 485, табл. 6.1',
            selectField('Группа помещений', 'set:group', s.group, groups)
            + '<div class="pair">' + numField('Интенсивность орошения', 'set:intensity', s.intensity, 'л/(с·м²)')
            + numField('Площадь для расчёта расхода', 'set:area', s.area, 'м²') + '</div>'
            + '<div class="pair">' + numField('Продолжительность подачи', 'set:minutes', s.minutes, 'мин')
            + numField('Макс. расстояние между оросителями', 'set:maxSpacing', s.maxSpacing, 'м') + '</div>');

        html += section('Ороситель',
            sprinklerFields(s)
            + '<div class="pair">' + numField('Давление на диктующем оросителе', 'set:dictHead', s.dictHead, 'м вод. ст.')
            + numField('Коэф. производительности k', 'set:k', s.k, 'л/(с·МПа^0,5)') + '</div>'
            + '<div class="pair">' + numField('Шаг между оросителями', 'set:spacing', s.spacing, 'м')
            + numField('Диаметр зоны орошения на плане', 'set:coverDia', s.coverDia, 'м') + '</div>'
            + checkField('Показывать круги зон орошения на плане', 'set:labels.circles', s.labels.circles)
            + '<p class="hint">Тот же выключатель — слоем «круги орошения» на вкладке «Нумерация и подписи». '
            + 'У отдельного оросителя диаметр можно задать свой в «Выбранном», а всему лучу сразу — в свойствах выделенного луча.</p>');

        html += section('Отметки',
            '<div class="pair">' + numField('Отметка установки спринклерного оросителя', 'set:sprinklerElev', s.sprinklerElev, 'м')
            + numField('Глубина заложения ввода относительно 0,000', 'set:inletElev', s.inletElev, 'м') + '</div>');

        html += section('Узел управления (Спецавтоматика)',
            '<div class="pair">' + selectField('Тип', 'set:cuKind', s.cuKind, kinds) + selectField('Диаметр', 'set:cuDn', String(s.cuDn), sizes) + '</div>'
            + numField('ξ узла (пусто — по таблице)', 'set:cuXi', s.cuXi, '', Fmt.sci(Catalog.cuXi(s.cuKind, s.cuDn)).replace('·10', 'e')));

        html += section('Напоры',
            '<div class="pair">' + numField('Гарантированный напор на вводе', 'set:guaranteed', s.guaranteed, 'м')
            + numField('Потери в насосной установке', 'set:pumpLoss', s.pumpLoss, 'м') + '</div>'
            + '<div class="pair">' + numField('Потери во всасывающих трубопроводах', 'set:suction', s.suction, 'м')
            + numField('Коэффициент местных сопротивлений', 'set:localFactor', s.localFactor, '') + '</div>');

        html += pkSection(s, false);

        html += section('Трубы для новых участков',
            pipeFields('Магистраль', 'set:pipeMain', s.pipeMain) + pipeFields('Лучи', 'set:pipeRay', s.pipeRay));

        html += documentSection(s);

        return html + '</div>';
    }

    /*
        Гидравлика плана внутреннего пожаротушения: потери по Дарси–Вейсбаху,
        как у ВПВ по стоякам. Трубы не новые, поэтому расчётный диаметр меньше
        внутреннего на запас под отложения, и по нему же идут V и Re.
    */
    function hydrSection(s) {
        var h = s.hydr || {};
        var list = Object.keys(Vpv.FORMULAS).map(function (k) { return [k, Vpv.FORMULAS[k]]; });

        return section('Гидравлика — потери по длине',
            '<div class="pair">' + selectField('Коэффициент трения λ по формуле', 'set:hydr.formula', h.formula, list)
            + numField('Запас к диаметру на отложения', 'set:hydr.reserve', h.reserve, 'мм') + '</div>'
            + numField('Кинематическая вязкость ν · 10⁻⁶', 'set:hydr.nu', h.nu, 'м²/с')
            + '<p class="hint">Потери считаются по Дарси–Вейсбаху: h = λ · L/dр · V²/(2g), dр = d − запас. '
            + 'Kт (методика АУП по СП 485, прил. Б) на плане кранов не используется: в таблице расчёта '
            + 'в его столбце стоит λ, а рядом — Re.</p>');
    }

    /** Раздел «Документ» — одинаковый у плана АПТ и у плана внутреннего ПТ. */
    function documentSection(s) {
        return section('Документ',
            textField('Шифр объекта', 'set:code', s.code)
            + appendixLine(App.plan ? 'plan:' + App.plan.sys + ':' + App.plan.plan : 'apt:' + App.book.active)
            + '<div class="pair">' + textField('Система', 'set:systemName', s.systemName)
            + textField('Объект («…пожаротушения …»)', 'set:objectText', s.objectText) + '</div>'
            + textField('Название таблицы', 'set:tableTitle', s.tableTitle)
            + textField('Насосная установка (марка, Q, H)', 'set:pumpText', s.pumpText)
            + '<p class="hint">Строка про насосную установку попадает в приложение только когда она нужна: '
            + 'при Ннас.треб = Нтр − Нгар ≤ 0 вместо неё печатается, что требуемый напор обеспечивает '
            + 'гарантированный напор наружной сети.</p>');
    }

    /*
        Пожарные краны. На плане АПТ это значения по умолчанию для кранов,
        попавших в спринклерную сеть; на плане внутреннего пожаротушения —
        главные исходные данные: по ним считается вся система.
    */
    function pkSection(s, byPlan) {
        var table = Model.pkTable(s);
        var head = byPlan ? 'Пожарный кран — СП 10.13130 табл. 7.3' : 'Пожарные краны ВПВ — значения по умолчанию';

        var body = '<div class="pair">'
            + selectField('DN клапана', 'set:pkDn', String(s.pkDn), [['50', 'DN 50'], ['65', 'DN 65']])
            + selectField('Спрыск ствола', 'set:pkNozzle', String(s.pkNozzle), [['13', '13 мм'], ['16', '16 мм'], ['19', '19 мм']])
            + '</div>'
            + '<div class="pair">'
            + selectField('Длина рукава', 'set:pkHose', String(s.pkHose), [['10', '10 м'], ['15', '15 м'], ['20', '20 м']])
            + selectField('Компактная струя', 'set:pkCompact', String(s.pkCompact),
                [6, 8, 10, 12, 14, 16, 18, 20].map(function (h) { return [String(h), h + ' м']; }))
            + '</div>'
            + '<p class="hint">' + (table.found
                ? 'По табл. 7.3: q = ' + Fmt.trim(table.q, 2) + ' л/с, P = ' + Fmt.trim(table.p / 100, 3)
                    + ' МПа (' + Fmt.trim(table.p, 2) + ' м).'
                : 'Такого сочетания в табл. 7.3 нет — впишите расход и давление вручную.') + '</p>'
            + '<div class="pair">' + numField(byPlan ? 'Число струй в расчёте (СП 10 табл. 7.1)' : 'Число струй',
                'set:pkJets', s.pkJets)
            + numField('Расход одной струи (пусто — по табл. 7.3)', 'set:pkFlow', s.pkFlow, 'л/с',
                table.found ? Fmt.trim(table.q, 2) : '') + '</div>'
            // На плане кранов отметка клапана живёт в разделе «Отметки».
            + '<div class="pair">' + numField('Давление у клапана ПК (пусто — по табл. 7.3)', 'set:pkHead', s.pkHead, 'м',
                table.found ? Fmt.trim(table.p, 2) : '')
            + (byPlan ? ''
                : numField('Отметка клапана (пусто — как у оросителей)', 'set:pkElev', s.pkElev, 'м',
                    Fmt.trim(s.sprinklerElev, 2))) + '</div>';

        body += byPlan
            ? '<p class="hint">Краны ставятся инструментом «Пожарный кран» <kbd>K</kbd> прямо на плане: щелчок по трубе — '
                + 'кран в сети, щелчок по пустому месту — отдельно, потом к нему ведётся подводка. '
                + 'Рисуйте систему целиком: расход берут только расчётные струи — их получают самые невыгодные краны, '
                + 'а остальные краны идут в объём сети. Выбор можно забрать себе: щёлкните по крану и поставьте ему '
                + '«в расчёте» или «не в расчёте» — назначенные краны расчёт не трогает, а остаток струй сам '
                + 'разложит по оставшимся. Компактная струя — по п. 7.15: 6 м до 50 м высоты.</p>'
            : '<p class="hint">Краны не прибавляются к расходу, а включаются в расчётную сеть (СП 485 п. Б.1.3.16); '
                + 'подводка — от трубы не меньше DN 65. Ставятся инструментом «Пожарный кран» <kbd>K</kbd>, '
                + 'у каждого можно задать свои значения.</p>';

        return section(head, body);
    }

    /* --- вкладка «Расчёт» ----------------------------------------------------- */

    function warningsHtml(list) {
        if (!list.length) return '';
        return '<ul class="warnings">' + list.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    }

    function renderCalc() {
        var p = App.project;
        var s = p.settings;
        var net = App.net;
        var calc = App.calc;

        // Приведение лучей — приём расчёта оросителей: на плане кранов выбора нет.
        var html = '<div class="calc-bar">'
            + (s.planKind === 'vpv' ? ''
                : '<label class="field inline">Таблица<select data-key="set:tableMode">'
                    + '<option value="sp"' + (s.tableMode !== 'actual' ? ' selected' : '') + '>как в СП: лучи от Hдикт с приведением</option>'
                    + '<option value="actual"' + (s.tableMode === 'actual' ? ' selected' : '') + '>фактические напоры</option></select></label>')
            + checkField('сворачивать аналоги', 'set:collapseAnalogs', s.collapseAnalogs)
            + '<div class="spacer"></div>'
            + '<button data-action="copy-tsv" title="Табуляция и запятые — вставляется в Excel числами">Копировать для Excel</button>'
            + '<button data-action="xlsx">Выгрузить .xlsx</button>'
            + '</div>';

        if (!net.ok) {
            return html + '<div class="empty"><b>' + esc(net.errors.join(' ')) + '</b><br><br>'
                + 'Порядок: «Ввод» — поставить ввод, «Магистраль» — провести питающий трубопровод, '
                + '«Луч с оросителями» — начать на магистрали и щёлкать точки оросителей. '
                + 'Таблица заполнится сама.</div>' + warningsHtml(net.warnings);
        }

        var h = calc.head;
        html += '<div class="cards small">'
            + card('Q расчётный', n2(h.Q) + ' л/с', n2(h.Q * 3.6) + ' м³/ч')
            + card('Нсети × ' + Fmt.trim(h.localFactor, 2), n2(h.Hnet) + ' м', 'без местных ' + n2(h.HnetRaw))
            + card('Нтр', n2(h.Hreq) + ' м', s.planKind === 'vpv'
                ? 'Нпк ' + n2(h.Hfree) + ' м' : 'Нуу ' + n2(h.Hcu) + ' м')
            + card('Ннас = Нтр − Нгар', n2(h.HpumpReq) + ' м', 'Нгар ' + n2(h.Hguar) + ' м', h.HpumpReq > 0 ? '' : 'ok')
            + '</div>';

        /*
            Воздушное внутреннее пожаротушение: объём и время подачи воды видны
            здесь же, рядом с напорами. В записку идёт только объём, поэтому
            время смотрят на этой вкладке и в приложении.
        */
        if (s.planKind === 'vpv' && calc.air && calc.air.on) {
            var a = calc.air;
            var bigV = a.volume > a.limit + 1e-9;
            var bigT = a.fill > 30 + 1e-9;

            html += '<div class="cards small">'
                + card('Объём сети', Fmt.num(a.volume * 1000, 0) + ' л',
                    bigV ? 'больше предельного 1 м³' : 'не более 1 м³ (п. 8.4)', bigV ? 'bad' : 'ok')
                + card('Вода в диктующий ПК', Fmt.num(a.fill, a.fill < 100 ? 1 : 0) + ' с',
                    bigT ? 'больше предельных 30 с' : 'не более 30 с (п. 8.4)', bigT ? 'bad' : 'ok')
                + '</div>';
        }

        html += warningsHtml(net.warnings.concat(calc.warnings));

        if (calc.hydrants.length) {
            html += '<table class="grid pk-table"><thead><tr><th>Пожарный кран</th><th>Струй × расход</th><th>Q, л/с</th>'
                + '<th>Отм. клапана</th><th>Давление нужно, м</th><th>Давление расчётное, м</th><th>Труба подводки</th></tr></thead><tbody>';
            calc.hydrants.forEach(function (k) {
                var off = s.planKind === 'vpv' && !k.working;
                var low = k.reach && !off && k.valve < k.head - 1e-6;
                html += '<tr data-node="' + k.id + '"><td class="name">' + esc(k.name) + (k.dict ? ' <span class="badge red">диктующий</span>' : '')
                    + (off ? ' <span class="badge">' + (k.use === false ? 'исключён' : 'не в расчётном случае') + '</span>' : '')
                    + (!off && k.use === true ? ' <span class="badge violet">назначен</span>' : '')
                    + '</td><td class="num">' + (off ? '—' : k.jets + ' × ' + Fmt.trim(k.flow, 2)) + '</td><td class="num strong">' + n2(k.Q)
                    + '</td><td class="num">' + n2(k.elev) + '</td><td class="num">' + (off ? '—' : n2(k.head))
                    + '</td><td class="num' + (low ? ' bad' : '') + '">' + (k.reach ? n2(k.valve) : 'не соединён')
                    + '</td><td class="num' + (k.supplyDn !== null && k.supplyDn < 65 ? ' bad' : '') + '">'
                    + (k.supplyDn !== null ? 'Ду' + k.supplyDn : '—') + '</td></tr>';
            });
            html += '</tbody></table>';
        }

        var sel = App.selection;
        var marked = {};
        if (sel && sel.type === 'seg') marked[sel.id] = true;
        if (sel && sel.type === 'branch' && sel.branch) sel.branch.segs.forEach(function (id) { marked[id] = true; });

        // На плане кранов в тех же столбцах стоят λ и Re: счёт по Шевелеву.
        var byPlanTable = s.planKind === 'vpv';

        html += '<div class="table-wrap"><table class="grid calc"><thead><tr>'
            + '<th>№ уч.</th><th>Напор Н,<br>м</th><th>' + (byPlanTable ? 'λ' : 'Kт') + '</th>'
            + '<th>' + (byPlanTable ? 'Re' : 'k') + '</th><th>Расход Q,<br>л/с</th><th>Ду · размер</th>'
            + '<th>Dнар,<br>мм</th><th>Стенка,<br>мм</th><th>Материал</th><th>V,<br>м/с</th><th>L, м</th><th>ΔH, м</th>'
            + '</tr></thead><tbody>';

        calc.rows.forEach(function (r) {
            if (r.type === 'group') {
                var firstSeg = net.N[r.group.path[0]].pseg;
                html += '<tr class="group-row ' + r.group.kind + '"' + (r.group.kind === 'branch' ? ' data-group-seg="' + firstSeg + '"' : '')
                    + '><td colspan="12">' + esc(r.text) + '</td></tr>';
                return;
            }

            if (r.type === 'summary') {
                html += '<tr class="summary-row"><td>' + esc(r.name) + '</td><td class="num">' + n2(r.Hk)
                    + '</td><td></td><td></td><td class="num strong">' + n2(r.Q) + '</td><td colspan="7" class="formula">'
                    + esc(Report.summaryText(r)) + '</td></tr>';
                return;
            }

            if (r.type === 'total') {
                html += '<tr class="total-row"><td>Итого</td><td class="num">' + n2(r.H) + '</td><td></td><td></td><td class="num">'
                    + n2(r.Q) + '</td><td colspan="6"></td><td class="num">' + n2(r.dH) + '</td></tr>';
                return;
            }

            var seg = Model.seg(p, r.segId);
            var node = Model.node(p, r.nodeId);
            var geom = Model.geomLength(p, seg);
            var ktNote = r.ktSource === 'shevelev' ? 'формуле ' + (Vpv.FORMULAS[(s.hydr || {}).formula] || Vpv.FORMULAS.shevelev)
                : r.ktSource === 'formula' ? 'Kт по формуле: размера нет в таблице'
                    : r.ktSource === 'manual' ? 'Kт введено вручную' : 'Kт из таблицы';

            html += '<tr data-seg="' + r.segId + '" class="' + (marked[r.segId] ? 'selected' : '') + '">'
                + '<td class="name">' + esc(r.name)
                + (r.ring ? ' <span class="badge" title="полукольцо: 50 % расхода">½</span>' : '')
                + (r.fixed ? ' <span class="badge violet" title="постоянный расход в узле">+' + Fmt.trim(r.fixed, 2) + '</span>' : '')
                + '</td>'
                + '<td class="num">' + n2(r.H) + '</td>'
                // λ и Re считаются по скорости — вписывать их нечем.
                + (byPlanTable
                    ? '<td class="num" title="λ по ' + esc(ktNote) + '">' + Fmt.kt(r.kt) + '</td>'
                        + '<td class="num">' + (r.k === null ? '<span class="dim">—</span>' : Fmt.num(r.k, 0)) + '</td>'
                    : '<td><input class="cell' + (r.ktManual ? ' manual' : '') + (r.ktSource === 'formula' ? ' formula' : '') + '" data-key="seg:' + r.segId + ':kt" value="'
                        + (r.ktManual ? esc(valueText(r.kt)) : '') + '" placeholder="' + esc(Fmt.kt(r.kt)) + '" title="' + esc(ktNote) + '"></td>'
                        + '<td>' + (r.k === null ? '<span class="dim">—</span>'
                            : '<input class="cell short' + (node.k > 0 ? ' manual' : '') + '" data-key="node:' + r.nodeId + ':k" value="'
                            + (node.k > 0 ? esc(valueText(node.k)) : '') + '" placeholder="' + esc(Fmt.trim(r.k, 3)) + '">') + '</td>')
                + '<td class="num strong">' + n2(r.Q) + '</td>'
                + '<td>' + sizeSelect('seg:' + r.segId + ':size', seg.material, seg.od, seg.wall, true, 'cell-select') + '</td>'
                + '<td class="num">' + Fmt.trim(r.od, 1) + '</td>'
                + '<td class="num">' + Fmt.trim(r.wall, 1) + '</td>'
                + '<td>' + materialSelect('seg:' + r.segId + ':material', seg.material, 'cell-select') + '</td>'
                + '<td class="num' + (r.Vactual > Solver.MAX_VELOCITY ? ' bad' : '') + '">' + n2(r.V) + '</td>'
                + '<td><input class="cell' + (r.lenManual ? ' manual' : '') + '" data-key="seg:' + r.segId + ':len" value="'
                + (r.lenManual ? esc(valueText(r.L)) : '') + '" placeholder="' + esc(Fmt.num(geom, 2)) + '" title="Пусто — длина по плану"></td>'
                + '<td class="num">' + n2(r.dH) + '</td>'
                + '</tr>';
        });

        html += '</tbody></table></div>'
            + '<p class="hint">Серые числа в полях — из плана и таблиц. Впишите своё — ячейка станет жирной и будет '
            + 'использоваться вместо расчётной; сотрите — вернётся расчётное. Щелчок по строке показывает участок на плане.</p>';

        return html;
    }

    /* --- вкладка «Вывод» ----------------------------------------------------- */

    function renderOutput() {
        return '<div class="calc-bar"><button data-action="print" class="primary">Печать / PDF</button>'
            + '<button data-action="xlsx">Выгрузить .xlsx</button>'
            + '<button data-action="copy-tsv">Копировать таблицу</button>'
            + '<button data-action="png">Картинка плана</button></div>'
            + '<div class="report">' + Report.html(App) + '</div>';
    }

    /* --- вкладка «Нумерация и подписи» --------------------------------------- */

    /*
        Коридор жилого дома выше 75 м.

        Вкладка делает ровно три вещи: показывает, что размечено, хранит
        правила расстановки и запускает сборку. Сама расстановка живёт в
        corridor.js — здесь только кнопки, иначе правила разъехались бы между
        окном и расчётом.
    */
    function renderCorridor() {
        var p = App.project;
        var c = p.corridor || { axis: [], doors: [], notes: [] };
        var s = p.settings.corridor || {};
        var phase = Tools.corridorPhase();
        var drawing = Tools.current() === 'corridor';

        var len = c.axis.length > 1 ? Corridor.length(c.axis) : 0;

        var state = '<p class="hint">Ось: ' + (c.axis.length > 1
            ? Fmt.num(len, 2) + ' м, точек ' + c.axis.length
            : 'не проведена')
            + '. Квартирных дверей отмечено: ' + c.doors.length + '.</p>';

        if (!drawing) {
            state += '<p class="hint">Разметка чертится инструментом «Коридор» слева.</p>';
        } else {
            state += '<p class="hint">Сейчас отмечается: <b>'
                + (phase === 'doors' ? 'квартирные двери' : 'ось коридора')
                + '</b>. Enter на плане — следующий шаг.</p>';
        }

        var html = section('Разметка',
            state
            + '<div class="actions">'
            + '<button data-action="corridor-draw">Чертить ось</button>'
            + '<button data-action="corridor-doors">Отмечать двери</button>'
            + '<button data-action="corridor-clear">Снять разметку</button>'
            + '</div>');

        html += section('Правила расстановки',
            '<div class="pair">'
            + numField('Не далее от двери, м', 'set:corridor.doorReach', s.doorReach)
            + numField('От торца коридора, м', 'set:corridor.endReach', s.endReach)
            + '</div>'
            + '<div class="pair">'
            + numField('Шаг не ближе, м', 'set:corridor.minStep', s.minStep)
            + numField('Шаг не далее, м', 'set:corridor.maxStep', s.maxStep)
            + '</div>'
            + '<p class="hint">Ороситель встаёт напротив каждой квартирной двери; '
            + 'если напротив занято, его двигают, но не дальше заданного. Промежутки '
            + 'добираются поровну. От торца пусто — берётся половина наибольшего шага.</p>');

        html += section('Диаметры трубы',
            textField('Оросителей : Ду, мм', 'set:corridor.diameters', s.diameters)
            + numField('Либо один диаметр на весь коридор, Ду мм', 'set:corridor.dn', s.dn)
            + '<p class="hint">Участок получает диаметр по числу оросителей, которые через '
            + 'него идут, считая от дальнего торца к стояку. Задан один диаметр — он ставится '
            + 'всем участкам; ноль — значит по таблице.</p>');

        html += section('Сборка',
            '<p class="hint">Оросители ставятся на ось, участки соединяются от дальнего '
            + 'торца к последней точке оси. Ввода на плане нет — последняя точка становится '
            + 'вводом, то есть врезкой в стояк; ввод уже есть — коридор прицепляется к нему.</p>'
            + '<div class="actions"><button class="primary" data-action="corridor-place">'
            + 'Расставить и собрать трубу</button></div>');

        if (c.notes && c.notes.length) {
            html += section('Замечания расстановки',
                '<ul class="notes">' + c.notes.map(function (t) {
                    return '<li>' + esc(t) + '</li>';
                }).join('') + '</ul>');
        }

        return html;
    }

    function renderNumbering() {
        var s = App.project.settings;
        var num = s.num;
        var L = s.labels;
        var mainStyles = Calc.STYLES.filter(function (st) {
            return st.key === 'digits' || st.key === 'letters' || st.key === 'latin';
        }).map(function (st) { return [st.key, st.name]; });
        var branchStyles = Calc.STYLES.map(function (st) { return [st.key, st.name]; });

        var html = section('Основные участки — от диктующего оросителя до ввода',
            '<div class="pair">' + selectField('Стиль', 'set:num.mainStyle', num.mainStyle, mainStyles)
            + numField('Начать с номера', 'set:num.mainStart', num.mainStart) + '</div>'
            + '<div class="pair">' + textField('Приставка', 'set:num.mainPrefix', num.mainPrefix)
            + textField('Суффикс', 'set:num.mainSuffix', num.mainSuffix) + '</div>');

        html += section('Второстепенные участки — лучи',
            '<div class="pair">' + selectField('Стиль', 'set:num.branchStyle', num.branchStyle, branchStyles)
            + numField('Начать с номера', 'set:num.branchStart', num.branchStart) + '</div>'
            + '<div class="pair">' + textField('Приставка', 'set:num.branchPrefix', num.branchPrefix)
            + textField('Суффикс', 'set:num.branchSuffix', num.branchSuffix) + '</div>'
            + selectField('Узел, где луч встречает магистраль', 'set:num.attach', num.attach,
                [['own', 'своя метка луча (г-д, как в Excel)'], ['main', 'метка узла магистрали (г-5)']]));

        html += section('Общее',
            selectField('Направление счёта', 'set:num.direction', num.direction,
                [['dict', 'от диктующего оросителя (как в СП)'], ['source', 'от ввода']])
            + '<div class="pair">' + textField('Подпись ввода', 'set:num.sourceLabel', num.sourceLabel)
            + textField('Подпись узла управления', 'set:num.cuLabel', num.cuLabel) + '</div>'
            + '<p class="hint">Своя подпись узла задаётся в его свойствах слева и сохраняется при любой перенумерации.</p>'
            + '<div class="actions"><button data-action="labels-reset">Сбросить все свои подписи</button></div>');

        html += section('Подписи на плане',
            '<div class="checks">'
            + checkField('номера узлов', 'set:labels.nodes', L.nodes)
            + checkField('напор в узлах', 'set:labels.pressure', L.pressure)
            + checkField('расходы', 'set:labels.flow', L.flow)
            + checkField('длины участков', 'set:labels.length', L.length)
            + checkField('потери напора', 'set:labels.loss', L.loss)
            + checkField('диаметры', 'set:labels.pipe', L.pipe)
            + checkField('круги орошения', 'set:labels.circles', L.circles)
            + '</div><p class="hint">Длина со звёздочкой — введена вручную и отличается от плана.</p>');

        if (App.calc && App.calc.ok) {
            html += section('Что получилось', '<div class="groups-preview">' + App.calc.groups.map(function (g) {
                return '<div><b>' + esc(g.kind === 'main' ? 'Основная' : 'Луч') + '</b> ' + esc(g.name)
                    + (g.analogOf ? ' <span class="dim">— аналог ' + esc(g.analogOf.name) + '</span>' : '') + '</div>';
            }).join('') + '</div>');
        }

        return html;
    }

    /* --- вкладка «Трубы» ------------------------------------------------------ */

    function renderPipes() {
        var html = '<p class="hint">Удельные характеристики Kт — лист «Удельн. хар-ки тр-в» калькулятора и СП 485 табл. Б.2. '
            + 'Размер, которого нет в таблице, считается по формуле Kт = 10⁻¹⁰·864,6122·(Dвн − 1)^5,3333 и помечается. '
            + 'Kт конкретного участка можно вписать вручную в таблице расчёта.</p>';

        Catalog.MATERIALS.forEach(function (m) {
            html += '<h4 class="pipes-title">' + esc(m.key) + ' <span class="dim">' + esc(m.name) + '</span></h4>'
                + '<table class="grid pipes"><thead><tr><th>Ду</th><th>Dнар, мм</th><th>Стенка, мм</th><th>Dвн, мм</th><th>Kт</th></tr></thead><tbody>';
            m.sizes.forEach(function (r) {
                html += '<tr><td>' + r.dn + '</td><td class="num">' + Fmt.trim(r.od, 1) + '</td><td class="num">' + Fmt.trim(r.wall, 1)
                    + '</td><td class="num">' + Fmt.trim(Catalog.inner(r.od, r.wall), 1) + '</td><td class="num">' + Fmt.kt(r.kt) + '</td></tr>';
            });
            html += '</tbody></table>';
        });

        return html;
    }

    /* --- стояк ------------------------------------------------------------------ */

    /**
        Вкладка «Стояк» у плана этажа: точка «Ввод» на плане — это врезка в
        стояк, а не ввод в здание. Здесь видно, каким этажам принадлежит план,
        что идёт после врезки (стояк, магистраль, узел управления, насосная) и
        каким выходит требуемый напор всей системы.
    */
    function renderRiser() {
        if (!App.plan) return '<p class="empty">Вкладка «Стояк» — для плана этажа системы «АПТ по этажам».</p>';

        var sys = Systems.find(App.book, App.plan.sys);
        if (!sys || !sys.floors) return '<p class="empty">Система не найдена.</p>';

        var v = sys.floors;
        var res = Floors.solve(v, App.book);
        var head = '<div class="calc-bar"><button data-action="riser-open" class="primary">← Схема стояка ' + esc(sys.code) + '</button></div>'
            + '<p class="hint">Точка «Ввод» на плане — врезка в стояк ' + esc(sys.code) + '. Отметки этажей, стояк, магистраль, '
            + 'узел управления и насосная задаются на схеме стояка; здесь показано, чем продолжается расчёт этого плана.</p>';

        if (!res.ok) return head + '<p class="empty">' + esc(res.errors.join(' ')) + '</p>';

        var chain = Floors.chain(v, res, App.plan.plan);
        var used = res.floors.filter(function (r) { return r.plan && String(r.plan.id) === String(App.plan.plan); });

        head += '<h4 class="pipes-title">План «' + esc(App.plan.name) + '» — этажи</h4>'
            + '<p>' + (used.length
                ? esc(used.map(function (r) { return r.section.name + ' ' + r.floor.label; }).join(', '))
                : '<span class="dim">ни один этаж не использует этот план</span>') + '</p>';

        if (!chain) return head;

        var rec = chain.rec;
        var i = v.inlet;

        head += '<h4 class="pipes-title">После врезки — ' + esc(rec.section.name + ', ' + rec.floor.label)
            + ' (по нему план диктует)</h4>'
            + '<table class="grid"><thead><tr><th>Участок</th><th>Q, л/с</th><th>Труба</th><th>L, м</th><th>Kт</th>'
            + '<th>V, м/с</th><th>ΔH, м</th></tr></thead><tbody>'
            + chain.rows.map(function (r) {
                return '<tr><td>' + esc(r.name) + '</td><td class="num">' + n2(r.Q) + '</td><td>'
                    + esc((r.dn ? 'Ду' + r.dn + ' ' : '') + r.od + '×' + r.wall) + '</td><td class="num">' + n2(r.L)
                    + '</td><td class="num">' + Fmt.kt(r.kt) + '</td><td class="num">' + n2(r.V)
                    + '</td><td class="num">' + Fmt.num(r.dH, 3) + '</td></tr>';
            }).join('')
            + '</tbody></table>';

        head += '<h4 class="pipes-title">Требуемый напор системы ' + esc(sys.code) + '</h4>'
            + '<table class="grid"><tbody>'
            + [
                ['Напор у врезки этажа (от оросителя по сети этажа)', chain.atTee],
                ['ΔH стояка до магистрали', rec.dHr],
                ['ΔH магистрали до насосной', rec.dHm],
                ['Нсети = (' + Fmt.num(rec.HplanRaw, 3) + ' + ' + Fmt.num(rec.dHr, 3) + ' + ' + Fmt.num(rec.dHm, 3)
                    + ') · ' + Fmt.trim(i.localFactor, 2), rec.Hnet],
                ['Нгеом от оси ввода до оросителей этажа', rec.Hgeom],
                ['Нуу — узел управления ' + i.cuKind + ' Ду' + i.cuDn, rec.Hcu],
                ['Нсв у диктующего оросителя', rec.Hfree],
                ['Поэтажный узел и насосная', v.floorNodeLoss + i.stationLoss]
            ].map(function (r) {
                return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + Fmt.num(r[1], 3) + '</td></tr>';
            }).join('')
            + '<tr class="total-row"><td>Нтр этажа</td><td class="num">' + n2(rec.Htr) + '</td></tr>'
            + '<tr class="total-row"><td>Нр = Нтр − Нгар (' + n2(i.guaranteed) + ')</td><td class="num">' + n2(rec.Hp) + '</td></tr>'
            + '<tr class="total-row"><td>Диктующий этаж системы: ' + esc(res.dict.section.name + ', ' + res.dict.floor.label)
            + '</td><td class="num">' + n2(res.dict.Htr) + '</td></tr>'
            + '</tbody></table>';

        if (rec.dia && rec.dia.ok) {
            head += '<p class="hint">На этом этаже подобрана диафрагма ⌀' + Fmt.trim(rec.dia.d, 1) + ' мм: срезает '
                + n2(rec.dia.cut) + ' м, после неё у врезки ' + n2(rec.after) + ' м.</p>';
        }

        return head;
    }

    /* --- общее ------------------------------------------------------------------ */

    function renderTabs() {
        // Вкладка «Стояк» — только у плана этажа системы «АПТ по этажам».
        var list = TABS.filter(function (t) { return !t.plan || App.plan; });
        if (!list.some(function (t) { return t.key === tab; })) tab = 'calc';

        $('tabs').innerHTML = list.map(function (t) {
            return '<button data-tab="' + t.key + '"' + (t.key === tab ? ' class="active"' : '') + '>' + esc(t.name) + '</button>';
        }).join('');
    }

    function renderTab() {
        var body = $('tabBody');
        var html = '';

        switch (tab) {
            case 'inputs': html = renderInputs(); break;
            case 'riser': html = renderRiser(); break;
            case 'corridor': html = renderCorridor(); break;
            case 'output': html = renderOutput(); break;
            case 'numbering': html = renderNumbering(); break;
            case 'binding': html = renderBinding(); break;
            case 'pipes': html = renderPipes(); break;
            default: html = renderCalc();
        }

        body.dataset.tab = tab;
        rerender(body, html);
    }

    function updateTools() {
        var current = Tools.current();
        document.querySelectorAll('[data-tool]').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tool === current);
        });

        /*
            На плане внутреннего пожаротушения оросителей, узла управления и
            расчётной зоны нет — инструменты только мешали бы. Если такой
            инструмент был выбран, возвращаемся к выбору.
        */
        var byPlan = App.project && App.project.settings.planKind === 'vpv';
        $('tools').classList.toggle('vpv-plan', !!byPlan);
        if (byPlan && ['ray', 'sprinkler', 'cu', 'zone', 'corridor'].indexOf(current) >= 0) Tools.set('select');
    }

    function updateTop() {
        var net = App.net;
        var calc = App.calc;
        var undo = $('undoBtn');
        var redo = $('redoBtn');

        undo.disabled = !History.canUndo();
        redo.disabled = !History.canRedo();
        undo.title = History.canUndo() ? 'Отменить: ' + History.undoLabel() + ' (Ctrl+Z)' : 'Отменять нечего';
        redo.title = History.canRedo() ? 'Вернуть: ' + History.redoLabel() + ' (Ctrl+Y)' : 'Возвращать нечего';

        var summary = $('summary');
        if (net && net.ok && calc && calc.ok) {
            var h = calc.head;
            var count = net.warnings.length + calc.warnings.length;
            summary.innerHTML = '<span>Q <b>' + n2(h.Q) + '</b> л/с</span><span>Нтр <b>' + n2(h.Hreq)
                + '</b> м</span><span>Ннас <b>' + n2(h.HpumpReq) + '</b> м</span>'
                + (count ? '<span class="warn" title="' + esc(net.warnings.concat(calc.warnings).join('\n')) + '">замечаний: ' + count + '</span>' : '');
        } else {
            summary.innerHTML = '<span class="dim">' + esc(net ? net.errors.join(' ') : '') + '</span>';
        }

        var u = App.project.underlay;
        document.querySelector('.viewbar').classList.toggle('no-underlay', !u);
        if (u) {
            $('ulOpacity').value = u.opacity === undefined ? 0.6 : u.opacity;
            $('ulVisible').checked = u.visible !== false;
        }

        var d = App.project.dxf;
        document.querySelector('.viewbar').classList.toggle('no-dxf', !d);
        if (d) {
            $('dxfVisible').checked = d.visible !== false;
            // Тяжёлый чертёж не влезает в память браузера: после перезапуска
            // он приходит пустым, и об этом честнее сказать прямо в панели.
            $('dxfLabel').textContent = d.ents && d.ents.length ? 'Чертёж' : 'Чертёж (не в памяти)';
            $('dxfLabel').title = d.ents && d.ents.length
                ? d.name + ' — 1 ед. = ' + Fmt.trim(d.factor, 6) + ' м, ' + Fmt.num(d.w, 2) + ' × ' + Fmt.num(d.h, 2) + ' м'
                : 'Чертёж не поместился в автосохранение браузера: откройте файл проекта или вставьте DXF заново.';
        }
    }

    function refresh() {
        updateTools();
        updateTop();
        // Набор вкладок зависит от места: у плана этажа добавляется «Стояк».
        renderTabs();
        renderInspector();
        renderTab();
    }

    function init() {
        try { tab = localStorage.getItem('sprinkler-web:tab') || 'calc'; } catch (e) { tab = 'calc'; }

        renderTabs();

        $('tabs').addEventListener('click', function (e) {
            var b = e.target.closest('button[data-tab]');
            if (!b) return;
            tab = b.dataset.tab;
            try { localStorage.setItem('sprinkler-web:tab', tab); } catch (err) { /* без памяти вкладки */ }
            renderTabs();
            renderTab();
        });

        document.querySelectorAll('#tools, .viewbar').forEach(function (bar) {
            bar.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-tool]');
                if (b) Tools.set(b.dataset.tool);
            });
        });

        [$('tabBody'), $('inspector')].forEach(function (el) {
            el.addEventListener('change', onChange);
            el.addEventListener('click', onClick);
        });

        $('tabBody').addEventListener('mouseover', function (e) {
            var tr = e.target.closest('tr[data-seg]');
            var id = tr ? Number(tr.dataset.seg) : null;
            if (App.hoverSeg !== id) {
                App.hoverSeg = id;
                View.render();
            }
        });

        $('tabBody').addEventListener('mouseleave', function () {
            App.hoverSeg = null;
            View.render();
        });

        // Ширина правой панели — перетаскиванием разделителя.
        var panel = $('rightPanel');
        try {
            var saved = Number(localStorage.getItem('sprinkler-web:right'));
            if (saved > 300) panel.style.width = saved + 'px';
        } catch (e) { /* по умолчанию */ }

        $('splitter').addEventListener('pointerdown', function (e) {
            var splitter = e.currentTarget;
            splitter.setPointerCapture(e.pointerId);

            function move(ev) {
                var w = Math.max(340, Math.min(window.innerWidth - 420, window.innerWidth - ev.clientX));
                panel.style.width = w + 'px';
                View.resize();
            }

            function up() {
                splitter.removeEventListener('pointermove', move);
                splitter.removeEventListener('pointerup', up);
                try { localStorage.setItem('sprinkler-web:right', parseInt(panel.style.width, 10)); } catch (err) { /* ничего */ }
            }

            splitter.addEventListener('pointermove', move);
            splitter.addEventListener('pointerup', up);
        });
    }

    return {
        init: init,
        refresh: refresh,
        updateTools: updateTools
    };
})();
